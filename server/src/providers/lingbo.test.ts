import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { hostById } from '@lingbo/shared';
import { loadConfig } from '../config';
import { createAvatar } from './avatar';
import { clearLingboHealth, createLingboTts } from './lingbo';

const dirs: string[] = [];

afterEach(() => {
  clearLingboHealth();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('lingbo local avatar service', () => {
  it('keeps the lingbo id and a timed clip when the service is down', async () => {
    const dir = tempDir();
    const tts = createLingboTts(config(dir), async () => {
      throw new Error('offline');
    });
    const clip = await tts.synthesize('家人们看这款', hostPersona());
    expect(tts.id).toBe('lingbo');
    expect(tts.degraded).toBe(true);
    expect(clip.provider).toBe('lingbo');
    expect(clip.audioUrl).toBeNull();
    expect(clip.durationMs).toBeGreaterThan(700);
    const avatar = createAvatar(config(dir, { AVATAR_PROVIDER: 'lingbo' }), async () => {
      throw new Error('offline');
    });
    await avatar.refresh?.();
    expect(avatar.presentation).toMatchObject({ id: 'local', configured: 'lingbo', degraded: true, videoUrl: null });
    expect(await avatar.clipFor({ text: '你好', persona: hostPersona() })).toBeNull();
  });

  it('saves wav from the local service and only copies a real mouth video', async () => {
    const dir = tempDir();
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      calls.push({ url, body });
      if (url.endsWith('/health')) return json({ ok: true });
      if (url.endsWith('/v1/tts')) return new Response(new Uint8Array(tinyWav()), { status: 200, headers: { 'X-Duration-Ms': '960' } });
      if (url.endsWith('/v1/clip')) return json({ audioUrl: 'http://avatar.test/media/a.wav', videoUrl: 'http://avatar.test/media/a.mp4', engine: 'musetalk' });
      if (url.endsWith('/media/a.mp4')) return new Response(Buffer.from('ftyp-fake'), { status: 200 });
      if (url.endsWith('/v1/publish')) return json({ published: false, reason: 'livekit_sdk_missing' });
      return new Response('missing', { status: 404 });
    };
    const tts = createLingboTts(config(dir), fetchImpl);
    const clip = await tts.synthesize('欢迎来到直播间', hostPersona('ran'));
    expect(tts.degraded).toBe(false);
    expect(clip.audioUrl).toMatch(/^\/uploads\/lingbo-.*\.wav$/);
    expect(clip.durationMs).toBe(960);
    expect(fs.existsSync(path.join(dir, 'uploads', path.basename(clip.audioUrl ?? '')))).toBe(true);

    const avatar = createAvatar(config(dir, { AVATAR_PROVIDER: 'lingbo', LIVEKIT_HOST_PUBLISHER: 'lingbo' }), fetchImpl);
    await avatar.refresh?.();
    expect(avatar.presentation.id).toBe('lingbo');
    const video = await avatar.clipFor({
      text: '欢迎来到直播间',
      persona: hostPersona(),
      audioUrl: clip.audioUrl,
      portraitUrl: null,
    });
    expect(video).toMatch(/^\/uploads\/lingbo-.*\.mp4$/);
    const clipCall = calls.find((call) => call.url.endsWith('/v1/clip'));
    expect(typeof clipCall?.body.audioBase64).toBe('string');
    expect(typeof clipCall?.body.portraitBase64).toBe('string');

    await avatar.publishToRoom?.({
      text: '欢迎来到直播间',
      persona: hostPersona(),
      audioUrl: clip.audioUrl,
      videoUrl: video,
      livekitUrl: 'ws://127.0.0.1:7880',
      token: 'room-token',
    });
    const publish = calls.find((call) => call.url.endsWith('/v1/publish'));
    expect(publish?.body.token).toBe('room-token');
    expect(publish?.body.videoEngine).toBe('musetalk');
  });

  it('does not hand a silent wav to the page', async () => {
    const dir = tempDir();
    const tts = createLingboTts(
      config(dir),
      async (input) => {
        const url = String(input);
        if (url.endsWith('/health')) return json({ ok: true, tts: 'silent', talkingHead: 'portrait' });
        if (url.endsWith('/v1/tts')) {
          return new Response(new Uint8Array(tinyWav()), { status: 200, headers: { 'X-Duration-Ms': '800', 'X-Engine': 'silent' } });
        }
        return new Response('missing', { status: 404 });
      },
    );
    await tts.refresh();
    expect(tts.degraded).toBe(true);
    const clip = await tts.synthesize('只有时长', hostPersona());
    expect(clip.audioUrl).toBeNull();
    expect(clip.durationMs).toBe(800);
    expect(clip.provider).toBe('lingbo');
  });

  it('leaves the 2D mouth in place when the service has audio but no mouth video', async () => {
    const dir = tempDir();
    const avatar = createAvatar(
      config(dir, { AVATAR_PROVIDER: 'lingbo' }),
      async (input) => {
        const url = String(input);
        if (url.endsWith('/health')) return json({ ok: true });
        if (url.endsWith('/v1/clip')) return json({ audioUrl: 'http://avatar.test/media/b.wav', videoUrl: null, engine: 'portrait' });
        return new Response('missing', { status: 404 });
      },
    );
    expect(await avatar.clipFor({ text: '只有声音', persona: hostPersona() })).toBeNull();
    expect(avatar.presentation).toMatchObject({ id: 'lingbo', degraded: false });
  });
});

function config(dataDir: string, extra: Record<string, string> = {}) {
  return loadConfig({
    DATA_DIR: dataDir,
    TTS_PROVIDER: 'lingbo',
    AVATAR_PROVIDER: 'lingbo',
    LINGBO_AVATAR_URL: 'http://avatar.test',
    ...extra,
  });
}

function hostPersona(id: 'lin' | 'ran' = 'lin') {
  const host = hostById(id);
  return { name: host.name, tone: host.tone, extraNotes: '', speechRate: host.speechRate, hostId: host.id, voice: host.voice };
}

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingbo-avatar-'));
  dirs.push(dir);
  return dir;
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function tinyWav(): Buffer {
  const samples = 160;
  const data = Buffer.alloc(44 + samples * 2);
  data.write('RIFF', 0);
  data.writeUInt32LE(36 + samples * 2, 4);
  data.write('WAVE', 8);
  data.write('fmt ', 12);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(16000, 24);
  data.writeUInt32LE(32000, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write('data', 36);
  data.writeUInt32LE(samples * 2, 40);
  return data;
}
