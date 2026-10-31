import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_PERSONA } from '@lingbo/shared';
import { loadConfig } from '../config';
import { makeApp } from '../test/helper';
import { createTts } from './tts';

const dirs: string[] = [];
const apps: Array<{ close: () => Promise<void>; dataDir: string }> = [];

afterEach(async () => {
  for (const app of apps.splice(0)) {
    await app.close();
    fs.rmSync(app.dataDir, { recursive: true, force: true });
  }
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function refDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingbo-tts-'));
  dirs.push(dir);
  const audio = path.join(dir, 'ref.wav');
  fs.writeFileSync(audio, Buffer.alloc(64, 1));
  return { dir, audio };
}

describe('cloned voices', () => {
  it('posts a CosyVoice zero-shot form and stores the wav', async () => {
    const { dir, audio } = refDir();
    let seen: { url: string; text: string; prompt: string; file: boolean } | null = null;
    const tts = createTts(
      loadConfig({
        TTS_PROVIDER: 'cosyvoice',
        COSYVOICE_URL: 'http://voice.example',
        CLONE_REF_AUDIO: audio,
        CLONE_REF_TEXT: '参考文本',
        DATA_DIR: dir,
      }),
      async (url, init) => {
        const form = init?.body as FormData;
        seen = {
          url: String(url),
          text: String(form.get('tts_text')),
          prompt: String(form.get('prompt_text')),
          file: form.get('prompt_wav') instanceof Blob,
        };
        return new Response(Buffer.alloc(64, 2));
      },
    );
    const clip = await tts.synthesize('家人们好', DEFAULT_PERSONA);
    expect(tts.id).toBe('cosyvoice');
    expect(seen).toEqual({
      url: 'http://voice.example/inference_zero_shot',
      text: '家人们好',
      prompt: '参考文本',
      file: true,
    });
    expect(clip.audioUrl).toMatch(/^\/uploads\/tts-.*\.wav$/);
    expect(fs.existsSync(path.join(dir, 'uploads', path.basename(clip.audioUrl ?? '')))).toBe(true);
  });

  it('posts GPT-SoVITS api_v2 fields', async () => {
    const { dir, audio } = refDir();
    let body: Record<string, unknown> | null = null;
    const tts = createTts(
      loadConfig({
        TTS_PROVIDER: 'gpt-sovits',
        GPT_SOVITS_URL: 'http://voice.example:9880',
        CLONE_REF_AUDIO: audio,
        CLONE_REF_TEXT: '参考文本',
        DATA_DIR: dir,
      }),
      async (url, init) => {
        expect(String(url)).toBe('http://voice.example:9880/tts');
        body = JSON.parse(String(init?.body));
        return new Response(Buffer.alloc(48, 3));
      },
    );
    const clip = await tts.synthesize('家人们好', { ...DEFAULT_PERSONA, speechRate: 1.2 });
    expect(clip.provider).toBe('gpt-sovits');
    expect(body).toMatchObject({
      text: '家人们好',
      text_lang: 'zh',
      ref_audio_path: audio,
      prompt_text: '参考文本',
      prompt_lang: 'zh',
      media_type: 'wav',
      streaming_mode: false,
      speed_factor: 1.2,
    });
  });

  it('accepts an F5 bridge that returns either wav bytes or audioUrl', async () => {
    const { dir, audio } = refDir();
    const wav = createTts(
      loadConfig({
        TTS_PROVIDER: 'f5',
        F5_TTS_URL: 'http://voice.example/f5',
        CLONE_REF_AUDIO: audio,
        CLONE_REF_TEXT: '参考文本',
        DATA_DIR: dir,
      }),
      async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        expect(body).toMatchObject({ gen_text: '家人们好', ref_audio: audio, ref_text: '参考文本' });
        return new Response(Buffer.alloc(48, 4));
      },
    );
    expect((await wav.synthesize('家人们好', DEFAULT_PERSONA)).provider).toBe('f5');

    const linked = createTts(
      loadConfig({
        TTS_PROVIDER: 'f5',
        F5_TTS_URL: 'http://voice.example/f5',
        CLONE_REF_AUDIO: audio,
        CLONE_REF_TEXT: '参考文本',
        DATA_DIR: dir,
      }),
      async () =>
        new Response(JSON.stringify({ audioUrl: 'http://voice.example/out.wav' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    expect((await linked.synthesize('家人们好', DEFAULT_PERSONA)).audioUrl).toBe('http://voice.example/out.wav');
  });

  it('stays on the mock voice when the clone reference is missing', async () => {
    const bundle = await makeApp({ ttsProvider: 'cosyvoice', cosyvoiceUrl: 'http://voice.example', cloneRefAudio: '', cloneRefText: '' });
    apps.push({ close: () => bundle.app.close(), dataDir: bundle.dataDir });
    const system = await bundle.app.inject({ method: 'GET', url: '/api/system' });
    expect(system.json().tts).toMatchObject({ id: 'mock', configured: 'cosyvoice', degraded: true });
  });
});
