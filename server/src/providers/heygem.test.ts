import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PERSONA } from '@lingbo/shared';
import { loadConfig } from '../config';
import { createAvatar } from './avatar';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingbo-heygem-'));
  dirs.push(dir);
  return dir;
}

function heygemEnv(dataDir: string, faceDir: string, extra: Record<string, string> = {}) {
  return loadConfig({
    AVATAR_PROVIDER: 'heygem',
    DATA_DIR: dataDir,
    HEYGEM_DATA_DIR: faceDir,
    HEYGEM_VIDEO_URL: 'http://heygem.local:8383',
    HEYGEM_TTS_URL: 'http://heygem.local:18180',
    HEYGEM_VIDEO_PATH: 'lin.mp4',
    HEYGEM_REFERENCE_AUDIO: 'origin/lin.wav',
    HEYGEM_REFERENCE_TEXT: '大家好',
    ...extra,
  });
}

describe('HeyGem avatar', () => {
  it('stays on the local portrait until a driving video and reference audio are configured', async () => {
    let called = false;
    const avatar = createAvatar(
      loadConfig({ AVATAR_PROVIDER: 'heygem' }),
      async () => {
        called = true;
        return new Response('no');
      },
    );
    expect(avatar.presentation).toMatchObject({ id: 'local', configured: 'heygem', degraded: true });
    expect(await avatar.clipFor({ text: '家人们好', persona: DEFAULT_PERSONA, purpose: 'script' })).toBeNull();
    expect(called).toBe(false);
  });

  it('returns a scripted clip when HeyGem finishes within the wait', async () => {
    const dataDir = tempDir();
    const faceDir = tempDir();
    let code = '';
    const avatar = createAvatar(
      heygemEnv(dataDir, faceDir, { HEYGEM_SCRIPT_WAIT_MS: '2000', HEYGEM_HOST_VIDEOS: 'ran=ran.mp4' }),
      async (url, init) => {
        const href = String(url);
        if (href.endsWith('/v1/invoke')) {
          return new Response(Uint8Array.from([82, 73, 70, 70, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), {
            status: 200,
            headers: { 'content-type': 'audio/wav' },
          });
        }
        if (href.endsWith('/easy/submit')) {
          const body = JSON.parse(String(init?.body)) as { code: string; audio_url: string; video_url: string };
          code = body.code;
          expect(body.video_url).toBe('ran.mp4');
          expect(body.audio_url).toBe(`${body.code}.wav`);
          return new Response(JSON.stringify({ code: 10000, success: true }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        fs.writeFileSync(path.join(faceDir, `${code}-r.mp4`), 'mp4');
        return new Response(
          JSON.stringify({ code: 10000, data: { status: 2, result: `/${code}-r.mp4`, progress: 100, msg: '任务完成' } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
    );
    const scripted = await avatar.clipFor({
      text: '先讲卖点',
      persona: { ...DEFAULT_PERSONA, hostId: 'ran' },
      purpose: 'script',
    });
    expect(scripted).toMatch(/^\/uploads\/heygem-.*\.mp4$/);
    expect(fs.existsSync(path.join(dataDir, 'uploads', path.basename(scripted ?? '')))).toBe(true);
    expect(fs.existsSync(path.join(faceDir, `${code}.wav`))).toBe(true);
  });

  it('lets a live reply fall back immediately and play the clip once it exists', async () => {
    const dataDir = tempDir();
    const faceDir = tempDir();
    let code = '';
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const avatar = createAvatar(heygemEnv(dataDir, faceDir), async (url, init) => {
      const href = String(url);
      if (href.endsWith('/v1/invoke')) {
        return new Response(Uint8Array.from([82, 73, 70, 70, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), {
          status: 200,
          headers: { 'content-type': 'audio/wav' },
        });
      }
      if (href.endsWith('/easy/submit')) {
        code = (JSON.parse(String(init?.body)) as { code: string }).code;
        return new Response(JSON.stringify({ code: 10000 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      await gate;
      fs.writeFileSync(path.join(faceDir, `${code}-r.mp4`), 'mp4');
      return new Response(JSON.stringify({ code: 10000, data: { status: 2, result: `/${code}-r.mp4` } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const reply = await avatar.clipFor({ text: '保质期十八个月', persona: DEFAULT_PERSONA, purpose: 'reply' });
    expect(reply).toBeNull();
    release();
    await vi.waitFor(async () => {
      const ready = await avatar.clipFor({ text: '保质期十八个月', persona: DEFAULT_PERSONA, purpose: 'reply' });
      expect(ready).toMatch(/^\/uploads\/heygem-/);
    });
  });

  it('marks the provider degraded when HeyGem reports a failed render', async () => {
    const avatar = createAvatar(
      heygemEnv(tempDir(), tempDir(), { HEYGEM_SCRIPT_WAIT_MS: '1000' }),
      async (url) => {
        const href = String(url);
        if (href.endsWith('/v1/invoke')) {
          return new Response(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]), {
            status: 200,
            headers: { 'content-type': 'audio/wav' },
          });
        }
        if (href.endsWith('/easy/submit')) {
          return new Response(JSON.stringify({ code: 10000 }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ code: 10000, data: { status: 3, msg: 'GPU 不可用' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    );
    expect(await avatar.clipFor({ text: '家人们好', persona: DEFAULT_PERSONA, purpose: 'script' })).toBeNull();
    expect(avatar.presentation).toMatchObject({ id: 'heygem', degraded: true });
  });
});
