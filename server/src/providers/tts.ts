/**
 * 语音提供者。
 *
 * mock：按字数估算口播时长，不生成音频。观众页用这段时长驱动口型和字幕，
 * 并可选调用浏览器 speechSynthesis 播放。
 * http：POST JSON 到 TTS_HTTP_URL，期望响应 { "audioUrl": "...", "durationMs": 2400 }。
 * 失败时退回 mock。
 * cosyvoice / gpt-sovits / f5：见 cloneTts.ts。缺地址或参考音频时退回 mock。
 * lingbo：本机 services/lingbo-avatar。服务没起来时仍返回 lingbo，时长按字数估算。
 *
 * 请求体：
 * { "text": "家人们好", "voice": "warm-female", "name": "小林", "hostId": "lin", "rate": 1, "language": "zh-CN" }
 */
import type { Persona } from '@lingbo/shared';
import type { AppConfig } from '../config';
import { createCloneTts } from './cloneTts';
import { createLingboTts } from './lingbo';
import type { SpeechClip, TtsProvider } from './types';

export function estimateSpeechMs(text: string, speechRate: number): number {
  const chars = Math.max(1, [...text].length);
  const rate = Math.min(1.6, Math.max(0.6, speechRate || 1));
  return Math.round(Math.min(7000, Math.max(1500, (chars * 150) / rate)));
}

export class MockTts implements TtsProvider {
  readonly id = 'mock' as const;

  async synthesize(text: string, persona: Persona): Promise<SpeechClip> {
    return {
      text,
      durationMs: estimateSpeechMs(text, persona.speechRate),
      audioUrl: null,
      provider: 'mock',
    };
  }
}

export class HttpTts implements TtsProvider {
  readonly id = 'http' as const;

  constructor(
    private readonly config: AppConfig,
    private readonly fallback: MockTts,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async synthesize(text: string, persona: Persona): Promise<SpeechClip> {
    try {
      const response = await this.fetchImpl(this.config.ttsHttpUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.ttsApiKey ? { Authorization: `Bearer ${this.config.ttsApiKey}` } : {}),
        },
        body: JSON.stringify({
          text,
          voice: persona.voice,
          name: persona.name,
          hostId: persona.hostId,
          rate: persona.speechRate,
          language: 'zh-CN',
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(`TTS ${response.status}`);
      const data = (await response.json()) as { audioUrl?: string; durationMs?: number };
      if (!data.audioUrl) throw new Error('TTS 响应缺少 audioUrl');
      return {
        text,
        audioUrl: data.audioUrl,
        durationMs:
          typeof data.durationMs === 'number' && data.durationMs > 0
            ? data.durationMs
            : estimateSpeechMs(text, persona.speechRate),
        provider: 'http',
      };
    } catch (error) {
      console.error('语音服务调用失败，改用本地时长', error);
      return this.fallback.synthesize(text, persona);
    }
  }
}

export function createTts(config: AppConfig, fetchImpl: typeof fetch = fetch): TtsProvider {
  const mock = new MockTts();
  if (config.ttsProvider === 'lingbo') return createLingboTts(config, fetchImpl);
  if (config.ttsProvider === 'http' && config.ttsHttpUrl) return new HttpTts(config, mock, fetchImpl);
  if (config.ttsProvider === 'cosyvoice' || config.ttsProvider === 'gpt-sovits' || config.ttsProvider === 'f5') {
    return createCloneTts(config, mock, fetchImpl) ?? mock;
  }
  return mock;
}
