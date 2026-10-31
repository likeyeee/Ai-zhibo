import { DEFAULT_PERSONA, type Product } from '@lingbo/shared';
import { describe, expect, it } from 'vitest';
import { buildAnswer, buildScript } from './mockCopy';
import { MockLlm, OpenAiLlm } from './llm';
import { HttpTts, MockTts, estimateSpeechMs } from './tts';
import { loadConfig } from '../config';

const product: Product = {
  id: 'p1',
  title: '正山小种 · 红茶叶礼盒',
  priceYuan: 128,
  imageUrl: null,
  description: '桐木关的红茶',
  sellingPoints: ['松烟香，桂圆甜'],
  faqs: [{ question: '保质期多久', answer: '密封避光可存放18个月' }],
  createdAt: '',
  updatedAt: '',
};

describe('mock copy', () => {
  it('builds a spoken script from the product', () => {
    const text = buildScript(product, DEFAULT_PERSONA)
      .map((segment) => segment.text)
      .join('\n');
    expect(text).toContain(product.title);
    expect(text).toContain('松烟香');
    expect(text).toContain('128');
    expect(text).toContain('18个月');
  });

  it('answers a matching FAQ and a price question differently', () => {
    const faq = buildAnswer(product, DEFAULT_PERSONA, '保质期多久啊');
    expect(faq.via).toBe('faq');
    expect(faq.text).toContain('18个月');
    const price = buildAnswer(product, { ...DEFAULT_PERSONA, tone: 'professional' }, '这个多少钱');
    expect(price.via).toBe('price');
    expect(price.text).toContain('128');
    expect(price.text).not.toContain('18个月');
  });

  it('does not reuse an unrelated FAQ', () => {
    const answer = buildAnswer(product, DEFAULT_PERSONA, '包装是什么颜色');
    expect(answer.via).toBe('general');
    expect(answer.text).not.toContain('18个月');
  });
});

describe('providers', () => {
  it('estimates a readable pause from the text length', () => {
    expect(estimateSpeechMs('你好', 1)).toBe(1500);
    expect(estimateSpeechMs('家人们'.repeat(40), 1)).toBe(7000);
  });

  it('uses the model response when the chat API returns JSON', async () => {
    const llm = new OpenAiLlm(loadConfig({ LLM_API_KEY: 'test', LLM_PROVIDER: 'openai' }), new MockLlm(), async () =>
      Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                segments: [
                  { kind: 'opening', text: '模型开场' },
                  { kind: 'price', text: '只要 10 元' },
                ],
              }),
            },
          },
        ],
      }),
    );
    const draft = await llm.generateScript({ product, persona: DEFAULT_PERSONA });
    expect(draft.provider).toBe('openai');
    expect(draft.segments[0]?.text).toBe('模型开场');
  });

  it('falls back to the local script when the model is offline', async () => {
    const llm = new OpenAiLlm(loadConfig({ LLM_API_KEY: 'test', LLM_PROVIDER: 'openai' }), new MockLlm(), async () => {
      throw new Error('offline');
    });
    const draft = await llm.generateScript({ product, persona: DEFAULT_PERSONA });
    expect(draft.provider).toBe('mock');
    expect(draft.segments.map((segment) => segment.text).join('\n')).toContain(product.title);
  });

  it('calls an HTTP TTS service and falls back when it fails', async () => {
    const config = loadConfig({ TTS_PROVIDER: 'http', TTS_HTTP_URL: 'https://tts.example/speak', TTS_API_KEY: 'secret' });
    let authorization = '';
    const ok = new HttpTts(config, new MockTts(), async (_url, init) => {
      authorization = new Headers(init?.headers).get('authorization') ?? '';
      return Response.json({ audioUrl: 'https://cdn.example/a.mp3', durationMs: 2200 });
    });
    const clip = await ok.synthesize('家人们好', DEFAULT_PERSONA);
    expect(clip.provider).toBe('http');
    expect(clip.audioUrl).toContain('cdn.example');
    expect(authorization).toBe('Bearer secret');

    const failed = new HttpTts(config, new MockTts(), async () => {
      throw new Error('down');
    });
    const fallback = await failed.synthesize('家人们好', DEFAULT_PERSONA);
    expect(fallback.provider).toBe('mock');
    expect(fallback.audioUrl).toBeNull();
  });
});
