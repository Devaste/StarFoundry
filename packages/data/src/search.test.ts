import { describe, expect, it } from 'vitest';
import { GameData } from './game-data.js';
import { buildSearchIndex } from './search.js';

const data = new GameData({
  format: 1,
  dataVersion: 'test',
  goods: { ids: ['x:hv_circuit', 'x:uhv_circuit', 'x:steel_plate', 'x:stainless_steel_plate', 'x:seed', 'x:nanoprocessor', '#x:circuits/hv'], kinds: [0, 0, 0, 0, 0, 0, 2] },
  tags: { 6: [0, 5] },
  recipeTypes: ['x:t'],
  machines: [],
  recipes: [['r', 0, 1, 1, 0, [[4, 1]], [[0, 1], [1, 1], [2, 1], [3, 1], [5, 1]]]],
});
data.setNames({ locale: 'en', goods: ['HV Universal Circuit', 'UHV Universal Circuit', 'Steel Plate', 'Stainless Steel Plate', 'Seed', 'Nanoprocessor', null], recipeTypes: [], machines: [] });
const index = buildSearchIndex(data);
const names = (q: string) => index.search(q).map((g) => data.goodName(g));

describe('search', () => {
  it('matches words in any order, whole words first', () => {
    expect(names('circuit hv')).toEqual(['HV Universal Circuit', 'Nanoprocessor', 'UHV Universal Circuit']);
    expect(names('plate steel')[0]).toBe('Steel Plate');
  });
  it('finds a group by the tag its members are in', () => {
    expect(names('hv circuits')).toContain('Nanoprocessor');
  });
  it('finds an exact id first', () => {
    expect(names('x:stainless_steel_plate')[0]).toBe('Stainless Steel Plate');
  });
  it('retries a query typed in the other keyboard layout', () => {
    expect(names('ыуув')).toEqual(['Seed']);
  });
  it('forgives one typo per word when nothing matches', () => {
    expect(names('stainles stel')).toEqual(['Stainless Steel Plate']);
    expect(names('cirquit')).toHaveLength(3);
  });
});
