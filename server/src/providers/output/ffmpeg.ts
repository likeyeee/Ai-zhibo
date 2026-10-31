import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { OutputDestinationState } from '@lingbo/shared';
import { nextBackoff } from './backoff';
import { redactPushUrl, safeDetail } from './pushUrl';
import type { OutputEngine, ProgramOverlay, PushTarget, RunningPush } from './types';

export interface Spawned {
  kill(): void;
  exited: Promise<number>;
}

export type SpawnFn = (args: string[]) => Spawned;

export function ffmpegArgs(font: string, titleFile: string, priceFile: string, captionFile: string, url: string): string[] {
  const fontPart = font ? `fontfile=${font}:` : '';
  const line = (file: string, size: number, color: string, y: string) =>
    `drawtext=${fontPart}textfile=${file}:reload=1:fontsize=${size}:fontcolor=${color}:x=64:y=${y}`;
  const filter = [
    line(titleFile, 42, 'white', '80'),
    line(priceFile, 32, '0xF0C27A', '150'),
    line(captionFile, 34, 'white', 'h-140'),
  ].join(',');
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-re',
    '-f',
    'lavfi',
    '-i',
    'color=c=0x241816:s=1280x720:r=25',
    '-f',
    'lavfi',
    '-i',
    'anullsrc=channel_layout=stereo:sample_rate=44100',
    '-vf',
    filter,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-tune',
    'zerolatency',
    '-pix_fmt',
    'yuv420p',
    '-g',
    '50',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-ar',
    '44100',
    '-f',
    'flv',
    url,
  ];
}

function defaultSpawn(args: string[]): Spawned {
  const child = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
  return {
    kill: () => stopChild(child),
    exited: new Promise((resolve) => {
      let errorText = '';
      child.stderr?.on('data', (chunk: Buffer) => {
        errorText = `${errorText}${chunk.toString('utf8')}`.slice(-500);
      });
      child.on('error', () => resolve(-1));
      child.on('exit', (code) => {
        if (errorText) (child as ChildProcess & { lingboError?: string }).lingboError = errorText;
        resolve(code ?? -1);
      });
    }),
  };
}

function stopChild(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode) return;
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 1500);
  child.on('exit', () => clearTimeout(timer));
}

export class FfmpegOutput implements OutputEngine {
  readonly id = 'ffmpeg' as const;

  constructor(
    private readonly opts: {
      font: string;
      dir: string;
      spawn?: SpawnFn;
      schedule?: (fn: () => void, ms: number) => { cancel(): void };
    },
  ) {}

  async start(input: {
    sessionId: string;
    roomName: string;
    programUrl: string;
    targets: PushTarget[];
    overlay: ProgramOverlay;
  }): Promise<RunningPush> {
    return new FfmpegPush(this.opts, input.targets, input.overlay);
  }
}

class FfmpegPush implements RunningPush {
  private readonly lanes = new Map<string, Lane>();
  private stopped = false;

  constructor(
    opts: {
      font: string;
      dir: string;
      spawn?: SpawnFn;
      schedule?: (fn: () => void, ms: number) => { cancel(): void };
    },
    targets: PushTarget[],
    overlay: ProgramOverlay,
  ) {
    for (const target of targets) this.lanes.set(target.destinationId, new Lane(opts, target, overlay));
    for (const lane of this.lanes.values()) lane.start();
  }

  async stop() {
    this.stopped = true;
    await Promise.all([...this.lanes.values()].map((lane) => lane.stop()));
  }

  setOverlay(overlay: ProgramOverlay) {
    for (const lane of this.lanes.values()) lane.setOverlay(overlay);
  }

  async refresh() {}

  statuses(): OutputDestinationState[] {
    if (this.stopped) {
      return [...this.lanes.values()].map((lane) => ({ ...lane.status(), status: 'idle' as const }));
    }
    return [...this.lanes.values()].map((lane) => lane.status());
  }
}

class Lane {
  private child: Spawned | null = null;
  private intentional = false;
  private reconnects = 0;
  private state: OutputDestinationState;
  private timer: { cancel(): void } | null = null;
  private dir: string;

  constructor(
    private readonly opts: {
      font: string;
      dir: string;
      spawn?: SpawnFn;
      schedule?: (fn: () => void, ms: number) => { cancel(): void };
    },
    private readonly target: PushTarget,
    overlay: ProgramOverlay,
  ) {
    this.dir = path.join(opts.dir, target.destinationId);
    this.state = { destinationId: target.destinationId, status: 'connecting', reconnects: 0, detail: '' };
    this.writeOverlay(overlay);
  }

  start() {
    if (this.intentional) return;
    fs.mkdirSync(this.dir, { recursive: true });
    const args = ffmpegArgs(
      this.opts.font,
      path.join(this.dir, 'title.txt'),
      path.join(this.dir, 'price.txt'),
      path.join(this.dir, 'caption.txt'),
      this.target.url,
    );
    const spawnFn = this.opts.spawn ?? defaultSpawn;
    let child: Spawned;
    try {
      child = spawnFn(args);
    } catch (error) {
      this.state = {
        destinationId: this.target.destinationId,
        status: 'failed',
        reconnects: this.reconnects,
        detail: safeDetail(error instanceof Error ? error.message : 'ffmpeg_missing', [this.target.secret, this.target.url]),
      };
      this.arm();
      return;
    }
    this.child = child;
    this.state = {
      destinationId: this.target.destinationId,
      status: this.reconnects > 0 ? 'reconnecting' : 'connecting',
      reconnects: this.reconnects,
      detail: '',
    };
    void child.exited.then((code) => {
      if (this.child !== child) return;
      this.child = null;
      if (this.intentional) return;
      this.reconnects += 1;
      this.state = {
        destinationId: this.target.destinationId,
        status: 'reconnecting',
        reconnects: this.reconnects,
        detail: safeDetail(`ffmpeg exit ${code}`, [this.target.secret, this.target.url]),
      };
      this.arm();
    });
    this.state = {
      destinationId: this.target.destinationId,
      status: 'live',
      reconnects: this.reconnects,
      detail: redactPushUrl(this.target.url),
    };
  }

  setOverlay(overlay: ProgramOverlay) {
    this.writeOverlay(overlay);
  }

  async stop() {
    this.intentional = true;
    this.timer?.cancel();
    this.timer = null;
    this.child?.kill();
    this.child = null;
  }

  status(): OutputDestinationState {
    return { ...this.state };
  }

  private arm() {
    if (this.intentional) return;
    const delay = nextBackoff(this.reconnects);
    const schedule = this.opts.schedule ?? ((fn, ms) => {
      const timer = setTimeout(fn, ms);
      return { cancel: () => clearTimeout(timer) };
    });
    this.timer?.cancel();
    this.timer = schedule(() => {
      this.timer = null;
      this.start();
    }, delay);
  }

  private writeOverlay(overlay: ProgramOverlay) {
    fs.mkdirSync(this.dir, { recursive: true });
    writeLine(path.join(this.dir, 'title.txt'), overlay.productTitle || overlay.hostName || '灵播');
    writeLine(path.join(this.dir, 'price.txt'), overlay.priceLabel);
    writeLine(path.join(this.dir, 'caption.txt'), overlay.caption);
  }
}

function writeLine(file: string, value: string) {
  const line = value.replace(/[\r\n]/g, ' ').slice(0, 80);
  fs.writeFileSync(file, `${line}\n`);
}
