import type { ProductInput } from './store';

export const SAMPLE_PRODUCTS: ProductInput[] = [
  {
    title: '正山小种 · 红茶叶礼盒',
    priceYuan: 128,
    imageUrl: null,
    description: '武夷山桐木关的正山小种，松烟香清楚，汤色是红琥珀，适合自喝，也适合当一份不太张扬的礼物。',
    sellingPoints: [
      '核心产区春茶，松烟香和桂圆甜都在',
      '一泡一罐，办公室和出差都好带',
      '不涩口，第一次喝红茶的人也能接受',
    ],
    faqs: [
      { question: '保质期多久', answer: '密封避光可存放 18 个月，开罐后建议一个月内喝完' },
      { question: '苦不苦', answer: '以醇甜为主，烟熏香在后段，正常冲泡不涩口' },
      { question: '怎么泡', answer: '95℃的水，3 克茶配 150 毫升，先快速洗茶，再泡 10 秒起' },
    ],
  },
  {
    title: '云感保湿精华 30ml',
    priceYuan: 199,
    imageUrl: null,
    description: '给容易紧绷的皮肤用的凝露精华，主打保湿，不走厚重奶油质地。',
    sellingPoints: [
      '神经酰胺和泛醇，重点是补水而不是堆功效',
      '凝露质地，涂完很快收，夏天也不闷',
      '无香精、无酒精',
    ],
    faqs: [
      { question: '油皮能用吗', answer: '可以。质地是凝露，成膜很快，不容易糊在脸上' },
      { question: '孕妇能用吗', answer: '配方没有添加视黄醇，使用前仍建议咨询医生' },
      { question: '有香精吗', answer: '没有香精，也没有酒精' },
    ],
  },
  {
    title: '口袋筋膜枪 Mini',
    priceYuan: 299,
    imageUrl: null,
    description: '运动后放松肩颈和小腿的小机器，强调轻和能带出门，不讲医疗效果。',
    sellingPoints: [
      '机身大约 480 克，可以放进通勤包',
      '四档力度，低档适合肩颈，高档适合小腿',
      'Type-C 充电，约 90 分钟充满',
    ],
    faqs: [
      { question: '噪音大吗', answer: '最低档适合在家里用，晚上使用建议关上门' },
      { question: '怎么充电', answer: 'Type-C 接口，大约 90 分钟充满' },
      { question: '有保修吗', answer: '整机一年质保，以包装内的保修卡为准' },
    ],
  },
];
