import { plainPrice, type Persona, type Product, type ScriptSegment, type Tone } from '@lingbo/shared';

export type AnswerVia = 'faq' | 'price' | 'promo' | 'shipping' | 'general';

export interface BuiltAnswer {
  text: string;
  via: AnswerVia;
}

const OPENING: Record<Tone, (name: string, title: string) => string> = {
  enthusiastic: (name, title) =>
    `家人们，欢迎来到直播间，我是${name}。今天重点讲「${title}」，卖点和价格我都放在明面上。`,
  professional: (name, title) =>
    `大家好，我是${name}。这一段把「${title}」的特点、适合谁、以及价格讲完。`,
  gentle: (name, title) =>
    `大家好呀，我是${name}。我想慢慢介绍「${title}」，你们可以边听边在评论区提问。`,
  humorous: (name, title) =>
    `${name}上线了。今天这款「${title}」，我按真实使用场景讲，不念参数表。`,
};

const POINT_LEADS: Record<Tone, string[]> = {
  enthusiastic: ['先说最值得记的，', '再一个，', '还有，', '另外，'],
  professional: ['第一点，', '第二点，', '补充一点，', '还需要说明，'],
  gentle: ['我比较在意的是，', '还有，', '另外想说，', '再补一句，'],
  humorous: ['最打动我的是，', '然后，', '还有个实际的好处，', '最后，'],
};

const LEAD: Record<Tone, string> = {
  enthusiastic: '这条我来答。',
  professional: '直接回答：',
  gentle: '我看到你的问题了。',
  humorous: '好，我按资料答。',
};

const CLOSING: Record<Tone, (name: string) => string> = {
  enthusiastic: (name) =>
    `${name}先讲到这里。想要的可以看下方商品，有问题打在公屏上，我下一段回答。`,
  professional: () => '以上是这款商品的核心信息。具体问题发在评论里，我会按商品资料回答。',
  gentle: () => '先介绍到这里。你们有疑问就留言，我会按资料逐条回复。',
  humorous: () => '这一轮讲完了。要下单看商品卡，有问题尽管丢到评论区。',
};

export function buildScript(product: Product, persona: Persona): ScriptSegment[] {
  const price = plainPrice(product.priceYuan);
  const segments: ScriptSegment[] = [
    { kind: 'opening', text: OPENING[persona.tone](persona.name, product.title) },
  ];
  if (product.description.trim()) {
    segments.push({ kind: 'selling_point', text: `背景先说清楚：${finish(product.description)}` });
  }
  product.sellingPoints.forEach((point, index) => {
    const lead = POINT_LEADS[persona.tone][index % POINT_LEADS[persona.tone].length] ?? '';
    segments.push({ kind: 'selling_point', text: `${lead}${finish(point)}` });
  });
  segments.push({ kind: 'price', text: priceLine(persona.tone, product.title, price) });
  for (const faq of product.faqs.slice(0, 2)) {
    segments.push({
      kind: 'faq',
      text: `如果有人问「${faq.question}」，答案是：${finish(faq.answer)}`,
    });
  }
  if (persona.extraNotes.trim()) {
    segments.push({ kind: 'selling_point', text: finish(persona.extraNotes) });
  }
  segments.push({ kind: 'closing', text: CLOSING[persona.tone](persona.name) });
  return segments;
}

export function buildAnswer(product: Product, persona: Persona, question: string): BuiltAnswer {
  const price = plainPrice(product.priceYuan);
  const lead = LEAD[persona.tone];
  const faq = matchFaq(product, question);
  if (faq) {
    return { via: 'faq', text: `${lead}${finish(faq.answer)}` };
  }
  if (/多少钱|价格|怎么卖|售价/.test(question)) {
    return { via: 'price', text: `${lead}「${product.title}」现在的直播价是 ${price} 元。` };
  }
  if (/优惠|折扣|便宜|券|满减/.test(question)) {
    return {
      via: 'promo',
      text: `${lead}优惠就是这个直播价 ${price} 元，没有另外的口头折扣，以页面显示为准。`,
    };
  }
  if (/发货|快递|物流|几天到|包邮/.test(question)) {
    return { via: 'shipping', text: `${lead}下单后按店铺正常时效发货，具体以订单页的物流信息为准。` };
  }
  const point = product.sellingPoints[0];
  if (point) {
    const short = [...question].slice(0, 40).join('');
    return {
      via: 'general',
      text: `${lead}关于「${short}」，这款可以先记住：${finish(point)}价格是 ${price} 元。`,
    };
  }
  return {
    via: 'general',
    text: `${lead}「${product.title}」的直播价是 ${price} 元。我下一段继续讲卖点。`,
  };
}

export function matchFaq(product: Product, question: string): Product['faqs'][number] | null {
  const normalized = normalize(question);
  let best: { faq: Product['faqs'][number]; score: number } | null = null;
  for (const faq of product.faqs) {
    const target = normalize(faq.question);
    let score = overlapScore(normalized, target);
    if (normalized && target && (normalized.includes(target) || target.includes(normalized))) score = 1;
    if (!best || score > best.score) best = { faq, score };
  }
  if (best && best.score >= 0.45) return best.faq;
  return null;
}

function priceLine(tone: Tone, title: string, price: string): string {
  switch (tone) {
    case 'enthusiastic':
      return `价格说在前面，「${title}」直播间今天是 ${price} 元。`;
    case 'professional':
      return `价格是 ${price} 元，对应的就是刚才这款「${title}」。`;
    case 'gentle':
      return `如果你们觉得合适，「${title}」的价格是 ${price} 元。`;
    case 'humorous':
      return `报价格：${price} 元。说的就是「${title}」。`;
  }
}

function finish(text: string): string {
  const trimmed = text.trim().replace(/[。.!！?？]+$/u, '');
  return `${trimmed}。`;
}

function normalize(input: string): string {
  return input.toLowerCase().replace(/[^\p{Script=Han}a-z0-9]/gu, '');
}

function overlapScore(leftRaw: string, rightRaw: string): number {
  const left = bigrams(leftRaw);
  const right = bigrams(rightRaw);
  if (left.size === 0 || right.size === 0) return 0;
  let hit = 0;
  for (const item of left) if (right.has(item)) hit += 1;
  return hit / left.size;
}

function bigrams(input: string): Set<string> {
  const chars = [...input];
  const set = new Set<string>();
  if (chars.length === 1) set.add(chars[0] ?? '');
  for (let i = 0; i < chars.length - 1; i += 1) set.add(`${chars[i]}${chars[i + 1]}`);
  set.delete('');
  return set;
}
