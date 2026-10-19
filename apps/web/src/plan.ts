import type { GameData } from '@starfoundry/data';
import { buildProblem, defaultRaw, readPlan, type MachineConfig, type Plan, type PlanRequest, type ProductionProblem, type ProductionSolution } from '@starfoundry/solver';
import { useEffect, useMemo, useRef, useState } from 'react';
import { goodKey, parseGoodKey } from './components/GoodLink';

export interface Target {
  good: number;
  /** per second */
  rate: number;
}

export interface PlanState {
  targets: Target[];
  maxTier: number;
  /** good -> recipe id the user picked for it */
  locks: Record<number, string>;
  /** recipe ids the user forbade */
  bans: string[];
  /** goods added to / removed from the default raw resources */
  rawAdd: number[];
  rawRemove: number[];
  /** recipe id -> the machine the user set up for it */
  configs: Record<string, MachineConfig>;
  /**
   * always on: only goods the user picked a recipe for are made, the rest come from the factory the line is built
   * into (the solver's full-chain mode is not offered: lines are built into an existing factory)
   */
  manual: true;
}

export const emptyPlan = (): PlanState => ({ targets: [], maxTier: DEFAULT_MAX_TIER, locks: {}, bans: [], rawAdd: [], rawRemove: [], configs: {}, manual: true });

export const DEFAULT_MAX_TIER = 5; // IV

const list = (items: string[]) => (items.length ? items.join('~') : undefined);
const split = (value: string | null) => (value ? value.split('~') : []);

/**
 * Plan <-> URL hash params, so a plan is a shareable link:
 * t=item:gtceu:x@0.5~fluid:gtceu:y@2, tier=5, lock=item:gtceu:x>recipe/id, ban=recipe/id, raw=+item:a~-fluid:b,
 * cfg=recipe/id>machine:id,hatchTier,amps,count,parallel,coil,bulking (empty fields use the default)
 */
export function encodePlan(data: GameData, plan: PlanState): Record<string, string | undefined> {
  return {
    t: list(plan.targets.map((t) => `${goodKey(data, t.good)}@${t.rate}`)),
    tier: plan.maxTier === DEFAULT_MAX_TIER ? undefined : String(plan.maxTier),
    lock: list(Object.entries(plan.locks).map(([good, recipe]) => `${goodKey(data, Number(good))}>${recipe}`)),
    ban: list(plan.bans),
    raw: list([...plan.rawAdd.map((g) => `+${goodKey(data, g)}`), ...plan.rawRemove.map((g) => `-${goodKey(data, g)}`)]),
    cfg: list(Object.entries(plan.configs).map(([recipe, c]) => `${recipe}>${encodeConfig(c)}`)),
  };
}

const encodeConfig = (c: MachineConfig) =>
  [c.machine, c.hatch?.tier, c.hatch?.amps, c.hatch?.count, c.parallel, c.coil, c.bulking].map((x) => x ?? '').join(',').replace(/,+$/, '');

function decodeConfig(value: string): MachineConfig {
  const [machine, tier, amps, count, parallel, coil, bulking] = value.split(',');
  const config: MachineConfig = {};
  const int = (x: string | undefined) => (x && Number.isInteger(Number(x)) ? Number(x) : undefined);
  if (machine) config.machine = machine;
  if (int(tier) !== undefined) config.hatch = { tier: int(tier)!, amps: int(amps) ?? 2, count: int(count) ?? 1 };
  if (int(parallel)) config.parallel = int(parallel)!;
  if (coil) config.coil = coil;
  if (bulking) config.bulking = bulking;
  return config;
}

export function decodePlan(data: GameData, params: URLSearchParams): PlanState {
  const targets: Target[] = [];
  for (const part of params.get('t')?.split('~') ?? []) {
    const at = part.lastIndexOf('@');
    const good = parseGoodKey(data, part.slice(0, at));
    const rate = Number(part.slice(at + 1));
    if (good !== undefined && rate > 0) targets.push({ good, rate });
  }
  const tier = Number(params.get('tier') ?? DEFAULT_MAX_TIER);
  const plan: PlanState = { ...emptyPlan(), targets, maxTier: Number.isInteger(tier) ? tier : DEFAULT_MAX_TIER, manual: true };
  for (const part of split(params.get('lock'))) {
    const at = part.indexOf('>');
    const good = parseGoodKey(data, part.slice(0, at));
    const recipe = part.slice(at + 1);
    if (good !== undefined && data.recipe(recipe)) plan.locks[good] = recipe;
  }
  plan.bans = split(params.get('ban')).filter((id) => data.recipe(id));
  for (const part of split(params.get('raw'))) {
    const good = parseGoodKey(data, part.slice(1));
    if (good !== undefined) (part.startsWith('-') ? plan.rawRemove : plan.rawAdd).push(good);
  }
  for (const part of split(params.get('cfg'))) {
    const at = part.indexOf('>');
    const recipe = part.slice(0, at);
    if (at > 0 && data.recipe(recipe)) plan.configs[recipe] = decodeConfig(part.slice(at + 1));
  }
  return plan;
}

/** Raw resources of a plan: the defaults with the user's changes. */
export function planRaw(defaults: number[], state: PlanState): number[] {
  const removed = new Set(state.rawRemove);
  return [...new Set([...defaults.filter((g) => !removed.has(g)), ...state.rawAdd])];
}

type Reply = { id: number; solution?: ProductionSolution; error?: string };

let worker: Worker | undefined;
let lastId = 0;
const pending = new Map<number, { resolve: (s: ProductionSolution) => void; reject: (e: Error) => void }>();

/** Solves one LP in the solver worker (one worker for the whole page). */
export function solveInWorker(problem: ProductionProblem): Promise<ProductionSolution> {
  if (!worker) {
    worker = new Worker(new URL('./solver.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<Reply>) => {
      const job = pending.get(e.data.id);
      if (!job) return;
      pending.delete(e.data.id);
      if (e.data.error || !e.data.solution) job.reject(new Error(e.data.error ?? 'no solution'));
      else job.resolve(e.data.solution);
    };
  }
  const id = ++lastId;
  const { recipes, targets, raw } = problem; // the solver needs only the LP itself
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker!.postMessage({ id, problem: { recipes, targets, raw } });
  });
}

export function useDefaultRaw(data: GameData) {
  return useMemo(() => defaultRaw(data), [data]);
}

/** What the solver is asked for the current plan state. */
export function planRequest(state: PlanState, defaultRawGoods: number[]): PlanRequest {
  return {
    targets: Object.fromEntries(state.targets.map((t) => [t.good, t.rate])),
    // goods the user marked raw are supplied from outside at no cost, so the solver never makes them
    settings: { maxTier: state.maxTier, raw: planRaw(defaultRawGoods, state), supplied: state.rawAdd, locks: state.locks, bans: state.bans, configs: state.configs, manual: state.manual },
  };
}

/** Solves the plan in the solver worker whenever targets or settings change. */
export function useSolvedPlan(data: GameData, state: PlanState): { plan?: Plan; solving: boolean; error?: string; ms?: number } {
  const counter = useRef(0);
  const raw = useDefaultRaw(data);
  const [result, setResult] = useState<{ plan?: Plan; solving: boolean; error?: string; ms?: number }>({ solving: false });

  const key = JSON.stringify(state);
  useEffect(() => {
    if (!state.targets.length) {
      setResult({ solving: false });
      return;
    }
    const id = ++counter.current;
    const started = performance.now();
    const request = planRequest(state, raw);
    const problem = buildProblem(data, request);
    setResult((r) => ({ ...r, solving: true }));
    solveInWorker(problem).then(
      (solution) => id === counter.current && setResult({ plan: readPlan(data, request, problem, solution), solving: false, ms: Math.round(performance.now() - started) }),
      (e: unknown) => id === counter.current && setResult({ solving: false, error: String(e) }),
    );
  }, [data, raw, key]);

  return result;
}
