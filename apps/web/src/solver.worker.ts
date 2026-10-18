// All solving runs off the main thread (SPEC §10.2).
import { loadSolver, solveProduction, type ProductionProblem } from '@starfoundry/solver';
import wasmUrl from 'highs/runtime?url';

const ready = loadSolver({ locateFile: () => wasmUrl });

self.onmessage = async (event: MessageEvent<{ id: number; problem: ProductionProblem }>) => {
  await ready;
  const { id, problem } = event.data;
  try {
    self.postMessage({ id, solution: await solveProduction(problem) });
  } catch (e) {
    self.postMessage({ id, error: String(e) });
  }
};
