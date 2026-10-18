import { GameData, type RawBundle } from '@starfoundry/data';
import { describe, expect, it } from 'vitest';
import { effectiveRecipe, machineFeatures, machineOptions } from './index.js';

// goods: 0 ingot, 1 plate, 2 dust, 3 hot ingot
const bundle: RawBundle = {
  format: 1,
  dataVersion: 'test',
  goods: { ids: ['x:ingot', 'x:plate', 'x:dust', 'x:hot_ingot'], kinds: [0, 0, 0, 0] },
  tags: {},
  recipeTypes: ['gtceu:bender', 'gtceu:electric_blast_furnace'],
  machines: [
    { id: 'gtceu:lv_bender', tier: 1, types: [0] },
    { id: 'gtceu:mv_bender', tier: 2, types: [0] },
    { id: 'gtceu:large_material_press', tier: 0, types: [0], multiblock: true },
    { id: 'gtceu:electric_blast_furnace', tier: 0, types: [1], multiblock: true },
    { id: 'gtceu:ultimate_ebf', tier: 0, types: [1], multiblock: true },
  ],
  recipes: [
    ['bend', 0, 40, 30, 1, [[0, 3]], [[1, 2]]],
    ['blast', 1, 100, 30, 1, [[2, 1]], [[3, 1]], { data: { ebf_temp: 1000 } }],
    ['hot', 1, 100, 30, 1, [[2, 1]], [[3, 1]], { data: { ebf_temp: 3000 } }],
  ],
};
const data = new GameData(bundle);
const recipe = (id: string) => data.recipe(id)!;

describe('machine config', () => {
  it('defaults to the highest allowed single block', () => {
    const e = effectiveRecipe(data, recipe('bend'), 2)!;
    expect(data.machines[e.machine!]!.id).toBe('gtceu:mv_bender');
    expect([e.durationTicks, e.eut]).toEqual([20, 120]);
  });

  it('lists single blocks and multiblocks that can run a recipe', () => {
    expect(machineOptions(data, recipe('bend')).map((m) => data.machines[m]!.id)).toEqual([
      'gtceu:large_material_press', 'gtceu:lv_bender', 'gtceu:mv_bender',
    ]);
    expect(machineFeatures('gtceu:large_material_press')).toEqual({ parallel: true, coil: false, bulking: false });
    expect(machineFeatures('gtceu:ultimate_ebf')).toEqual({ parallel: true, coil: true, bulking: true });
  });

  it('runs a multiblock with a parallel hatch before the overclock', () => {
    const hatch = { tier: 2, amps: 2, count: 1 };
    const oc = effectiveRecipe(data, recipe('bend'), 2, { machine: 'gtceu:large_material_press', hatch })!;
    expect([oc.multiblock, oc.durationTicks, oc.eut, oc.parallels]).toEqual([true, 20, 120, 1]);
    // the MV hatch fits 4 parallels of the 30 EU/t recipe, which uses up the voltage the OC would have used
    const par = effectiveRecipe(data, recipe('bend'), 2, { machine: 'gtceu:large_material_press', hatch, parallel: 8 })!;
    expect([par.durationTicks, par.eut, par.parallels]).toEqual([40, 120, 4]);
    expect(par.outputs[0]!.amount).toBe(8);
    expect(par.inputs[0]!.amount).toBe(12);
  });

  it('applies throughput boosting and bulking on StarT furnaces', () => {
    const e = effectiveRecipe(data, recipe('blast'), 1, {
      machine: 'gtceu:ultimate_ebf', hatch: { tier: 1, amps: 2, count: 1 }, bulking: '4:3.25',
    })!;
    expect(e.coil).toBe('cupronickel');
    // boosting x4 content, x1.6 time, x0.95 EU/t; bulking x4 content, x3.25 time
    expect([e.durationTicks, e.eut, e.parallels]).toEqual([520, 28, 16]);
    expect(e.outputs[0]!.amount).toBe(16);
  });

  it('picks the coil a blast recipe needs and rejects one too cold', () => {
    const auto = effectiveRecipe(data, recipe('hot'), 2)!;
    expect(auto.coil).toBe('nichrome');
    const cold = effectiveRecipe(data, recipe('hot'), 2, { machine: 'gtceu:electric_blast_furnace', hatch: { tier: 2, amps: 2, count: 1 }, coil: 'kanthal' })!;
    expect(cold.configError).toBe('coil_temperature_too_low');
    expect(cold.coil).toBe('nichrome');
  });

  it('falls back to the default machine when the config cannot run the recipe', () => {
    const e = effectiveRecipe(data, recipe('bend'), 2, { machine: 'gtceu:electric_blast_furnace' })!;
    expect(e.configError).toBe('wrong_machine');
    expect(data.machines[e.machine!]!.id).toBe('gtceu:mv_bender');
  });
});
