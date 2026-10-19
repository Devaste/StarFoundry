// All solving runs off the main thread (SPEC §10.2).
import { loadSolver, solveMip, solveProduction, type ProductionProblem } from '@starfoundry/solver';
import wasmUrl from 'highs/runtime?url';

const ready = loadSolver({ locateFile: () => wasmUrl });

type Job = { id: number; problem?: ProductionProblem; lp?: string; options?: { timeLimit: number } };

self.onmessage = async (event: MessageEvent<Job>) => {
  await ready;
  const { id, problem, lp, options } = event.data;
  try {
    if (lp !== undefined) self.postMessage({ id, mip: await solveMip(lp, options ?? { timeLimit: 20 }) });
    else self.postMessage({ id, solution: await solveProduction(problem!) });
  } catch (e) {
    self.postMessage({ id, error: String(e) });
  }
};
