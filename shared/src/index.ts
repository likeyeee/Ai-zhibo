import { coerceHostId, hostById, type HostId } from './hosts';

export { HOST_IDS, HOSTS, STUDIO_BACKGROUND, coerceHostId, hostById } from './hosts';
export type { HostFace, HostId, HostProfile } from './hosts';
export { blendOpenness, blinkAmount, idlePose, mouthBox, visemeAt } from './stage';
export type { IdlePose, MouthBox, VisemeFrame, VisemeShape } from './stage';

export const TONES = ['enthusiastic', 'professional', 'gentle', 'humorous'] as const;

export type Tone = (typeof TONES)[number];

export type SessionStatus = 'live' | 'ended';

export type ScriptKind = 'opening' | 'selling_point' | 'price' | 'faq' | 'closing';

export type LlmProviderId = 'mock' | 'openai';

export type TtsProviderId = 'mock' | 'http' | 'cosyvoice' | 'gpt-sovits' | 'f5';

export type AvatarProviderId = 'local' | 'video' | 'http' | 'livekit' | 'heygem' | 'musetalk';

export type RealtimeProviderId = 'local' | 'livekit';

export type RealtimeRole = 'host' | 'viewer';

export type HostPublisherMode = 'browser' | 'agent';

/** LiveKit data channel topic. Agents and browsers share this packet shape. */
export const LIVEKIT_TOPIC = 'lingbo';

export type CommentSource = 'viewer' | 'simulator' | 'platform';

export const PLATFORMS = ['douyin', 'kuaishou', 'bilibili', 'wechat_channels', 'tiktok', 'custom'] as const;

export type PlatformId = (typeof PLATFORMS)[number];

export type OutputProviderId = 'mock' | 'ffmpeg' | 'livekit-egress';

export type OutputConfigId = 'mock' | 'ffmpeg' | 'livekit';

export type OutputPushStatus = 'idle' | 'connecting' | 'live' | 'simulated' | 'reconnecting' | 'failed';

export interface StreamDestination {
  id: string;
  platform: PlatformId;
  label: string;
  serverUrl: string;
  enabled: boolean;
  hasStreamKey: boolean;
  streamKeyHint: string;
  createdAt: string;
  updatedAt: string;
}

export interface OutputDestinationState {
  destinationId: string;
  status: OutputPushStatus;
  reconnects: number;
  detail: string;
}

export interface OutputSnapshot {
  provider: OutputProviderId;
  configured: OutputConfigId;
  degraded: boolean;
  sessionId: string | null;
  destinations: OutputDestinationState[];
}

export type SpeechPurpose = 'script' | 'reply';

export interface Faq {
  question: string;
  answer: string;
}

export interface Product {
  id: string;
  title: string;
  priceYuan: number;
  imageUrl: string | null;
  sellingPoints: string[];
  faqs: Faq[];
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface Persona {
  name: string;
  tone: Tone;
  extraNotes: string;
  speechRate: number;
  hostId: HostId;
  voice: string;
}

export const DEFAULT_PERSONA: Persona = {
  name: '小林',
  tone: 'enthusiastic',
  extraNotes: '',
  speechRate: 1,
  hostId: 'lin',
  voice: 'warm-female',
};

export function normalizeStoredPersona(
  input:
    | {
        name?: string;
        tone?: string;
        extraNotes?: string;
        speechRate?: number;
        hostId?: string;
        voice?: string;
      }
    | null
    | undefined,
): Persona {
  const host = hostById(input?.hostId);
  const hostId = coerceHostId(input?.hostId);
  const tone = (TONES as readonly string[]).includes(input?.tone ?? '') ? (input?.tone as Tone) : host.tone;
  const speechRate =
    typeof input?.speechRate === 'number' && input.speechRate >= 0.6 && input.speechRate <= 1.6
      ? input.speechRate
      : host.speechRate;
  return {
    name: input?.name?.trim() || host.name,
    tone,
    extraNotes: typeof input?.extraNotes === 'string' ? input.extraNotes : '',
    speechRate,
    hostId,
    voice: input?.voice?.trim() || host.voice,
  };
}

export interface ScriptSegment {
  kind: ScriptKind;
  text: string;
}

export interface Script {
  id: string;
  productId: string;
  persona: Persona;
  segments: ScriptSegment[];
  provider: LlmProviderId;
  createdAt: string;
}

export interface CommentReply {
  text: string;
  provider: LlmProviderId;
  createdAt: string;
}

export interface Comment {
  id: string;
  clientId: string | null;
  sessionId: string;
  viewerName: string;
  text: string;
  source: CommentSource;
  createdAt: string;
  reply: CommentReply | null;
}

export interface RealtimeJoin {
  provider: RealtimeProviderId;
  url: string | null;
  room: string | null;
  token: string | null;
  role: RealtimeRole;
  publishMedia: boolean;
}

export interface RealtimeDataPacket {
  v: 1;
  type: 'comment' | 'speech';
  clientId?: string;
  name?: string;
  text: string;
  purpose?: SpeechPurpose;
  durationMs?: number;
  productId?: string;
}

export interface SessionStats {
  commentCount: number;
  replyCount: number;
  productShows: number;
  speakingMs: number;
  demoAudience: number;
}

export type DirectorMode = 'auto' | 'semi';

export type SceneTemplate = 'studio' | 'greenscreen';

export interface ShowControl {
  mode: DirectorMode;
  paused: boolean;
  loop: boolean;
  showAiLabel: boolean;
  scene: SceneTemplate;
  portraitUrl: string | null;
}

export const DEFAULT_SHOW: ShowControl = {
  mode: 'auto',
  paused: false,
  loop: true,
  showAiLabel: true,
  scene: 'studio',
  portraitUrl: null,
};

export function normalizeShow(input?: Partial<ShowControl> | null): ShowControl {
  return {
    mode: input?.mode === 'semi' ? 'semi' : 'auto',
    paused: input?.paused === true,
    loop: input?.loop !== false,
    showAiLabel: input?.showAiLabel !== false,
    scene: input?.scene === 'greenscreen' ? 'greenscreen' : 'studio',
    portraitUrl: typeof input?.portraitUrl === 'string' && input.portraitUrl.trim() ? input.portraitUrl.trim() : null,
  };
}

export interface LiveSession {
  id: string;
  status: SessionStatus;
  productIds: string[];
  currentProductId: string | null;
  persona: Persona;
  show: ShowControl;
  currentCaption: string;
  startedAt: string;
  endedAt: string | null;
  createdAt: string;
  stats: SessionStats;
}

export interface SystemInfo {
  llm: { id: LlmProviderId; configured: LlmProviderId; degraded: boolean };
  tts: { id: TtsProviderId; configured: TtsProviderId; degraded: boolean };
  avatar: { id: AvatarProviderId; configured: AvatarProviderId; degraded: boolean; videoUrl: string | null };
  realtime: {
    id: RealtimeProviderId;
    configured: RealtimeProviderId;
    degraded: boolean;
    publishMedia: boolean;
  };
  output: {
    id: OutputProviderId;
    configured: OutputConfigId;
    degraded: boolean;
  };
  simulateViewers: boolean;
}

export type LiveEvent =
  | {
      type: 'snapshot';
      session: LiveSession;
      product: Product | null;
      comments: Comment[];
      connections: number;
    }
  | {
      type: 'speech';
      purpose: SpeechPurpose;
      text: string;
      durationMs: number;
      audioUrl: string | null;
      avatarVideoUrl: string | null;
      productId: string;
    }
  | { type: 'product'; product: Product }
  | { type: 'comment'; comment: Comment }
  | { type: 'reply'; comment: Comment }
  | { type: 'stats'; stats: SessionStats }
  | { type: 'status'; session: LiveSession }
  | { type: 'script'; script: Script }
  | { type: 'presence'; connections: number };

export function plainPrice(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

export function formatYuan(value: number): string {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function emptyStats(): SessionStats {
  return {
    commentCount: 0,
    replyCount: 0,
    productShows: 0,
    speakingMs: 0,
    demoAudience: 0,
  };
}
