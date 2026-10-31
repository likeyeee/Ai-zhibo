/**
 * 本机数字人服务（services/lingbo-avatar）。
 *
 * 语音：POST /v1/tts，正文是 wav。服务没起来时，这一句只用本地时长，id 仍是 lingbo。
 * 形象：POST /v1/clip。只有返回了 videoUrl（MuseTalk 真的写出了口型）才替换二维口型。
 * 推流：POST /v1/publish，服务立刻返回，再在后台把音频推进 LiveKit。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Persona } from '@lingbo/shared';
import type { AppConfig } from '../config';
import { estimateSpeechMs } from './tts';
import type { SpeechClip, TtsProvider } from './types';

interface LingboHealth {
  ok: boolean;
  tts: string;
  talkingHead: string;
}

const health = new Map<string, LingboHealth & { at: number }>();

export function clearLingboHealth(): void {
  health.clear();
}

export async function lingboHealth(url: string, fetchImpl: typeof fetch): Promise<LingboHealth> {
  const hit = health.get(url);
  if (hit && Date.now() - hit.at < 5000) return hit;
  try {
    const response = await fetchImpl(`${url}/health`, { signal: AbortSignal.timeout(400) });
    const data = response.ok ? ((await response.json()) as { tts?: string; talkingHead?: string }) : {};
    const snap = {
      ok: response.ok,
      tts: typeof data.tts === 'string' ? data.tts : '',
      talkingHead: typeof data.talkingHead === 'string' ? data.talkingHead : '',
      at: Date.now(),
    };
    health.set(url, snap);
    return snap;
  } catch {
    const snap = { ok: false, tts: '', talkingHead: '', at: Date.now() };
    health.set(url, snap);
    return snap;
  }
}

export class LingboTts implements TtsProvider {
  readonly id = 'lingbo' as const;
  degraded = true;

  constructor(
    private readonly config: AppConfig,
    private readonly fetchImpl: typeof fetch,
  ) {}

  async refresh(): Promise<void> {
    const snap = await lingboHealth(this.config.lingboAvatarUrl, this.fetchImpl);
    this.degraded = !snap.ok || snap.tts === 'silent';
  }

  async synthesize(text: string, persona: Persona): Promise<SpeechClip> {
    const fallback = localClip(text, persona);
    if (!this.config.lingboAvatarUrl) {
      this.degraded = true;
      return fallback;
    }
    try {
      const snap = await lingboHealth(this.config.lingboAvatarUrl, this.fetchImpl);
      if (!snap.ok) {
        this.degraded = true;
        return fallback;
      }
      const response = await this.fetchImpl(`${this.config.lingboAvatarUrl}/v1/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          voice: persona.voice,
          hostId: persona.hostId,
          rate: persona.speechRate,
          language: 'zh-CN',
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(`lingbo tts ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength < 44 || bytes[0] !== 0x52) throw new Error('lingbo tts 不是 wav');
      const header = Number(response.headers.get('x-duration-ms'));
      const engine = response.headers.get('x-engine');
      if (engine === 'silent' || snap.tts === 'silent') {
        this.degraded = true;
        return {
          text,
          audioUrl: null,
          durationMs: Number.isFinite(header) && header > 0 ? header : estimateSpeechMs(text, persona.speechRate),
          provider: 'lingbo',
        };
      }
      this.degraded = false;
      return {
        text,
        audioUrl: writeUpload(this.config.dataDir, bytes, 'wav'),
        durationMs: Number.isFinite(header) && header > 0 ? header : estimateSpeechMs(text, persona.speechRate),
        provider: 'lingbo',
      };
    } catch (error) {
      this.degraded = true;
      console.error('本机语音不可用，这一句改用本地时长', error instanceof Error ? error.message : 'tts_failed');
      return fallback;
    }
  }
}

export function createLingboTts(config: AppConfig, fetchImpl: typeof fetch): LingboTts {
  return new LingboTts(config, fetchImpl);
}

export async function lingboClip(
  config: AppConfig,
  fetchImpl: typeof fetch,
  input: { text: string; persona: Persona; audioUrl?: string | null; portraitUrl?: string | null },
): Promise<string | null> {
  const snap = await lingboHealth(config.lingboAvatarUrl, fetchImpl);
  if (!snap.ok) return null;
  const audio = readUpload(config.dataDir, input.audioUrl);
  const portrait = readPortrait(config.dataDir, input.persona.hostId, input.portraitUrl);
  const response = await fetchImpl(`${config.lingboAvatarUrl}/v1/clip`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: input.text,
      voice: input.persona.voice,
      hostId: input.persona.hostId,
      rate: input.persona.speechRate,
      audioBase64: audio ? audio.toString('base64') : undefined,
      portraitBase64: portrait ? portrait.toString('base64') : undefined,
    }),
    signal: AbortSignal.timeout(config.lingboClipTimeoutMs),
  });
  if (!response.ok) throw new Error(`lingbo clip ${response.status}`);
  const data = (await response.json()) as { videoUrl?: string | null };
  if (!data.videoUrl) return null;
  const video = await fetchImpl(data.videoUrl, { signal: AbortSignal.timeout(config.lingboClipTimeoutMs) });
  if (!video.ok) throw new Error(`lingbo video ${video.status}`);
  const bytes = new Uint8Array(await video.arrayBuffer());
  if (bytes.byteLength < 8) throw new Error('lingbo video empty');
  return writeUpload(config.dataDir, bytes, 'mp4');
}

export async function lingboPublish(
  config: AppConfig,
  fetchImpl: typeof fetch,
  input: {
    text: string;
    persona: Persona;
    audioUrl?: string | null;
    videoUrl?: string | null;
    livekitUrl: string;
    token: string;
  },
): Promise<void> {
  const snap = await lingboHealth(config.lingboAvatarUrl, fetchImpl);
  if (!snap.ok) return;
  const audio = readUpload(config.dataDir, input.audioUrl);
  const video = input.videoUrl ? readUpload(config.dataDir, input.videoUrl) : null;
  const response = await fetchImpl(`${config.lingboAvatarUrl}/v1/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      livekitUrl: input.livekitUrl,
      token: input.token,
      text: input.text,
      voice: input.persona.voice,
      hostId: input.persona.hostId,
      rate: input.persona.speechRate,
      audioBase64: audio ? audio.toString('base64') : undefined,
      videoBase64: video ? video.toString('base64') : undefined,
      videoEngine: video ? 'musetalk' : 'portrait',
    }),
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new Error(`lingbo publish ${response.status}`);
}

function localClip(text: string, persona: Persona): SpeechClip {
  return {
    text,
    durationMs: estimateSpeechMs(text, persona.speechRate),
    audioUrl: null,
    provider: 'lingbo',
  };
}

function writeUpload(dataDir: string, bytes: Uint8Array, ext: 'wav' | 'mp4'): string {
  const name = `lingbo-${crypto.randomUUID()}.${ext}`;
  const dir = path.join(dataDir, 'uploads');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), bytes);
  return `/uploads/${name}`;
}

function readUpload(dataDir: string, url: string | null | undefined): Buffer | null {
  if (!url || !url.startsWith('/uploads/')) return null;
  const name = path.basename(url);
  if (!/^[\w.-]+$/.test(name)) return null;
  const file = path.join(dataDir, 'uploads', name);
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file);
}

function readPortrait(dataDir: string, hostId: string, portraitUrl: string | null | undefined): Buffer | null {
  const uploaded = readUpload(dataDir, portraitUrl);
  if (uploaded) return uploaded;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, '../../../web/public/hosts', `${hostId}.jpg`),
    path.resolve(process.cwd(), 'web/public/hosts', `${hostId}.jpg`),
    path.resolve(process.cwd(), '../web/public/hosts', `${hostId}.jpg`),
  ];
  const file = candidates.find((item) => fs.existsSync(item));
  return file ? fs.readFileSync(file) : null;
}
