import path from 'node:path';
import fs from 'node:fs';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { loadConfig, type AppConfig } from './config';
import { SessionDirector } from './director';
import { LiveHub } from './liveHub';
import { createAgentDispatcher } from './providers/agentDispatch';
import { createAvatar } from './providers/avatar';
import { createLlm } from './providers/llm';
import { createOutputEngine } from './providers/output/create';
import { OutputManager } from './providers/output/manager';
import { loadSecretKey, SecretBox } from './providers/output/secrets';
import { createRealtime } from './providers/realtime';
import { createTts } from './providers/tts';
import { registerRoutes } from './routes';
import { JsonStore } from './store';

export interface CreateAppOptions {
  config?: Partial<AppConfig>;
  logger?: boolean;
}

export async function createApp(options: CreateAppOptions = {}) {
  const config: AppConfig = { ...loadConfig(), ...options.config };
  const store = new JsonStore(path.join(config.dataDir, 'db.json'));
  const hub = new LiveHub();
  const llm = createLlm(config);
  const tts = createTts(config);
  const avatar = createAvatar(config);
  const realtime = createRealtime(config);
  const outputEngine = createOutputEngine(config);
  const output = new OutputManager(store, new SecretBox(loadSecretKey(config.dataDir, config.outputSecret)), outputEngine.engine, {
    configured: config.outputProvider,
    degraded: outputEngine.degraded,
    programBaseUrl: config.programBaseUrl,
    webOrigin: config.webOrigin,
  });
  const agents = createAgentDispatcher(config);
  const director = new SessionDirector(store, hub, llm, tts, config, output, agents, avatar);
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 1_000_000 });

  const allowed = new Set([config.webOrigin, 'http://localhost:5173', 'http://127.0.0.1:5173']);
  await app.register(cors, {
    origin: (origin, callback) => {
      if (!origin || config.webOrigin === '*' || allowed.has(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
  });
  await app.register(multipart, { limits: { fileSize: 2 * 1024 * 1024, files: 1 } });
  await app.register(websocket);

  registerRoutes(app, { config, store, hub, director, llm, tts, avatar, realtime, output });

  const webDist = findWebDist();
  if (webDist) {
    await app.register(fastifyStatic, { root: webDist });
  }

  app.setNotFoundHandler((request, reply) => {
    const url = request.raw.url ?? request.url;
    if (url.startsWith('/api') || url.startsWith('/uploads')) {
      return reply.code(404).send({ error: 'not_found' });
    }
    if (webDist && request.method === 'GET') {
      return reply.type('text/html; charset=utf-8').send(fs.readFileSync(path.join(webDist, 'index.html')));
    }
    return reply.code(404).send({ error: 'not_found' });
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    request.log.error(error);
    const status = error.statusCode ?? 500;
    if (status === 413) return reply.code(413).send({ error: 'image_too_large' });
    if (status === 400) return reply.code(400).send({ error: 'invalid_body' });
    return reply.code(500).send({ error: 'server_error' });
  });

  app.addHook('onClose', async () => {
    await director.stopAll();
    await output.close();
  });

  await app.ready();
  return { app, config, store, hub, director, llm, tts, avatar, output };
}

export type AppBundle = Awaited<ReturnType<typeof createApp>>;

function findWebDist(): string | null {
  const candidates = [path.resolve(process.cwd(), 'web/dist'), path.resolve(process.cwd(), '../web/dist')];
  return candidates.find((candidate) => fs.existsSync(path.join(candidate, 'index.html'))) ?? null;
}

export type { FastifyInstance };
