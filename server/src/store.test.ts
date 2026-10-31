import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { JsonStore } from './store';

const dirs: string[] = [];

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingbo-store-'));
  dirs.push(dir);
  return new JsonStore(path.join(dir, 'db.json'));
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const sample = {
  title: '测试红茶',
  priceYuan: 128.126,
  imageUrl: null,
  sellingPoints: ['松烟香'],
  faqs: [{ question: '保质期多久', answer: '18个月' }],
  description: '测试',
};

describe('JsonStore', () => {
  it('persists products across instances', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingbo-store-'));
    dirs.push(dir);
    const file = path.join(dir, 'db.json');
    const created = new JsonStore(file).createProduct(sample);
    const loaded = new JsonStore(file).getProduct(created.id);
    expect(loaded?.title).toBe('测试红茶');
    expect(loaded?.priceYuan).toBe(128.13);
  });

  it('updates and deletes products', () => {
    const store = tempStore();
    const created = store.createProduct(sample);
    const updated = store.updateProduct(created.id, { ...sample, title: '新名字', priceYuan: 88 });
    expect(updated?.title).toBe('新名字');
    expect(store.deleteProduct(created.id)).toBe(true);
    expect(store.getProduct(created.id)).toBeNull();
  });

  it('answers the oldest unanswered comment first', () => {
    const store = tempStore();
    const product = store.createProduct(sample);
    const session = store.createLiveSession({ productIds: [product.id], persona: store.getPersona() });
    const first = store.addComment({
      sessionId: session.id,
      viewerName: '甲',
      text: '第一问',
      source: 'viewer',
    });
    store.addComment({ sessionId: session.id, viewerName: '乙', text: '第二问', source: 'viewer' });
    expect(store.nextUnanswered(session.id)?.id).toBe(first?.id);
    const replied = store.setReply(first!.id, { text: '先回答你', provider: 'mock' });
    expect(replied?.reply?.text).toBe('先回答你');
    expect(store.getSession(session.id)?.stats).toMatchObject({ commentCount: 2, replyCount: 1 });
    expect(store.nextUnanswered(session.id)?.text).toBe('第二问');
  });

  it('keeps one comment when the same client id is posted twice', () => {
    const store = tempStore();
    const product = store.createProduct(sample);
    const session = store.createLiveSession({ productIds: [product.id], persona: store.getPersona() });
    const first = store.addComment({
      sessionId: session.id,
      viewerName: '晚风',
      text: '多少钱',
      source: 'viewer',
      clientId: 'c-1',
    });
    const second = store.addComment({
      sessionId: session.id,
      viewerName: '晚风',
      text: '多少钱',
      source: 'viewer',
      clientId: 'c-1',
    });
    expect(second?.id).toBe(first?.id);
    expect(store.getSession(session.id)?.stats.commentCount).toBe(1);
  });

  it('rejects comments after the session ends', () => {
    const store = tempStore();
    const product = store.createProduct(sample);
    const session = store.createLiveSession({ productIds: [product.id], persona: store.getPersona() });
    store.endSession(session.id);
    expect(
      store.addComment({ sessionId: session.id, viewerName: '甲', text: '还有人吗', source: 'viewer' }),
    ).toBeNull();
  });
});
