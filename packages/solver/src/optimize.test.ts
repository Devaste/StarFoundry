import { GameData, type RawBundle } from '@starfoundry/data';
import { describe, expect, it } from 'vitest';
import { exactLine, optimizePlan, perfectRates, solveMip, solveProduction } from './index.js';

// goods: 0 ingot, 1 plate; one bending recipe at LV, benders at LV and MV
const bundle: RawBundle = {
  format: 1,
  dataVersion: 'test',
  goods: { ids: ['x:ingot', 'x:plate'], kinds: [0, 0] },
  tags: {},
  recipeTypes: ['x:bender'],
  machines: [
    { id: 'x:lv_bender', tier: 1, types: [0] },
    { id: 'x:mv_bender', tier: 2, types: [0] },
  ],
  recipes: [
    ['bend', 0, 40, 30, 1, [[0, 1]], [[1, 1]]],
    // makes two plates of an ingot, at the cost of a byproduct-free but slower run
    ['press', 0, 80, 30, 1, [[0, 1]], [[1, 2]]],
  ],
};
const data = new GameData(bundle);
const optimize = (rate: number) =>
  optimizePlan(data, { targets: { 1: rate }, settings: { maxTier: 2, raw: [0], supplied: [0], manual: true, locks: { 1: 'bend' } } }, solveProduction);

describe('optimizePlan', () => {
  it('keeps the tier that needs fewer machines', async () => {
    // 1 plate/s: 2 LV benders or 1 MV bender (the default)
    const o = await optimize(1);
    expect(o.changes).toEqual([]);
    expect(o.after.machines).toBe(1);
  });

  it('suggests a recipe that takes less from the factory', async () => {
    const o = await optimize(1);
    expect(o.alternatives.map((a) => a.recipe)).toEqual(['press']);
    expect(o.alternatives[0]!.score.inputs).toBeCloseTo(0.5);
  });

  it('drops to the lowest tier that still needs the same machines, to save power', async () => {
    // 0.1 plate/s: one bender either way; LV draws 6 EU/t on average, MV (overclocked) 12
    const o = await optimize(0.1);
    expect(o.changes.map((c) => c.config)).toEqual([{ machine: 'x:lv_bender' }]);
    expect(o.after.eut).toBeCloseTo(6);
    expect(o.before.eut).toBeCloseTo(12);
  });
});

describe('wholeBatch', () => {
  it('counts the batch of input in which every recipe runs whole', async () => {
    // 1 plate/s on the bender: 1 ingot per run, so one ingot is a whole batch
    const o = await optimize(1);
    expect(o.batch).toMatchObject({ good: 0, amount: 1 });
  });
});

describe('perfectRates', () => {
  it('finds the nearest rates where every machine works full time', () => {
    const rates = perfectRates([0.5, 1.5]);
    expect(rates[0]).toMatchObject({ scale: 1, machines: 3 });
    expect(rates.at(-1)).toMatchObject({ scale: 2, utilization: 1, machines: 4 });
  });
});

describe('exactLine', () => {
  it('grows the line until every machine works full time', async () => {
    // 0.3 plate/s: one LV bender (0.5 runs/s) is the smallest full-time line
    const request = { targets: { 1: 0.3 }, settings: { maxTier: 2, raw: [0], supplied: [0], manual: true, locks: { 1: 'bend' } } };
    const o = await optimizePlan(data, request, solveProduction);
    const { line } = await exactLine(data, request, o.plan, o.configs, solveMip, 1);
    expect(line?.recipes.map((r) => [r.machines, r.setup.machineTier])).toEqual([[1, 1]]);
    expect(line?.targets.get(1)).toBeCloseTo(0.5);
    expect(line?.recipes[0]!.busy).toBeCloseTo(1);
  });
});
