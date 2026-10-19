/**
 * "Exact line": whole machines that all work 100% of the time, so nothing backs up and nothing starves.
 *
 * In a built line every machine of a recipe runs at most at the speed its setup gives (runs per second per
 * machine). Every item made and used inside the line must balance exactly (anything left over backs up), and
 * every machine must work at least `busy` of its time (else it starves). Durations are whole ticks and chances
 * are fractions, so a perfectly full line rarely exists; `busy` = 0.99 lets a machine wait one tick in a hundred.
 * That is a small integer program: per recipe, pick one setup (voltage tier, coil) and a whole number of
 * machines. The line may make more than the targets (extra product leaves the line), and it may only take from
 * the factory and leave as byproducts what the planned line already does.
 *
 * Priorities, as in Optimize: least from the factory, then fewest byproducts, then fewest machines, then power.
 */
import type { GameData } from '@starfoundry/data';
import { configOptions, effectiveRecipe, type EffectiveRecipe, type MachineConfig } from './effective.js';
import { buildProblem, IMPORT_KINDS, rawWeight, type Plan, type PlanRequest } from './plan.js';

/** Solves an LP/MIP in CPLEX LP format (HiGHS); returns column values by name. */
export type SolveMip = (lp: string, options: { timeLimit: number }) => Promise<{ status: string; columns: Record<string, number> }>;

export interface ExactRecipe {
  recipe: string;
  setup: EffectiveRecipe;
  /** the config to apply (undefined: the recipe's default machine) */
  config?: MachineConfig | undefined;
  machines: number;
  /** runs per second of all its machines */
  rate: number;
  /** share of the time the machines work */
  busy: number;
}

export interface ExactLine {
  recipes: ExactRecipe[];
  /** good -> per second the line makes of each target (at least the asked rate) */
  targets: Map<number, number>;
  imports: Map<number, number>;
  byproducts: Map<number, number>;
  machines: number;
  eut: number;
  /** the solver proved this is the best such line (false: the best found in the time limit) */
  optimal: boolean;
  /** the targets' rates over the asked ones (at least 1) */
  scale: number;
}

export interface ExactResult {
  /** undefined: no such line within MAX_MACHINES machines per recipe and the time limit */
  line?: ExactLine;
  /** the recipe that needs the biggest line: scale is how many times the targets must grow for it alone */
  limiting?: { recipe: string; scale: number } | undefined;
}

/** most machines per recipe the search considers */
const MAX_MACHINES = 256;
const EPS = 1e-9;

/**
 * The best exact line for the plan's recipes, or undefined when none exists within MAX_MACHINES per recipe.
 * `plan` is the line as solved (its recipes, imports and byproducts); `configs` are the setups it was solved with.
 */
export async function exactLine(
  data: GameData,
  request: PlanRequest,
  plan: Plan,
  configs: Record<string, MachineConfig>,
  solve: SolveMip,
  /** least share of the time every machine must work (1: exactly full time) */
  busy = 0.99,
  timeLimit = 20,
): Promise<ExactResult> {
  const free = new Set(request.settings.raw.filter((g) => !(request.settings.supplied ?? []).includes(g)));
  const nodes = plan.nodes.filter((n) => n.rate > EPS);
  if (!nodes.length) return {};

  // setups per recipe: the one it runs on and every other the plan's tier allows
  type Option = { e: EffectiveRecipe; config?: MachineConfig | undefined };
  const options: Option[][] = nodes.map((node) => {
    const tierCap = Math.max(request.settings.maxTier, node.recipe.tier);
    const list: Option[] = [{ e: node.config, config: configs[node.recipe.id] }];
    for (const config of configOptions(data, node.recipe, tierCap, node.config)) {
      const e = effectiveRecipe(data, node.recipe, tierCap, config);
      if (!e || e.configError || e.durationTicks <= 0) continue;
      // two setups at the same speed with the same flows: keep the one drawing less
      const same = list.findIndex((o) => o.e.durationTicks === e.durationTicks && sameFlows(o.e, e));
      if (same >= 0) {
        if (e.eut < list[same]!.e.eut && same > 0) list[same] = { e, config };
        continue;
      }
      list.push({ e, config });
    }
    return list;
  });

  // the recipe that needs the line scaled up most: even one machine on its slowest setup works too fast
  let limiting: ExactResult['limiting'];
  nodes.forEach((node, i) => {
    const slowest = Math.min(...options[i]!.map(({ e }) => (20 / e.durationTicks) * outputPerRun(e)));
    const scale = (busy * slowest) / (node.rate * outputPerRun(node.config));
    if (!limiting || scale > limiting.scale) limiting = { recipe: node.recipe.id, scale };
  });

  // tag conversions the solved line uses (a tag input fed by one of its members)
  const problem = buildProblem(data, { ...request, settings: { ...request.settings, configs } });
  const conversions = problem.recipes.filter((r) => r.id.startsWith('tag:'));

  const flows = new Map<number, string[]>(); // good -> terms of its balance row
  const add = (good: number, term: string) => (flows.get(good) ?? flows.set(good, []).get(good)!).push(term);
  const objective: string[] = [];
  const bounds: string[] = [];
  const generals: string[] = [];
  const binaries: string[] = [];
  const rows: string[] = [];
  // weights for the priorities (inputs per item, byproducts per item, machines, EU/t)
  const W_IN = 1e6;
  const W_BY = 1e3;
  const W_MACHINE = 1;
  const W_EU = 1e-6;

  options.forEach((list, i) => {
    const pick: string[] = [];
    list.forEach(({ e }, k) => {
      const n = `n${i}_${k}`;
      const y = `y${i}_${k}`;
      const r = `r${i}_${k}`;
      const perMachine = 20 / e.durationTicks; // runs per second of one machine
      // the machines run between `busy` and all of their time: r in [busy, 1] · n · perMachine
      rows.push(` hi${i}_${k}: ${r} ${signed(-perMachine)} ${n} <= 0`);
      rows.push(` lo${i}_${k}: ${r} ${signed(-perMachine * busy)} ${n} >= 0`);
      for (const s of e.inputs) add(s.good, `${signed(-s.amount)} ${r}`);
      for (const s of e.outputs) add(s.good, `${signed(s.amount)} ${r}`);
      objective.push(`${signed(W_MACHINE + W_EU * e.eut)} ${n}`);
      rows.push(` u${i}_${k}: ${n} - ${MAX_MACHINES} ${y} <= 0`);
      bounds.push(` 0 <= ${n} <= ${MAX_MACHINES}`);
      generals.push(n);
      binaries.push(y);
      pick.push(`+ ${y}`);
    });
    rows.push(` one${i}: ${pick.join(' ')} <= 1`);
  });
  conversions.forEach((r, c) => {
    for (const [g, a] of Object.entries(r.inputs)) add(Number(g), `${signed(-a)} c${c}`);
    for (const [g, a] of Object.entries(r.outputs)) add(Number(g), `${signed(a)} c${c}`);
  });

  const imports = new Set<number>();
  for (const kind of IMPORT_KINDS) for (const g of plan.imports[kind].keys()) imports.add(g);
  for (const g of free) if (flows.has(g)) imports.add(g);
  const goods = [...flows.keys()];
  goods.forEach((g) => {
    const terms = flows.get(g)!;
    if (imports.has(g)) {
      terms.push(`+ i${g}`);
      if (!free.has(g)) objective.push(`${signed(W_IN * rawWeight(data, g))} i${g}`);
    }
    const target = request.targets[g] ?? 0;
    if (g in request.targets) {
      // extra product leaves the line; a little cost keeps it near the asked rate
      terms.push(`- e${g}`);
      objective.push(`${signed(rawWeight(data, g))} e${g}`);
    } else if (plan.byproducts.has(g)) {
      terms.push(`- e${g}`);
      objective.push(`${signed(W_BY * rawWeight(data, g))} e${g}`);
    } else if (free.has(g)) {
      terms.push(`- e${g}`); // water and lava may go back where they came from
    }
    rows.push(` b${g}: ${terms.join(' ')} = ${target}`);
  });

  const lp = [
    'Minimize',
    ` obj: ${objective.join(' ')}`,
    'Subject To',
    ...rows,
    'Bounds',
    ...bounds,
    'General',
    ` ${generals.join(' ')}`,
    'Binary',
    ` ${binaries.join(' ')}`,
    'End',
  ].join('\n');

  const result = await solve(lp, { timeLimit });
  if (!['Optimal', 'Time limit reached'].includes(result.status)) return { limiting };
  const value = (name: string) => result.columns[name] ?? 0;
  const recipes: ExactRecipe[] = [];
  options.forEach((list, i) => {
    list.forEach(({ e, config }, k) => {
      const machines = Math.round(value(`n${i}_${k}`));
      const rate = value(`r${i}_${k}`);
      if (machines > 0) recipes.push({ recipe: nodes[i]!.recipe.id, setup: e, config, machines, rate, busy: (rate * e.durationTicks) / 20 / machines });
    });
  });
  if (!recipes.length) return { limiting };

  const net = new Map<number, number>();
  for (const r of recipes) {
    for (const s of r.setup.inputs) net.set(s.good, (net.get(s.good) ?? 0) - s.amount * r.rate);
    for (const s of r.setup.outputs) net.set(s.good, (net.get(s.good) ?? 0) + s.amount * r.rate);
  }
  const line: ExactLine = {
    recipes,
    targets: new Map(),
    imports: new Map(),
    byproducts: new Map(),
    machines: recipes.reduce((s, r) => s + r.machines, 0),
    eut: recipes.reduce((s, r) => s + r.machines * r.setup.eut, 0),
    optimal: result.status === 'Optimal',
    scale: 1,
  };
  for (const [g, x] of net) {
    if (g in request.targets) line.targets.set(g, x);
    else if (x < -1e-9 && !free.has(g)) line.imports.set(g, -x);
    else if (x > 1e-6 && !free.has(g)) line.byproducts.set(g, x);
  }
  line.scale = Math.min(...[...line.targets].map(([g, x]) => x / request.targets[g]!));
  return { line, limiting };
}

/** Main output per run, to compare setups whose runs differ (parallels). */
const outputPerRun = (e: EffectiveRecipe) => e.outputs.find((o) => o.amount > 0)?.amount ?? 1;

function sameFlows(a: EffectiveRecipe, b: EffectiveRecipe) {
  const flat = (e: EffectiveRecipe) => [...e.inputs, ...e.outputs].map((s) => `${s.good}:${s.amount.toPrecision(9)}`).join(',');
  return flat(a) === flat(b);
}

function signed(a: number): string {
  return a < 0 ? `- ${-a}` : `+ ${a}`;
}
