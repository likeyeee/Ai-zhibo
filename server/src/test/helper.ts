import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AppConfig } from '../config';
import { createApp } from '../app';

export async function makeApp(overrides: Partial<AppConfig> = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingbo-'));
  const bundle = await createApp({
    logger: false,
    config: {
      dataDir,
      simulateViewers: false,
      speechPauseScale: 0,
      llmProvider: 'mock',
      ttsProvider: 'mock',
      avatarProvider: 'local',
      avatarVideoUrl: '',
      realtimeProvider: 'local',
      livekitUrl: '',
      livekitApiKey: '',
      livekitApiSecret: '',
      livekitHostPublisher: 'browser',
      livekitAgentName: 'lingbo-host',
      outputProvider: 'mock',
      programBaseUrl: '',
      outputFont: '',
      ingestToken: '',
      outputSecret: 'test-secret',
      ...overrides,
    },
  });
  return { ...bundle, dataDir };
}
