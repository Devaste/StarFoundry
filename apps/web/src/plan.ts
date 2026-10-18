import type { GameData } from '@starfoundry/data';
import { buildProblem, defaultRaw, readPlan, type Plan, type PlanRequest, type ProductionSolution } from '@starfoundry/solver';
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
}

export const DEFAULT_MAX_TIER = 5; // IV

/** Plan <-> URL hash params (t=item:gtceu:x@0.5~fluid:gtceu:y@2, tier=5), so a plan is a shareable link. */
export function encodePlan(data: GameData, plan: PlanState): Record<string, string | undefined> {
  return {
    t: plan.targets.length ? plan.targets.map((t) => `${goodKey(data, t.good)}@${t.rate}`).join('~') : undefined,
    tier: plan.maxTier === DEFAULT_MAX_TIER ? undefined : String(plan.maxTier),
  };
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
  return { targets, maxTier: Number.isInteger(tier) ? tier : DEFAULT_MAX_TIER };
}

type Reply = { id: number; solution?: ProductionSolution; error?: string };

/** Solves the plan in the solver worker whenever targets or settings change. */
export function useSolvedPlan(data: GameData, state: PlanState): { plan?: Plan; solving: boolean; error?: string; ms?: number } {
  const worker = useRef<Worker>(undefined);
  const counter = useRef(0);
  const raw = useMemo(() => defaultRaw(data), [data]);
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
      settings: { maxTier: state.maxTier, raw },
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
    w.postMessage({ id, problem });
    return () => w.removeEventListener('message', onMessage);
  }, [data, raw, key]);

  return result;
}
