import { GameData, type RawBundle } from '@starfoundry/data';
import { describe, expect, it } from 'vitest';
import { buildProblem, reachableGoods, readPlan, solveProduction, type PlanRequest } from './index.js';

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

  it('never plans a recipe whose inputs cannot be had, and says the target is out of reach', async () => {
    // no raw ore or water: nothing can make the plate
    const p = await plan({ targets: { 3: 2 }, settings: { maxTier: 4, raw: [] } });
    expect(p.nodes).toEqual([]);
    expect(p.unreachable).toEqual([3]);
    expect(p.imports.source.get(3)).toBeCloseTo(2);
    // supplying the ore and water makes the line possible again
    const ok = await plan({ targets: { 3: 2 }, settings: { maxTier: 4, raw: [], supplied: [0, 5] } });
    expect(ok.unreachable).toEqual([]);
    expect(ok.nodes.map((n) => n.recipe.id).sort()).toEqual(['bend', 'macerate', 'smelt']);
  });

  it('reaches only goods whose whole chain fits the tier', () => {
    const reach = (maxTier: number) => [...reachableGoods(data, { maxTier, raw: [0, 5] })].sort((a, b) => a - b);
    // ULV: maceration only (the furnace is LV), so no ingot and no plate
    expect(reach(0)).toEqual([0, 1, 4, 5, 6]);
    expect(reach(1)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('builds only the recipes the user picked in recipe mode', async () => {
    const settings = { maxTier: 1, raw: [0, 5], manual: true };
    // nothing picked: the target itself is the chain's input
    const none = await plan({ targets: { 3: 2 }, settings });
    expect(none.nodes).toEqual([]);
    expect(none.imports.leaf.get(3)).toBeCloseTo(2);
    // the plate on the bender and the ingot on the furnace; the dust stays an input, even though it could be made
    const two = await plan({ targets: { 3: 2 }, settings: { ...settings, locks: { 3: 'bend', 2: 'smelt' } } });
    expect(two.nodes.map((n) => n.recipe.id).sort()).toEqual(['bend', 'smelt']);
    expect(two.imports.leaf.get(1)).toBeCloseTo(3);
    // a picked recipe above the plan's tier still runs (on a machine of its own tier)
    const fancy = await plan({ targets: { 3: 10 }, settings: { ...settings, locks: { 3: 'fancy' } } });
    expect(fancy.nodes.map((n) => n.recipe.id)).toEqual(['fancy']);
  });

  it('respects bans and locks', async () => {
    const banned = await plan({ targets: { 3: 10 }, settings: { maxTier: 5, raw: [0, 5], bans: ['fancy'] } });
    expect(banned.nodes.map((n) => n.recipe.id).sort()).toEqual(['bend', 'macerate', 'smelt']);
    // locking the plate to the high-tier recipe works even when the plan's tier is lower
    const locked = await plan({ targets: { 3: 10 }, settings: { maxTier: 1, raw: [0, 5], locks: { 3: 'fancy' } } });
    expect(locked.nodes.map((n) => n.recipe.id)).toContain('fancy');
    expect(locked.nodes.map((n) => n.recipe.id)).not.toContain('bend');
  });

  it('buys a supplied good instead of making it, even when making it is cheap', async () => {
    // ingots and a little slag: maceration makes dust and slag together
    const both = { targets: { 2: 1, 4: 0.1 } };
    const made = await plan({ ...both, settings: { maxTier: 4, raw: [0, 1, 5] } });
    expect(made.nodes.map((n) => n.recipe.id).sort()).toEqual(['macerate', 'smelt']);
    expect(made.imports.raw.get(1) ?? 0).toBeCloseTo(0);
    const bought = await plan({ ...both, settings: { maxTier: 4, raw: [0, 5], supplied: [1] } });
    // 0.2 macerations/s give the slag and 0.4 dust; the other 0.6 dust is bought
    expect(bought.imports.raw.get(1)).toBeCloseTo(0.6);
  });

  it('runs a recipe on the machine the user set up', async () => {
    const settings = { maxTier: 4, raw: [0, 5] };
    const auto = await plan({ targets: { 3: 2 }, settings });
    const lv = await plan({ targets: { 3: 2 }, settings: { ...settings, configs: { bend: { machine: 'x:lv_bender' } } } });
    const bend = (p: typeof auto) => p.nodes.find((n) => n.recipe.id === 'bend')!;
    // the LV bender does not overclock: twice the machines at a quarter of the power each
    expect(bend(lv).machines).toBeCloseTo(bend(auto).machines * 2);
    expect(bend(lv).eut).toBeCloseTo(bend(auto).eut / 2);
    expect(bend(lv).config.configured).toBe(true);
  });
});
