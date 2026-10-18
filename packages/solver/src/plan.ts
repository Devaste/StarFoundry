/**
 * Production plan from targets (SPEC §5.1, fixed config): candidate recipes reachable from the targets,
 * the balance LP over them, and the solved line with machine counts and power.
 *
 * Until the mechanics port lands, every recipe runs at its own tier with no overclock or parallels:
 * one machine does one operation per `durationTicks`, drawing the recipe's EU/t.
 */
import { GoodKind, type GameData, type Recipe } from '@starfoundry/data';
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
  return r.tier <= settings.maxTier && r.eut >= 0 && r.outputs.length > 0;
}

/** Expected output per operation at the recipe's own tier (no boost yet). */
const expected = (amount: number, chance: number) => amount * Math.min(1, chance);

/** Recipes reachable backwards from the targets through allowed producers. */
export function candidateRecipes(data: GameData, request: PlanRequest): Recipe[] {
  const seen = new Set<number>(request.settings.raw);
  const picked = new Set<number>();
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
    for (const r of data.producers[good]!) {
      const recipe = data.recipes[r]!;
      if (picked.has(r) || !allowedRecipe(recipe, request.settings)) continue;
      picked.add(r);
      for (const s of recipe.inputs) queue.push(s.good);
    }
  }
  return [...picked].map((r) => data.recipes[r]!);
}

/** Why a good may be imported: marked raw, nothing allowed makes it, or as a costly last resort. */
export type ImportKind = 'raw' | 'source' | 'producible';

export interface PlanProblem extends ProductionProblem {
  importKind: Record<string, ImportKind>;
}

export function buildProblem(data: GameData, request: PlanRequest): PlanProblem {
  const { settings } = request;
  const euWeight = settings.euWeight ?? 1e-4;
  const machineWeight = settings.machineWeight ?? 0.01;
  const rawSet = new Set(settings.raw);
  const sourcePenalty = settings.sourcePenalty ?? 10;
  const penalty = settings.importPenalty ?? 1000;
  const key = (good: number) => String(good);
  const recipes: LpRecipe[] = [];
  const goods = new Set<number>(Object.keys(request.targets).map(Number));

  for (const r of candidateRecipes(data, request)) {
    const inputs: Record<string, number> = {};
    const outputs: Record<string, number> = {};
    for (const s of r.inputs) {
      inputs[key(s.good)] = (inputs[key(s.good)] ?? 0) + expected(s.amount, s.chance);
      goods.add(s.good);
    }
    for (const s of r.outputs) {
      outputs[key(s.good)] = (outputs[key(s.good)] ?? 0) + expected(s.amount, s.chance);
      goods.add(s.good);
    }
    // cost per operation: its share of the line's EU/t and machine count
    const seconds = r.durationTicks / 20;
    recipes.push({ id: r.id, inputs, outputs, cost: seconds * (r.eut * euWeight + machineWeight) });
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
      : data.producers[good]!.some((r) => allowedRecipe(data.recipes[r]!, settings)) ? 'producible' : 'source';
    importKind[key(good)] = kind;
    raw[key(good)] = rawWeight(data, good) * (kind === 'raw' ? 1 : kind === 'source' ? sourcePenalty : penalty);
  }

  const targets: Record<string, number> = {};
  for (const [good, rate] of Object.entries(request.targets)) targets[good] = rate;
  return { recipes, targets, raw, importKind };
}

export interface PlanNode {
  recipe: Recipe;
  /** operations per second */
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
    const recipe = data.recipe(id)!;
    const inputs = new Map<number, number>();
    const outputs = new Map<number, number>();
    for (const s of recipe.inputs) {
      const amount = expected(s.amount, s.chance) * rate;
      const flows = tagFlow.get(s.good);
      if (flows) {
        const total = flows.reduce((sum, f) => sum + f.rate, 0);
        for (const f of flows) inputs.set(f.member, (inputs.get(f.member) ?? 0) + (amount * f.rate) / total);
      } else inputs.set(s.good, (inputs.get(s.good) ?? 0) + amount);
    }
    for (const s of recipe.outputs) outputs.set(s.good, (outputs.get(s.good) ?? 0) + expected(s.amount, s.chance) * rate);
    const machines = (rate * recipe.durationTicks) / 20;
    const node: PlanNode = { recipe, rate, machines, eut: machines * recipe.eut, inputs, outputs };
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
