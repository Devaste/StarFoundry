import { describe, expect, it } from 'vitest';
import { fromDisplay, toDisplay } from './units.js';

describe('rate units', () => {
  it('converts per second to display units and back', () => {
    expect(toDisplay(2, 'min')).toBe(120);
    expect(toDisplay(2, 'h')).toBe(7200);
    expect(fromDisplay(7200, 'h')).toBe(2);
  });
});
