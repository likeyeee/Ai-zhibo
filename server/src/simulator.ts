import type { Product } from '@lingbo/shared';
import type { AppConfig } from './config';
import type { LiveHub } from './liveHub';
import type { JsonStore } from './store';

const NAMES = ['晚风', '小鹿', '阿棠', '米粒', '南山', '桃桃', '星河', '阿宁', '春山', '白露'];

const GENERIC = ['这个多少钱？', '现在有优惠吗？', '适合什么人？', '发货要多久？', '能再讲讲卖点吗？', '质量怎么样？'];

export class ViewerSimulator {
  private readonly timers = new Map<string, NodeJS.Timeout[]>();

  constructor(
    private readonly store: JsonStore,
    private readonly hub: LiveHub,
    private readonly config: AppConfig,
  ) {}

  start(sessionId: string) {
    this.stop(sessionId);
    const tick = () => this.tick(sessionId);
    const kick = setTimeout(tick, 2500);
    const loop = setInterval(tick, this.config.simulateIntervalMs);
    this.timers.set(sessionId, [kick, loop]);
  }

  stop(sessionId: string) {
    const timers = this.timers.get(sessionId);
    if (!timers) return;
    for (const timer of timers) clearTimeout(timer);
    this.timers.delete(sessionId);
  }

  stopAll() {
    for (const sessionId of [...this.timers.keys()]) this.stop(sessionId);
  }

  private tick(sessionId: string) {
    const session = this.store.getSession(sessionId);
    if (!session || session.status !== 'live') return;
    const audience = 80 + Math.floor(Math.random() * 70) + session.stats.commentCount * 2;
    const updated = this.store.setDemoAudience(sessionId, audience);
    if (updated) this.hub.publish(sessionId, { type: 'stats', stats: updated.stats });
    if (Math.random() > 0.75) return;
    const product = session.currentProductId ? this.store.getProduct(session.currentProductId) : null;
    const comment = this.store.addComment({
      sessionId,
      viewerName: NAMES[Math.floor(Math.random() * NAMES.length)] ?? '观众',
      text: pickQuestion(product),
      source: 'simulator',
    });
    if (!comment) return;
    this.hub.publish(sessionId, { type: 'comment', comment });
    const stats = this.store.getSession(sessionId)?.stats;
    if (stats) this.hub.publish(sessionId, { type: 'stats', stats });
  }
}

function pickQuestion(product: Product | null): string {
  const faqs = product?.faqs.map((item) => item.question) ?? [];
  const pool = [...GENERIC, ...faqs, ...faqs];
  return pool[Math.floor(Math.random() * pool.length)] ?? '这个多少钱？';
}
