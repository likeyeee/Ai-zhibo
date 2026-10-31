import { timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import '@fastify/multipart';
import '@fastify/websocket';
import { IngressClient, IngressInput } from 'livekit-server-sdk';
import { normalizeStoredPersona, PLATFORMS, type Persona, type PlatformId, type SystemInfo } from '@lingbo/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodError, ZodType } from 'zod';
import { z } from 'zod';
import type { AppConfig } from './config';
import type { SessionDirector } from './director';
import type { LiveHub } from './liveHub';
import type { AvatarProvider } from './providers/avatar';
import { normalizeInbound } from './providers/ingest';
import { livekitApiHost } from './providers/output/livekitEgress';
import type { OutputManager } from './providers/output/manager';
import { liveKitRoomName, type RealtimeProvider } from './providers/realtime';
import type { LlmProvider, TtsProvider } from './providers/types';
import { SAMPLE_PRODUCTS } from './samples';
import type { JsonStore, ProductInput } from './store';

export interface Deps {
  config: AppConfig;
  store: JsonStore;
  hub: LiveHub;
  director: SessionDirector;
  llm: LlmProvider;
  tts: TtsProvider;
  avatar: AvatarProvider;
  realtime: RealtimeProvider;
  output: OutputManager;
}

const personaSchema = z.object({
  name: z.string().trim().min(1, '请填写主播名').max(20),
  tone: z.enum(['enthusiastic', 'professional', 'gentle', 'humorous']),
  extraNotes: z.string().trim().max(300).default(''),
  speechRate: z.number().min(0.6).max(1.6),
  hostId: z.string().trim().max(20).optional(),
  voice: z.string().trim().max(40).optional(),
});

const productSchema = z.object({
  title: z.string().trim().min(1, '请填写商品名').max(80),
  priceYuan: z.number({ invalid_type_error: '价格需要是数字' }).positive('价格要大于 0').max(1_000_000),
  imageUrl: z
    .union([z.string().trim().max(2000), z.null()])
    .optional()
    .transform((value) => value || null)
    .refine((value) => value === null || isSafeImageUrl(value), '图片地址不合法'),
  sellingPoints: z
    .array(z.string().max(200))
    .max(12)
    .default([])
    .transform((items) => items.map((item) => clean(item)).filter(Boolean)),
  faqs: z
    .array(
      z.object({
        question: z.string().trim().min(1).max(200),
        answer: z.string().trim().min(1).max(500),
      }),
    )
    .max(20)
    .default([]),
  description: z.string().trim().max(1000).default(''),
});

const showSchema = z.object({
  mode: z.enum(['auto', 'semi']).optional(),
  paused: z.boolean().optional(),
  loop: z.boolean().optional(),
  showAiLabel: z.boolean().optional(),
  scene: z.enum(['studio', 'greenscreen']).optional(),
  portraitUrl: z.string().trim().max(500).nullable().optional(),
});

const sessionSchema = z.object({
  productIds: z.array(z.string().trim().min(1)).min(1, '请至少选择一个商品').max(30),
  persona: personaSchema.optional(),
  show: showSchema.optional(),
});

const controlSchema = z.object({
  action: z.enum(['pause', 'resume', 'advance', 'next', 'insert']).optional(),
  text: z.string().trim().max(200).optional(),
  mode: z.enum(['auto', 'semi']).optional(),
  loop: z.boolean().optional(),
  showAiLabel: z.boolean().optional(),
  scene: z.enum(['studio', 'greenscreen']).optional(),
  portraitUrl: z.string().trim().max(500).nullable().optional(),
});

const previewSchema = z.object({
  productId: z.string().trim().min(1),
  persona: personaSchema.optional(),
});

const commentSchema = z.object({
  viewerName: z.string().trim().max(20).optional(),
  text: z.string().trim().min(1, '请输入评论').max(200),
  clientId: z
    .string()
    .trim()
    .max(64)
    .optional()
    .transform((value) => value || null),
});

const rtcSchema = z.object({
  role: z.enum(['host', 'viewer']),
  identity: z.string().trim().max(64).optional(),
  name: z.string().trim().max(40).optional(),
});

const destinationSchema = z.object({
  platform: z.enum(PLATFORMS),
  label: z.string().trim().min(1).max(40),
  serverUrl: z.string().trim().min(8).max(500),
  streamKey: z.string().max(800).optional(),
  enabled: z.boolean().default(true),
});

export function registerRoutes(app: FastifyInstance, deps: Deps) {
  app.get('/api/health', async () => ({ ok: true }));

  app.get('/api/system', async () => systemPayload(deps));

  app.get('/api/settings', async () => ({ persona: deps.store.getPersona() }));

  app.put('/api/settings', async (request, reply) => {
    const persona = parse(personaSchema, request.body, reply);
    if (!persona) return;
    return { persona: deps.store.setPersona(normalizePersona(persona)) };
  });

  app.get('/api/products', async () => ({ products: deps.store.listProducts() }));

  app.post('/api/products', async (request, reply) => {
    const input = parse(productSchema, request.body, reply);
    if (!input) return;
    return reply.code(201).send({ product: deps.store.createProduct(toProductInput(input)) });
  });

  app.post('/api/products/seed', async () => {
    const titles = new Set(deps.store.listProducts().map((product) => product.title));
    const products = SAMPLE_PRODUCTS.filter((sample) => !titles.has(sample.title)).map((sample) =>
      deps.store.createProduct(sample),
    );
    return { products, created: products.length };
  });

  app.get<{ Params: { id: string } }>('/api/products/:id', async (request, reply) => {
    const product = deps.store.getProduct(request.params.id);
    if (!product) return fail(reply, 404, 'product_not_found');
    return { product };
  });

  app.put<{ Params: { id: string } }>('/api/products/:id', async (request, reply) => {
    const input = parse(productSchema, request.body, reply);
    if (!input) return;
    const product = deps.store.updateProduct(request.params.id, toProductInput(input));
    if (!product) return fail(reply, 404, 'product_not_found');
    return { product };
  });

  app.delete<{ Params: { id: string } }>('/api/products/:id', async (request, reply) => {
    const removed = deps.store.deleteProduct(request.params.id);
    if (!removed) return fail(reply, 404, 'product_not_found');
    return reply.code(204).send();
  });

  app.post('/api/uploads', async (request, reply) => {
    const file = await request.file();
    if (!file) return fail(reply, 400, 'file_missing');
    const extension = extensionFor(file.mimetype);
    if (!extension) {
      file.file.resume();
      return fail(reply, 400, 'image_type');
    }
    const name = `${crypto.randomUUID()}${extension}`;
    const dir = path.join(deps.config.dataDir, 'uploads');
    fs.mkdirSync(dir, { recursive: true });
    const full = path.join(dir, name);
    await pipeline(file.file, fs.createWriteStream(full));
    if (file.file.truncated) {
      fs.rmSync(full, { force: true });
      return fail(reply, 413, 'image_too_large');
    }
    return { url: `/uploads/${name}` };
  });

  app.get<{ Params: { name: string } }>('/uploads/:name', async (request, reply) => {
    const { name } = request.params;
    if (!/^[\w.-]+$/.test(name)) return fail(reply, 404, 'not_found');
    const dir = path.resolve(deps.config.dataDir, 'uploads');
    const full = path.resolve(dir, name);
    if (path.dirname(full) !== dir || !fs.existsSync(full)) return fail(reply, 404, 'not_found');
    return reply.type(mimeFor(name)).send(fs.createReadStream(full));
  });

  app.post('/api/scripts/preview', async (request, reply) => {
    const body = parse(previewSchema, request.body, reply);
    if (!body) return;
    const product = deps.store.getProduct(body.productId);
    if (!product) return fail(reply, 404, 'product_not_found');
    const persona = body.persona ? deps.store.setPersona(normalizePersona(body.persona)) : deps.store.getPersona();
    const draft = await deps.llm.generateScript({ product, persona });
    const script = deps.store.addScript({
      productId: product.id,
      persona,
      segments: draft.segments,
      provider: draft.provider,
    });
    return { script };
  });

  app.get('/api/sessions', async () => ({ sessions: deps.store.listSessions() }));

  app.post('/api/sessions', async (request, reply) => {
    const body = parse(sessionSchema, request.body, reply);
    if (!body) return;
    if (deps.store.getLiveSession()) return fail(reply, 409, 'session_already_live');
    const productIds = [...new Set(body.productIds)];
    for (const productId of productIds) {
      if (!deps.store.getProduct(productId)) return fail(reply, 400, 'product_required');
    }
    const persona = body.persona ? deps.store.setPersona(normalizePersona(body.persona)) : deps.store.getPersona();
    const session = deps.store.createLiveSession({ productIds, persona, show: body.show });
    deps.director.start(session.id);
    return reply.code(201).send({ session });
  });

  app.get<{ Params: { id: string } }>('/api/sessions/:id', async (request, reply) => {
    const session = deps.store.getSession(request.params.id);
    if (!session) return fail(reply, 404, 'session_not_found');
    const product = session.currentProductId ? deps.store.getProduct(session.currentProductId) : null;
    return { session, product };
  });

  app.post<{ Params: { id: string } }>('/api/sessions/:id/control', async (request, reply) => {
    const existing = deps.store.getSession(request.params.id);
    if (!existing) return fail(reply, 404, 'session_not_found');
    if (existing.status !== 'live') return fail(reply, 409, 'session_not_live');
    const body = parse(controlSchema, request.body, reply);
    if (!body) return;
    const patch: Partial<typeof existing.show> = {};
    if (body.mode) patch.mode = body.mode;
    if (body.loop !== undefined) patch.loop = body.loop;
    if (body.showAiLabel !== undefined) patch.showAiLabel = body.showAiLabel;
    if (body.scene) patch.scene = body.scene;
    if (body.portraitUrl !== undefined) {
      if (body.portraitUrl && !isSafeImageUrl(body.portraitUrl)) return fail(reply, 400, 'invalid_body');
      patch.portraitUrl = body.portraitUrl || null;
    }
    if (body.action === 'pause') patch.paused = true;
    if (body.action === 'resume') patch.paused = false;
    if (body.action === 'insert' && !body.text?.trim()) return fail(reply, 400, 'invalid_body');
    let session = existing;
    if (Object.keys(patch).length > 0) {
      const updated = deps.store.updateShow(existing.id, patch);
      if (!updated) return fail(reply, 404, 'session_not_found');
      session = updated;
    }
    if (body.action === 'advance') deps.director.release(existing.id, 'advance');
    if (body.action === 'next') deps.director.release(existing.id, 'next');
    if (body.action === 'insert' && body.text) deps.director.enqueue(existing.id, clean(body.text));
    deps.hub.publish(existing.id, { type: 'status', session });
    return { session };
  });

  app.post<{ Params: { id: string } }>('/api/sessions/:id/stop', async (request, reply) => {
    const existing = deps.store.getSession(request.params.id);
    if (!existing) return fail(reply, 404, 'session_not_found');
    await deps.director.stop(request.params.id);
    const session = deps.store.getSession(request.params.id);
    return { session };
  });

  app.get<{ Params: { id: string } }>('/api/sessions/:id/comments', async (request, reply) => {
    const session = deps.store.getSession(request.params.id);
    if (!session) return fail(reply, 404, 'session_not_found');
    return { comments: deps.store.listComments(request.params.id) };
  });

  app.post<{ Params: { id: string } }>('/api/sessions/:id/comments', async (request, reply) => {
    const session = deps.store.getSession(request.params.id);
    if (!session) return fail(reply, 404, 'session_not_found');
    if (session.status !== 'live') return fail(reply, 409, 'session_not_live');
    const body = parse(commentSchema, request.body, reply);
    if (!body) return;
    const comment = deps.store.addComment({
      sessionId: session.id,
      viewerName: clean(body.viewerName || '') || '观众',
      text: clean(body.text),
      source: 'viewer',
      clientId: body.clientId,
    });
    if (!comment) return fail(reply, 409, 'session_not_live');
    deps.hub.publish(session.id, { type: 'comment', comment });
    const stats = deps.store.getSession(session.id)?.stats;
    if (stats) deps.hub.publish(session.id, { type: 'stats', stats });
    return reply.code(201).send({ comment });
  });

  app.get<{ Params: { sessionId: string } }>(
    '/api/live/:sessionId',
    { websocket: true },
    (socket, request) => {
      const { sessionId } = request.params;
      const existing = deps.store.getSession(sessionId);
      if (!existing) {
        socket.close(1008, 'not found');
        return;
      }
      deps.hub.addSocket(sessionId, socket);
      const session = deps.store.getSession(sessionId) ?? existing;
      const product = session.currentProductId ? deps.store.getProduct(session.currentProductId) : null;
      socket.send(
        JSON.stringify({
          type: 'snapshot',
          session,
          product,
          comments: deps.store.listComments(sessionId),
          connections: deps.hub.connections(sessionId),
        }),
      );
      const leave = () => deps.hub.removeSocket(sessionId, socket);
      socket.on('close', leave);
      socket.on('error', leave);
    },
  );

  app.get('/api/destinations', async () => ({
    destinations: deps.store.listDestinations().map((record) => deps.output.toPublic(record)),
  }));

  app.post('/api/destinations', async (request, reply) => {
    const body = parse(destinationSchema, request.body, reply);
    if (!body) return;
    const cipher = deps.output.prepareKey(body.serverUrl, body.streamKey ?? '');
    if (cipher === null || cipher === undefined) return fail(reply, 400, 'invalid_push_url');
    const record = deps.store.createDestination({
      platform: body.platform,
      label: clean(body.label),
      serverUrl: body.serverUrl.trim(),
      streamKeyCipher: cipher,
      enabled: body.enabled ?? true,
    });
    await deps.output.sync();
    return reply.code(201).send({ destination: deps.output.toPublic(record) });
  });

  app.put<{ Params: { id: string } }>('/api/destinations/:id', async (request, reply) => {
    const existing = deps.store.getDestination(request.params.id);
    if (!existing) return fail(reply, 404, 'destination_not_found');
    const body = parse(destinationSchema, request.body, reply);
    if (!body) return;
    const cipher = deps.output.prepareKey(body.serverUrl, body.streamKey, existing.streamKeyCipher);
    if (cipher === null) return fail(reply, 400, 'invalid_push_url');
    const record = deps.store.updateDestination(existing.id, {
      platform: body.platform,
      label: clean(body.label),
      serverUrl: body.serverUrl.trim(),
      enabled: body.enabled ?? true,
      streamKeyCipher: cipher,
    });
    if (!record) return fail(reply, 404, 'destination_not_found');
    await deps.output.sync();
    return { destination: deps.output.toPublic(record) };
  });

  app.delete<{ Params: { id: string } }>('/api/destinations/:id', async (request, reply) => {
    const removed = deps.store.deleteDestination(request.params.id);
    if (!removed) return fail(reply, 404, 'destination_not_found');
    await deps.output.sync();
    return reply.code(204).send();
  });

  app.get('/api/output', async () => deps.output.snapshot());

  app.post('/api/output/restart', async () => {
    await deps.output.sync();
    return deps.output.snapshot();
  });

  app.post<{ Params: { platform: string } }>('/api/ingest/:platform', async (request, reply) => {
    if (!PLATFORMS.includes(request.params.platform as PlatformId)) return fail(reply, 404, 'not_found');
    if (!deps.config.ingestToken) return fail(reply, 503, 'ingest_disabled');
    const raw = request.body;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail(reply, 400, 'invalid_body');
    const body = { ...(raw as Record<string, unknown>) };
    const presented = presentedToken(request, body);
    delete body.ingestToken;
    if (!sameSecret(deps.config.ingestToken, presented)) return fail(reply, 401, 'ingest_unauthorized');
    const session = deps.store.getLiveSession();
    if (!session) return fail(reply, 409, 'session_not_live');
    const inbound = normalizeInbound(body);
    const known = new Set(
      deps.store
        .listComments(session.id)
        .map((item) => item.clientId)
        .filter((id): id is string => Boolean(id)),
    );
    const commentIds: string[] = [];
    for (const item of inbound) {
      const clientId = item.externalId ? `${request.params.platform}:${item.externalId}` : null;
      if (clientId && known.has(clientId)) continue;
      const comment = deps.store.addComment({
        sessionId: session.id,
        viewerName: item.viewerName,
        text: item.text,
        source: 'platform',
        clientId,
      });
      if (!comment) continue;
      if (clientId) known.add(clientId);
      deps.hub.publish(session.id, { type: 'comment', comment });
      commentIds.push(comment.id);
    }
    const stats = deps.store.getSession(session.id)?.stats;
    if (stats && commentIds.length > 0) deps.hub.publish(session.id, { type: 'stats', stats });
    return { accepted: commentIds.length, commentIds };
  });

  app.post<{ Params: { id: string } }>('/api/sessions/:id/ingress', async (request, reply) => {
    const session = deps.store.getSession(request.params.id);
    if (!session) return fail(reply, 404, 'session_not_found');
    if (!livekitConfigured(deps.config)) return fail(reply, 409, 'livekit_required');
    try {
      const client = new IngressClient(livekitApiHost(deps.config.livekitUrl), deps.config.livekitApiKey, deps.config.livekitApiSecret);
      const info = await client.createIngress(IngressInput.RTMP_INPUT, {
        name: `lingbo-${session.id}`,
        roomName: liveKitRoomName(session.id),
        participantIdentity: 'avatar-source',
        participantName: session.persona.name,
      });
      return {
        ingress: {
          id: info.ingressId,
          url: info.url,
          streamKey: info.streamKey,
          room: liveKitRoomName(session.id),
        },
      };
    } catch (error) {
      request.log.error(error);
      return fail(reply, 502, 'livekit_unavailable');
    }
  });

  app.post<{ Params: { id: string } }>('/api/sessions/:id/rtc', async (request, reply) => {
    const session = deps.store.getSession(request.params.id);
    if (!session) return fail(reply, 404, 'session_not_found');
    const body = parse(rtcSchema, request.body, reply);
    if (!body) return;
    const identity =
      body.role === 'host' ? 'host' : safeIdentity(body.identity || '', `viewer-${crypto.randomUUID().slice(0, 8)}`);
    if (identity === 'host' && body.role !== 'host') return fail(reply, 400, 'invalid_body');
    const join = await deps.realtime.join({
      sessionId: session.id,
      role: body.role,
      identity,
      name: clean(body.name || '') || (body.role === 'host' ? session.persona.name : '观众'),
    });
    return { join };
  });
}

export function systemPayload(deps: Deps): SystemInfo {
  return {
    llm: {
      id: deps.llm.id,
      configured: deps.config.llmProvider,
      degraded: deps.config.llmProvider === 'openai' && deps.llm.id !== 'openai',
    },
    tts: {
      id: deps.tts.id,
      configured: deps.config.ttsProvider,
      degraded: deps.config.ttsProvider !== 'mock' && deps.tts.id !== deps.config.ttsProvider,
    },
    avatar: deps.avatar.presentation,
    realtime: {
      id: deps.realtime.id,
      configured: deps.config.realtimeProvider,
      degraded: deps.config.realtimeProvider === 'livekit' && deps.realtime.id !== 'livekit',
      publishMedia: deps.realtime.id === 'livekit' && deps.config.livekitHostPublisher === 'browser',
    },
    output: {
      id: deps.output.snapshot().provider,
      configured: deps.config.outputProvider,
      degraded: deps.output.snapshot().degraded,
    },
    simulateViewers: deps.config.simulateViewers,
  };
}

function livekitConfigured(config: AppConfig): boolean {
  return Boolean(config.livekitUrl && config.livekitApiKey && config.livekitApiSecret);
}

function presentedToken(request: FastifyRequest, body: Record<string, unknown>): string {
  const header = request.headers['x-lingbo-ingest-token'];
  const fromHeader = Array.isArray(header) ? header[0] : header;
  if (typeof fromHeader === 'string' && fromHeader) return fromHeader;
  return typeof body.ingestToken === 'string' ? body.ingestToken : '';
}

function sameSecret(expected: string, got: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(got);
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

function safeIdentity(value: string, fallback: string): string {
  const cleaned = value.replace(/[^\w.-]/g, '').slice(0, 64);
  return cleaned || fallback;
}

function toProductInput(input: z.infer<typeof productSchema>): ProductInput {
  return {
    title: clean(input.title),
    priceYuan: input.priceYuan,
    imageUrl: input.imageUrl ?? null,
    sellingPoints: input.sellingPoints ?? [],
    faqs: (input.faqs ?? []).map((faq) => ({ question: clean(faq.question), answer: clean(faq.answer) })),
    description: clean(input.description ?? ''),
  };
}

function normalizePersona(persona: z.infer<typeof personaSchema>): Persona {
  return normalizeStoredPersona({
    name: clean(persona.name),
    tone: persona.tone,
    extraNotes: clean(persona.extraNotes ?? ''),
    speechRate: persona.speechRate,
    hostId: persona.hostId,
    voice: persona.voice,
  });
}

function parse<T>(schema: ZodType<T, z.ZodTypeDef, unknown>, body: unknown, reply: FastifyReply): T | undefined {
  const result = schema.safeParse(body);
  if (!result.success) {
    fail(reply, 400, 'invalid_body', formatZod(result.error));
    return undefined;
  }
  return result.data;
}

function fail(reply: FastifyReply, status: number, error: string, details?: string) {
  return reply.code(status).send(details ? { error, details } : { error });
}

function formatZod(error: ZodError): string {
  return error.issues
    .slice(0, 4)
    .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
    .join('；');
}

function clean(input: string): string {
  return input.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
}

function isSafeImageUrl(value: string): boolean {
  if (value.startsWith('/uploads/')) return /^\/uploads\/[\w.-]+$/.test(value);
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function extensionFor(mime: string): string | null {
  switch (mime) {
    case 'image/jpeg':
      return '.jpg';
    case 'image/png':
      return '.png';
    case 'image/webp':
      return '.webp';
    case 'image/gif':
      return '.gif';
    default:
      return null;
  }
}

function mimeFor(name: string): string {
  switch (path.extname(name).toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    case '.wav':
      return 'audio/wav';
    case '.mp3':
      return 'audio/mpeg';
    case '.mp4':
      return 'video/mp4';
    default:
      return 'application/octet-stream';
  }
}
