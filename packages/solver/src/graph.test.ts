import type { Recipe } from '@starfoundry/data';
import { describe, expect, it } from 'vitest';
import { planGraph, type Plan, type PlanNode } from './index.js';

const node = (id: string, rate: number, inputs: [number, number][], outputs: [number, number][]): PlanNode => ({
  recipe: { id } as Recipe,
  config: {} as PlanNode['config'],
  rate, machines: rate, eut: 0, inputs: new Map(inputs), outputs: new Map(outputs),
});

describe('planGraph', () => {
  it('splits a good over its consumers and adds import, target and byproduct nodes', () => {
    // ore(0) -> [macerate] -> dust(1) + slag(4) ; dust -> [smelt] -> ingot(2); half the dust also comes from imports
    const plan: Plan = {
      status: 'Optimal',
      nodes: [node('macerate', 1, [[0, 1]], [[1, 2], [4, 0.5]]), node('smelt', 4, [[1, 4]], [[2, 4]])],
      imports: { raw: new Map([[0, 1], [1, 2]]), leaf: new Map(), source: new Map(), producible: new Map() },
      unreachable: [],
      byproducts: new Map([[4, 0.5]]),
      totalEut: 0,
      producersOf: new Map(),
    };
    const g = planGraph(plan, { 2: 4 });
    expect(g.nodes.map((n) => n.id).sort()).toEqual(['b4', 'i0', 'i1', 'r0', 'r1', 't2']);
    const edge = (from: string, to: string) => g.edges.find((e) => e.from === from && e.to === to);
    expect(edge('r0', 'r1')!.rate).toBeCloseTo(2);
    expect(edge('i1', 'r1')!.rate).toBeCloseTo(2);
    expect(edge('r1', 't2')!.rate).toBeCloseTo(4);
    expect(edge('r0', 'b4')!.rate).toBeCloseTo(0.5);
    expect(g.edges.every((e) => !e.loop)).toBe(true);
  });

  it('leaves out recipes whose flows are all LP noise', () => {
    const plan: Plan = {
      status: 'Optimal',
      nodes: [node('make', 1, [[0, 1]], [[2, 1]]), node('noise', 2e-6, [[3, 1e-7]], [[4, 1e-7]])],
      imports: { raw: new Map([[0, 1], [3, 1e-7]]), leaf: new Map(), source: new Map(), producible: new Map() },
      unreachable: [],
      byproducts: new Map([[4, 1e-7]]),
      totalEut: 0,
      producersOf: new Map(),
    };
    expect(planGraph(plan, { 2: 1 }).nodes.map((n) => n.id).sort()).toEqual(['i0', 'r0', 't2']);
  });

  it('marks edges inside a cycle as a loop', () => {
    // a -> b -> a with a target taken out of b
    const plan: Plan = {
      status: 'Optimal',
      nodes: [node('a', 1, [[1, 1]], [[0, 2]]), node('b', 1, [[0, 2]], [[1, 1], [2, 1]])],
      imports: { raw: new Map(), leaf: new Map(), source: new Map(), producible: new Map() },
      unreachable: [],
      byproducts: new Map(),
      totalEut: 0,
      producersOf: new Map(),
    };
    const g = planGraph(plan, { 2: 1 });
    expect(g.edges.filter((e) => e.loop).map((e) => `${e.from}>${e.to}`).sort()).toEqual(['r0>r1', 'r1>r0']);
    expect(g.edges.find((e) => e.to === 't2')!.loop).toBe(false);
  });

  it('joins a good with several suppliers and consumers at a hub', () => {
    // two recipes make water(5), two use it
    const plan: Plan = {
      status: 'Optimal',
      nodes: [
        node('w1', 1, [], [[5, 1]]), node('w2', 1, [], [[5, 3]]),
        node('u1', 1, [[5, 2]], [[2, 1]]), node('u2', 1, [[5, 2]], [[2, 1]]),
      ],
      imports: { raw: new Map(), leaf: new Map(), source: new Map(), producible: new Map() },
      unreachable: [],
      byproducts: new Map(),
      totalEut: 0,
      producersOf: new Map(),
    };
    const g = planGraph(plan, { 2: 2 });
    expect(g.nodes.find((n) => n.id === 'h5')).toMatchObject({ kind: 'hub', rate: 4 });
    expect(g.edges.filter((e) => e.good === 5).map((e) => `${e.from}>${e.to}:${e.rate}`).sort()).toEqual([
      'h5>r2:2', 'h5>r3:2', 'r0>h5:1', 'r1>h5:3',
    ]);
  });
});
