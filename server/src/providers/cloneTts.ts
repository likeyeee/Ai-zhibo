/**
 * 克隆音色。三个适配器都要求 CLONE_REF_AUDIO 和 CLONE_REF_TEXT。
 * 地址或参考音频没配齐时，createTts 退回 mock，系统信息标成降级。
 * 调用失败时这一句改用本地时长，不中断直播。音频写到数据目录的 uploads，供预览和推流页播放。
 *
 * CosyVoice 官方 FastAPI：POST {COSYVOICE_URL}/inference_zero_shot
 * multipart 字段 tts_text、prompt_text、prompt_wav。响应是 wav 字节。
 *
 * GPT-SoVITS api_v2：POST {GPT_SOVITS_URL}/tts（地址本身以 /tts 结尾则不再追加）
 * JSON：text、text_lang=zh、ref_audio_path、prompt_text、prompt_lang=zh、
 * media_type=wav、streaming_mode=false、speed_factor=语速。响应是 wav 字节。
 *
 * F5-TTS 没有稳定的官方 REST。这里约定一个小桥：
 * POST {F5_TTS_URL} JSON { gen_text, ref_audio, ref_text, speed }。
 * 响应可以是 wav 字节，或 JSON { "audioUrl": "..." }。
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Persona, TtsProviderId } from '@lingbo/shared';
import type { AppConfig } from '../config';
import type { SpeechClip, TtsProvider } from './types';
import { estimateSpeechMs, MockTts } from './tts';

export function cloneConfigured(config: AppConfig): boolean {
  return Boolean(config.cloneRefAudio && config.cloneRefText && fs.existsSync(config.cloneRefAudio));
}

export function createCloneTts(config: AppConfig, fallback: MockTts, fetchImpl: typeof fetch): TtsProvider | null {
  if (!cloneConfigured(config)) return null;
  if (config.ttsProvider === 'cosyvoice' && config.cosyvoiceUrl) return new CosyVoiceTts(config, fallback, fetchImpl);
  if (config.ttsProvider === 'gpt-sovits' && config.gptSovitsUrl) return new GptSovitsTts(config, fallback, fetchImpl);
  if (config.ttsProvider === 'f5' && config.f5Url) return new F5Tts(config, fallback, fetchImpl);
  return null;
}

class CosyVoiceTts implements TtsProvider {
  readonly id = 'cosyvoice' as const;

  constructor(
    private readonly config: AppConfig,
    private readonly fallback: MockTts,
    private readonly fetchImpl: typeof fetch,
  ) {}

  async synthesize(text: string, persona: Persona): Promise<SpeechClip> {
    try {
      const prompt = fs.readFileSync(this.config.cloneRefAudio);
      const form = new FormData();
      form.set('tts_text', text);
      form.set('prompt_text', this.config.cloneRefText);
      form.set(
        'prompt_wav',
        new Blob([new Uint8Array(prompt.buffer, prompt.byteOffset, prompt.byteLength)], { type: 'audio/wav' }),
        path.basename(this.config.cloneRefAudio) || 'prompt.wav',
      );
      const response = await this.fetchImpl(`${this.config.cosyvoiceUrl}/inference_zero_shot`, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) throw new Error(`cosyvoice ${response.status}`);
      return clipFromWav(this.config.dataDir, text, persona, 'cosyvoice', new Uint8Array(await response.arrayBuffer()));
    } catch (error) {
      console.error('CosyVoice 调用失败，改用本地时长', error instanceof Error ? error.message : 'tts_failed');
      return this.fallback.synthesize(text, persona);
    }
  }
}

class GptSovitsTts implements TtsProvider {
  readonly id = 'gpt-sovits' as const;

  constructor(
    private readonly config: AppConfig,
    private readonly fallback: MockTts,
    private readonly fetchImpl: typeof fetch,
  ) {}

  async synthesize(text: string, persona: Persona): Promise<SpeechClip> {
    try {
      const response = await this.fetchImpl(joinTts(this.config.gptSovitsUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          text_lang: 'zh',
          ref_audio_path: this.config.cloneRefAudio,
          prompt_text: this.config.cloneRefText,
          prompt_lang: 'zh',
          media_type: 'wav',
          streaming_mode: false,
          speed_factor: persona.speechRate,
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) throw new Error(`gpt-sovits ${response.status}`);
      return clipFromWav(this.config.dataDir, text, persona, 'gpt-sovits', new Uint8Array(await response.arrayBuffer()));
    } catch (error) {
      console.error('GPT-SoVITS 调用失败，改用本地时长', error instanceof Error ? error.message : 'tts_failed');
      return this.fallback.synthesize(text, persona);
    }
  }
}

class F5Tts implements TtsProvider {
  readonly id = 'f5' as const;

  constructor(
    private readonly config: AppConfig,
    private readonly fallback: MockTts,
    private readonly fetchImpl: typeof fetch,
  ) {}

  async synthesize(text: string, persona: Persona): Promise<SpeechClip> {
    try {
      const response = await this.fetchImpl(this.config.f5Url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gen_text: text,
          ref_audio: this.config.cloneRefAudio,
          ref_text: this.config.cloneRefText,
          speed: persona.speechRate,
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) throw new Error(`f5 ${response.status}`);
      const kind = response.headers.get('content-type') ?? '';
      if (kind.includes('application/json')) {
        const data = (await response.json()) as { audioUrl?: string };
        if (!data.audioUrl) throw new Error('f5 响应缺少 audioUrl');
        return {
          text,
          audioUrl: data.audioUrl,
          durationMs: estimateSpeechMs(text, persona.speechRate),
          provider: 'f5',
        };
      }
      return clipFromWav(this.config.dataDir, text, persona, 'f5', new Uint8Array(await response.arrayBuffer()));
    } catch (error) {
      console.error('F5-TTS 调用失败，改用本地时长', error instanceof Error ? error.message : 'tts_failed');
      return this.fallback.synthesize(text, persona);
    }
  }
}

function joinTts(base: string): string {
  return base.endsWith('/tts') ? base : `${base}/tts`;
}

function clipFromWav(dataDir: string, text: string, persona: Persona, provider: TtsProviderId, bytes: Uint8Array): SpeechClip {
  if (bytes.byteLength < 44) throw new Error('tts wav too small');
  return {
    text,
    audioUrl: writeWav(dataDir, bytes),
    durationMs: estimateSpeechMs(text, persona.speechRate),
    provider,
  };
}

function writeWav(dataDir: string, bytes: Uint8Array): string {
  const name = `tts-${crypto.randomUUID()}.wav`;
  const dir = path.join(dataDir, 'uploads');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), bytes);
  return `/uploads/${name}`;
}
