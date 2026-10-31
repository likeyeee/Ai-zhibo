import fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeApp } from './test/helper';

const apps: Array<{ close: () => Promise<void>; dataDir: string }> = [];

afterEach(async () => {
  for (const app of apps.splice(0)) {
    await app.close();
    fs.rmSync(app.dataDir, { recursive: true, force: true });
  }
});

async function setup() {
  const bundle = await makeApp();
  apps.push({ close: () => bundle.app.close(), dataDir: bundle.dataDir });
  const created = await bundle.app.inject({
    method: 'POST',
    url: '/api/products',
    payload: {
      title: '正山小种 · 红茶叶礼盒',
      priceYuan: 128,
      imageUrl: null,
      description: '桐木关红茶',
      sellingPoints: ['松烟香，桂圆甜'],
      faqs: [{ question: '保质期多久', answer: '密封避光可存放18个月' }],
    },
  });
  expect(created.statusCode).toBe(201);
  const productId = created.json().product.id as string;
  return { app: bundle.app, productId };
}

describe('livestream flow', () => {
  it('previews a script, speaks, and answers a viewer', async () => {
    const { app, productId } = await setup();
    const preview = await app.inject({
      method: 'POST',
      url: '/api/scripts/preview',
      payload: { productId },
    });
    expect(preview.statusCode).toBe(200);
    const scriptText = (preview.json().script.segments as Array<{ text: string }>).map((segment) => segment.text).join('\n');
    expect(scriptText).toContain('松烟香');
    expect(preview.json().script.provider).toBe('mock');

    const started = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { productIds: [productId] },
    });
    expect(started.statusCode).toBe(201);
    const sessionId = started.json().session.id as string;

    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { productIds: [productId] },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error).toBe('session_already_live');

    await vi.waitFor(async () => {
      const current = await app.inject({ method: 'GET', url: `/api/sessions/${sessionId}` });
      expect(current.json().session.currentCaption.length).toBeGreaterThan(0);
    });

    const comment = await app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/comments`,
      payload: { viewerName: '晚风', text: '保质期多久' },
    });
    expect(comment.statusCode).toBe(201);

    await vi.waitFor(async () => {
      const listed = await app.inject({ method: 'GET', url: `/api/sessions/${sessionId}/comments` });
      const reply = listed.json().comments[0]?.reply?.text as string | undefined;
      expect(reply).toContain('18个月');
    });

    const stopped = await app.inject({ method: 'POST', url: `/api/sessions/${sessionId}/stop` });
    expect(stopped.json().session.status).toBe('ended');

    const late = await app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/comments`,
      payload: { text: '还在吗' },
    });
    expect(late.statusCode).toBe(409);
  });

  it('rejects an empty catalog and an unsafe image url', async () => {
    const bundle = await makeApp();
    apps.push({ close: () => bundle.app.close(), dataDir: bundle.dataDir });
    const missing = await bundle.app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { productIds: [] },
    });
    expect(missing.statusCode).toBe(400);

    const badImage = await bundle.app.inject({
      method: 'POST',
      url: '/api/products',
      payload: { title: '坏图片', priceYuan: 10, imageUrl: 'javascript:alert(1)', sellingPoints: [], faqs: [] },
    });
    expect(badImage.statusCode).toBe(400);
    expect(badImage.json().error).toBe('invalid_body');
  });

  it('stores an uploaded image and reports the active providers', async () => {
    const bundle = await makeApp({
      avatarProvider: 'video',
      avatarVideoUrl: 'https://cdn.example/host.mp4',
    });
    apps.push({ close: () => bundle.app.close(), dataDir: bundle.dataDir });
    const system = await bundle.app.inject({ method: 'GET', url: '/api/system' });
    expect(system.json().avatar).toEqual({
      id: 'video',
      configured: 'video',
      degraded: false,
      videoUrl: 'https://cdn.example/host.mp4',
    });
    expect(system.json().llm.id).toBe('mock');

    const boundary = '----lingboBoundary';
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="dot.png"\r\nContent-Type: image/png\r\n\r\n`,
      ),
      png,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const uploaded = await bundle.app.inject({
      method: 'POST',
      url: '/api/uploads',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload,
    });
    expect(uploaded.statusCode).toBe(200);
    const url = uploaded.json().url as string;
    expect(url).toMatch(/^\/uploads\/.+\.png$/);
    const fetched = await bundle.app.inject({ method: 'GET', url });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.headers['content-type']).toContain('image/png');
  });

  it('reports a local realtime room until LiveKit is configured', async () => {
    const { app, productId } = await setup();
    const started = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { productIds: [productId] },
    });
    const sessionId = started.json().session.id as string;
    const rtc = await app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/rtc`,
      payload: { role: 'viewer', name: '晚风' },
    });
    expect(rtc.statusCode).toBe(200);
    expect(rtc.json().join.provider).toBe('local');
    expect(rtc.json().join.token).toBeNull();
    const system = await app.inject({ method: 'GET', url: '/api/system' });
    expect(system.json().realtime).toMatchObject({ id: 'local', degraded: false, publishMedia: false });
    await app.inject({ method: 'POST', url: `/api/sessions/${sessionId}/stop` });
  });

  it('seeds sample products once', async () => {
    const bundle = await makeApp();
    apps.push({ close: () => bundle.app.close(), dataDir: bundle.dataDir });
    const first = await bundle.app.inject({ method: 'POST', url: '/api/products/seed' });
    expect(first.json().created).toBe(3);
    const second = await bundle.app.inject({ method: 'POST', url: '/api/products/seed' });
    expect(second.json().created).toBe(0);
  });

  it('holds an inserted line until the show is resumed', async () => {
    const bundle = await makeApp();
    apps.push({ close: () => bundle.app.close(), dataDir: bundle.dataDir });
    const created = await bundle.app.inject({
      method: 'POST',
      url: '/api/products',
      payload: { title: '红茶', priceYuan: 36, imageUrl: null, sellingPoints: ['清香'], faqs: [], description: '桐木关' },
    });
    const spoken: string[] = [];
    bundle.hub.tap((_sessionId, event) => {
      if (event.type === 'speech') spoken.push(event.text);
    });
    const line = '请把这句插播念出来甲乙丙';
    const started = await bundle.app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { productIds: [created.json().product.id], show: { paused: true } },
    });
    const sessionId = started.json().session.id as string;
    expect(started.json().session.show.paused).toBe(true);
    const inserted = await bundle.app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/control`,
      payload: { action: 'insert', text: line },
    });
    expect(inserted.statusCode).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(spoken).not.toContain(line);
    const resumed = await bundle.app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/control`,
      payload: { action: 'resume' },
    });
    expect(resumed.json().session.show.paused).toBe(false);
    await vi.waitFor(() => {
      expect(spoken).toContain(line);
    });
  });

  it('ends after the current product when looping is off', async () => {
    const { app, productId } = await setup();
    const started = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { productIds: [productId], show: { paused: true, loop: false } },
    });
    const sessionId = started.json().session.id as string;
    expect(started.json().session.show.loop).toBe(false);
    await app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/control`,
      payload: { action: 'resume' },
    });
    await vi.waitFor(async () => {
      const current = await app.inject({ method: 'GET', url: `/api/sessions/${sessionId}` });
      expect(current.json().session.status).toBe('ended');
    });
  });
});
