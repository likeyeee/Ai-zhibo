import { describe, expect, it } from 'vitest';
import { blendOpenness, blinkAmount, mouthBox, visemeAt } from '@lingbo/shared';
import { hostById } from '@lingbo/shared';

describe('visemes', () => {
  it('rests outside the utterance and opens on a spoken character', () => {
    expect(visemeAt('你好', -1, 1000)).toEqual({ shape: 'rest', openness: 0 });
    expect(visemeAt('你好', 1000, 1000)).toEqual({ shape: 'rest', openness: 0 });
    expect(visemeAt('', 100, 1000).shape).toBe('rest');
    const spoken = visemeAt('你好', 100, 1000);
    expect(spoken.shape).not.toBe('rest');
    expect(spoken.openness).toBeGreaterThanOrEqual(0.15);
    expect(spoken.openness).toBeLessThanOrEqual(0.85);
    expect(visemeAt('你。', 800, 1000)).toEqual({ shape: 'closed', openness: 0.05 });
  });

  it('lets audio amplitude override a closed viseme and blinks on a short window', () => {
    expect(blendOpenness(0.2, null)).toBe(0.2);
    expect(blendOpenness(0.2, 0.8)).toBeGreaterThan(0.7);
    expect(blinkAmount(0, 0)).toBe(0);
    expect(blinkAmount(55, 0)).toBeGreaterThan(0.9);
    const box = mouthBox(hostById('lin').face, { shape: 'open', openness: 0.8 });
    const rest = mouthBox(hostById('lin').face, { shape: 'rest', openness: 0 });
    expect(box.h).toBeGreaterThan(rest.h);
  });
});
