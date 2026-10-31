import fs from 'node:fs';
import path from 'node:path';
import type { AppConfig } from '../../config';
import { FfmpegOutput } from './ffmpeg';
import { LiveKitEgressOutput, createLiveKitEgressApi, livekitApiHost } from './livekitEgress';
import { MockOutput } from './mock';
import type { OutputEngine } from './types';

const FONT_CANDIDATES = [
  '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc',
  '/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf',
];

export function resolveOutputFont(configured: string): string {
  if (configured && fs.existsSync(configured)) return configured;
  return FONT_CANDIDATES.find((file) => fs.existsSync(file)) ?? '';
}

export function createOutputEngine(config: AppConfig): { engine: OutputEngine; degraded: boolean } {
  if (config.outputProvider === 'ffmpeg') {
    return {
      engine: new FfmpegOutput({
        font: resolveOutputFont(config.outputFont),
        dir: path.join(config.dataDir, 'output'),
      }),
      degraded: false,
    };
  }
  if (config.outputProvider === 'livekit') {
    if (!config.livekitUrl || !config.livekitApiKey || !config.livekitApiSecret) {
      return { engine: new MockOutput(), degraded: true };
    }
    return {
      engine: new LiveKitEgressOutput(
        createLiveKitEgressApi(livekitApiHost(config.livekitUrl), config.livekitApiKey, config.livekitApiSecret),
      ),
      degraded: false,
    };
  }
  return { engine: new MockOutput(), degraded: false };
}
