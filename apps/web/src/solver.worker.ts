// All solving runs off the main thread (SPEC §10.2).
import { loadSolver, solveProduction, type ProductionProblem } from '@starfoundry/solver';
import wasmUrl from 'highs/runtime?url';

const ready = loadSolver({ locateFile: () => wasmUrl });

self.onmessage = async (event: MessageEvent<ProductionProblem>) => {
  await ready;
  self.postMessage(await solveProduction(event.data));
};
