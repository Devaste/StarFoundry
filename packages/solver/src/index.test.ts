import { describe, expect, it } from 'vitest';
import { solveProduction } from './index.js';

describe('solveProduction', () => {
  it('scales a chain to the target rate', async () => {
    const s = await solveProduction({
      recipes: [
        { id: 'ingot', inputs: { dust: 1 }, outputs: { ingot: 1 } },
        { id: 'plate', inputs: { ingot: 3 }, outputs: { plate: 2 } },
      ],
      targets: { plate: 4 },
      raw: { dust: 1 },
    });
    expect(s.status).toBe('Optimal');
    expect(s.rates.plate).toBeCloseTo(2);
    expect(s.rates.ingot).toBeCloseTo(6);
    expect(s.imports.dust).toBeCloseTo(6);
    expect(s.itemPrices.plate).toBeCloseTo(1.5);
  });

  it('picks the cheaper alternative and recycles a byproduct loop', async () => {
    const s = await solveProduction({
      recipes: [
        // expensive route
        { id: 'acid_direct', inputs: { sulfur: 3 }, outputs: { acid: 1 } },
        // cheap route returns diluted acid, which is reconcentrated in a loop
        { id: 'acid_loop', inputs: { sulfur: 1, diluted: 1 }, outputs: { acid: 1 } },
        { id: 'use_acid', inputs: { acid: 1, ore: 1 }, outputs: { product: 1, diluted: 1 } },
      ],
      targets: { product: 1 },
      raw: { sulfur: 1, ore: 1 },
    });
    expect(s.status).toBe('Optimal');
    expect(s.rates.acid_direct).toBeUndefined();
    expect(s.rates.acid_loop).toBeCloseTo(1);
    expect(s.imports.sulfur).toBeCloseTo(1);
    expect(s.surplus.diluted).toBeUndefined();
  });

  it('reports infeasible when an input cannot be produced or imported', async () => {
    const s = await solveProduction({
      recipes: [{ id: 'plate', inputs: { ingot: 1 }, outputs: { plate: 1 } }],
      targets: { plate: 1 },
      raw: {},
    });
    expect(s.status).toBe('Infeasible');
  });
});
