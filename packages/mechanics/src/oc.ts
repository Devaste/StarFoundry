/**
 * Overclocking, parallels and chance boost as Star Technology Theta 2 HF4 runs them
 * (GTM-StarT-Fork 1.7.1c, StarT-Core 1.8.1b). One-to-one port of startech_mechanics.py;
 * every function names the Java it mirrors. The pure OC functions are checked against the
 * shipped jar's output (test/java_oc_reference.txt.gz).
 *
 * eut is the recipe's total EU/t (voltage × amperage), durations are integer ticks.
 */
import { V } from './index.js';

export const ULV = 0;
export const LV = 1;
export const MV = 2;
export const MAX = 14;
const INT_MAX = 2 ** 31 - 1;
/** GTValues.VEX: V extended to tier 30, then Long.MAX_VALUE */
const VEX = (tier: number) => (tier >= 31 ? Number.MAX_VALUE : 8 * 4 ** tier);

/** Python int.bit_length for non-negative integers */
const bitLength = (x: number) => (x <= 0 ? 0 : Math.trunc(x).toString(2).length);

/** GTUtil.getOCTierByVoltage: smallest tier T with V[T] >= voltage. */
export function ocTierByVoltage(voltage: number): number {
  if (voltage <= V[ULV]!) return ULV;
  return (bitLength(voltage - 1) - 2) >> 1;
}

/** GTUtil.getTierByVoltage: like the OC tier, capped at MAX above int range. */
export function tierByVoltage(voltage: number): number {
  return voltage > INT_MAX ? MAX : ocTierByVoltage(voltage);
}

/** GTUtil.getFloorTierByVoltage: highest tier T with V[T] <= voltage. */
export function floorTierByVoltage(voltage: number): number {
  if (voltage < V[LV]!) return ULV;
  return (bitLength(voltage) - 4) >> 1;
}

export interface OCResult {
  eutMultiplier: number;
  durationMultiplier: number;
  ocLevel: number;
  baseOcLevel: number;
  parallels: number;
}

/** OverclockingLogic.standardOC (:137-159) */
export function standardOC(
  eut: number, duration: number, ocAmount: number, baseOcAmount: number, _maxParallels: number,
  maxVoltage: number, durationFactor: number, voltageFactor: number,
): OCResult {
  let d = duration;
  let e = eut;
  let lvl = 0;
  while (ocAmount-- > 0) {
    const pe = e * voltageFactor;
    if (pe > maxVoltage) break;
    const pd = d * durationFactor;
    if (pd < 1) break;
    d = pd;
    e = pe;
    lvl++;
  }
  return { eutMultiplier: voltageFactor ** lvl, durationMultiplier: durationFactor ** lvl, ocLevel: lvl, baseOcLevel: Math.min(lvl, baseOcAmount), parallels: 1 };
}

/** OverclockingLogic.subTickParallelOC (:230-265) */
export function subTickParallelOC(
  eut: number, duration: number, ocAmount: number, baseOcAmount: number, maxParallels: number,
  maxVoltage: number, durationFactor: number, voltageFactor: number,
): OCResult {
  let d = duration;
  let e = eut;
  let parallel = 1;
  let shouldParallel = false;
  let lvl = 0;
  let dmul = 1;
  while (ocAmount-- > 0) {
    const pe = e * voltageFactor;
    if (pe > maxVoltage) break;
    if (shouldParallel || d * durationFactor < 1) {
      const pp = parallel / durationFactor;
      if (pp > maxParallels) break;
      parallel = pp;
      shouldParallel = true;
    } else {
      d *= durationFactor;
      dmul *= durationFactor;
    }
    e = pe;
    lvl++;
  }
  return { eutMultiplier: voltageFactor ** lvl, durationMultiplier: dmul, ocLevel: lvl, baseOcLevel: Math.min(lvl, baseOcAmount), parallels: Math.trunc(parallel) };
}

export const COIL_EUT_DISCOUNT_TEMPERATURE = 900;

/** OverclockingLogic.heatingCoilOC (:289-330): one perfect OC per 1800 K of surplus first. */
export function heatingCoilOC(
  eut: number, duration: number, ocAmount: number, baseOcAmount: number, maxParallels: number,
  maxVoltage: number, recipeTemp: number, machineTemp: number,
): OCResult {
  let perfectLeft = Math.floor(Math.max(0, Math.floor((machineTemp - recipeTemp) / COIL_EUT_DISCOUNT_TEMPERATURE)) / 2);
  let d = duration;
  let e = eut;
  let parallel = 1;
  let shouldParallel = false;
  let lvl = 0;
  let dmul = 1;
  while (ocAmount-- > 0) {
    const perfect = perfectLeft-- > 0;
    const pe = e * 4;
    if (pe > maxVoltage) break;
    const df = perfect ? 0.25 : 0.5;
    if (shouldParallel || d * df < 1) {
      const pp = parallel * (perfect ? 4 : 2);
      if (pp > maxParallels) break;
      parallel = pp;
      shouldParallel = true;
    } else {
      d *= df;
      dmul *= df;
    }
    e = pe;
    lvl++;
  }
  return { eutMultiplier: 4 ** lvl, durationMultiplier: dmul, ocLevel: lvl, baseOcLevel: Math.min(lvl, baseOcAmount), parallels: Math.trunc(parallel) };
}

/** OverclockingLogic.getCoilEUtDiscount (:350-355) */
export function coilEutDiscount(recipeTemp: number, machineTemp: number): number {
  if (recipeTemp < COIL_EUT_DISCOUNT_TEMPERATURE) return 1;
  const n = Math.max(0, Math.floor((machineTemp - recipeTemp) / COIL_EUT_DISCOUNT_TEMPERATURE));
  return n < 1 ? 1 : Math.min(1, 0.95 ** n);
}

export type OCLogic = 'NON_PERFECT' | 'PERFECT' | 'NON_PERFECT_SUBTICK' | 'PERFECT_SUBTICK' | 'FUSION';

const LOGICS: Record<OCLogic, { fn: typeof standardOC; durationFactor: number; voltageFactor: number; subtick: boolean }> = {
  NON_PERFECT: { fn: standardOC, durationFactor: 0.5, voltageFactor: 4, subtick: false },
  PERFECT: { fn: standardOC, durationFactor: 0.25, voltageFactor: 4, subtick: false },
  NON_PERFECT_SUBTICK: { fn: subTickParallelOC, durationFactor: 0.5, voltageFactor: 4, subtick: true },
  PERFECT_SUBTICK: { fn: subTickParallelOC, durationFactor: 0.25, voltageFactor: 4, subtick: true },
  FUSION: { fn: standardOC, durationFactor: 0.5, voltageFactor: 2, subtick: false },
};

// ---------------------------------------------------------------- energy input

export interface MachinePower {
  /** machine tier: recipes above it are rejected */
  tier: number;
  /** caps the OCs that count for chance boost */
  maxOverclockTier: number;
  overclockVoltage: number;
}

/** WorkableTieredMachine (:196-217): amperage never adds OCs; ocTier is the GUI-selected OC tier. */
export function singleblockPower(machineTier: number, ocTier = machineTier): MachinePower {
  return { tier: machineTier, maxOverclockTier: machineTier, overclockVoltage: Math.min(V[ocTier]!, V[machineTier]!) };
}

const hasPrimeFactorGt2 = (n: number) => {
  while (n % 2 === 0 && n > 1) n /= 2;
  return n > 1;
};
const isPowerOfFour = (n: number) => n > 0 && (n & (n - 1)) === 0 && (bitLength(n) - 1) % 2 === 0;

/** EnergyContainerList ctor + calculateVoltageAmperage (:36-101); hatches are [voltage, amperage]. */
export function combineHatches(hatches: [number, number][]): [number, number] {
  let voltage = hatches.reduce((s, [v, a]) => s + v * a, 0);
  let amperage = hatches.reduce((s, [, a]) => s + a, 0);
  if (voltage > 1 && amperage > 1) {
    if (hasPrimeFactorGt2(amperage) || isPowerOfFour(amperage)) amperage = 1;
    else if (amperage % 4 === 0) {
      while (amperage > 4) amperage = Math.floor(amperage / 4);
      voltage = Math.floor(voltage / amperage);
    } else if (amperage === 2) voltage = Math.floor(voltage / amperage);
    else amperage = 1;
  }
  return [voltage, amperage];
}

/** WorkableElectricMultiblockMachine tier (:74-78, :258-285) and overclock voltage (:215-238). */
export function multiblockPower(hatches: [number, number][]): MachinePower {
  const highest = Math.max(...hatches.map(([v]) => v));
  const nHighest = hatches.filter(([v]) => v === highest).length;
  const maxVoltage = nHighest > 1 ? V[Math.min(tierByVoltage(highest) + 1, MAX)]! : highest;
  const tier = floorTierByVoltage(maxVoltage);
  const [cv, ca] = combineHatches(hatches);
  return { tier, maxOverclockTier: tier, overclockVoltage: ca === 1 ? VEX(floorTierByVoltage(cv)) : cv };
}

// ---------------------------------------------------------------- recipe state

export interface RecipeState {
  /** EU/t per amp */
  voltage: number;
  amperage: number;
  duration: number;
  parallels: number;
  hatchParallels: number;
  ocLevel: number;
  baseOcLevel: number;
  /** multiplier on non-chanced, non-EU contents */
  contentMultiplier: number;
  /** chanced outputs are rolled this many times (= parallels) */
  chanceRolls: number;
  durationIsTotalCwu?: boolean;
}

export const baseRecipe = (eut: number, duration: number, durationIsTotalCwu = false): RecipeState => ({
  voltage: eut, amperage: 1, duration, parallels: 1, hatchParallels: 1, ocLevel: 0, baseOcLevel: 0,
  contentMultiplier: 1, chanceRolls: 1, durationIsTotalCwu,
});

export const recipeEut = (r: RecipeState) => r.voltage * r.amperage;

interface ApplyOptions {
  contentMul?: number;
  eutMul?: number;
  durationMul?: number;
  durationAdd?: number;
  parallels?: number;
  hatch?: boolean;
  addOcs?: number;
  addBaseOcs?: number;
}

/** ModifierFunction.FunctionBuilder.build (:194-228): truncates duration and voltage like Java casts. */
export function apply(r: RecipeState, o: ApplyOptions): RecipeState {
  const parallels = o.parallels ?? 1;
  if (parallels === 0) throw new Error('ModifierFunction.NULL');
  const next: RecipeState = { ...r };
  next.parallels = r.parallels * parallels;
  next.chanceRolls = next.parallels;
  next.contentMultiplier = r.contentMultiplier * (o.contentMul ?? 1);
  if (o.hatch) next.hatchParallels = r.hatchParallels * parallels;
  next.ocLevel = r.ocLevel + (o.addOcs ?? 0);
  next.baseOcLevel = r.baseOcLevel + (o.addBaseOcs ?? 0);
  next.duration = r.durationIsTotalCwu
    ? Math.trunc(Math.max(1, r.duration * (1 - 0.025 * (o.addOcs ?? 0))))
    : Math.max(1, Math.trunc(r.duration * (o.durationMul ?? 1) + (o.durationAdd ?? 0)));
  if ((o.eutMul ?? 1) !== 1) next.voltage = Math.trunc(r.voltage * o.eutMul!);
  return next;
}

/** RecipeHelper.getRecipeEUtTier (:55-61) */
export function recipeEutTier(r: RecipeState): number {
  let v = r.voltage;
  if (r.hatchParallels > 1) v = Math.floor(v / r.hatchParallels);
  return tierByVoltage(v);
}

/** RecipeHelper.getPreOCRecipeEuTier (:63-70) */
export function preOcRecipeTier(r: RecipeState): number {
  let e = recipeEut(r);
  if (r.hatchParallels > 1) e = Math.floor(e / r.hatchParallels);
  e = Math.floor(e / 4 ** r.ocLevel);
  return tierByVoltage(e);
}

/** RecipeHelper.getChanceTier (:76-82); the pack sets chanceUseRecipeOC: true, so base OCs count. */
export function chanceTier(r: RecipeState, chanceUseRecipeOc = true): number {
  const rt = preOcRecipeTier(r);
  const oc = chanceUseRecipeOc ? r.baseOcLevel : r.ocLevel;
  return rt === ULV && oc > 0 ? LV + oc : rt + oc;
}

export interface OCOptions {
  maxVoltage?: number;
  shouldParallel?: boolean;
  /** parallel cap from inputs/outputs (infinite supply by default) */
  inputParallelLimit?: number;
  /** [recipeTemp, machineTemp] to run heatingCoilOC instead of the logic */
  heating?: [number, number];
}

/** OverclockingLogic.getModifier (:72-115) + OCResult.toModifier (:361-370) */
export function ocModifier(r: RecipeState, machine: MachinePower, logic: OCLogic = 'NON_PERFECT_SUBTICK', o: OCOptions = {}): RecipeState {
  const eut = recipeEut(r);
  if (eut === 0) return r;
  const maxV = o.maxVoltage ?? machine.overclockVoltage;
  const recipeTier = tierByVoltage(eut);
  let ocs = ocTierByVoltage(maxV) - recipeTier;
  let baseOcs = machine.maxOverclockTier - recipeTier;
  if (recipeTier === ULV) {
    ocs--;
    baseOcs--;
  }
  if (ocs === 0) return r;
  const l = LOGICS[logic];
  const subtick = o.heating ? true : l.subtick;
  let maxPar = 1;
  if ((o.shouldParallel ?? true) && subtick) {
    const lg = Math.floor((bitLength(r.duration) - 1) / 2);
    maxPar = lg > ocs ? 16 : Math.min(Math.min(2 ** (2 * (ocs - lg)) + 1, INT_MAX), o.inputParallelLimit ?? INT_MAX);
  }
  const res = o.heating
    ? heatingCoilOC(eut, r.duration, ocs, baseOcs, maxPar, maxV, o.heating[0], o.heating[1])
    : l.fn(eut, r.duration, ocs, baseOcs, maxPar, maxV, l.durationFactor, l.voltageFactor);
  return apply(r, {
    contentMul: res.parallels, eutMul: res.eutMultiplier, durationMul: res.durationMultiplier,
    parallels: res.parallels, addOcs: res.ocLevel, addBaseOcs: res.baseOcLevel,
  });
}

/** GTRecipeModifiers.ELECTRIC_OVERCLOCK (:50-58): rejects recipes above the machine's tier. */
export function electricOverclock(r: RecipeState, machine: MachinePower, logic: OCLogic, o: OCOptions = {}): RecipeState {
  if (recipeEutTier(r) > machine.maxOverclockTier) throw new Error('insufficient_voltage');
  return ocModifier(r, machine, logic, o);
}

// ---------------------------------------------------------------- parallels and throughput

/** GTRecipeModifiers.hatchParallel (:124-170); absolute hatch path from StarT-Core. */
export function hatchParallel(r: RecipeState, machine: MachinePower, setting: number, inputParallelLimit = INT_MAX, absolute = false): RecipeState {
  if (setting <= 1) return r;
  if (absolute) {
    const p = Math.min(setting, inputParallelLimit);
    if (p <= 0) throw new Error('NULL');
    return apply(r, { contentMul: p, parallels: p, hatch: true });
  }
  const eut = recipeEut(r);
  const energyLimit = eut ? Math.floor(machine.overclockVoltage / eut) : setting;
  const p = Math.min(setting, inputParallelLimit, energyLimit);
  if (p <= 1) return r;
  const recipeTier = ocTierByVoltage(eut);
  const parTier = Math.min(ocTierByVoltage(eut * p), machine.maxOverclockTier);
  const base = parTier - recipeTier - (recipeTier === ULV ? 1 : 0);
  return apply(r, { contentMul: p, eutMul: p, parallels: p, hatch: true, addBaseOcs: base });
}

/** GTRecipeModifiers.batchMode (:172-190): same throughput, fewer recipe checks. */
export function batchMode(r: RecipeState, batchDuration = 100, inputParallelLimit = INT_MAX): RecipeState {
  if (r.duration >= batchDuration) return r;
  const p = Math.min(Math.floor(batchDuration / r.duration), inputParallelLimit);
  return p <= 1 ? r : apply(r, { contentMul: p, durationMul: p, parallels: p });
}

/** StarTRecipeModifiers.throughputBoosting (:118-138) */
export function throughputBoosting(r: RecipeState, inputParallelLimit = INT_MAX): RecipeState {
  return inputParallelLimit < 4 ? r : apply(r, { contentMul: 4, durationMul: 1.6, eutMul: 0.95, parallels: 4 });
}

// ---------------------------------------------------------------- coil machines

/** coil name -> [temperature, level, energyDiscount, tier] (CoilBlock.java + kubejs coils.js) */
export const COILS: Record<string, [number, number, number, number]> = {
  cupronickel: [1800, 1, 1, 0], kanthal: [2700, 2, 1, 1], nichrome: [3600, 2, 2, 2],
  rtm_alloy: [4500, 4, 2, 3], hssg: [5400, 4, 4, 4], naquadah: [7200, 8, 4, 5],
  trinium: [9001, 8, 8, 6], tritanium: [10800, 16, 8, 7],
  zalloy: [13499, 24, 12, 8], magmada_alloy: [16199, 32, 16, 9], abyssal_alloy: [18888, 40, 20, 10],
};

/** EBF heat: coil temperature + 100 K per tier above MV. */
export const furnaceTemperature = (coil: string, machineTier: number) => COILS[coil]![0] + 100 * Math.max(0, machineTier - MV);

/** GTRecipeModifiers.ebfOverclock (:237-261) */
export function ebfOverclock(r: RecipeState, machine: MachinePower, coil: string, recipeTemp: number, o: OCOptions = {}): RecipeState {
  const furnaceTemp = furnaceTemperature(coil, machine.tier);
  if (recipeTemp > furnaceTemp) throw new Error('coil_temperature_too_low');
  if (recipeEutTier(r) > machine.tier) throw new Error('insufficient_voltage');
  const discounted = apply(r, { eutMul: coilEutDiscount(recipeTemp, furnaceTemp) });
  return ocModifier(discounted, machine, 'NON_PERFECT_SUBTICK', { ...o, heating: [recipeTemp, furnaceTemp] });
}

/** GTRecipeModifiers.crackerOverclock (:203-220) */
export function crackerOverclock(r: RecipeState, machine: MachinePower, coil: string, o: OCOptions = {}): RecipeState {
  const next = ocModifier(r, machine, 'NON_PERFECT_SUBTICK', o);
  const t = COILS[coil]![3];
  if (t <= 0) return next;
  const disc = t > 9 ? 0.9 + (t - 9) * 0.025 : t * 0.1;
  return apply(next, { eutMul: Math.max(0.0001, 1 - disc) });
}

/** GTRecipeModifiers.pyrolyseOvenOverclock (:275-290) */
export function pyrolyseOverclock(r: RecipeState, machine: MachinePower, coil: string, o: OCOptions = {}): RecipeState {
  const t = COILS[coil]![3];
  const next = ocModifier(r, machine, 'NON_PERFECT_SUBTICK', o);
  return apply(next, { durationMul: t === 0 ? 4 / 3 : 2 / (t + 1) });
}

/** GTRecipeModifiers.chemicalReactorOverclock (:346-364) */
export function chemicalReactorOverclock(r: RecipeState, machine: MachinePower, coil: string, o: OCOptions = {}): RecipeState {
  const t = COILS[coil]![3];
  let next = apply(r, { durationMul: 1 / (0.75 + t * 0.25) });
  next = ocModifier(next, machine, 'NON_PERFECT_SUBTICK', o);
  return apply(next, { eutMul: 1 - t * 0.05 });
}

// ---------------------------------------------------------------- chances

export const MAX_CHANCE = 10_000;

/** ChanceBoostFunction.OVERCLOCK; chance and boost in maxChance units. */
export function boostedChance(chance: number, tierBoost: number, recipeTier: number, chanceTierValue: number, maxChance = MAX_CHANCE): number {
  let diff = chanceTierValue - recipeTier;
  if (diff <= 0) return chance;
  if (recipeTier === ULV) diff--;
  return Math.max(0, Math.min(maxChance, chance + tierBoost * diff));
}

/**
 * Expected amount of one chanced output per completed (modified) run, OR logic: rolled `parallels`
 * times, and the per-machine chance cache makes the long-run average exactly boosted / max.
 * chance and boost are fractions of one here.
 */
export function chancedOutputFactor(r: RecipeState, chance: number, boostPerTier: number): number {
  const p = boostedChance(chance * MAX_CHANCE, boostPerTier * MAX_CHANCE, preOcRecipeTier(r), chanceTier(r)) / MAX_CHANCE;
  return r.chanceRolls * p;
}
