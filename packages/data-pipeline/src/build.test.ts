import { GameData, GoodKind, buildSearchIndex } from '@starfoundry/data';
import { describe, expect, it } from 'vitest';
import { buildBundle, buildNames, type DumpRecipe, type DumpStack } from './build.js';

const full = { chance: 10000, maxChance: 10000, tierChanceBoost: 0 };
const item = (id: string | string[], count: number, extra: Partial<DumpStack> = {}): DumpStack => ({
  ...full, items: Array.isArray(id) ? id : [id], count, consumed: true, ...extra,
});
const fluid = (id: string, amount: number): DumpStack => ({ ...full, fluids: [id], amount, consumed: true });
const recipe = (r: Partial<DumpRecipe> & Pick<DumpRecipe, 'contents'>): DumpRecipe => ({
  duration: 100, category: 'gtceu:centrifuge', voltage_tier: 1,
  energy: { input: { total: 30 }, output: { total: 0 } }, ...r,
});

const dump = {
  'gtceu:centrifuge': {
    'gtceu:centrifuge/a': recipe({
      contents: {
        inputs: {
          item: [
            item(['minecraft:sand', 'minecraft:red_sand'], 2, { content: { ingredient: { tag: 'minecraft:smelts_to_glass' } } }),
            item('gtceu:programmed_circuit', 1, { circuit: 3, consumed: false, chance: 0 }),
            item('gtceu:catalyst', 1, { consumed: false }),
          ],
          fluid: [fluid('gtceu:water', 1000)],
        },
        outputs: {
          item: [
            item('gtceu:dust', 1),
            item('gtceu:rare', 1, { chance: 2500, tierChanceBoost: 500 }),
            item('gtceu:range', 0, { count: undefined, count_min: 0, count_max: 10 }),
          ],
        },
      },
      conditions: [{ type: 'cleanroom', tooltip: '?cRequires Cleanroom' }],
    }),
  },
  'gtceu:macerator': {
    'gtceu:macerator/recycle': recipe({ category: 'gtceu:macerator_recycling', contents: { outputs: { item: [item('gtceu:dust', 1)] } } }),
  },
  'gtceu:steam_turbine': {
    'gtceu:steam_turbine/steam': recipe({
      energy: { input: { total: 0 }, output: { total: 32 } },
      contents: { inputs: { fluid: [fluid('gtceu:steam', 640)] } },
    }),
  },
};
const machines = {
  recipe_types: { 'gtceu:centrifuge': {}, 'gtceu:macerator': {}, 'gtceu:steam_turbine': {} },
  machines: {
    'gtceu:lv_centrifuge': { tier: 1, recipe_types: ['gtceu:centrifuge'], multiblock: false },
    'gtceu:me_hatch': { tier: 7, recipe_types: [], multiblock: false },
  },
};

describe('buildBundle', () => {
  const bundle = buildBundle(dump, machines, { dataVersion: 'test' });
  const data = new GameData(bundle);
  const g = (kind: GoodKind, id: string) => data.good(kind, id)!;

  it('drops recycling and keeps the rest', () => {
    expect(bundle.recipes.map((r) => r[0])).toEqual(['gtceu:centrifuge/a', 'gtceu:steam_turbine/steam']);
    expect(bundle.machines.map((m) => m.id)).toEqual(['gtceu:lv_centrifuge']);
  });

  it('normalizes stacks: tags, circuits, catalysts, chances, ranges', () => {
    const r = data.recipe('gtceu:centrifuge/a')!;
    const tag = g(GoodKind.Tag, '#minecraft:smelts_to_glass');
    expect(data.tags.get(tag)!.map((m) => data.goodIds[m])).toEqual(['minecraft:sand', 'minecraft:red_sand']);
    expect(r.inputs.map((s) => [s.good, s.amount])).toEqual([[tag, 2], [g(GoodKind.Fluid, 'gtceu:water'), 1000]]);
    expect(r.extra.circuit).toBe(3);
    expect(r.extra.keep).toEqual([[g(GoodKind.Item, 'gtceu:catalyst'), 1]]);
    expect(r.outputs[1]).toMatchObject({ chance: 0.25, boostPerTier: 0.05 });
    expect(r.outputs[2]!.amount).toBe(5);
    expect(r.extra.range).toEqual({ 2: [0, 10] });
    expect(r.extra.cond).toEqual(['Requires Cleanroom']);
    expect(data.recipe('gtceu:steam_turbine/steam')!.eut).toBe(-32);
  });

  it('indexes producers and consumers through tags', () => {
    const r = data.recipe('gtceu:centrifuge/a')!.index;
    expect(data.producers[g(GoodKind.Item, 'gtceu:dust')]).toEqual([r]);
    expect(data.consumers[g(GoodKind.Item, 'minecraft:red_sand')]).toEqual([r]);
  });

  it('builds names with fallback and search', () => {
    const en = buildNames(bundle, { items: { 'gtceu:dust': 'Dust', 'minecraft:sand': 'Sand' }, fluids: { 'gtceu:water': 'Water' } }, 'en');
    const ru = buildNames(bundle, { items: { 'gtceu:dust': 'Пыль' } }, 'ru');
    data.setNames(ru, en);
    expect(data.goodName(g(GoodKind.Item, 'gtceu:dust'))).toBe('Пыль');
    expect(data.goodName(g(GoodKind.Fluid, 'gtceu:water'))).toBe('Water');
    expect(data.goodName(g(GoodKind.Item, 'gtceu:rare'))).toBe('gtceu:rare');
    const search = buildSearchIndex(data, en.goods);
    expect(search.search('dust')[0]).toBe(g(GoodKind.Item, 'gtceu:dust'));
    expect(search.search('пыль')).toEqual([g(GoodKind.Item, 'gtceu:dust')]);
    expect(search.search('water')).toEqual([g(GoodKind.Fluid, 'gtceu:water')]);
  });
});
