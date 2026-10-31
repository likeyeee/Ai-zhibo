/**
 * 数字人形象。
 *
 * local：播出页和预览间用肖像、演播室背景、眨眼和口型。口型默认跟口播文本的时间轴；
 * 有 TTS 音频时，页面再用音量修正张开程度。
 * video：循环播放 AVATAR_VIDEO_URL。
 * http：每句口播 POST 到 AVATAR_HTTP_URL，期望 { "videoUrl": "https://..." }。
 * 失败或没填地址时退回 local，并在系统信息里标成降级。
 * livekit：房间里由外部参与者发布视频轨（LiveKit Agents 的 Tavus、Hedra、Simli、
 * bitHuman 插件，或 Ingress 进来的一路 RTMP）。本进程不内置这些 SDK。
 * 没配好 LiveKit 时退回 local。
 * heygem：调用本机 Duix HeyGem 的离线成片接口。口播预先提交，回复不等待。
 * 没配数据目录、驱动视频或参考音频时退回 local。
 * musetalk：POST { text, audioUrl, portraitUrl, mouthOnly: true, hostId, language } 到 MUSETALK_URL，
 * 期望 { "videoUrl": "..." }。只驱动嘴部。超时约 8 秒，失败或没填地址时退回 local。
 * lingbo：本机 services/lingbo-avatar。服务没起来时退回 local。
 * 返回的视频地址只有 MuseTalk 写出了口型才使用；静图成片不会替换二维口型。
 */
import type { AvatarProviderId, Persona, SpeechPurpose } from '@lingbo/shared';
import type { AppConfig } from '../config';
import { HeygemAvatar } from './heygem';
import { lingboClip, lingboHealth, lingboPublish } from './lingbo';

export interface AvatarPresentation {
  id: AvatarProviderId;
  configured: AvatarProviderId;
  degraded: boolean;
  videoUrl: string | null;
}

export interface AvatarClipInput {
  text: string;
  persona: Persona;
  purpose?: SpeechPurpose;
  audioUrl?: string | null;
  portraitUrl?: string | null;
}

export interface AvatarRoomPublish {
  text: string;
  persona: Persona;
  audioUrl?: string | null;
  videoUrl?: string | null;
  livekitUrl: string;
  token: string;
}

export interface AvatarProvider {
  readonly presentation: AvatarPresentation;
  prepare?(input: { texts: string[]; persona: Persona }): void;
  refresh?(): Promise<void>;
  clipFor(input: AvatarClipInput): Promise<string | null>;
  publishToRoom?(input: AvatarRoomPublish): Promise<void>;
}

export function createAvatar(config: AppConfig, fetchImpl: typeof fetch = fetch): AvatarProvider {
  return new SwitchingAvatar(config, fetchImpl);
}

class SwitchingAvatar implements AvatarProvider {
  private clipFailed = false;
  private musetalkFailed = false;
  private lingboDown = true;
  private readonly heygem: HeygemAvatar | null;

  constructor(
    private readonly config: AppConfig,
    private readonly fetchImpl: typeof fetch,
  ) {
    this.heygem = config.avatarProvider === 'heygem' ? new HeygemAvatar(config, fetchImpl) : null;
  }

  get presentation(): AvatarPresentation {
    if (this.heygem) return this.heygem.presentation;
    const configured = this.config.avatarProvider;
    if (configured === 'video') {
      if (!this.config.avatarVideoUrl) return { id: 'local', configured, degraded: true, videoUrl: null };
      return { id: 'video', configured, degraded: false, videoUrl: this.config.avatarVideoUrl };
    }
    if (configured === 'http') {
      if (!this.config.avatarHttpUrl) return { id: 'local', configured, degraded: true, videoUrl: null };
      return { id: 'http', configured, degraded: this.clipFailed, videoUrl: null };
    }
    if (configured === 'livekit') {
      if (!livekitAvatarReady(this.config)) return { id: 'local', configured, degraded: true, videoUrl: null };
      return { id: 'livekit', configured, degraded: false, videoUrl: null };
    }
    if (configured === 'musetalk') {
      if (!this.config.musetalkUrl) return { id: 'local', configured, degraded: true, videoUrl: null };
      return { id: 'musetalk', configured, degraded: this.musetalkFailed, videoUrl: null };
    }
    if (configured === 'lingbo') {
      if (this.lingboDown) return { id: 'local', configured, degraded: true, videoUrl: null };
      return { id: 'lingbo', configured, degraded: this.clipFailed, videoUrl: null };
    }
    return { id: 'local', configured: 'local', degraded: false, videoUrl: null };
  }

  async refresh() {
    if (this.config.avatarProvider !== 'lingbo') return;
    this.lingboDown = !(await lingboHealth(this.config.lingboAvatarUrl, this.fetchImpl)).ok;
  }

  prepare(input: { texts: string[]; persona: Persona }) {
    this.heygem?.prepare(input);
  }

  async publishToRoom(input: AvatarRoomPublish): Promise<void> {
    if (this.config.livekitHostPublisher !== 'lingbo') return;
    await lingboPublish(this.config, this.fetchImpl, input);
  }

  async clipFor(input: AvatarClipInput): Promise<string | null> {
    if (this.heygem) return this.heygem.clipFor(input);
    if (this.config.avatarProvider === 'lingbo') return this.lingboClip(input);
    if (this.config.avatarProvider === 'musetalk' && this.config.musetalkUrl) return this.musetalkClip(input);
    if (this.config.avatarProvider !== 'http' || !this.config.avatarHttpUrl) return null;
    try {
      const response = await this.fetchImpl(this.config.avatarHttpUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.avatarApiKey ? { Authorization: `Bearer ${this.config.avatarApiKey}` } : {}),
        },
        body: JSON.stringify({
          text: input.text,
          voice: input.persona.voice,
          hostId: input.persona.hostId,
          language: 'zh-CN',
        }),
        signal: AbortSignal.timeout(12000),
      });
      if (!response.ok) throw new Error(`avatar ${response.status}`);
      const data = (await response.json()) as { videoUrl?: string };
      if (!data.videoUrl || !isPlayable(data.videoUrl)) throw new Error('avatar 响应缺少 videoUrl');
      this.clipFailed = false;
      return data.videoUrl;
    } catch (error) {
      this.clipFailed = true;
      console.error('形象服务调用失败，改用本地肖像', error instanceof Error ? error.message : 'avatar_failed');
      return null;
    }
  }

  private async lingboClip(input: AvatarClipInput): Promise<string | null> {
    const snap = await lingboHealth(this.config.lingboAvatarUrl, this.fetchImpl);
    this.lingboDown = !snap.ok;
    if (!snap.ok) return null;
    try {
      const video = await lingboClip(this.config, this.fetchImpl, input);
      this.clipFailed = false;
      return video;
    } catch (error) {
      const down = !(await lingboHealth(this.config.lingboAvatarUrl, this.fetchImpl).catch(() => ({ ok: false }))).ok;
      this.lingboDown = down;
      this.clipFailed = !down;
      console.error('本机形象不可用，改用本地肖像', error instanceof Error ? error.message : 'avatar_failed');
      return null;
    }
  }

  private async musetalkClip(input: AvatarClipInput): Promise<string | null> {
    try {
      const response = await this.fetchImpl(this.config.musetalkUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: input.text,
          audioUrl: input.audioUrl ?? null,
          portraitUrl: input.portraitUrl ?? null,
          mouthOnly: true,
          hostId: input.persona.hostId,
          language: 'zh-CN',
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error(`musetalk ${response.status}`);
      const data = (await response.json()) as { videoUrl?: string };
      if (!data.videoUrl || !isPlayable(data.videoUrl)) throw new Error('musetalk 响应缺少 videoUrl');
      this.musetalkFailed = false;
      return data.videoUrl;
    } catch (error) {
      this.musetalkFailed = true;
      console.error('MuseTalk 调用失败，改用本地肖像', error instanceof Error ? error.message : 'avatar_failed');
      return null;
    }
  }
}

function livekitAvatarReady(config: AppConfig): boolean {
  return config.realtimeProvider === 'livekit' && Boolean(config.livekitUrl && config.livekitApiKey && config.livekitApiSecret);
}

function isPlayable(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}
