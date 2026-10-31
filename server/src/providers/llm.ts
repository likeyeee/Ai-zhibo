/**
 * 话术提供者。
 *
 * mock：只用商品资料拼口播，不联网。
 * openai：调用兼容 OpenAI Chat Completions 的接口。失败时退回 mock，直播不会中断。
 *
 * 接入自己的模型时，保持 LlmProvider 的两个方法即可：
 * generateScript 返回 5–8 段口播，answerQuestion 只根据商品资料回答。
 */
import { z } from 'zod';
import type { AppConfig } from '../config';
import { buildAnswer, buildScript } from './mockCopy';
import type { AnswerDraft, LlmProvider, ScriptDraft } from './types';

const segmentSchema = z
  .object({
    kind: z.enum(['opening', 'selling_point', 'price', 'faq', 'closing']),
    text: z.string().trim().min(1).max(500),
  })
  .array()
  .min(1)
  .max(12);

export class MockLlm implements LlmProvider {
  readonly id = 'mock' as const;

  async generateScript(input: Parameters<LlmProvider['generateScript']>[0]): Promise<ScriptDraft> {
    return { segments: buildScript(input.product, input.persona), provider: 'mock' };
  }

  async answerQuestion(input: Parameters<LlmProvider['answerQuestion']>[0]): Promise<AnswerDraft> {
    return { text: buildAnswer(input.product, input.persona, input.question).text, provider: 'mock' };
  }
}

export class OpenAiLlm implements LlmProvider {
  readonly id = 'openai' as const;

  constructor(
    private readonly config: AppConfig,
    private readonly fallback: MockLlm,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async generateScript(input: Parameters<LlmProvider['generateScript']>[0]): Promise<ScriptDraft> {
    try {
      const content = await this.chat([
        {
          role: 'system',
          content:
            '你是电商直播编剧。只输出简体中文 JSON，不要写 Markdown。不要编造商品资料里没有的功效、认证和承诺，不要使用“最”“第一”“根治”“百分百”这类绝对化用语。',
        },
        {
          role: 'user',
          content: [
            `主播：${input.persona.name}`,
            `语气：${input.persona.tone}`,
            `补充要求：${input.persona.extraNotes || '无'}`,
            `商品资料：${JSON.stringify({
              title: input.product.title,
              priceYuan: input.product.priceYuan,
              description: input.product.description,
              sellingPoints: input.product.sellingPoints,
              faqs: input.product.faqs,
            })}`,
            '输出 {"segments":[{"kind":"opening|selling_point|price|faq|closing","text":"..."}]}。',
            '写 5 到 8 段口语，必须出现价格数字和至少一个卖点。',
          ].join('\n'),
        },
      ]);
      const parsed = segmentSchema.parse(parseJson(content));
      return { segments: parsed, provider: 'openai' };
    } catch (error) {
      console.error('话术模型调用失败，改用本地话术', error);
      return this.fallback.generateScript(input);
    }
  }

  async answerQuestion(input: Parameters<LlmProvider['answerQuestion']>[0]): Promise<AnswerDraft> {
    try {
      const content = await this.chat([
        {
          role: 'system',
          content:
            '你是直播间里的数字主播。只用给定商品资料回答，不知道就说可以在下一段补充，不要编造。80 字以内，简体中文，口语。',
        },
        {
          role: 'user',
          content: [
            `主播：${input.persona.name}`,
            `语气：${input.persona.tone}`,
            `商品：${input.product.title}，价格 ${input.product.priceYuan} 元`,
            `卖点：${input.product.sellingPoints.join('；') || '无'}`,
            `问答：${input.product.faqs.map((item) => `${item.question} => ${item.answer}`).join('\n') || '无'}`,
            `观众问：${input.question}`,
          ].join('\n'),
        },
      ]);
      const text = content.trim();
      if (!text) throw new Error('empty answer');
      return { text, provider: 'openai' };
    } catch (error) {
      console.error('回答模型调用失败，改用本地回答', error);
      return this.fallback.answerQuestion(input);
    }
  }

  private async chat(messages: Array<{ role: 'system' | 'user'; content: string }>): Promise<string> {
    const response = await this.fetchImpl(`${this.config.llmBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.llmApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.config.llmModel,
        temperature: 0.7,
        messages,
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`LLM ${response.status}`);
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw new Error('LLM 没有返回内容');
    return content;
  }
}

export function createLlm(config: AppConfig, fetchImpl: typeof fetch = fetch): LlmProvider {
  const mock = new MockLlm();
  if (config.llmProvider === 'openai' && config.llmApiKey) {
    return new OpenAiLlm(config, mock, fetchImpl);
  }
  return mock;
}

function parseJson(content: string): unknown {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const parsed = JSON.parse(cleaned) as { segments?: unknown } | unknown[];
  if (Array.isArray(parsed)) return parsed;
  return parsed.segments ?? parsed;
}
