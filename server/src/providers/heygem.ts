/**
 * Duix HeyGem（仓库 duixcom/Duix.Heygem，也称 Duix.Avatar）的本地 HTTP 客户端。
 *
 * 它做的是离线成片，不是实时口型：
 * 1. POST {tts}/v1/invoke，fish-speech 返回 wav 字节。官方客户端把字节写成
 *    face2face/temp 下的文件名，再把这个文件名交给视频服务。
 * 2. POST {video}/easy/submit，body 里 audio_url、video_url、code。
 * 3. GET {video}/easy/query?code= 直到 data.status 为 2。成品在数据目录里，
 *    不是一个浏览器能直接打开的 URL。
 *
 * 口播段会在开场时预先提交。等到该说这句话时，成品已经在就播视频，否则立刻用本地肖像。
 * 观众回复默认不等待，避免直播卡住。下一轮轮播如果成品已经写好，再改播视频。
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Persona, SpeechPurpose } from '@lingbo/shared';
import type { AppConfig } from '../config';
import type { AvatarPresentation } from './avatar';

const JOB_TIMEOUT_MS = 180_000;
const POLL_MS = 400;

export interface HeygemClipInput {
  text: string;
  persona: Persona;
  purpose?: SpeechPurpose;
}

export class HeygemAvatar {
  private readonly hostVideos: Map<string, string>;
  private readonly ready = new Map<string, string | null>();
  private readonly jobs = new Map<string, Promise<string | null>>();
  private failed = false;

  constructor(
    private readonly config: AppConfig,
    private readonly fetchImpl: typeof fetch,
  ) {
    this.hostVideos = parsePairs(config.heygemHostVideos);
  }

  get presentation(): AvatarPresentation {
    if (!this.configured) return { id: 'local', configured: 'heygem', degraded: true, videoUrl: null };
    return { id: 'heygem', configured: 'heygem', degraded: this.failed, videoUrl: null };
  }

  prepare(input: { texts: string[]; persona: Persona }) {
    if (!this.configured) return;
    for (const text of input.texts) {
      const key = cacheKey(text, input.persona);
      void this.ensure(key, text, input.persona).catch(() => undefined);
    }
  }

  async clipFor(input: HeygemClipInput): Promise<string | null> {
    if (!this.configured) return null;
    const key = cacheKey(input.text, input.persona);
    if (this.ready.has(key)) return this.ready.get(key) ?? null;
    const job = this.ensure(key, input.text, input.persona);
    const wait = input.purpose === 'reply' ? this.config.heygemReplyWaitMs : this.config.heygemScriptWaitMs;
    if (wait <= 0) return null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), wait);
    });
    const result = await Promise.race([job, timeout]);
    if (timer) clearTimeout(timer);
    return result;
  }

  private get configured(): boolean {
    return Boolean(
      this.config.heygemVideoUrl &&
        this.config.heygemTtsUrl &&
        this.config.heygemDataDir &&
        this.config.heygemReferenceAudio &&
        this.config.heygemReferenceText &&
        (this.config.heygemVideoPath || this.hostVideos.size > 0),
    );
  }

  private ensure(key: string, text: string, persona: Persona): Promise<string | null> {
    const existing = this.jobs.get(key);
    if (existing) return existing;
    const job = this.render(text, persona)
      .then((url) => {
        this.ready.set(key, url);
        if (!url) this.failed = true;
        return url;
      })
      .catch((error: unknown) => {
        this.failed = true;
        this.ready.set(key, null);
        console.error('HeyGem 成片失败，这句改用本地肖像', error instanceof Error ? error.message : 'heygem_failed');
        return null;
      });
    this.jobs.set(key, job);
    return job;
  }

  private async render(text: string, persona: Persona): Promise<string | null> {
    const videoPath = this.hostVideos.get(persona.hostId) || this.config.heygemVideoPath;
    if (!videoPath) return null;
    const code = randomUUID();
    const audioName = await this.synthesize(code, text);
    const submitted = await this.fetchImpl(`${this.config.heygemVideoUrl}/easy/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audio_url: audioName,
        video_url: videoPath,
        code,
        chaofen: 0,
        watermark_switch: 0,
        pn: 1,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!submitted.ok) throw new Error(`heygem submit ${submitted.status}`);
    const accepted = (await submitted.json()) as { code?: number; success?: boolean };
    if (accepted.code !== 10000 && accepted.success !== true) throw new Error('heygem submit rejected');
    const result = await this.poll(code);
    return this.publish(code, result);
  }

  private async synthesize(code: string, text: string): Promise<string> {
    const response = await this.fetchImpl(`${this.config.heygemTtsUrl}/v1/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        speaker: code,
        text,
        format: 'wav',
        topP: 0.7,
        max_new_tokens: 1024,
        chunk_length: 100,
        repetition_penalty: 1.2,
        temperature: 0.7,
        need_asr: false,
        streaming: false,
        is_fixed_seed: 0,
        is_norm: 1,
        reference_audio: this.config.heygemReferenceAudio,
        reference_text: this.config.heygemReferenceText,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`heygem tts ${response.status}`);
    const type = response.headers.get('content-type') ?? '';
    if (type.includes('json')) {
      const data = (await response.json()) as { audio_url?: string; path?: string };
      const named = data.audio_url || data.path;
      if (!named) throw new Error('heygem tts 没有音频');
      return path.basename(named);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 16) throw new Error('heygem tts 音频为空');
    const name = `${code}.wav`;
    fs.mkdirSync(this.config.heygemDataDir, { recursive: true });
    fs.writeFileSync(path.join(this.config.heygemDataDir, name), bytes);
    return name;
  }

  private async poll(code: string): Promise<string> {
    const deadline = Date.now() + JOB_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const response = await this.fetchImpl(`${this.config.heygemVideoUrl}/easy/query?code=${encodeURIComponent(code)}`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`heygem query ${response.status}`);
      const body = (await response.json()) as {
        code?: number;
        msg?: string;
        data?: { status?: number; result?: string; msg?: string };
      };
      if (body.code === 9999 || body.code === 10002 || body.code === 10003) {
        throw new Error(body.msg || 'heygem query failed');
      }
      const status = body.data?.status;
      if (status === 2 && body.data?.result) return body.data.result;
      if (status === 3) throw new Error(body.data?.msg || 'heygem render failed');
      await delay(POLL_MS);
    }
    throw new Error('heygem timeout');
  }

  private publish(code: string, result: string): string {
    const source = findResult(this.config.heygemDataDir, result);
    if (!source) throw new Error('heygem 成品不在数据目录里');
    const safe = code.replace(/[^\w-]/g, '');
    const uploads = path.join(this.config.dataDir, 'uploads');
    fs.mkdirSync(uploads, { recursive: true });
    const target = path.join(uploads, `heygem-${safe}.mp4`);
    fs.copyFileSync(source, target);
    return `/uploads/heygem-${safe}.mp4`;
  }
}

function cacheKey(text: string, persona: Persona): string {
  return `${persona.hostId}\n${text}`;
}

function parsePairs(value: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of value.split(',')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    const mapped = part.slice(index + 1).trim();
    if (key && mapped) map.set(key, mapped);
  }
  return map;
}

function findResult(dataDir: string, result: string): string | null {
  const base = path.basename(result);
  if (!base || base === '.' || base === '..') return null;
  const root = path.resolve(dataDir);
  for (const candidate of [path.join(root, base), path.join(root, 'temp', base)]) {
    const resolved = path.resolve(candidate);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) continue;
    if (fs.existsSync(resolved)) return resolved;
  }
  return null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
