import fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PERSONA, HOSTS } from '@lingbo/shared';
import { loadConfig } from '../config';
import { makeApp } from '../test/helper';
import { createAvatar } from './avatar';

const apps: Array<{ close: () => Promise<void>; dataDir: string }> = [];

afterEach(async () => {
  for (const app of apps.splice(0)) {
    await app.close();
    fs.rmSync(app.dataDir, { recursive: true, force: true });
  }
});

describe('host library', () => {
  it('ships four named hosts with a voice, style inputs, and a portrait', () => {
    expect(HOSTS.length).toBeGreaterThanOrEqual(4);
    const ids = new Set(HOSTS.map((host) => host.id));
    expect(ids).toEqual(new Set(['lin', 'heng', 'ran', 'chen']));
    for (const host of HOSTS) {
      expect(host.name.length).toBeGreaterThan(0);
      expect(host.voice.length).toBeGreaterThan(0);
      expect(host.portrait.startsWith('/hosts/')).toBe(true);
      expect(host.face.mouthW).toBeGreaterThan(0);
      expect(host.face.eyeY).toBeGreaterThan(0);
    }
  });
});

describe('avatar provider', () => {
  it('asks the HTTP talking-head service for a clip and falls back when it fails', async () => {
    const calls: Array<{ url: string; body: { hostId: string; voice: string; text: string }; auth: string }> = [];
    const ok = createAvatar(
      loadConfig({ AVATAR_PROVIDER: 'http', AVATAR_HTTP_URL: 'https://avatar.example/clip', AVATAR_API_KEY: 'secret' }),
      async (url, init) => {
        const headers = init?.headers as { Authorization?: string };
        calls.push({ url: String(url), body: JSON.parse(String(init?.body)), auth: headers.Authorization ?? '' });
        return new Response(JSON.stringify({ videoUrl: 'https://cdn.example/talk.mp4' }), { status: 200 });
      },
    );
    const clip = await ok.clipFor({ text: '家人们好', persona: { ...DEFAULT_PERSONA, hostId: 'ran', voice: 'bright-female' } });
    expect(clip).toBe('https://cdn.example/talk.mp4');
    expect(calls[0]).toMatchObject({
      url: 'https://avatar.example/clip',
      auth: 'Bearer secret',
      body: { hostId: 'ran', voice: 'bright-female', text: '家人们好' },
    });
    expect(ok.presentation).toMatchObject({ id: 'http', configured: 'http', degraded: false });

    const down = createAvatar(
      loadConfig({ AVATAR_PROVIDER: 'http', AVATAR_HTTP_URL: 'https://avatar.example/clip' }),
      async () => {
        throw new Error('down');
      },
    );
    expect(await down.clipFor({ text: '家人们好', persona: DEFAULT_PERSONA })).toBeNull();
    expect(down.presentation).toMatchObject({ id: 'http', configured: 'http', degraded: true, videoUrl: null });

    const missing = createAvatar(loadConfig({ AVATAR_PROVIDER: 'http' }));
    expect(missing.presentation).toMatchObject({ id: 'local', configured: 'http', degraded: true });
    expect(await missing.clipFor({ text: '家人们好', persona: DEFAULT_PERSONA })).toBeNull();
  });

  it('keeps the local renderer unless LiveKit credentials are present', () => {
    const ready = createAvatar(
      loadConfig({
        AVATAR_PROVIDER: 'livekit',
        REALTIME_PROVIDER: 'livekit',
        LIVEKIT_URL: 'ws://localhost:7880',
        LIVEKIT_API_KEY: 'devkey',
        LIVEKIT_API_SECRET: 'secret',
      }),
    );
    expect(ready.presentation).toMatchObject({ id: 'livekit', degraded: false, videoUrl: null });

    const idle = createAvatar(loadConfig({ AVATAR_PROVIDER: 'livekit', REALTIME_PROVIDER: 'local' }));
    expect(idle.presentation).toMatchObject({ id: 'local', configured: 'livekit', degraded: true });

    const video = createAvatar(loadConfig({ AVATAR_PROVIDER: 'video' }));
    expect(video.presentation).toMatchObject({ id: 'local', configured: 'video', degraded: true, videoUrl: null });

    const musetalkMissing = createAvatar(loadConfig({ AVATAR_PROVIDER: 'musetalk' }));
    expect(musetalkMissing.presentation).toMatchObject({ id: 'local', configured: 'musetalk', degraded: true });
  });

  it('asks MuseTalk to drive only the mouth and falls back locally', async () => {
    const calls: Array<{ mouthOnly: boolean; portraitUrl: string | null; audioUrl: string | null }> = [];
    const avatar = createAvatar(
      loadConfig({ AVATAR_PROVIDER: 'musetalk', MUSETALK_URL: 'http://127.0.0.1:9881/talk' }),
      async (_url, init) => {
        calls.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ videoUrl: 'http://127.0.0.1:9881/out.mp4' }), { status: 200 });
      },
    );
    const clip = await avatar.clipFor({
      text: '家人们好',
      persona: DEFAULT_PERSONA,
      audioUrl: '/uploads/tts-demo.wav',
      portraitUrl: '/uploads/me.jpg',
    });
    expect(clip).toBe('http://127.0.0.1:9881/out.mp4');
    expect(calls[0]).toMatchObject({ mouthOnly: true, portraitUrl: '/uploads/me.jpg', audioUrl: '/uploads/tts-demo.wav' });
    expect(avatar.presentation).toMatchObject({ id: 'musetalk', degraded: false });

    const down = createAvatar(
      loadConfig({ AVATAR_PROVIDER: 'musetalk', MUSETALK_URL: 'http://127.0.0.1:9881/talk' }),
      async () => {
        throw new Error('down');
      },
    );
    expect(await down.clipFor({ text: '家人们好', persona: DEFAULT_PERSONA })).toBeNull();
    expect(down.presentation).toMatchObject({ id: 'musetalk', degraded: true });
  });

  it('puts the talking-head url on the speech the program page receives', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ videoUrl: 'https://cdn.example/talk.mp4' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;
    try {
      const bundle = await makeApp({ avatarProvider: 'http', avatarHttpUrl: 'https://avatar.example/clip' });
      apps.push({ close: () => bundle.app.close(), dataDir: bundle.dataDir });
      const clips: Array<string | null> = [];
      bundle.hub.tap((_sessionId, event) => {
        if (event.type === 'speech') clips.push(event.avatarVideoUrl);
      });
      const created = await bundle.app.inject({
        method: 'POST',
        url: '/api/products',
        payload: { title: '红茶', priceYuan: 36, imageUrl: null, sellingPoints: ['清香'], faqs: [], description: '' },
      });
      const started = await bundle.app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: { productIds: [created.json().product.id] },
      });
      expect(started.statusCode).toBe(201);
      await vi.waitFor(() => {
        expect(clips).toContain('https://cdn.example/talk.mp4');
      });
      const system = await bundle.app.inject({ method: 'GET', url: '/api/system' });
      expect(system.json().avatar.id).toBe('http');
    } finally {
      globalThis.fetch = original;
    }
  });
});
