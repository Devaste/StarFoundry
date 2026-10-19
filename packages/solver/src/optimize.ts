/**
 * "Optimize" for a built line: keeps what the line makes and looks for
 * 1. machine setups (voltage tier, coil) that take less from the factory, leave fewer byproducts, need fewer
 *    whole machines and then less power, in that order of importance;
 * 2. the output rates at which every machine runs full time (the line's perfect ratio);
 * 3. other recipes for the items the line makes, with how each would change the line.
 *
 * The setups are found one recipe at a time (coordinate descent) until nothing improves. A setup that keeps a
 * recipe's flows in proportion (anything but a chance boost) is scored without solving the line again.
 */
import type { GameData } from '@starfoundry/data';
import { configOptions, effectiveRecipe, type EffectiveRecipe, type MachineConfig } from './effective.js';
import type { ProductionProblem, ProductionSolution } from './index.js';
import { allowedRecipe, buildProblem, IMPORT_KINDS, reachableGoods, readPlan, type Plan, type PlanRequest } from './plan.js';

export type Solve = (problem: ProductionProblem) => Promise<ProductionSolution>;

export interface PlanScore {
  /** items (buckets for fluids) per second the line takes from outside, water and lava aside */
  inputs: number;
  /** items (buckets) per second of byproducts */
  byproducts: number;
  /** the same split for showing: items per second and mB per second */
  inputItems: number;
  inputFluid: number;
  byproductItems: number;
  byproductFluid: number;
  /** machines to build: each recipe's count rounded up */
  machines: number;
  /** machines as computed (fractional) */
  exactMachines: number;
  eut: number;
}

export interface SetupChange {
  recipe: string;
  from: EffectiveRecipe;
  to: EffectiveRecipe;
  config: MachineConfig;
}

export interface RateOption {
  /** factor on every target rate */
  scale: number;
  /** share of the built machines' time spent working */
  utilization: number;
  machines: number;
}

export interface WholeBatch {
  /** the good the batch is counted in (the line's main input from the factory, else its first target) */
  good: number;
  amount: number;
  /** recipe id -> runs in the batch */
  runs: { recipe: string; runs: number }[];
}

export interface Alternative {
  /** the item the recipe makes */
  good: number;
  recipe: string;
  score: PlanScore;
}

export interface Optimization {
  before: PlanScore;
  after: PlanScore;
  /** setups that changed, to apply as the plan's configs */
  changes: SetupChange[];
  configs: Record<string, MachineConfig>;
  /** where every machine runs full time, nearest to the current rate first; scale 1 is the current rate */
  rates: RateOption[];
  /** the smallest batch in which every recipe handling items runs a whole number of times, if there is one */
  batch?: WholeBatch | undefined;
  /** recipes that would make the line better by the same measure, best first */
  alternatives: Alternative[];
}

const EPS = 1e-9;
/** machine counts this close above a whole number are rounding noise */
const WHOLE = 1e-6;

const ceilMachines = (m: number) => (m <= WHOLE ? 0 : Math.ceil(m - WHOLE));

export function scorePlan(data: GameData, plan: Plan, free: ReadonlySet<number>): PlanScore {
  let inputItems = 0;
  let inputFluid = 0;
  for (const kind of IMPORT_KINDS) {
    for (const [good, rate] of plan.imports[kind]) {
      if (free.has(good)) continue;
      if (data.isFluid(good)) inputFluid += rate;
      else inputItems += rate;
    }
  }
  let byproductItems = 0;
  let byproductFluid = 0;
  for (const [good, rate] of plan.byproducts) {
    if (data.isFluid(good)) byproductFluid += rate;
    else byproductItems += rate;
  }
  // a bucket weighs like an item, as in rawWeight
  const inputs = inputItems + inputFluid / 1000;
  const byproducts = byproductItems + byproductFluid / 1000;
  let machines = 0;
  let exactMachines = 0;
  let eut = 0;
  for (const n of plan.nodes) {
    if (n.rate <= EPS) continue;
    machines += ceilMachines(n.machines);
    exactMachines += n.machines;
    eut += n.eut;
  }
  return { inputs, byproducts, inputItems, inputFluid, byproductItems, byproductFluid, machines, exactMachines, eut };
}

const ORDER: (keyof PlanScore)[] = ['inputs', 'byproducts', 'machines', 'eut'];

/** a scores better than b: lower on the first measure where they differ (beyond rounding) */
export function betterScore(a: PlanScore, b: PlanScore): boolean {
  for (const k of ORDER) {
    const tol = 1e-6 * Math.max(1, Math.abs(a[k]), Math.abs(b[k]));
    if (a[k] < b[k] - tol) return true;
    if (a[k] > b[k] + tol) return false;
  }
  return false;
}

/** Per-run flows divided by the first output: equal shapes mean the line's flows do not change. */
function shape(e: EffectiveRecipe): number[] | undefined {
  const ref = e.outputs.find((o) => o.amount > 0)?.amount;
  if (!ref) return undefined;
  return [...e.inputs, ...e.outputs].map((s) => s.amount / ref);
}

function sameShape(a: EffectiveRecipe, b: EffectiveRecipe) {
  const x = shape(a);
  const y = shape(b);
  return !!x && !!y && x.length === y.length && x.every((v, i) => Math.abs(v - y[i]!) <= 1e-9 * Math.max(1, Math.abs(v)));
}

const sameSetup = (a: EffectiveRecipe, b: EffectiveRecipe) =>
  a.machine === b.machine && a.machineTier === b.machineTier && a.coil === b.coil && a.parallel === b.parallel && a.bulking === b.bulking;

export async function optimizePlan(data: GameData, request: PlanRequest, solve: Solve, onProgress?: (done: number, total: number) => void): Promise<Optimization> {
  const free = new Set(request.settings.raw.filter((g) => !(request.settings.supplied ?? []).includes(g)));
  const run = async (configs: Record<string, MachineConfig>, locks = request.settings.locks) => {
    const req: PlanRequest = { ...request, settings: { ...request.settings, configs, ...(locks ? { locks } : {}) } };
    const problem = buildProblem(data, req);
    const plan = readPlan(data, req, problem, await solve(problem));
    return { plan, score: scorePlan(data, plan, free) };
  };

  const start = await run({ ...request.settings.configs });
  if (start.plan.status !== 'Optimal') throw new Error(start.plan.status);
  let configs = { ...request.settings.configs };
  let best = start;

  // 1. setups, one recipe at a time, until a pass changes nothing
  for (let pass = 0; pass < 3; pass++) {
    let improved = false;
    const ids = best.plan.nodes.filter((n) => n.rate > EPS).map((n) => n.recipe.id);
    for (const [k, id] of ids.entries()) {
      onProgress?.(pass * ids.length + k, ids.length * 3);
      const index = best.plan.nodes.findIndex((n) => n.recipe.id === id);
      const node = best.plan.nodes[index];
      if (!node) continue;
      const tierCap = Math.max(request.settings.maxTier, node.recipe.tier);
      for (const option of configOptions(data, node.recipe, tierCap, node.config)) {
        const e = effectiveRecipe(data, node.recipe, tierCap, option);
        if (!e || e.configError || sameSetup(e, node.config)) continue;
        const trial = { ...configs, [id]: option };
        let candidate: typeof best;
        if (sameShape(e, node.config)) {
          // same flows: only this recipe's machine count and power change
          const ref = (x: EffectiveRecipe) => x.outputs.find((o) => o.amount > 0)!.amount;
          const rate = (node.rate * ref(node.config)) / ref(e);
          const machines = (rate * e.durationTicks) / 20;
          const nodes = best.plan.nodes.slice();
          nodes[index] = { ...node, config: e, rate, machines, eut: machines * e.eut };
          const plan = { ...best.plan, nodes, totalEut: best.plan.totalEut - node.eut + machines * e.eut };
          candidate = { plan, score: scorePlan(data, plan, free) };
        } else {
          candidate = await run(trial);
          if (candidate.plan.status !== 'Optimal') continue;
        }
        if (betterScore(candidate.score, best.score)) {
          best = candidate;
          configs = trial;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }
  // re-solve with the chosen setups so the result is exactly what the planner will show
  best = await run(configs);

  const changes: SetupChange[] = [];
  for (const node of best.plan.nodes) {
    const was = start.plan.nodes.find((n) => n.recipe.id === node.recipe.id);
    const config = configs[node.recipe.id];
    if (was && config && !sameSetup(was.config, node.config)) changes.push({ recipe: node.recipe.id, from: was.config, to: node.config, config });
  }
  // keep only the setups that changed (and the user's own, untouched)
  const applied = { ...request.settings.configs };
  for (const c of changes) applied[c.recipe] = c.config;

  // 2. perfect ratio: machine counts scale with the targets
  const rates = perfectRates(best.plan.nodes.filter((n) => n.rate > EPS).map((n) => n.machines));
  const batch = wholeBatch(data, best.plan, request, free);

  // 3. other recipes for what the line makes
  const alternatives: Alternative[] = [];
  const locks = request.settings.locks ?? {};
  // only recipes whose inputs the world can provide at this tier (no ore blocks in a skyblock)
  const reachable = reachableGoods(data, { ...request.settings, manual: false, locks: {} });
  for (const [goodKey, recipeId] of Object.entries(locks)) {
    const good = Number(goodKey);
    if (!best.plan.nodes.some((n) => n.recipe.id === recipeId && n.rate > EPS)) continue;
    const others = data.producers[good]!
      .map((r) => data.recipes[r]!)
      .filter((r) => r.id !== recipeId && allowedRecipe(r, request.settings) && !undoesConversion(data, r, good) && r.inputs.every((i) => reachable.has(i.good)))
      .slice(0, 40);
    for (const r of others) {
      const trialConfigs = { ...applied };
      delete trialConfigs[recipeId];
      try {
        const trial = await run(trialConfigs, { ...locks, [good]: r.id });
        if (trial.plan.status === 'Optimal' && betterScore(trial.score, best.score) && noWorseOnMaterials(trial.score, best.score)) alternatives.push({ good, recipe: r.id, score: trial.score });
      } catch {
        // a recipe the solver cannot balance is no alternative
      }
    }
  }
  alternatives.sort((a, b) => (betterScore(a.score, b.score) ? -1 : betterScore(b.score, a.score) ? 1 : 0));
  onProgress?.(1, 1);
  return { before: start.score, after: best.score, changes, configs: applied, rates, batch, alternatives };
}

/** Takes no more from the factory and leaves no more byproducts (1% slack): no trading one for the other. */
const noWorseOnMaterials = (a: PlanScore, b: PlanScore) =>
  a.inputs <= b.inputs * 1.01 + 1e-9 && a.byproducts <= b.byproducts * 1.01 + 1e-9;

/**
 * The recipe takes something the item itself is turned into (a block of the dust, the molten metal of the ingot):
 * it only undoes a packing or melting step, so it is no real way to make the item.
 */
function undoesConversion(data: GameData, recipe: { inputs: { good: number }[] }, good: number): boolean {
  const madeFromGood = new Set(data.consumers[good]!.flatMap((r) => data.recipes[r]!.outputs.map((o) => o.good)));
  return recipe.inputs.some((s) => madeFromGood.has(s.good));
}

/**
 * Scales of the target rates at which the built machines work all the time (or nearly), between 1/8 and 8
 * times the current rate. Each is better than every option closer to the current rate; the current rate first.
 */
export function perfectRates(machines: number[]): RateOption[] {
  const at = (scale: number): RateOption => {
    const exact = machines.reduce((s, m) => s + m * scale, 0);
    const built = machines.reduce((s, m) => s + ceilMachines(m * scale), 0);
    return { scale, utilization: built ? exact / built : 1, machines: built };
  };
  if (!machines.length) return [];
  const scales = new Set<number>([1]);
  for (const m of machines) {
    if (m <= EPS) continue;
    for (let k = Math.max(1, Math.floor(m / 8)); k <= Math.ceil(m * 8) && k <= 4096; k++) {
      const s = k / m;
      if (s >= 1 / 8 && s <= 8) scales.add(s);
    }
  }
  const options = [...scales].map(at).sort((a, b) => Math.abs(Math.log(a.scale)) - Math.abs(Math.log(b.scale)));
  const result: RateOption[] = [options[0]!];
  let best = options[0]!.utilization;
  for (const o of options.slice(1)) {
    if (o.utilization > best + 1e-6) {
      result.push(o);
      best = o.utilization;
    }
    if (best >= 1 - 1e-6) break;
  }
  return result;
}

/** batches are searched up to this many units of the reference good */
const MAX_BATCH = 100000;

/**
 * The smallest amount of the line's main input (or of its first target) for which every recipe that takes or
 * makes items runs a whole number of times: with 90 ores a 1-in-7 step leaves 8.57 runs; the batch says to feed
 * 315. Fluids come in millibuckets, so recipes handling only fluids are left out.
 */
export function wholeBatch(data: GameData, plan: Plan, request: PlanRequest, free: ReadonlySet<number>): WholeBatch | undefined {
  let good: number | undefined;
  let rate = 0;
  for (const kind of IMPORT_KINDS) {
    for (const [g, r] of plan.imports[kind]) {
      if (!free.has(g) && !data.isFluid(g) && r > rate) {
        good = g;
        rate = r;
      }
    }
  }
  if (good === undefined) {
    const first = Object.entries(request.targets)[0];
    if (!first) return undefined;
    good = Number(first[0]);
    rate = first[1];
  }
  const items = plan.nodes.filter((n) => n.rate > EPS && [...n.recipe.inputs, ...n.recipe.outputs].some((st) => !data.isFluid(st.good)));
  const perUnit = items.map((n) => n.rate / rate);
  // targets come back from the URL rounded to 6 digits, so whole is within 1e-4
  const whole = (x: number) => Math.abs(x - Math.round(x)) <= 1e-4 * Math.max(1, x);
  for (let amount = 1; amount <= MAX_BATCH; amount++) {
    if (perUnit.every((q) => whole(q * amount))) {
      return { good, amount, runs: items.map((n, i) => ({ recipe: n.recipe.id, runs: Math.round(perUnit[i]! * amount) })) };
    }
  }
  return undefined;
}
