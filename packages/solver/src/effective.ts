/**
 * Default machine for a recipe and the recipe as that machine runs it (SPEC §4.3, fixed config, §5.4 mode 1).
 *
 * - A single-block machine is used when one exists for the recipe type: the highest tier allowed by the plan,
 *   with OC_NON_PERFECT like every GT single block.
 * - Otherwise the recipe type's multiblock with one 2A energy hatch at the plan's tier, no parallel hatch.
 *   Blast furnaces get the lowest coil that reaches the recipe's heat; LCR, cracker and pyrolyse oven
 *   cupronickel coils; everything else NON_PERFECT_SUBTICK. Per-node machine config comes later (M3).
 */
import type { GameData, Recipe, Stack } from '@starfoundry/data';
import {
  COILS, baseRecipe, chanceTier, chancedOutputFactor, chemicalReactorOverclock, crackerOverclock, ebfOverclock,
  electricOverclock, furnaceTemperature, multiblockPower, pyrolyseOverclock, recipeEut, singleblockPower, tierByVoltage, V,
  type MachinePower, type RecipeState,
} from '@starfoundry/mechanics';

export interface EffectiveRecipe {
  recipe: Recipe;
  /** machine index in GameData.machines, if the type has one */
  machine?: number | undefined;
  /** machine tier (single block) or energy hatch tier (multiblock) */
  machineTier: number;
  multiblock: boolean;
  coil?: string | undefined;
  durationTicks: number;
  eut: number;
  parallels: number;
  ocLevel: number;
  chanceTier: number;
  /** expected amount per run, after parallels and boosted chances */
  inputs: { good: number; amount: number }[];
  outputs: { good: number; amount: number }[];
}

const COIL_LOGIC: Record<string, 'ebf' | 'lcr' | 'cracker' | 'pyrolyse'> = {
  'gtceu:electric_blast_furnace': 'ebf',
  'gtceu:alloy_blast_smelter': 'ebf',
  'gtceu:large_chemical_reactor': 'lcr',
  'gtceu:cracker': 'cracker',
  'gtceu:pyrolyse_oven': 'pyrolyse',
};

/** Picks the default machine and applies its overclock; returns undefined if nothing allowed can run it. */
export function effectiveRecipe(data: GameData, recipe: Recipe, maxTier: number): EffectiveRecipe | undefined {
  const typeId = data.recipeTypes[recipe.type]!;
  const machines = data.machinesByType[recipe.type] ?? [];
  const recipeTier = tierByVoltage(recipe.eut);
  let state: RecipeState = baseRecipe(recipe.eut, recipe.durationTicks, recipe.extra.data?.duration_is_total_cwu === true);

  const single = machines
    .filter((m) => !data.machines[m]!.multiblock && data.machines[m]!.tier <= maxTier && data.machines[m]!.tier >= recipeTier)
    .at(-1);
  let machine: number | undefined;
  let machineTier: number;
  let multiblock = false;
  let coil: string | undefined;

  if (recipe.eut === 0) {
    // primitive and steam-free recipes: no energy, no overclock
    machine = machines[0];
    machineTier = data.machines[machine ?? -1]?.tier ?? 0;
  } else if (single !== undefined) {
    machine = single;
    machineTier = data.machines[single]!.tier;
    try {
      state = electricOverclock(state, singleblockPower(machineTier), 'NON_PERFECT');
    } catch {
      return undefined;
    }
  } else {
    multiblock = true;
    machine = machines.find((m) => data.machines[m]!.id === typeId) ?? machines.find((m) => data.machines[m]!.multiblock) ?? machines[0];
    machineTier = maxTier;
    if (recipeTier > maxTier) return undefined;
    const power: MachinePower = multiblockPower([[V[maxTier]!, 2]]);
    try {
      const special = COIL_LOGIC[typeId];
      if (special === 'ebf') {
        const temp = Number(recipe.extra.data?.ebf_temp ?? 0);
        coil = Object.keys(COILS).find((c) => furnaceTemperature(c, maxTier) >= temp);
        if (!coil) return undefined;
        state = ebfOverclock(state, power, coil, temp);
      } else if (special) {
        coil = 'cupronickel';
        const fn = special === 'lcr' ? chemicalReactorOverclock : special === 'cracker' ? crackerOverclock : pyrolyseOverclock;
        if (recipeTier > power.tier) return undefined;
        state = fn(state, power, coil);
      } else {
        state = electricOverclock(state, power, 'NON_PERFECT_SUBTICK');
      }
    } catch {
      return undefined;
    }
  }

  const amount = (s: Stack) => (s.chance < 1 ? s.amount * chancedOutputFactor(state, s.chance, s.boostPerTier) : s.amount * state.contentMultiplier);
  return {
    recipe, machine, machineTier, multiblock, coil,
    durationTicks: state.duration,
    eut: recipeEut(state),
    parallels: state.parallels,
    ocLevel: state.ocLevel,
    chanceTier: chanceTier(state),
    inputs: recipe.inputs.map((s) => ({ good: s.good, amount: amount(s) })),
    outputs: recipe.outputs.map((s) => ({ good: s.good, amount: amount(s) })),
  };
}
