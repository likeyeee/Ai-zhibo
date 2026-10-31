/**
 * 实时音视频。
 *
 * local：不连接 LiveKit。口播、字幕和评论走原来的 WebSocket，
 * 观众页用内置矢量主播，浏览器语音可选。
 *
 * livekit：用 livekit-server-sdk 在本地签发进房令牌（不把密钥交给浏览器）。
 * 房间名 lingbo-<场次 id>，主播身份固定为 host。
 * 浏览器导播台会把画面推进这个房间；观众订阅。
 * 评论和口播文本同时写到 data channel，topic 为 `lingbo`。
 *
 * LiveKit Agents 适合把 TTS 音频从服务端推上来。那一步不放进本进程：
 * 把 LIVEKIT_HOST_PUBLISHER 设为 agent 后，浏览器不再推画面，
 * 由外部 Agent 以身份 host 进房，并监听 topic `lingbo` 里的 speech 包。
 * 设为 lingbo 时，浏览器同样不推音视频，由本机数字人服务以身份 lingbo-avatar 进房。
 */
import { AccessToken } from 'livekit-server-sdk';
import type { RealtimeJoin, RealtimeRole } from '@lingbo/shared';
import type { AppConfig } from '../config';

export interface RealtimeProvider {
  readonly id: 'local' | 'livekit';
  join(input: { sessionId: string; role: RealtimeRole; identity: string; name: string }): Promise<RealtimeJoin>;
}

export function liveKitRoomName(sessionId: string): string {
  return `lingbo-${sessionId}`;
}

export function createRealtime(config: AppConfig): RealtimeProvider {
  if (config.realtimeProvider === 'livekit' && config.livekitUrl && config.livekitApiKey && config.livekitApiSecret) {
    return new LiveKitRealtime(config);
  }
  return new LocalRealtime();
}

class LocalRealtime implements RealtimeProvider {
  readonly id = 'local' as const;

  async join(input: { role: RealtimeRole }): Promise<RealtimeJoin> {
    return {
      provider: 'local',
      url: null,
      room: null,
      token: null,
      role: input.role,
      publishMedia: false,
      hostPublisher: 'browser',
    };
  }
}

export class LiveKitRealtime implements RealtimeProvider {
  readonly id = 'livekit' as const;

  constructor(private readonly config: AppConfig) {}

  async join(input: { sessionId: string; role: RealtimeRole; identity: string; name: string }): Promise<RealtimeJoin> {
    const room = liveKitRoomName(input.sessionId);
    const publishMedia = input.role === 'host' && this.config.livekitHostPublisher === 'browser';
    const hostPublisher = this.config.livekitHostPublisher;
    const token = new AccessToken(this.config.livekitApiKey, this.config.livekitApiSecret, {
      identity: input.identity,
      name: input.name,
      ttl: '6h',
    });
    token.addGrant({
      roomJoin: true,
      room,
      canPublish: publishMedia,
      canSubscribe: true,
      canPublishData: true,
    });
    return {
      provider: 'livekit',
      url: this.config.livekitUrl,
      room,
      token: await token.toJwt(),
      role: input.role,
      publishMedia,
      hostPublisher,
    };
  }
}

export async function mintPublisherToken(config: AppConfig, sessionId: string): Promise<string | null> {
  if (!config.livekitUrl || !config.livekitApiKey || !config.livekitApiSecret) return null;
  const token = new AccessToken(config.livekitApiKey, config.livekitApiSecret, {
    identity: 'lingbo-avatar',
    name: '灵播数字人',
    ttl: '6h',
  });
  token.addGrant({
    roomJoin: true,
    room: liveKitRoomName(sessionId),
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });
  return token.toJwt();
}
