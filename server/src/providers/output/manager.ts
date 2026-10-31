import type { OutputConfigId, OutputSnapshot, StreamDestination } from '@lingbo/shared';
import type { DestinationRecord, JsonStore } from '../../store';
import { buildPushUrl } from './pushUrl';
import { streamKeyHint, type SecretBox } from './secrets';
import { EMPTY_OVERLAY, type OutputEngine, type ProgramOverlay, type PushTarget } from './types';

export class OutputManager {
  private generation = 0;
  private sessionId: string | null = null;
  private running: { stop(): Promise<void>; statuses(): OutputSnapshot['destinations']; setOverlay(overlay: ProgramOverlay): void; refresh(): Promise<void> } | null = null;
  private overlay: ProgramOverlay = { ...EMPTY_OVERLAY };
  private timer: NodeJS.Timeout | null = null;
  private failures = new Map<string, string>();

  constructor(
    private readonly store: JsonStore,
    private readonly box: SecretBox,
    private readonly engine: OutputEngine,
    private readonly opts: { configured: OutputConfigId; degraded: boolean; programBaseUrl: string; webOrigin: string },
  ) {}

  snapshot(): OutputSnapshot {
    const runtime = new Map((this.running?.statuses() ?? []).map((row) => [row.destinationId, row]));
    return {
      provider: this.engine.id,
      configured: this.opts.configured,
      degraded: this.opts.degraded,
      sessionId: this.sessionId,
      destinations: this.store.listDestinations().map((record) => {
        if (!record.enabled) return { destinationId: record.id, status: 'idle' as const, reconnects: 0, detail: '' };
        const failed = this.failures.get(record.id);
        if (failed) return { destinationId: record.id, status: 'failed' as const, reconnects: 0, detail: failed };
        const row = runtime.get(record.id);
        if (row) return row;
        if (this.sessionId) return { destinationId: record.id, status: 'connecting' as const, reconnects: 0, detail: '' };
        return { destinationId: record.id, status: 'idle' as const, reconnects: 0, detail: '' };
      }),
    };
  }

  prepareKey(serverUrl: string, streamKey: string | undefined, existingCipher = ''): string | null | undefined {
    const current = streamKey === undefined ? (existingCipher ? (this.box.open(existingCipher) ?? '') : '') : streamKey;
    try {
      buildPushUrl(serverUrl, current);
    } catch {
      return null;
    }
    if (streamKey === undefined) return undefined;
    if (!streamKey) return '';
    return this.box.seal(streamKey);
  }

  toPublic(record: DestinationRecord): StreamDestination {
    const plain = record.streamKeyCipher ? this.box.open(record.streamKeyCipher) : '';
    return {
      id: record.id,
      platform: record.platform,
      label: record.label,
      serverUrl: record.serverUrl,
      enabled: record.enabled,
      hasStreamKey: Boolean(record.streamKeyCipher),
      streamKeyHint: plain ? streamKeyHint(plain) : record.streamKeyCipher ? '••••' : '',
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  updateOverlay(overlay: ProgramOverlay) {
    this.overlay = overlay;
    this.running?.setOverlay(overlay);
  }

  async attach(sessionId: string) {
    const generation = ++this.generation;
    this.sessionId = sessionId;
    const previous = this.running;
    this.running = null;
    await previous?.stop();
    if (generation !== this.generation) return;
    const push = await this.engine.start({
      sessionId,
      roomName: `lingbo-${sessionId}`,
      programUrl: this.programUrl(sessionId),
      targets: this.targets(),
      overlay: this.overlay,
    });
    if (generation !== this.generation) {
      await push.stop();
      return;
    }
    this.running = push;
    this.armRefresh();
  }

  async detach(sessionId: string) {
    if (this.sessionId && this.sessionId !== sessionId) return;
    this.generation += 1;
    this.sessionId = null;
    this.clearRefresh();
    const running = this.running;
    this.running = null;
    await running?.stop();
  }

  async sync() {
    if (!this.sessionId) return;
    await this.attach(this.sessionId);
  }

  async close() {
    this.generation += 1;
    this.sessionId = null;
    this.clearRefresh();
    const running = this.running;
    this.running = null;
    await running?.stop();
  }

  private programUrl(sessionId: string): string {
    const base = this.opts.programBaseUrl || this.opts.webOrigin;
    return `${base.replace(/\/$/, '')}/program/${sessionId}`;
  }

  private targets(): PushTarget[] {
    this.failures.clear();
    const targets: PushTarget[] = [];
    for (const record of this.store.listDestinations()) {
      if (!record.enabled) continue;
      const secret = record.streamKeyCipher ? (this.box.open(record.streamKeyCipher) ?? '') : '';
      try {
        targets.push({ destinationId: record.id, url: buildPushUrl(record.serverUrl, secret), secret });
      } catch {
        this.failures.set(record.id, 'invalid_push_url');
      }
    }
    return targets;
  }

  private armRefresh() {
    this.clearRefresh();
    this.timer = setInterval(() => {
      void this.running?.refresh();
    }, 3000);
    this.timer.unref?.();
  }

  private clearRefresh() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
