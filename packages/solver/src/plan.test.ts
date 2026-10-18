import { GameData, type RawBundle } from '@starfoundry/data';
import { describe, expect, it } from 'vitest';
import { buildProblem, readPlan, solveProduction, type PlanRequest } from './index.js';

// goods: 0 ore, 1 dust, 2 ingot, 3 plate, 4 slag, 5 water (fluid), 6 tag(ore|dust)
const bundle: RawBundle = {
  format: 1,
  dataVersion: 'test',
  goods: { ids: ['x:ore', 'x:dust', 'x:ingot', 'x:plate', 'x:slag', 'x:water', '#x:any'], kinds: [0, 0, 0, 0, 0, 1, 2] },
  tags: { 6: [0, 1] },
  recipeTypes: ['x:macerator', 'x:furnace', 'x:bender', 'x:fancy'],
  machines: [
    { id: 'x:lv_macerator', tier: 1, types: [0] },
    { id: 'x:lv_furnace', tier: 1, types: [1] },
    { id: 'x:lv_bender', tier: 1, types: [2] },
    { id: 'x:mv_bender', tier: 2, types: [2] },
    { id: 'x:iv_fancy', tier: 5, types: [3] },
  ],
  recipes: [
    ['macerate', 0, 100, 2, 0, [[0, 1]], [[1, 2], [4, 1, 0.5]]],
    ['smelt', 1, 200, 30, 1, [[1, 1], [5, 100]], [[2, 1]]],
    ['bend', 2, 40, 30, 1, [[2, 3]], [[3, 2]]],
    // high-tier alternative, filtered out by maxTier
    ['fancy', 3, 20, 2048, 5, [[6, 1]], [[3, 10]]],
  ],
};
const data = new GameData(bundle);

async function plan(request: PlanRequest) {
  const problem = buildProblem(data, request);
  return readPlan(data, request, problem, await solveProduction(problem));
}

describe('plan', () => {
  it('builds the chain down to raw resources with machine counts and overclocked power', async () => {
    const p = await plan({ targets: { 3: 2 }, settings: { maxTier: 4, raw: [0, 5] } });
    expect(p.status).toBe('Optimal');
    const node = (id: string) => p.nodes.find((n) => n.recipe.id === id)!;
    expect(node('bend').rate).toBeCloseTo(1);
    // the MV bender overclocks the LV recipe once: 120 EU/t, 1 s
    expect(node('bend').config).toMatchObject({ machineTier: 2, durationTicks: 20, eut: 120, ocLevel: 1 });
    expect(node('bend').machines).toBeCloseTo(1);
    expect(node('smelt').machines).toBeCloseTo(30); // 3 ingots/s × 10 s
    expect(node('macerate').rate).toBeCloseTo(1.5);
    expect(p.totalEut).toBeCloseTo(1 * 120 + 30 * 30 + 7.5 * 2);
    expect(p.imports.raw.get(0)).toBeCloseTo(1.5);
    expect(p.imports.raw.get(5)).toBeCloseTo(300);
    expect(p.byproducts.get(4)).toBeCloseTo(0.75);
  });

  it('uses the tagged recipe when its tier is allowed', async () => {
    const p = await plan({ targets: { 3: 10 }, settings: { maxTier: 5, raw: [0, 5] } });
    const fancy = p.nodes.find((n) => n.recipe.id === 'fancy')!;
    expect(fancy.rate).toBeCloseTo(1);
    // one macerated ore gives two dusts, so the tag is fed with dust, credited to the dust in the node
    expect(fancy.inputs.get(1)).toBeCloseTo(1);
    expect(p.imports.raw.get(0)).toBeCloseTo(0.5);
  });

  it('imports an unmakeable input as a source', async () => {
    const p = await plan({ targets: { 3: 2 }, settings: { maxTier: 4, raw: [] } });
    expect(p.imports.source.get(0)).toBeCloseTo(1.5);
    expect(p.imports.source.get(5)).toBeCloseTo(300);
  });
});
