import { EgressClient, StreamOutput, StreamProtocol } from 'livekit-server-sdk';

const EGRESS_STARTING = 0;
const EGRESS_ACTIVE = 1;
const EGRESS_ENDING = 2;
const EGRESS_COMPLETE = 3;
const EGRESS_FAILED = 4;
const EGRESS_ABORTED = 5;
const EGRESS_LIMIT = 6;
const STREAM_ACTIVE = 0;
const STREAM_FINISHED = 1;
const STREAM_FAILED = 2;
import type { OutputDestinationState, OutputPushStatus } from '@lingbo/shared';
import { nextBackoff } from './backoff';
import { redactPushUrl, safeDetail } from './pushUrl';
import type { OutputEngine, ProgramOverlay, PushTarget, RunningPush } from './types';

export interface EgressSnapshot {
  egressId: string;
  status: number;
  error: string;
  streamResults: Array<{ url: string; status: number; error: string; retries: number }>;
}

export interface LiveKitEgressApi {
  startRoomCompositeEgress(
    roomName: string,
    output: { stream: StreamOutput },
    opts: { layout?: string; customBaseUrl?: string },
  ): Promise<{ egressId: string }>;
  stopEgress(egressId: string): Promise<void>;
  listEgress(opts: { egressId: string }): Promise<EgressSnapshot[]>;
  updateStream(egressId: string, addOutputUrls?: string[], removeOutputUrls?: string[]): Promise<void>;
}

export function livekitApiHost(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol === 'ws:') parsed.protocol = 'http:';
  if (parsed.protocol === 'wss:') parsed.protocol = 'https:';
  return parsed.origin;
}

export function createLiveKitEgressApi(httpHost: string, apiKey: string, apiSecret: string): LiveKitEgressApi {
  const client = new EgressClient(httpHost, apiKey, apiSecret);
  return {
    async startRoomCompositeEgress(roomName, output, opts) {
      const info = await client.startRoomCompositeEgress(roomName, output, opts);
      return { egressId: info.egressId };
    },
    async stopEgress(egressId) {
      await client.stopEgress(egressId);
    },
    async listEgress(opts) {
      const items = await client.listEgress({ egressId: opts.egressId });
      return items.map((item) => ({
        egressId: item.egressId,
        status: item.status,
        error: item.error,
        streamResults: (item.streamResults ?? []).map((stream) => ({
          url: stream.url,
          status: stream.status,
          error: stream.error,
          retries: stream.retries,
        })),
      }));
    },
    async updateStream(egressId, addOutputUrls, removeOutputUrls) {
      await client.updateStream(egressId, addOutputUrls, removeOutputUrls);
    },
  };
}

export class LiveKitEgressOutput implements OutputEngine {
  readonly id = 'livekit-egress' as const;

  constructor(
    private readonly api: LiveKitEgressApi,
    private readonly schedule: (fn: () => void, ms: number) => { cancel(): void } = (fn, ms) => {
      const timer = setTimeout(fn, ms);
      return { cancel: () => clearTimeout(timer) };
    },
  ) {}

  async start(input: {
    sessionId: string;
    roomName: string;
    programUrl: string;
    targets: PushTarget[];
    overlay: ProgramOverlay;
  }): Promise<RunningPush> {
    return new LiveKitPush(this.api, this.schedule, input.roomName, input.programUrl, input.targets);
  }
}

class LiveKitPush implements RunningPush {
  private egressId = '';
  private intentional = false;
  private reconnects = 0;
  private timer: { cancel(): void } | null = null;
  private rows: OutputDestinationState[];

  constructor(
    private readonly api: LiveKitEgressApi,
    private readonly schedule: (fn: () => void, ms: number) => { cancel(): void },
    private readonly roomName: string,
    private readonly programUrl: string,
    private targets: PushTarget[],
  ) {
    this.rows = targets.map((target) => ({
      destinationId: target.destinationId,
      status: 'connecting',
      reconnects: 0,
      detail: '',
    }));
    void this.open();
  }

  setOverlay(_overlay: ProgramOverlay) {}

  statuses(): OutputDestinationState[] {
    return this.rows.map((row) => ({ ...row }));
  }

  async refresh() {
    if (!this.egressId || this.intentional) return;
    try {
      const items = await this.api.listEgress({ egressId: this.egressId });
      const info = items.find((item) => item.egressId === this.egressId) ?? items[0];
      if (!info) return;
      this.apply(info);
      if (isTerminal(info.status)) this.arm();
    } catch (error) {
      this.failAll(error instanceof Error ? error.message : 'egress_list_failed');
    }
  }

  async stop() {
    this.intentional = true;
    this.timer?.cancel();
    this.timer = null;
    const id = this.egressId;
    this.egressId = '';
    if (!id) return;
    try {
      await this.api.stopEgress(id);
    } catch {
      // The room composite may already have ended with the room.
    }
    this.rows = this.rows.map((row) => ({ ...row, status: 'idle', detail: '' }));
  }

  private async open() {
    if (this.intentional) return;
    if (this.targets.length === 0) {
      this.rows = [];
      return;
    }
    this.rows = this.targets.map((target) => ({
      destinationId: target.destinationId,
      status: this.reconnects > 0 ? 'reconnecting' : 'connecting',
      reconnects: this.reconnects,
      detail: '',
    }));
    try {
      const started = await this.api.startRoomCompositeEgress(
        this.roomName,
        {
          stream: new StreamOutput({
            protocol: StreamProtocol.RTMP,
            urls: this.targets.map((target) => target.url),
          }),
        },
        { layout: 'lingbo', customBaseUrl: this.programUrl },
      );
      if (this.intentional) {
        await this.api.stopEgress(started.egressId);
        return;
      }
      this.egressId = started.egressId;
      this.rows = this.targets.map((target) => ({
        destinationId: target.destinationId,
        status: 'live',
        reconnects: this.reconnects,
        detail: redactPushUrl(target.url),
      }));
    } catch (error) {
      this.failAll(error instanceof Error ? error.message : 'egress_start_failed');
      this.arm();
    }
  }

  private apply(info: EgressSnapshot) {
    const overall = mapEgress(info.status);
    this.rows = this.targets.map((target) => {
      const stream = info.streamResults.find((item) => item.url === target.url);
      if (!stream) {
        return {
          destinationId: target.destinationId,
          status: overall,
          reconnects: this.reconnects,
          detail: safeDetail(info.error, secretsOf(this.targets)) || redactPushUrl(target.url),
        };
      }
      const status = mapStream(stream.status, stream.retries, overall);
      return {
        destinationId: target.destinationId,
        status,
        reconnects: this.reconnects + stream.retries,
        detail: safeDetail(stream.error || info.error, secretsOf(this.targets)) || redactPushUrl(target.url),
      };
    });
  }

  private failAll(message: string) {
    const detail = safeDetail(message, secretsOf(this.targets));
    this.rows = this.targets.map((target) => ({
      destinationId: target.destinationId,
      status: 'failed',
      reconnects: this.reconnects,
      detail,
    }));
  }

  private arm() {
    if (this.intentional) return;
    this.reconnects += 1;
    this.timer?.cancel();
    this.timer = this.schedule(() => {
      this.timer = null;
      this.egressId = '';
      void this.open();
    }, nextBackoff(this.reconnects));
    this.rows = this.rows.map((row) => ({ ...row, status: 'reconnecting', reconnects: this.reconnects }));
  }
}

function secretsOf(targets: PushTarget[]): string[] {
  return targets.flatMap((target) => [target.secret, target.url]);
}

function isTerminal(status: number): boolean {
  return (
    status === EGRESS_FAILED ||
    status === EGRESS_ABORTED ||
    status === EGRESS_COMPLETE ||
    status === EGRESS_LIMIT
  );
}

function mapEgress(status: number): OutputPushStatus {
  if (status === EGRESS_STARTING) return 'connecting';
  if (status === EGRESS_ACTIVE || status === EGRESS_ENDING) return 'live';
  if (isTerminal(status)) return 'failed';
  return 'connecting';
}

function mapStream(status: number, retries: number, overall: OutputPushStatus): OutputPushStatus {
  if (status === STREAM_ACTIVE) return 'live';
  if (status === STREAM_FAILED) return retries > 0 ? 'reconnecting' : 'failed';
  if (status === STREAM_FINISHED) return overall === 'live' ? 'idle' : overall;
  return overall;
}
