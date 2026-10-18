import highsLoader from 'highs';

/** A recipe already adjusted for its machine config: net flows per operation. */
export interface LpRecipe {
  id: string;
  /** item id -> amount consumed per operation */
  inputs: Record<string, number>;
  /** item id -> expected amount produced per operation */
  outputs: Record<string, number>;
  /** cost per operation per second (e.g. EU or machine weight); 0 if not priced */
  cost?: number;
}

export interface ProductionProblem {
  recipes: LpRecipe[];
  /** item id -> required net output per second */
  targets: Record<string, number>;
  /** item id -> cost per unit imported; only these items may be imported */
  raw: Record<string, number>;
  /** cost per unit of surplus (byproducts); default 0 */
  wasteCost?: number;
}

export interface ProductionSolution {
  status: string;
  objective: number;
  /** recipe id -> operations per second */
  rates: Record<string, number>;
  imports: Record<string, number>;
  surplus: Record<string, number>;
  /** item id -> shadow price: what one more unit per second costs the line */
  itemPrices: Record<string, number>;
}

type Highs = Awaited<ReturnType<typeof highsLoader>>;
let highs: Promise<Highs> | undefined;

/** Loads the HiGHS runtime once; pass loader options (e.g. locateFile) in browsers. */
export function loadSolver(options?: Parameters<typeof highsLoader>[0]): Promise<Highs> {
  highs ??= highsLoader(options);
  return highs;
}

/**
 * Builds the balance LP (SPEC §5.1): for every item
 *   Σ_r (out − in)·x_r + imp − exp = target,  x, imp, exp ≥ 0, imp only for raw items,
 * minimizing Σ raw·imp + Σ cost·x + waste·Σ exp.
 */
export function buildLp(problem: ProductionProblem): { lp: string; recipeCols: string[]; items: string[] } {
  const items = new Set<string>([...Object.keys(problem.targets), ...Object.keys(problem.raw)]);
  for (const r of problem.recipes) {
    for (const i of Object.keys(r.inputs)) items.add(i);
    for (const i of Object.keys(r.outputs)) items.add(i);
  }
  const itemList = [...items];
  const itemIndex = new Map(itemList.map((id, n) => [id, n]));
  const recipeCols = problem.recipes.map((_, n) => `x${n}`);
  const terms: string[][] = itemList.map(() => []);

  problem.recipes.forEach((r, n) => {
    const net = new Map<string, number>();
    for (const [i, a] of Object.entries(r.inputs)) net.set(i, (net.get(i) ?? 0) - a);
    for (const [i, a] of Object.entries(r.outputs)) net.set(i, (net.get(i) ?? 0) + a);
    for (const [i, a] of net) if (a !== 0) terms[itemIndex.get(i)!]!.push(`${signed(a)} x${n}`);
  });

  const objective: string[] = [];
  problem.recipes.forEach((r, n) => r.cost && objective.push(`${signed(r.cost)} x${n}`));
  const waste = problem.wasteCost ?? 0;
  itemList.forEach((id, n) => {
    terms[n]!.push(`- e${n}`);
    if (waste) objective.push(`${signed(waste)} e${n}`);
    if (id in problem.raw) {
      terms[n]!.push(`+ i${n}`);
      objective.push(`${signed(problem.raw[id]!)} i${n}`);
    }
  });

  const rows = itemList.map((id, n) => ` b${n}: ${terms[n]!.join(' ')} = ${problem.targets[id] ?? 0}`);
  const lp = ['Minimize', ` obj: ${objective.join(' ') || '0 e0'}`, 'Subject To', ...rows, 'End'].join('\n');
  return { lp, recipeCols, items: itemList };
}

export async function solveProduction(problem: ProductionProblem): Promise<ProductionSolution> {
  const { lp, recipeCols, items } = buildLp(problem);
  const result = (await loadSolver()).solve(lp);
  const solution: ProductionSolution = {
    status: result.Status, objective: 0, rates: {}, imports: {}, surplus: {}, itemPrices: {},
  };
  if (result.Status !== 'Optimal') return solution;
  solution.objective = result.ObjectiveValue;
  const value = (name: string) => result.Columns[name]?.Primal ?? 0;
  problem.recipes.forEach((r, n) => {
    const x = value(recipeCols[n]!);
    if (x > 1e-9) solution.rates[r.id] = x;
  });
  items.forEach((id, n) => {
    const imp = value(`i${n}`);
    const exp = value(`e${n}`);
    if (imp > 1e-9) solution.imports[id] = imp;
    if (exp > 1e-9) solution.surplus[id] = exp;
    const row = result.Rows[n];
    if (row && 'Dual' in row) solution.itemPrices[id] = row.Dual;
  });
  return solution;
}

function signed(a: number): string {
  return a < 0 ? `- ${-a}` : `+ ${a}`;
}
export * from './effective.js';
export * from './graph.js';
export * from './plan.js';
