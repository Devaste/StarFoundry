/**
 * The machine a recipe runs on and the recipe as that machine runs it (SPEC §4.3, §5.4 mode 1).
 *
 * Default, when the user set nothing for the recipe:
 * - A single-block machine when one exists for the recipe type: the highest tier allowed by the plan,
 *   with OC_NON_PERFECT like every GT single block.
 * - Otherwise the recipe type's multiblock with one 2A energy hatch at the plan's tier, no parallel hatch,
 *   and the lowest coil that works (blast furnaces: the lowest that reaches the recipe's heat).
 *
 * A per-recipe MachineConfig picks the machine, its energy hatches, parallel hatch, coil and bulking.
 * Multiblocks run their own modifier chain (MACHINE_MODIFIERS); modifiers the port does not model yet
 * are skipped and the result is flagged approximate.
 */
import type { GameData, Recipe, Stack } from '@starfoundry/data';
import {
  COILS, MACHINE_MODIFIERS, baseRecipe, bulking, chanceTier, chancedOutputFactor, chemicalReactorOverclock,
  crackerOverclock, ebfOverclock, electricOverclock, furnaceTemperature, hatchParallel, multiblockPower,
  pyrolyseOverclock, recipeEut, recipeEutTier, singleblockPower, throughputBoosting, tierByVoltage, V,
  type MachinePower, type Modifier, type RecipeState,
} from '@starfoundry/mechanics';

/** What the user set for one recipe's machine; everything optional, missing parts use the default. */
export interface MachineConfig {
  /** machine id (single block of a given tier, or a multiblock) */
  machine?: string;
  /** multiblock energy hatches: `count` hatches of `amps` A at voltage tier `tier` */
  hatch?: { tier: number; amps: number; count: number };
  /** parallel hatch setting (0 = none) */
  parallel?: number;
  coil?: string;
  /** StarT bulking type, e.g. '4:3.25' */
  bulking?: string;
}

export interface EffectiveRecipe {
  recipe: Recipe;
  /** machine index in GameData.machines, if the type has one */
  machine?: number | undefined;
  /** machine tier (single block) or energy hatch tier (multiblock) */
  machineTier: number;
  multiblock: boolean;
  /** multiblock energy hatches as used */
  hatch?: { tier: number; amps: number; count: number } | undefined;
  parallel?: number | undefined;
  coil?: string | undefined;
  bulking?: string | undefined;
  /** the machine has modifiers the planner does not model: numbers are a lower bound */
  approximate: boolean;
  /** why the user's config could not run the recipe (the default machine is used instead) */
  configError?: string | undefined;
  /** runs on the user's config (not the default machine) */
  configured: boolean;
  /** the plan tier the default machine was picked for */
  maxTier: number;
  durationTicks: number;
  eut: number;
  parallels: number;
  ocLevel: number;
  chanceTier: number;
  /** expected amount per run, after parallels and boosted chances */
  inputs: { good: number; amount: number }[];
  outputs: { good: number; amount: number }[];
}

/** Coil handling of the multiblocks that are not in MACHINE_MODIFIERS (none should be, but keep the old rule). */
const COIL_LOGIC: Record<string, Modifier> = {
  'gtceu:electric_blast_furnace': 'EBF_OVERCLOCK',
  'gtceu:alloy_blast_smelter': 'EBF_OVERCLOCK',
  'gtceu:large_chemical_reactor': 'CHEMICAL_REACTOR_OVERCLOCK',
  'gtceu:cracker': 'CRACKER_OVERCLOCK',
  'gtceu:pyrolyse_oven': 'PYROLYSE_OVEN_OVERCLOCK',
};

const OC_LOGIC = { OC_NON_PERFECT: 'NON_PERFECT', OC_PERFECT: 'PERFECT', OC_NON_PERFECT_SUBTICK: 'NON_PERFECT_SUBTICK' } as const;
const COIL_MODIFIERS = new Set<Modifier>(['EBF_OVERCLOCK', 'CHEMICAL_REACTOR_OVERCLOCK', 'CRACKER_OVERCLOCK', 'PYROLYSE_OVEN_OVERCLOCK']);
/** modifiers that apply nothing in the planner without being wrong */
const NEUTRAL = new Set<Modifier>(['PRIMITIVE']);

/** The modifier chain a multiblock applies; unknown multiblocks get the GT default. */
export function machineModifiers(machineId: string | undefined): { modifiers: Modifier[]; known: boolean } {
  const listed = machineId === undefined ? undefined : MACHINE_MODIFIERS[machineId];
  if (listed) return { modifiers: listed, known: true };
  const coil = machineId === undefined ? undefined : COIL_LOGIC[machineId];
  return { modifiers: [coil ?? 'OC_NON_PERFECT_SUBTICK'], known: coil !== undefined };
}

/** What the config panel can offer for a machine. */
export function machineFeatures(machineId: string | undefined) {
  const { modifiers } = machineModifiers(machineId);
  return {
    parallel: modifiers.includes('PARALLEL_HATCH'),
    coil: modifiers.some((m) => COIL_MODIFIERS.has(m)),
    bulking: modifiers.includes('BULKING'),
  };
}

/** Machines that can run a recipe: single blocks of its tier or above, and the type's multiblocks. */
export function machineOptions(data: GameData, recipe: Recipe): number[] {
  const recipeTier = tierByVoltage(recipe.eut);
  return (data.machinesByType[recipe.type] ?? []).filter((m) => {
    const machine = data.machines[m]!;
    return !machine.generator && (machine.multiblock || recipe.eut === 0 || machine.tier >= recipeTier);
  });
}

/** Lowest coil that runs the recipe on this machine (blast furnaces need the recipe's heat). */
export function defaultCoil(recipe: Recipe, modifiers: Modifier[], tier: number): string | undefined {
  if (!modifiers.includes('EBF_OVERCLOCK')) return modifiers.some((m) => COIL_MODIFIERS.has(m)) ? 'cupronickel' : undefined;
  const temp = Number(recipe.extra.data?.ebf_temp ?? 0);
  return Object.keys(COILS).find((c) => furnaceTemperature(c, tier) >= temp);
}

/** The default machine at the plan's tier (see the file comment). */
export function defaultMachine(data: GameData, recipe: Recipe, maxTier: number): MachineConfig {
  const typeId = data.recipeTypes[recipe.type]!;
  const machines = data.machinesByType[recipe.type] ?? [];
  const recipeTier = tierByVoltage(recipe.eut);
  if (recipe.eut === 0) return machines[0] === undefined ? {} : { machine: data.machines[machines[0]]!.id };
  const single = machines
    .filter((m) => !data.machines[m]!.multiblock && data.machines[m]!.tier <= maxTier && data.machines[m]!.tier >= recipeTier)
    .at(-1);
  if (single !== undefined) return { machine: data.machines[single]!.id };
  const multi = machines.find((m) => data.machines[m]!.id === typeId) ?? machines.find((m) => data.machines[m]!.multiblock) ?? machines[0];
  return { ...(multi === undefined ? {} : { machine: data.machines[multi]!.id }), hatch: { tier: maxTier, amps: 2, count: 1 } };
}

type Run = Omit<EffectiveRecipe, 'recipe' | 'configError' | 'configured' | 'maxTier' | 'inputs' | 'outputs' | 'durationTicks' | 'eut' | 'parallels' | 'ocLevel' | 'chanceTier'> & {
  state: RecipeState;
};

/** Runs the recipe on one concrete config; throws with a reason when the machine cannot run it. */
function run(data: GameData, recipe: Recipe, config: MachineConfig, maxTier: number): Run {
  const machine = config.machine === undefined ? undefined : data.machineIndex(config.machine);
  if (config.machine !== undefined && machine === undefined) throw new Error('unknown_machine');
  const info = machine === undefined ? undefined : data.machines[machine]!;
  if (info && !info.types.includes(recipe.type)) throw new Error('wrong_machine');
  let state: RecipeState = baseRecipe(recipe.eut, recipe.durationTicks, recipe.extra.data?.duration_is_total_cwu === true);

  if (recipe.eut === 0) {
    // primitive and steam-free recipes: no energy, no overclock
    return { machine, machineTier: info?.tier ?? 0, multiblock: info?.multiblock === true, approximate: false, state };
  }

  if (!info?.multiblock) {
    const machineTier = info?.tier ?? maxTier;
    if (tierByVoltage(recipe.eut) > machineTier) throw new Error('insufficient_voltage');
    state = electricOverclock(state, singleblockPower(machineTier), 'NON_PERFECT');
    return { machine, machineTier, multiblock: false, approximate: false, state };
  }

  const hatch = config.hatch ?? { tier: maxTier, amps: 2, count: 1 };
  const power: MachinePower = multiblockPower(Array.from({ length: Math.max(1, hatch.count) }, () => [V[hatch.tier]!, hatch.amps]));
  if (recipeEutTier(state) > power.tier) throw new Error('insufficient_voltage');
  const { modifiers, known } = machineModifiers(info.id);
  let approximate = !known;
  const coil = config.coil ?? defaultCoil(recipe, modifiers, power.tier);
  const parallel = modifiers.includes('PARALLEL_HATCH') ? config.parallel ?? 0 : undefined;
  const bulk = modifiers.includes('BULKING') ? config.bulking : undefined;

  for (const m of modifiers) {
    switch (m) {
      case 'PARALLEL_HATCH':
        state = hatchParallel(state, power, parallel ?? 0);
        break;
      case 'OC_NON_PERFECT':
      case 'OC_PERFECT':
      case 'OC_NON_PERFECT_SUBTICK':
        state = electricOverclock(state, power, OC_LOGIC[m]);
        break;
      case 'EBF_OVERCLOCK':
        if (!coil) throw new Error('coil_temperature_too_low');
        state = ebfOverclock(state, power, coil, Number(recipe.extra.data?.ebf_temp ?? 0));
        break;
      case 'CHEMICAL_REACTOR_OVERCLOCK':
        state = chemicalReactorOverclock(state, power, coil ?? 'cupronickel');
        break;
      case 'CRACKER_OVERCLOCK':
        state = crackerOverclock(state, power, coil ?? 'cupronickel');
        break;
      case 'PYROLYSE_OVEN_OVERCLOCK':
        state = pyrolyseOverclock(state, power, coil ?? 'cupronickel');
        break;
      case 'THROUGHPUT_BOOSTING':
        state = throughputBoosting(state);
        break;
      case 'BULKING':
        if (bulk) state = bulking(state, bulk);
        break;
      default:
        if (!NEUTRAL.has(m)) approximate = true;
    }
  }
  return {
    machine, machineTier: hatch.tier, multiblock: true, hatch, parallel, bulking: bulk,
    coil: modifiers.some((m) => COIL_MODIFIERS.has(m)) ? coil : undefined, approximate, state,
  };
}

const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * The recipe on the user's config if there is one, else on the default machine; undefined if nothing can run it.
 * A config that cannot run the recipe falls back to the default and says why in configError.
 */
export function effectiveRecipe(data: GameData, recipe: Recipe, maxTier: number, config?: MachineConfig): EffectiveRecipe | undefined {
  let result: Run | undefined;
  let configError: string | undefined;
  if (config) {
    try {
      result = run(data, recipe, config, maxTier);
    } catch (e) {
      configError = reason(e);
    }
  }
  if (!result) {
    if (tierByVoltage(recipe.eut) > maxTier && recipe.eut > 0) return undefined;
    try {
      result = run(data, recipe, defaultMachine(data, recipe, maxTier), maxTier);
    } catch {
      return undefined;
    }
  }
  const { state, ...machine } = result;
  const amount = (s: Stack) => (s.chance < 1 ? s.amount * chancedOutputFactor(state, s.chance, s.boostPerTier) : s.amount * state.contentMultiplier);
  return {
    recipe, ...machine, configError, configured: config !== undefined && configError === undefined, maxTier,
    durationTicks: state.duration,
    eut: recipeEut(state),
    parallels: state.parallels,
    ocLevel: state.ocLevel,
    chanceTier: chanceTier(state),
    inputs: recipe.inputs.map((s) => ({ good: s.good, amount: amount(s) })),
    outputs: recipe.outputs.map((s) => ({ good: s.good, amount: amount(s) })),
  };
}
