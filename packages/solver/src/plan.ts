/**
 * Production plan from targets (SPEC §5.1, fixed config): candidate recipes reachable from the targets,
 * the balance LP over them, and the solved line with machine counts and power.
 *
 * Each recipe runs on its default machine at the plan's max tier with the pack's overclock (effective.ts):
 * one machine does one run per overclocked duration, drawing the overclocked EU/t.
 */
import { GoodKind, type GameData, type Recipe } from '@starfoundry/data';
import { effectiveRecipe, type EffectiveRecipe } from './effective.js';
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
  /** cost multiplier for importing an item that some allowed recipe could make (keeps the LP feasible) */
  importPenalty?: number;
  /** goods bought as raw resources: imported at their raw weight, never produced */
  raw: number[];
  /** goods the user supplies from outside the line: imported at no cost (implies raw) */
  supplied?: number[];
  /** good -> the only recipe allowed to produce it (picked by the user; may be above maxTier) */
  locks?: Record<number, string>;
  /** recipe ids the user forbade */
  bans?: string[];
}

export interface PlanRequest {
  /** good index -> required output per second */
  targets: Record<number, number>;
  settings: PlanSettings;
}

/** Per-unit weight of a raw input: 1 per item, 1 per bucket (1000 mB) of fluid. */
export const rawWeight = (data: GameData, good: number) => (data.isFluid(good) ? 0.001 : 1);

const TAG_PREFIX = 'tag:';

const RAW_FLUIDS = new Set([
  'minecraft:water', 'minecraft:lava', 'gtceu:air', 'gtceu:nether_air', 'gtceu:ender_air', 'gtceu:oil', 'gtceu:oil_light',
  'gtceu:oil_medium', 'gtceu:oil_heavy', 'gtceu:natural_gas', 'gtceu:salt_water',
]);
const ORE = /:(?!crushed_|purified_|refined_|impure_|pure_|raw_)[a-z0-9_]+_ore$/;
const RAW_ORE = /:raw_[a-z0-9_]+$/;
const NOT_RAW_ORE = /_(dust|block|rubber)$|rubber/;

/** Default raw resources: ore blocks, raw ores and fluids pumped or collected from the world. */
export function defaultRaw(data: GameData): number[] {
  const raw: number[] = [];
  data.goodIds.forEach((id, good) => {
    const kind = data.goodKinds[good];
    if (kind === GoodKind.Fluid ? RAW_FLUIDS.has(id) : kind === GoodKind.Item && (ORE.test(id) || (RAW_ORE.test(id) && !NOT_RAW_ORE.test(id)))) {
      raw.push(good);
    }
  });
  return raw;
}

export function allowedRecipe(r: Recipe, settings: PlanSettings): boolean {
  return r.tier <= settings.maxTier && r.eut >= 0 && r.outputs.length > 0 && !settings.bans?.includes(r.id);
}

/** Producers the plan may use for a good: the locked recipe if there is one, else every allowed producer. */
export function producersFor(data: GameData, good: number, settings: PlanSettings): Recipe[] {
  const locked = settings.locks?.[good];
  const lockedRecipe = locked === undefined ? undefined : data.recipe(locked);
  if (lockedRecipe) return [lockedRecipe];
  return data.producers[good]!.map((r) => data.recipes[r]!).filter((r) => allowedRecipe(r, settings));
}

/** Recipes reachable backwards from the targets through allowed producers, as their default machine runs them. */
export function candidateRecipes(data: GameData, request: PlanRequest): EffectiveRecipe[] {
  const seen = new Set<number>([...request.settings.raw, ...(request.settings.supplied ?? [])]);
  const picked = new Map<number, EffectiveRecipe>();
  const queue = Object.keys(request.targets).map(Number);
  while (queue.length) {
    const good = queue.pop()!;
    if (seen.has(good)) continue;
    seen.add(good);
    const members = data.tags.get(good);
    if (members) {
      queue.push(...members);
      continue;
    }
    for (const recipe of producersFor(data, good, request.settings)) {
      if (picked.has(recipe.index)) continue;
      // a locked recipe above the plan's tier runs on a machine of its own tier
      const effective = effectiveRecipe(data, recipe, Math.max(request.settings.maxTier, recipe.tier));
      if (!effective) continue;
      picked.set(recipe.index, effective);
      for (const s of recipe.inputs) queue.push(s.good);
    }
  }
  return [...picked.values()];
}

/** Why a good may be imported: marked raw, nothing allowed makes it, or as a costly last resort. */
export type ImportKind = 'raw' | 'source' | 'producible';

export interface PlanProblem extends ProductionProblem {
  importKind: Record<string, ImportKind>;
  /** recipe id -> machine config and per-run flows behind its LP column (not needed by the solver itself) */
  effective: Map<string, EffectiveRecipe>;
}

export function buildProblem(data: GameData, request: PlanRequest): PlanProblem {
  const { settings } = request;
  const euWeight = settings.euWeight ?? 1e-4;
  const machineWeight = settings.machineWeight ?? 0.01;
  const supplied = new Set(settings.supplied);
  const rawSet = new Set([...settings.raw, ...supplied]);
  const sourcePenalty = settings.sourcePenalty ?? 10;
  const penalty = settings.importPenalty ?? 1000;
  const key = (good: number) => String(good);
  const recipes: LpRecipe[] = [];
  const goods = new Set<number>(Object.keys(request.targets).map(Number));
  const effective = new Map<string, EffectiveRecipe>();

  for (const e of candidateRecipes(data, request)) {
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
    // cost per run: its share of the line's EU/t and machine count
    const seconds = e.durationTicks / 20;
    recipes.push({ id: e.recipe.id, inputs, outputs, cost: seconds * (e.eut * euWeight + machineWeight) });
  }

  // Tags: any member can stand in for the tag, one for one.
  for (const good of [...goods]) {
    for (const m of data.tags.get(good) ?? []) {
      recipes.push({ id: `${TAG_PREFIX}${good}:${m}`, inputs: { [key(m)]: 1 }, outputs: { [key(good)]: 1 }, cost: 0 });
      goods.add(m);
    }
  }

  const raw: Record<string, number> = {};
  const importKind: Record<string, ImportKind> = {};
  for (const good of goods) {
    if (data.goodKinds[good] === GoodKind.Tag) continue;
    const kind: ImportKind = rawSet.has(good)
      ? 'raw'
      : producersFor(data, good, settings).length ? 'producible' : 'source';
    importKind[key(good)] = kind;
    raw[key(good)] = supplied.has(good) ? 0 : rawWeight(data, good) * (kind === 'raw' ? 1 : kind === 'source' ? sourcePenalty : penalty);
  }

  const targets: Record<string, number> = {};
  for (const [good, rate] of Object.entries(request.targets)) targets[good] = rate;
  return { recipes, targets, raw, importKind, effective };
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
  byproducts: Map<number, number>;
  totalEut: number;
  /** good -> per second produced inside the line, by node */
  producersOf: Map<number, { node: number; amount: number }[]>;
}

export function readPlan(data: GameData, request: PlanRequest, problem: PlanProblem, solution: ProductionSolution): Plan {
  const plan: Plan = {
    status: solution.status, nodes: [], imports: { raw: new Map(), source: new Map(), producible: new Map() }, byproducts: new Map(), totalEut: 0, producersOf: new Map(),
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
