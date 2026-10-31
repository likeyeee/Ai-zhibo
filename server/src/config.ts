import path from 'node:path';
import type {
  AvatarProviderId,
  HostPublisherMode,
  LlmProviderId,
  OutputConfigId,
  RealtimeProviderId,
  TtsProviderId,
} from '@lingbo/shared';

export interface AppConfig {
  host: string;
  port: number;
  webOrigin: string;
  dataDir: string;
  llmProvider: LlmProviderId;
  llmBaseUrl: string;
  llmApiKey: string;
  llmModel: string;
  ttsProvider: TtsProviderId;
  ttsHttpUrl: string;
  ttsApiKey: string;
  avatarProvider: AvatarProviderId;
  avatarVideoUrl: string;
  simulateViewers: boolean;
  simulateIntervalMs: number;
  speechPauseScale: number;
  realtimeProvider: RealtimeProviderId;
  livekitUrl: string;
  livekitApiKey: string;
  livekitApiSecret: string;
  livekitHostPublisher: HostPublisherMode;
  livekitAgentName: string;
  outputProvider: OutputConfigId;
  programBaseUrl: string;
  outputFont: string;
  ingestToken: string;
  outputSecret: string;
}

function text(env: NodeJS.ProcessEnv, key: string, fallback: string): string {
  const value = env[key];
  if (value === undefined || value.trim() === '') return fallback;
  return value.trim();
}

function flag(env: NodeJS.ProcessEnv, key: string, fallback: boolean): boolean {
  const value = env[key];
  if (value === undefined || value.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function num(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const value = env[key];
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const llm = text(env, 'LLM_PROVIDER', 'mock');
  const tts = text(env, 'TTS_PROVIDER', 'mock');
  const avatar = text(env, 'AVATAR_PROVIDER', 'local');
  return {
    host: text(env, 'HOST', '0.0.0.0'),
    port: clamp(Math.round(num(env, 'PORT', 8787)), 1, 65535),
    webOrigin: text(env, 'WEB_ORIGIN', 'http://localhost:5173'),
    dataDir: path.resolve(text(env, 'DATA_DIR', path.join(process.cwd(), 'data'))),
    llmProvider: llm === 'openai' ? 'openai' : 'mock',
    llmBaseUrl: text(env, 'LLM_BASE_URL', 'https://api.openai.com/v1').replace(/\/$/, ''),
    llmApiKey: text(env, 'LLM_API_KEY', ''),
    llmModel: text(env, 'LLM_MODEL', 'gpt-4o-mini'),
    ttsProvider: tts === 'http' ? 'http' : 'mock',
    ttsHttpUrl: text(env, 'TTS_HTTP_URL', ''),
    ttsApiKey: text(env, 'TTS_API_KEY', ''),
    avatarProvider: avatar === 'video' ? 'video' : 'local',
    avatarVideoUrl: text(env, 'AVATAR_VIDEO_URL', ''),
    simulateViewers: flag(env, 'SIMULATE_VIEWERS', true),
    simulateIntervalMs: clamp(Math.round(num(env, 'SIMULATE_INTERVAL_MS', 9000)), 2000, 120000),
    speechPauseScale: clamp(num(env, 'SPEECH_PAUSE_SCALE', 1), 0, 3),
    realtimeProvider: text(env, 'REALTIME_PROVIDER', 'local') === 'livekit' ? 'livekit' : 'local',
    livekitUrl: text(env, 'LIVEKIT_URL', ''),
    livekitApiKey: text(env, 'LIVEKIT_API_KEY', ''),
    livekitApiSecret: text(env, 'LIVEKIT_API_SECRET', ''),
    livekitHostPublisher: text(env, 'LIVEKIT_HOST_PUBLISHER', 'browser') === 'agent' ? 'agent' : 'browser',
    livekitAgentName: text(env, 'LIVEKIT_AGENT_NAME', 'lingbo-host'),
    outputProvider: outputProvider(text(env, 'OUTPUT_PROVIDER', 'mock')),
    programBaseUrl: text(env, 'PROGRAM_BASE_URL', '').replace(/\/$/, ''),
    outputFont: text(env, 'OUTPUT_FONT', ''),
    ingestToken: text(env, 'INGEST_TOKEN', ''),
    outputSecret: text(env, 'OUTPUT_SECRET', ''),
  };
}

function outputProvider(value: string): OutputConfigId {
  if (value === 'ffmpeg' || value === 'livekit') return value;
  return 'mock';
}
