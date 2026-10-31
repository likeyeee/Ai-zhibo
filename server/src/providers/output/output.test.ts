import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { makeApp } from '../../test/helper';
import { normalizeInbound } from '../ingest';
import { createAgentDispatcher } from '../agentDispatch';
import { nextBackoff } from './backoff';
import { FfmpegOutput, ffmpegArgs, type Spawned } from './ffmpeg';
import { LiveKitEgressOutput, type LiveKitEgressApi } from './livekitEgress';
import { buildPushUrl, redactPushUrl, safeDetail } from './pushUrl';
import { SecretBox } from './secrets';

describe('push urls and secrets', () => {
  it('joins an RTMP server with a stream key and keeps platform query strings', () => {
    expect(buildPushUrl('rtmp://127.0.0.1:1935/live', 'preview')).toBe('rtmp://127.0.0.1:1935/live/preview');
    expect(buildPushUrl('rtmps://push.example.com/stage/', 'stream-1?expire=10&sign=ab')).toBe(
      'rtmps://push.example.com/stage/stream-1?expire=10&sign=ab',
    );
    expect(buildPushUrl('rtmp://push.example.com/live/full-key', '')).toBe('rtmp://push.example.com/live/full-key');
    expect(() => buildPushUrl('https://example.com/live', 'key')).toThrow('invalid_push_url');
    expect(redactPushUrl('rtmp://127.0.0.1:1935/live/super-secret')).toBe('rtmp://127.0.0.1:1935/live/***');
    expect(safeDetail('ffmpeg failed rtmp://127.0.0.1/live/super-secret', ['super-secret'])).not.toContain('super-secret');
  });

  it('seals a stream key so the plaintext cannot be read back without the key', () => {
    const box = new SecretBox(Buffer.alloc(32, 7));
    const sealed = box.seal('douyin-key-8848');
    expect(sealed).not.toContain('douyin-key-8848');
    expect(box.open(sealed)).toBe('douyin-key-8848');
    expect(box.open('nope')).toBeNull();
  });
});

describe('platform comment ingest', () => {
  it('keeps Douyin live comments and drops gifts', () => {
    const comments = normalizeInbound({
      payload: [
        { msg_id: '735260', msg_type: 2, msg_type_str: 'live_comment', nickname: '茶客', content: '保质期多久' },
        { msg_id: '735261', msg_type: 3, msg_type_str: 'live_gift', nickname: '茶客', content: '小心心' },
      ],
    });
    expect(comments).toEqual([{ externalId: '735260', viewerName: '茶客', text: '保质期多久' }]);
  });

  it('accepts the normalized bridge shape', () => {
    expect(normalizeInbound({ text: '多少钱', viewerName: '晚风', externalId: 'm1' })).toEqual([
      { externalId: 'm1', viewerName: '晚风', text: '多少钱' },
    ]);
  });
});

describe('ffmpeg composite', () => {
  it('builds a slate command that pushes FLV and reloads overlay text', () => {
    const args = ffmpegArgs('/usr/share/fonts/wqy.ttc', '/tmp/title.txt', '/tmp/price.txt', '/tmp/caption.txt', 'rtmp://127.0.0.1/live/key');
    expect(args).toContain('-f');
    expect(args.at(-2)).toBe('flv');
    expect(args.at(-1)).toBe('rtmp://127.0.0.1/live/key');
    expect(args.join(' ')).toContain('drawtext=');
    expect(args.join(' ')).toContain('reload=1');
  });

  it('restarts a lane after ffmpeg exits', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingbo-ffmpeg-'));
    const launched: string[][] = [];
    const gate: { fail: ((code: number) => void) | null } = { fail: null };
    const schedule: Array<() => void> = [];
    const engine = new FfmpegOutput({
      font: '',
      dir,
      spawn(args): Spawned {
        launched.push(args);
        let resolve: (code: number) => void = () => undefined;
        const exited = new Promise<number>((done) => {
          resolve = done;
        });
        gate.fail = resolve;
        return {
          kill() {
            resolve(0);
          },
          exited,
        };
      },
      schedule(fn) {
        schedule.push(fn);
        return { cancel() {} };
      },
    });
    const push = await engine.start({
      sessionId: 's1',
      roomName: 'lingbo-s1',
      programUrl: 'http://localhost/program/s1',
      targets: [{ destinationId: 'd1', url: 'rtmp://127.0.0.1:1935/live/preview', secret: 'preview' }],
      overlay: { hostName: '小林', caption: '欢迎', productTitle: '红茶', priceLabel: '¥128' },
    });
    expect(launched).toHaveLength(1);
    expect(push.statuses()[0]?.status).toBe('live');
    gate.fail?.(1);
    await Promise.resolve();
    await Promise.resolve();
    expect(push.statuses()[0]?.status).toBe('reconnecting');
    expect(nextBackoff(1)).toBe(2000);
    schedule.shift()?.();
    expect(launched).toHaveLength(2);
    expect(fs.readFileSync(path.join(dir, 'd1', 'caption.txt'), 'utf8')).toContain('欢迎');
    await push.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('livekit egress', () => {
  it('starts a room composite to RTMP and stops it', async () => {
    const calls: string[] = [];
    const api: LiveKitEgressApi = {
      async startRoomCompositeEgress(roomName, output, opts) {
        calls.push(`${roomName}|${opts.customBaseUrl}|${opts.layout}|${output.stream.urls.join(',')}`);
        return { egressId: 'EG_1' };
      },
      async stopEgress(egressId) {
        calls.push(`stop:${egressId}`);
      },
      async listEgress() {
        return [
          {
            egressId: 'EG_1',
            status: 1,
            error: '',
            streamResults: [
              {
                url: 'rtmp://127.0.0.1:1935/live/preview',
                status: 0,
                error: '',
                retries: 0,
              },
            ],
          },
        ];
      },
      async updateStream() {},
    };
    const engine = new LiveKitEgressOutput(api, () => ({ cancel() {} }));
    const push = await engine.start({
      sessionId: 's1',
      roomName: 'lingbo-s1',
      programUrl: 'http://localhost:5173/program/s1',
      targets: [{ destinationId: 'd1', url: 'rtmp://127.0.0.1:1935/live/preview', secret: 'preview' }],
      overlay: { hostName: '小林', caption: '', productTitle: '红茶', priceLabel: '¥128' },
    });
    await viWait();
    expect(calls[0]).toContain('lingbo-s1');
    expect(calls[0]).toContain('http://localhost:5173/program/s1');
    expect(calls[0]).toContain('layout' in { layout: true } ? 'lingbo' : 'lingbo');
    expect(push.statuses()[0]?.status).toBe('live');
    await push.refresh();
    expect(push.statuses()[0]?.detail).toBe('rtmp://127.0.0.1:1935/live/***');
    await push.stop();
    expect(calls.at(-1)).toBe('stop:EG_1');
  });

  it('reconnects after egress fails without keeping the stream key in the detail', async () => {
    let started = 0;
    const gate: { retry: (() => void) | null } = { retry: null };
    const api: LiveKitEgressApi = {
      async startRoomCompositeEgress() {
        started += 1;
        if (started === 1) throw new Error('egress down rtmp://push.example/live/super-secret-key');
        return { egressId: 'EG_2' };
      },
      async stopEgress() {},
      async listEgress() {
        return [];
      },
      async updateStream() {},
    };
    const engine = new LiveKitEgressOutput(api, (fn) => {
      gate.retry = fn;
      return { cancel() { gate.retry = null; } };
    });
    const push = await engine.start({
      sessionId: 's1',
      roomName: 'lingbo-s1',
      programUrl: 'http://localhost/program/s1',
      targets: [{ destinationId: 'd1', url: 'rtmp://push.example/live/super-secret-key', secret: 'super-secret-key' }],
      overlay: { hostName: '', caption: '', productTitle: '', priceLabel: '' },
    });
    await viWait();
    expect(push.statuses()[0]?.status).toBe('reconnecting');
    expect(push.statuses()[0]?.detail).not.toContain('super-secret-key');
    gate.retry?.();
    await viWait();
    expect(started).toBe(2);
    expect(push.statuses()[0]?.status).toBe('live');
    await push.stop();
  });
});

describe('agent dispatch', () => {
  it('dispatches the named host agent into the session room', async () => {
    const calls: string[] = [];
    const dispatcher = createAgentDispatcher(
      {
        realtimeProvider: 'livekit',
        livekitHostPublisher: 'agent',
        livekitUrl: 'ws://localhost:7880',
        livekitApiKey: 'devkey',
        livekitApiSecret: 'secret',
        livekitAgentName: 'lingbo-host',
      } as never,
      {
        async createDispatch(roomName, agentName) {
          calls.push(`${roomName}:${agentName}`);
          return { id: 'dispatch-1' };
        },
        async deleteDispatch(dispatchId) {
          calls.push(`delete:${dispatchId}`);
        },
      },
    );
    await dispatcher.dispatchHost('session-1');
    await dispatcher.cancelHost('session-1');
    expect(calls).toEqual(['lingbo-session-1:lingbo-host', 'delete:dispatch-1']);
  });
});

const apps: Array<{ close: () => Promise<void>; dataDir: string }> = [];

afterEach(async () => {
  for (const app of apps.splice(0)) {
    await app.close();
    fs.rmSync(app.dataDir, { recursive: true, force: true });
  }
});

describe('destination API', () => {
  it('stores the stream key encrypted, simulates a push, and ingests a Douyin comment', async () => {
    const bundle = await makeApp({ ingestToken: 'ingest-test-token' });
    apps.push({ close: () => bundle.app.close(), dataDir: bundle.dataDir });
    const { app } = bundle;
    const created = await app.inject({
      method: 'POST',
      url: '/api/products',
      payload: {
        title: '正山小种红茶',
        priceYuan: 128,
        imageUrl: null,
        sellingPoints: ['松烟香'],
        faqs: [{ question: '保质期多久', answer: '密封可放18个月' }],
      },
    });
    const productId = created.json().product.id as string;
    const secret = 'super-secret-stream-key';
    const destination = await app.inject({
      method: 'POST',
      url: '/api/destinations',
      payload: {
        platform: 'douyin',
        label: '抖音主号',
        serverUrl: 'rtmp://127.0.0.1:1935/live',
        streamKey: secret,
        enabled: true,
      },
    });
    expect(destination.statusCode).toBe(201);
    const body = JSON.stringify(destination.json());
    expect(body).not.toContain(secret);
    expect(destination.json().destination.streamKeyHint).toBe('••••-key');
    const stored = fs.readFileSync(path.join(bundle.dataDir, 'db.json'), 'utf8');
    expect(stored).not.toContain(secret);

    const rejected = await app.inject({
      method: 'POST',
      url: '/api/destinations',
      payload: { platform: 'custom', label: '坏地址', serverUrl: 'https://example.com/live', streamKey: 'x', enabled: true },
    });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json().error).toBe('invalid_push_url');

    const started = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { productIds: [productId] },
    });
    const sessionId = started.json().session.id as string;
    await waitFor(async () => {
      const output = await app.inject({ method: 'GET', url: '/api/output' });
      return output.json().destinations[0]?.status === 'simulated';
    });
    const output = await app.inject({ method: 'GET', url: '/api/output' });
    expect(output.json().provider).toBe('mock');
    expect(output.json().sessionId).toBe(sessionId);

    const denied = await app.inject({
      method: 'POST',
      url: '/api/ingest/douyin',
      payload: { text: '你好' },
    });
    expect(denied.statusCode).toBe(401);

    const comment = await app.inject({
      method: 'POST',
      url: '/api/ingest/douyin',
      headers: { 'x-lingbo-ingest-token': 'ingest-test-token' },
      payload: {
        payload: [{ msg_id: 'c1', msg_type_str: 'live_comment', nickname: '茶客', content: '保质期多久' }],
      },
    });
    expect(comment.statusCode).toBe(200);
    expect(comment.json().accepted).toBe(1);

    const again = await app.inject({
      method: 'POST',
      url: '/api/ingest/douyin',
      headers: { 'x-lingbo-ingest-token': 'ingest-test-token' },
      payload: {
        payload: [{ msg_id: 'c1', msg_type_str: 'live_comment', nickname: '茶客', content: '保质期多久' }],
      },
    });
    expect(again.json().accepted).toBe(0);

    await waitFor(async () => {
      const listed = await app.inject({ method: 'GET', url: `/api/sessions/${sessionId}/comments` });
      const reply = listed.json().comments.find((item: { text: string }) => item.text === '保质期多久')?.reply?.text as string | undefined;
      return Boolean(reply?.includes('18个月'));
    });

    const ingress = await app.inject({ method: 'POST', url: `/api/sessions/${sessionId}/ingress` });
    expect(ingress.statusCode).toBe(409);
    expect(ingress.json().error).toBe('livekit_required');

    await app.inject({ method: 'POST', url: `/api/sessions/${sessionId}/stop` });
    const idle = await app.inject({ method: 'GET', url: '/api/output' });
    expect(idle.json().sessionId).toBeNull();
    expect(idle.json().destinations[0]?.status).toBe('idle');
  });

  it('refuses ingest when no token is configured', async () => {
    const bundle = await makeApp();
    apps.push({ close: () => bundle.app.close(), dataDir: bundle.dataDir });
    const response = await bundle.app.inject({
      method: 'POST',
      url: '/api/ingest/kuaishou',
      headers: { 'x-lingbo-ingest-token': 'anything' },
      payload: { text: '你好' },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error).toBe('ingest_disabled');
  });
});

async function viWait() {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

async function waitFor(check: () => Promise<boolean>) {
  const start = Date.now();
  while (Date.now() - start < 4000) {
    if (await check()) return;
    await viWait();
  }
  throw new Error('timed out');
}
