import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { createApp } from './app';

const here = path.dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: path.resolve(here, '../../.env') });

const { app, config, director, store } = await createApp({ logger: true });

for (const session of store.listSessions()) {
  if (session.status === 'live') director.start(session.id);
}

let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  await app.close();
  process.exit(0);
};
process.on('SIGINT', () => {
  void shutdown();
});
process.on('SIGTERM', () => {
  void shutdown();
});

try {
  await app.listen({ host: config.host, port: config.port });
  console.log(`灵播 API  http://localhost:${config.port}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
