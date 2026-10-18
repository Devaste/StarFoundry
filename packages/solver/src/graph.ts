/**
 * The solved plan as a flow graph (SPEC §2.1 Graph view): recipe nodes, plus item nodes where goods
 * enter the line (imports) or leave it (targets, byproducts). A good with one supplier or one consumer
 * flows straight from supplier to consumers (split in proportion); a good with several of both meets
 * at a hub node, so the graph gets suppliers + consumers edges instead of suppliers × consumers.
 */
import type { ImportKind, Plan } from './plan.js';

export type GraphNode =
  | { id: string; kind: 'recipe'; node: number }
  | { id: string; kind: 'import'; good: number; importKind: ImportKind; rate: number }
  | { id: string; kind: 'target' | 'byproduct' | 'hub'; good: number; rate: number };

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  good: number;
  /** per second */
  rate: number;
  /** both ends are in the same cycle (a loop in the line) */
  loop: boolean;
}

export interface PlanGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** flows below this (per second) are LP noise */
const EPS = 1e-6;

export function planGraph(plan: Plan, targets: Record<number, number>): PlanGraph {
  const nodes: GraphNode[] = [];
  const supply = new Map<number, { id: string; amount: number }[]>();
  const demand = new Map<number, { id: string; amount: number }[]>();
  const add = (map: typeof supply, good: number, id: string, amount: number) => {
    if (amount > EPS) (map.get(good) ?? map.set(good, []).get(good)!).push({ id, amount });
  };

  plan.nodes.forEach((n, i) => {
    if (n.rate <= EPS) return;
    const id = `r${i}`;
    nodes.push({ id, kind: 'recipe', node: i });
    for (const [good, amount] of n.inputs) add(demand, good, id, amount);
    for (const [good, amount] of n.outputs) add(supply, good, id, amount);
  });
  for (const importKind of ['raw', 'source', 'producible'] as const) {
    for (const [good, rate] of plan.imports[importKind]) {
      if (rate <= EPS) continue;
      const id = `i${good}`;
      nodes.push({ id, kind: 'import', good, importKind, rate });
      add(supply, good, id, rate);
    }
  }
  // a target takes its own surplus too, so everything made of it ends at the target
  const surplus = (good: number) => {
    const made = (supply.get(good) ?? []).reduce((s, x) => s + x.amount, 0);
    const used = (demand.get(good) ?? []).reduce((s, x) => s + x.amount, 0);
    return Math.max(0, made - used);
  };
  for (const good of Object.keys(targets).map(Number)) {
    const rate = surplus(good);
    if (rate <= EPS) continue;
    const id = `t${good}`;
    nodes.push({ id, kind: 'target', good, rate });
    add(demand, good, id, rate);
  }
  for (const [good, rate] of plan.byproducts) {
    if (rate <= EPS) continue;
    const id = `b${good}`;
    nodes.push({ id, kind: 'byproduct', good, rate });
    add(demand, good, id, rate);
  }

  const edges: GraphEdge[] = [];
  for (const [good, sources] of supply) {
    const sinks = demand.get(good) ?? [];
    const total = sinks.reduce((s, x) => s + x.amount, 0);
    const supplied = sources.reduce((s, x) => s + x.amount, 0);
    if (total <= EPS) continue;
    if (sources.length > 1 && sinks.length > 1) {
      const hub = `h${good}`;
      nodes.push({ id: hub, kind: 'hub', good, rate: supplied });
      for (const src of sources) edges.push({ id: `${src.id}>${hub}`, from: src.id, to: hub, good, rate: (src.amount / supplied) * total, loop: false });
      for (const sink of sinks) edges.push({ id: `${hub}>${sink.id}`, from: hub, to: sink.id, good, rate: sink.amount, loop: false });
      continue;
    }
    for (const src of sources) {
      for (const sink of sinks) {
        if (src.id === sink.id) continue;
        const rate = (src.amount / supplied) * sink.amount;
        if (rate > EPS) edges.push({ id: `${src.id}>${sink.id}:${good}`, from: src.id, to: sink.id, good, rate, loop: false });
      }
    }
  }

  const component = stronglyConnected(nodes.map((n) => n.id), edges);
  for (const e of edges) e.loop = component.get(e.from) === component.get(e.to);
  return { nodes, edges };
}

/** Tarjan's SCC: node id -> component index. */
function stronglyConnected(ids: string[], edges: GraphEdge[]): Map<string, number> {
  const out = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const e of edges) out.get(e.from)?.push(e.to);
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const component = new Map<string, number>();
  let counter = 0;
  let components = 0;

  for (const root of ids) {
    if (index.has(root)) continue;
    // iterative DFS: [node, next child position]
    const work: [string, number][] = [[root, 0]];
    while (work.length) {
      const frame = work[work.length - 1]!;
      const [v, i] = frame;
      if (i === 0) {
        index.set(v, counter);
        low.set(v, counter++);
        stack.push(v);
        onStack.add(v);
      }
      const children = out.get(v) ?? [];
      if (i < children.length) {
        frame[1]++;
        const w = children[i]!;
        if (!index.has(w)) work.push([w, 0]);
        else if (onStack.has(w)) low.set(v, Math.min(low.get(v)!, index.get(w)!));
        continue;
      }
      work.pop();
      const parent = work[work.length - 1];
      if (parent) low.set(parent[0], Math.min(low.get(parent[0])!, low.get(v)!));
      if (low.get(v) === index.get(v)) {
        let w: string;
        do {
          w = stack.pop()!;
          onStack.delete(w);
          component.set(w, components);
        } while (w !== v);
        components++;
      }
    }
  }
  return component;
}
