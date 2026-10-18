import type { GameData } from '@starfoundry/data';
import { buildProblem, defaultRaw, readPlan, type MachineConfig, type Plan, type PlanRequest, type ProductionSolution } from '@starfoundry/solver';
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
}

export const emptyPlan = (): PlanState => ({ targets: [], maxTier: DEFAULT_MAX_TIER, locks: {}, bans: [], rawAdd: [], rawRemove: [], configs: {} });

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
  const plan: PlanState = { ...emptyPlan(), targets, maxTier: Number.isInteger(tier) ? tier : DEFAULT_MAX_TIER };
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

/** Solves the plan in the solver worker whenever targets or settings change. */
export function useDefaultRaw(data: GameData) {
  return useMemo(() => defaultRaw(data), [data]);
}

export function useSolvedPlan(data: GameData, state: PlanState): { plan?: Plan; solving: boolean; error?: string; ms?: number } {
  const worker = useRef<Worker>(undefined);
  const counter = useRef(0);
  const raw = useDefaultRaw(data);
  const [result, setResult] = useState<{ plan?: Plan; solving: boolean; error?: string; ms?: number }>({ solving: false });

  useEffect(() => {
    const w = new Worker(new URL('./solver.worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    return () => w.terminate();
  }, []);

  const key = JSON.stringify(state);
  useEffect(() => {
    const w = worker.current;
    if (!w || !state.targets.length) {
      setResult({ solving: false });
      return;
    }
    const id = ++counter.current;
    const started = performance.now();
    const request: PlanRequest = {
      targets: Object.fromEntries(state.targets.map((t) => [t.good, t.rate])),
      // goods the user marked raw are supplied from outside at no cost, so the solver never makes them
      settings: { maxTier: state.maxTier, raw: planRaw(raw, state), supplied: state.rawAdd, locks: state.locks, bans: state.bans, configs: state.configs },
    };
    const problem = buildProblem(data, request);
    setResult((r) => ({ ...r, solving: true }));
    const onMessage = (e: MessageEvent<Reply>) => {
      if (e.data.id !== id) return;
      w.removeEventListener('message', onMessage);
      const ms = Math.round(performance.now() - started);
      if (e.data.error || !e.data.solution) setResult({ solving: false, error: e.data.error ?? 'no solution' });
      else setResult({ plan: readPlan(data, request, problem, e.data.solution), solving: false, ms });
    };
    w.addEventListener('message', onMessage);
    const { recipes, targets, raw: rawCosts } = problem; // the solver needs only the LP itself
    w.postMessage({ id, problem: { recipes, targets, raw: rawCosts } });
    return () => w.removeEventListener('message', onMessage);
  }, [data, raw, key]);

  return result;
}
