import { formatYuan, type Persona, type Product, type SpeechPurpose } from '@lingbo/shared';
import type { AppConfig } from './config';
import type { LiveHub } from './liveHub';
import type { AgentDispatcher } from './providers/agentDispatch';
import type { AvatarProvider } from './providers/avatar';
import type { OutputManager } from './providers/output/manager';
import type { LlmProvider, TtsProvider } from './providers/types';
import { ViewerSimulator } from './simulator';
import { interruptibleSleep } from './sleep';
import type { JsonStore } from './store';

export class SessionDirector {
  private readonly jobs = new Map<string, AbortController>();
  private readonly running = new Set<Promise<void>>();
  private readonly cursors = new Map<string, number>();
  private readonly inserts = new Map<string, string[]>();
  private readonly advances = new Set<string>();
  private readonly skipProducts = new Set<string>();
  private readonly simulator: ViewerSimulator;

  constructor(
    private readonly store: JsonStore,
    private readonly hub: LiveHub,
    private readonly llm: LlmProvider,
    private readonly tts: TtsProvider,
    private readonly config: AppConfig,
    private readonly output: OutputManager,
    private readonly agents: AgentDispatcher,
    private readonly avatar: AvatarProvider,
  ) {
    this.simulator = new ViewerSimulator(store, hub, config);
  }

  start(sessionId: string) {
    if (this.jobs.has(sessionId)) return;
    const controller = new AbortController();
    this.jobs.set(sessionId, controller);
    if (this.config.simulateViewers) this.simulator.start(sessionId);
    void this.output.attach(sessionId);
    const persona = this.store.getSession(sessionId)?.persona;
    void this.agents.dispatchHost(sessionId, {
      hostId: persona?.hostId ?? 'lin',
      voice: persona?.voice ?? '',
      avatar: this.config.avatarProvider,
    });
    const job = this.run(sessionId, controller.signal).finally(() => {
      this.jobs.delete(sessionId);
      this.simulator.stop(sessionId);
      this.cursors.delete(sessionId);
      this.inserts.delete(sessionId);
      this.advances.delete(sessionId);
      this.skipProducts.delete(sessionId);
      this.running.delete(job);
      void this.output.detach(sessionId);
      void this.agents.cancelHost(sessionId);
    });
    this.running.add(job);
  }

  enqueue(sessionId: string, text: string) {
    const line = text.trim();
    if (!line) return;
    const queue = this.inserts.get(sessionId) ?? [];
    queue.push(line);
    this.inserts.set(sessionId, queue);
  }

  release(sessionId: string, kind: 'advance' | 'next') {
    if (kind === 'next') this.skipProducts.add(sessionId);
    this.advances.add(sessionId);
  }

  async stop(sessionId: string) {
    this.simulator.stop(sessionId);
    const session = this.store.endSession(sessionId);
    this.jobs.get(sessionId)?.abort();
    await this.output.detach(sessionId);
    await this.agents.cancelHost(sessionId);
    if (session) this.hub.publish(sessionId, { type: 'status', session });
  }

  async stopAll() {
    this.simulator.stopAll();
    const ids = [...this.jobs.keys()];
    for (const sessionId of ids) {
      const session = this.store.endSession(sessionId);
      this.jobs.get(sessionId)?.abort();
      if (session) this.hub.publish(sessionId, { type: 'status', session });
    }
    await Promise.allSettled([...this.running]);
    await Promise.all(ids.map((sessionId) => this.output.detach(sessionId)));
    await Promise.all(ids.map((sessionId) => this.agents.cancelHost(sessionId)));
  }

  private async run(sessionId: string, signal: AbortSignal) {
    while (!signal.aborted) {
      try {
        const keepGoing = await this.step(sessionId, signal);
        if (!keepGoing) return;
      } catch (error) {
        if (signal.aborted) return;
        console.error('直播循环出错，稍后继续', error);
        await interruptibleSleep(800, signal);
      }
    }
  }

  private async step(sessionId: string, signal: AbortSignal): Promise<boolean> {
    const session = this.store.getSession(sessionId);
    if (!session || session.status !== 'live' || signal.aborted) return false;
    const product = this.pickProduct(session.productIds, sessionId, session.show.loop);
    if (!product) {
      const ended = this.store.endSession(sessionId);
      if (ended) this.hub.publish(sessionId, { type: 'status', session: ended });
      return false;
    }

    const persona = session.persona;
    this.store.setCurrentProduct(sessionId, product.id);
    const shown = this.store.bumpStat(sessionId, 'productShows');
    this.hub.publish(sessionId, { type: 'product', product });
    this.output.updateOverlay({
      hostName: persona.name,
      caption: '',
      productTitle: product.title,
      priceLabel: formatYuan(product.priceYuan),
    });
    if (shown) this.hub.publish(sessionId, { type: 'stats', stats: shown.stats });
    const generated = await this.llm.generateScript({ product, persona });
    if (signal.aborted) return false;
    const script = this.store.addScript({
      productId: product.id,
      persona,
      segments: generated.segments,
      provider: generated.provider,
    });
    this.hub.publish(sessionId, { type: 'script', script });
    this.avatar.prepare?.({ texts: script.segments.map((segment) => segment.text), persona });

    let first = true;
    for (const segment of script.segments) {
      if (signal.aborted) return false;
      const open = await this.waitGate(sessionId, signal, !first);
      if (!open) return false;
      first = false;
      if (this.takeSkip(sessionId)) break;
      await this.answerOne(sessionId, product, persona, signal);
      if (signal.aborted) return false;
      await this.drainInserts(sessionId, product.id, persona, signal);
      if (signal.aborted) return false;
      if (this.takeSkip(sessionId)) break;
      await this.speak(sessionId, segment.text, product.id, 'script', persona, signal);
    }
    return !signal.aborted;
  }

  private async waitGate(sessionId: string, signal: AbortSignal, holdForSemi: boolean): Promise<boolean> {
    while (!signal.aborted) {
      const session = this.store.getSession(sessionId);
      if (!session || session.status !== 'live') return false;
      if (this.skipProducts.has(sessionId)) return true;
      if (session.show.paused) {
        await interruptibleSleep(200, signal);
        continue;
      }
      if (holdForSemi && session.show.mode === 'semi' && !this.advances.has(sessionId)) {
        await interruptibleSleep(200, signal);
        continue;
      }
      this.advances.delete(sessionId);
      return true;
    }
    return false;
  }

  private takeSkip(sessionId: string): boolean {
    const skip = this.skipProducts.delete(sessionId);
    if (skip) this.advances.delete(sessionId);
    return skip;
  }

  private async drainInserts(sessionId: string, productId: string, persona: Persona, signal: AbortSignal) {
    while (!signal.aborted) {
      const session = this.store.getSession(sessionId);
      if (!session || session.status !== 'live') return;
      if (this.skipProducts.has(sessionId)) return;
      if (session.show.paused) {
        await interruptibleSleep(200, signal);
        continue;
      }
      const line = this.inserts.get(sessionId)?.shift();
      if (!line) return;
      await this.speak(sessionId, line, productId, 'script', persona, signal);
    }
  }

  private pickProduct(productIds: string[], sessionId: string, loop: boolean): Product | null {
    if (productIds.length === 0) return null;
    const start = this.cursors.get(sessionId) ?? 0;
    const span = loop ? productIds.length : productIds.length - start;
    if (span <= 0) return null;
    for (let offset = 0; offset < span; offset += 1) {
      const index = loop ? (start + offset) % productIds.length : start + offset;
      const product = this.store.getProduct(productIds[index] ?? '');
      if (product) {
        this.cursors.set(sessionId, index + 1);
        return product;
      }
    }
    return null;
  }

  private async answerOne(sessionId: string, product: Product, persona: Persona, signal: AbortSignal) {
    const pending = this.store.nextUnanswered(sessionId);
    if (!pending || signal.aborted) return;
    const answer = await this.llm.answerQuestion({ product, persona, question: pending.text });
    if (signal.aborted) return;
    const comment = this.store.setReply(pending.id, { text: answer.text, provider: answer.provider });
    if (!comment) return;
    this.hub.publish(sessionId, { type: 'reply', comment });
    const stats = this.store.getSession(sessionId)?.stats;
    if (stats) this.hub.publish(sessionId, { type: 'stats', stats });
    await this.speak(sessionId, answer.text, product.id, 'reply', persona, signal);
  }

  private async speak(
    sessionId: string,
    text: string,
    productId: string,
    purpose: SpeechPurpose,
    persona: Persona,
    signal: AbortSignal,
  ) {
    const clip = await this.tts.synthesize(text, persona);
    const live = this.store.getSession(sessionId);
    const avatarVideoUrl = signal.aborted
      ? null
      : await this.avatar.clipFor({
          text,
          persona,
          purpose,
          audioUrl: clip.audioUrl,
          portraitUrl: live?.show.portraitUrl ?? null,
        });
    if (signal.aborted) return;
    const session = this.store.setCaption(sessionId, text);
    const product = this.store.getProduct(productId);
    this.output.updateOverlay({
      hostName: persona.name,
      caption: text,
      productTitle: product?.title ?? '',
      priceLabel: product ? formatYuan(product.priceYuan) : '',
    });
    const counted = this.store.bumpStat(sessionId, 'speakingMs', clip.durationMs);
    this.hub.publish(sessionId, {
      type: 'speech',
      purpose,
      text,
      durationMs: clip.durationMs,
      audioUrl: clip.audioUrl,
      avatarVideoUrl,
      productId,
    });
    if (counted) this.hub.publish(sessionId, { type: 'stats', stats: counted.stats });
    else if (session) this.hub.publish(sessionId, { type: 'stats', stats: session.stats });
    const wait = Math.round(clip.durationMs * this.config.speechPauseScale);
    await interruptibleSleep(wait, signal);
  }
}
