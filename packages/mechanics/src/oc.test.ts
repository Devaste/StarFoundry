import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  apply, baseRecipe, chanceTier, chancedOutputFactor, ebfOverclock, hatchParallel, heatingCoilOC, multiblockPower,
  ocModifier, recipeEut, singleblockPower, standardOC, subTickParallelOC, type OCResult,
} from './oc.js';

const fmt = (r: OCResult) => [r.eutMultiplier, r.durationMultiplier, r.ocLevel, r.baseOcLevel, r.parallels];

describe('overclock functions match the pack jar', () => {
  // Output of OcHarness.java run against gtceu-st-1.20.1-1.7.1c.jar: 37,180 parameter sets x 28 calls.
  const lines = gunzipSync(readFileSync(new URL('../test/java_oc_reference.txt.gz', import.meta.url))).toString().trim().split('\n');

  it('for every reference case', () => {
    let cases = 0;
    const mismatches: string[] = [];
    for (const line of lines) {
      const parts = line.split('|').map((p) => p.trim());
      const [e, d, v, oc, mp] = parts[0]!.split(' ').map(Number) as [number, number, number, number, number];
      const got = [
        standardOC(e, d, oc, oc, mp, v, 0.5, 4),
        subTickParallelOC(e, d, oc, oc, mp, v, 0.25, 4),
        subTickParallelOC(e, d, oc, oc, mp, v, 0.5, 4),
        standardOC(e, d, oc, oc, mp, v, 0.5, 2),
      ];
      for (const rt of [1000, 1800, 4500, 9001]) for (const mt of [1800, 2700, 3600, 5400, 10800, 18888]) got.push(heatingCoilOC(e, d, oc, oc, mp, v, rt, mt));
      got.forEach((g, n) => {
        cases++;
        const want = parts[n + 1]!.split(',').map(Number);
        if (fmt(g).some((x, i) => x !== want[i]) && mismatches.length < 5) mismatches.push(`${parts[0]} #${n}: ${fmt(g)} vs ${want}`);
      });
    }
    expect(mismatches).toEqual([]);
    expect(cases).toBe(lines.length * 28);
  });
});

describe('worked examples (star_technology_mechanics.md §9)', () => {
  it('HV singleblock, 30 EU/t x 100 t, NON_PERFECT', () => {
    const r = ocModifier(baseRecipe(30, 100), singleblockPower(3), 'NON_PERFECT');
    expect([recipeEut(r), r.duration, r.ocLevel]).toEqual([480, 25, 2]);
    expect(chanceTier(r)).toBe(3);
  });

  it('2x IV 2A multiblock, 30 EU/t x 4 t, NON_PERFECT_SUBTICK', () => {
    const m = multiblockPower([[8192, 2], [8192, 2]]);
    expect(m).toMatchObject({ tier: 6, overclockVoltage: 32768 });
    const r = ocModifier(baseRecipe(30, 4), m, 'NON_PERFECT_SUBTICK');
    expect([recipeEut(r), r.duration, r.parallels, r.ocLevel]).toEqual([30720, 1, 8, 5]);
    expect(chanceTier(r)).toBe(6);
  });

  it('1x EV 16A, 30 EU/t x 400 t: amps add OCs but not chance tiers', () => {
    const m = multiblockPower([[2048, 16]]);
    const r = ocModifier(baseRecipe(30, 400), m, 'NON_PERFECT_SUBTICK');
    expect([recipeEut(r), r.duration, r.ocLevel]).toEqual([30720, 12, 5]);
    expect(chanceTier(r)).toBe(4);
  });

  it('IV 2A with a 16x parallel hatch, 30 EU/t x 200 t', () => {
    const m = multiblockPower([[8192, 2]]);
    let r = hatchParallel(baseRecipe(30, 200), m, 16);
    expect([recipeEut(r), r.parallels, r.baseOcLevel]).toEqual([480, 16, 2]);
    r = ocModifier(r, m, 'NON_PERFECT_SUBTICK');
    expect([recipeEut(r), r.duration]).toEqual([7680, 50]);
    expect(chanceTier(r)).toBe(5);
  });

  it('IV EBF with tritanium coils, 1920 EU/t x 1000 t at 3600 K', () => {
    const r = ebfOverclock(baseRecipe(1920, 1000), multiblockPower([[8192, 2]]), 'tritanium', 3600);
    expect([recipeEut(r), r.duration]).toEqual([5092, 250]);
  });

  it('10% + 8.5%/tier chance, LV recipe in an IV multiblock', () => {
    const r = ocModifier(baseRecipe(30, 1000), multiblockPower([[8192, 2]]), 'NON_PERFECT_SUBTICK');
    expect(chancedOutputFactor(r, 0.1, 0.085) / r.chanceRolls).toBeCloseTo(0.44);
  });

  it('truncates duration at every step', () => {
    expect(apply(baseRecipe(30, 7), { durationMul: 0.5 }).duration).toBe(3);
  });
});
