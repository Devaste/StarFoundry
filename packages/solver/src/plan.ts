/**
 * Production plan from targets (SPEC §5.1, fixed config): candidate recipes reachable from the targets,
 * the balance LP over them, and the solved line with machine counts and power.
 *
 * Each recipe runs on the machine the user set up for it, else its default machine at the plan's max tier (effective.ts):
 * one machine does one run per overclocked duration, drawing the overclocked EU/t.
 */
import { GoodKind, type GameData, type Recipe } from '@starfoundry/data';
import { effectiveRecipe, type EffectiveRecipe, type MachineConfig } from './effective.js';
import type { LpRecipe, ProductionProblem, ProductionSolution } from './index.js';

export interface PlanSettings {
  /** highest voltage tier allowed for recipes */
  maxTier: number;
  /** cost of 1 EU/t of power, in raw-item units per second (tie breaker between routes) */
  euWeight?: number;
  /** cost of one machine running full time, in raw-item units per second */
  machineWeight?: number;
  /** cost multiplier for an input no allowed recipe makes and that is not marked raw */
  sourcePenalty?: number;
  /**
   * cost multiplier for importing an item that some allowed recipe could make (keeps the LP feasible). Deep chains
   * (sieve to naquadah) cost thousands of raw units per item, so it must be far above any real chain.
   */
  importPenalty?: number;
  /** goods bought as raw resources: imported at their raw weight, never produced */
  raw: number[];
  /** goods the user supplies from outside the line: imported at no cost (implies raw) */
  supplied?: number[];
  /** good -> the only recipe allowed to produce it (picked by the user; may be above maxTier) */
  locks?: Record<number, string>;
  /** recipe ids the user forbade */
  bans?: string[];
  /** recipe id -> the machine the user set up for it */
  configs?: Record<string, MachineConfig>;
  /**
   * Recipe mode: the user builds the chain by hand. Only goods with a picked recipe (locks) are made, on the
   * picked recipe at any tier; every other input is an input of the chain.
   */
  manual?: boolean;
}

export interface PlanRequest {
  /** good index -> required output per second */
  targets: Record<number, number>;
  settings: PlanSettings;
}

/** Per-unit weight of a raw input: 1 per item, 1 per bucket (1000 mB) of fluid. */
export const rawWeight = (data: GameData, good: number) => (data.isFluid(good) ? 0.001 : 1);

const TAG_PREFIX = 'tag:';

/**
 * Star Technology is a skyblock: ores come from sieves (gravel <- cobblestone <- rock breaker), not from the
 * world, so only fluids taken from an infinite world source start as raw. Everything else must be made.
 */
const RAW_FLUIDS = new Set(['minecraft:water', 'minecraft:lava']);

/** Default raw resources: water and lava. */
export function defaultRaw(data: GameData): number[] {
  const raw: number[] = [];
  data.goodIds.forEach((id, good) => {
    if (data.goodKinds[good] === GoodKind.Fluid && RAW_FLUIDS.has(id)) raw.push(good);
  });
  return raw;
}

export function allowedRecipe(r: Recipe, settings: PlanSettings): boolean {
  return r.tier <= settings.maxTier && r.eut >= 0 && r.outputs.length > 0 && !settings.bans?.includes(r.id);
}

/**
 * Goods the line can actually get: raw and supplied goods, then everything an allowed (or locked) recipe makes
 * once all its consumed inputs are available, repeated until nothing new appears. A recipe that needs a good
 * outside this set (higher-tier tech, an item no recipe makes) can never run, so the plan never uses it.
 */
export function reachableGoods(data: GameData, settings: PlanSettings): Set<number> {
  const available = new Set<number>([...settings.raw, ...(settings.supplied ?? [])]);
  const locked = new Set(Object.values(settings.locks ?? {}));
  // a recipe its machine cannot run at the plan's tier (say, no coil reaches its heat) makes nothing
  const usable = (r: Recipe) =>
    locked.has(r.id) ? effectiveRecipe(data, r, Math.max(settings.maxTier, r.tier), settings.configs?.[r.id]) !== undefined
      : allowedRecipe(r, settings) && effectiveRecipe(data, r, settings.maxTier, settings.configs?.[r.id]) !== undefined;
  // consumed inputs per recipe still missing; a tag counts once and is met by any member
  // (data.consumers of a good also lists recipes that take a tag it is in, so count only the recipe's own inputs)
  const missing: (Set<number> | undefined)[] = new Array(data.recipes.length);
  const queue: number[] = [];
  const fire = (r: Recipe) => {
    for (const s of r.outputs) if (!available.has(s.good)) {
      available.add(s.good);
      queue.push(s.good);
    }
  };
  for (const r of data.recipes) {
    if (usable(r)) missing[r.index] = new Set(r.inputs.map((s) => s.good));
  }
  for (const g of available) queue.push(g);
  for (const r of data.recipes) if (missing[r.index]?.size === 0) fire(r);
  const met = new Set<number>();
  const meet = (good: number) => {
    if (met.has(good)) return;
    met.add(good);
    for (const ri of data.consumers[good] ?? []) {
      const need = missing[ri];
      if (need?.delete(good) && need.size === 0) fire(data.recipes[ri]!);
    }
  };
  while (queue.length) {
    const good = queue.pop()!;
    meet(good);
    for (const tag of data.memberOf[good] ?? []) {
      available.add(tag);
      meet(tag);
    }
  }
  return available;
}

/** Producers the plan may use for a good: the locked recipe if there is one, else every allowed producer. */
export function producersFor(data: GameData, good: number, settings: PlanSettings, reachable?: Set<number>): Recipe[] {
  const locked = settings.locks?.[good];
  const lockedRecipe = locked === undefined ? undefined : data.recipe(locked);
  if (lockedRecipe) return [lockedRecipe];
  return data.producers[good]!
    .map((r) => data.recipes[r]!)
    .filter((r) => allowedRecipe(r, settings) && (!reachable || r.inputs.every((s) => reachable.has(s.good))));
}

export interface Candidates {
  recipes: EffectiveRecipe[];
  /** recipe mode: inputs the user did not expand, taken as inputs of the chain */
  leaves: Set<number>;
  /** goods the line can get (undefined in recipe mode, where nothing is pruned) */
  reachable: Set<number> | undefined;
  /** targets nothing reachable can make */
  unreachable: number[];
}

/**
 * Recipes reachable backwards from the targets through producers that can actually run (see reachableGoods),
 * as their machine runs them. In recipe mode only goods with a picked recipe are expanded.
 */
export function candidateRecipes(data: GameData, request: PlanRequest): Candidates {
  const { settings } = request;
  // in recipe mode the user picks every recipe, so nothing is pruned for being out of reach
  const reachable = settings.manual ? undefined : reachableGoods(data, settings);
  const seen = new Set<number>([...settings.raw, ...(settings.supplied ?? [])]);
  const picked = new Map<number, EffectiveRecipe>();
  const leaves = new Set<number>();
  const targets = Object.keys(request.targets).map(Number);
  const unreachable = reachable ? targets.filter((g) => !reachable.has(g)) : [];
  const queue = [...targets];
  for (let head = 0; head < queue.length; head++) {
    const good = queue[head]!;
    if (seen.has(good)) continue;
    seen.add(good);
    const members = data.tags.get(good);
    if (members) {
      // a tag is met by any of its members; the ones nothing reachable makes would only enter the plan as imports
      queue.push(...(reachable ? members.filter((m) => reachable.has(m)) : members));
      continue;
    }
    if (settings.manual && settings.locks?.[good] === undefined) {
      leaves.add(good);
      continue;
    }
    for (const recipe of producersFor(data, good, settings, reachable)) {
      if (picked.has(recipe.index)) continue;
      // a locked recipe above the plan's tier runs on a machine of its own tier
      const effective = effectiveRecipe(data, recipe, Math.max(settings.maxTier, recipe.tier), settings.configs?.[recipe.id]);
      if (!effective) continue;
      picked.set(recipe.index, effective);
      for (const s of recipe.inputs) queue.push(s.good);
    }
  }
  return { recipes: [...picked.values()], leaves, unreachable, reachable };
}

/**
 * Why a good may be imported: marked raw, an input at the edge of a recipe-mode chain, nothing reachable makes it,
 * or as a costly last resort.
 */
export type ImportKind = 'raw' | 'leaf' | 'source' | 'producible';

export const IMPORT_KINDS: readonly ImportKind[] = ['raw', 'leaf', 'source', 'producible'];

export interface PlanProblem extends ProductionProblem {
  importKind: Record<string, ImportKind>;
  /** recipe id -> machine config and per-run flows behind its LP column (not needed by the solver itself) */
  effective: Map<string, EffectiveRecipe>;
  /** targets nothing reachable can make (imported as a last resort) */
  unreachable: number[];
}

export function buildProblem(data: GameData, request: PlanRequest): PlanProblem {
  const { settings } = request;
  const euWeight = settings.euWeight ?? 1e-4;
  const machineWeight = settings.machineWeight ?? 0.01;
  const supplied = new Set(settings.supplied);
  const rawSet = new Set([...settings.raw, ...supplied]);
  const sourcePenalty = settings.sourcePenalty ?? 10;
  const penalty = settings.importPenalty ?? 1e6;
  const key = (good: number) => String(good);
  const recipes: LpRecipe[] = [];
  const goods = new Set<number>(Object.keys(request.targets).map(Number));
  const effective = new Map<string, EffectiveRecipe>();

  const candidates = candidateRecipes(data, request);
  const made = new Set<number>();
  for (const e of candidates.recipes) {
    for (const o of e.outputs) made.add(o.good);
    effective.set(e.recipe.id, e);
    const inputs: Record<string, number> = {};
    const outputs: Record<string, number> = {};
    for (const s of e.inputs) {
      inputs[key(s.good)] = (inputs[key(s.good)] ?? 0) + s.amount;
      goods.add(s.good);
    }
    for (const s of e.outputs) {
      outputs[key(s.good)] = (outputs[key(s.good)] ?? 0) + s.amount;
      goods.add(s.good);
    }
    // cost per run: its share of the line's EU/t and machine count. A machine the user set up is priced like
    // the default one (per unit of output), so setting up a machine changes how a recipe runs, not which one is picked.
    const priced = e.configured ? effectiveRecipe(data, e.recipe, e.maxTier) ?? e : e;
    const perRun = (x: EffectiveRecipe) => x.outputs.reduce((sum, o) => sum + o.amount, 0) || 1;
    const seconds = priced.durationTicks / 20;
    const cost = seconds * (priced.eut * euWeight + machineWeight) * (perRun(e) / perRun(priced));
    recipes.push({ id: e.recipe.id, inputs, outputs, cost });
  }

  // Tags: any member the line can get stands in for the tag, one for one (an unreachable member would only be bought).
  for (const good of [...goods]) {
    for (const m of data.tags.get(good) ?? []) {
      if (candidates.reachable && !candidates.reachable.has(m)) continue;
      recipes.push({ id: `${TAG_PREFIX}${good}:${m}`, inputs: { [key(m)]: 1 }, outputs: { [key(good)]: 1 }, cost: 0 });
      goods.add(m);
    }
  }

  const raw: Record<string, number> = {};
  const importKind: Record<string, ImportKind> = {};
  for (const good of goods) {
    if (data.goodKinds[good] === GoodKind.Tag) continue;
    const kind: ImportKind = rawSet.has(good) ? 'raw' : candidates.leaves.has(good) ? 'leaf' : made.has(good) ? 'producible' : 'source';
    importKind[key(good)] = kind;
    const weight = kind === 'raw' || kind === 'leaf' ? 1 : kind === 'source' ? sourcePenalty : penalty;
    raw[key(good)] = supplied.has(good) ? 0 : rawWeight(data, good) * weight;
  }

  const targets: Record<string, number> = {};
  for (const [good, rate] of Object.entries(request.targets)) targets[good] = rate;
  return { recipes, targets, raw, importKind, effective, unreachable: candidates.unreachable };
}

export interface PlanNode {
  recipe: Recipe;
  /** default machine, its overclock and the per-run flows */
  config: EffectiveRecipe;
  /** runs per second */
  rate: number;
  machines: number;
  /** EU/t drawn by all machines of this node */
  eut: number;
  /** good -> per second */
  inputs: Map<number, number>;
  outputs: Map<number, number>;
}

export interface Plan {
  status: string;
  nodes: PlanNode[];
  /** good -> per second entering the line, by why it may be imported */
  imports: Record<ImportKind, Map<number, number>>;
  /** targets nothing reachable can make at this tier from the raw resources */
  unreachable: number[];
  byproducts: Map<number, number>;
  totalEut: number;
  /** good -> per second produced inside the line, by node */
  producersOf: Map<number, { node: number; amount: number }[]>;
}

export function readPlan(data: GameData, request: PlanRequest, problem: PlanProblem, solution: ProductionSolution): Plan {
  const plan: Plan = {
    status: solution.status, nodes: [], imports: { raw: new Map(), leaf: new Map(), source: new Map(), producible: new Map() }, unreachable: problem.unreachable, byproducts: new Map(), totalEut: 0, producersOf: new Map(),
  };
  if (solution.status !== 'Optimal') return plan;

  // Tag conversions are folded away: their member flow is credited as if the recipe consumed the member.
  const tagFlow = new Map<number, { member: number; rate: number }[]>();
  for (const [id, rate] of Object.entries(solution.rates)) {
    if (!id.startsWith(TAG_PREFIX)) continue;
    const [tag, member] = id.slice(TAG_PREFIX.length).split(':').map(Number) as [number, number];
    (tagFlow.get(tag) ?? tagFlow.set(tag, []).get(tag)!).push({ member, rate });
  }

  for (const [id, rate] of Object.entries(solution.rates)) {
    if (id.startsWith(TAG_PREFIX)) continue;
    const config = problem.effective.get(id)!;
    const { recipe } = config;
    const inputs = new Map<number, number>();
    const outputs = new Map<number, number>();
    for (const s of config.inputs) {
      const amount = s.amount * rate;
      const flows = tagFlow.get(s.good);
      if (flows) {
        const total = flows.reduce((sum, f) => sum + f.rate, 0);
        for (const f of flows) inputs.set(f.member, (inputs.get(f.member) ?? 0) + (amount * f.rate) / total);
      } else inputs.set(s.good, (inputs.get(s.good) ?? 0) + amount);
    }
    for (const s of config.outputs) outputs.set(s.good, (outputs.get(s.good) ?? 0) + s.amount * rate);
    const machines = (rate * config.durationTicks) / 20;
    const node: PlanNode = { recipe, config, rate, machines, eut: machines * config.eut, inputs, outputs };
    plan.totalEut += node.eut;
    plan.nodes.push(node);
  }
  plan.nodes.sort((a, b) => b.eut - a.eut);
  plan.nodes.forEach((node, n) => {
    for (const [good, amount] of node.outputs) {
      (plan.producersOf.get(good) ?? plan.producersOf.set(good, []).get(good)!).push({ node: n, amount });
    }
  });

  for (const [good, amount] of Object.entries(solution.imports)) {
    plan.imports[problem.importKind[good]!].set(Number(good), amount);
  }
  for (const [good, amount] of Object.entries(solution.surplus)) {
    const g = Number(good);
    if (amount > 1e-9 && !(g in request.targets)) plan.byproducts.set(g, amount);
  }
  return plan;
}
