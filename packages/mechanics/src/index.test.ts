import { describe, expect, it } from 'vitest';
import { TIER_NAMES, V, tierOf } from './index.js';

describe('tiers', () => {
  it('matches GTValues.V', () => {
    expect(V[0]).toBe(8);
    expect(V[1]).toBe(32);
    expect(V[9]).toBe(2_097_152);
    expect(V.length).toBe(TIER_NAMES.length);
  });

  it('finds the tier of a recipe voltage', () => {
    expect(tierOf(7)).toBe(0);
    expect(tierOf(30)).toBe(1);
    expect(tierOf(32)).toBe(1);
    expect(tierOf(33)).toBe(2);
    expect(tierOf(1_966_080)).toBe(9);
  });
});
