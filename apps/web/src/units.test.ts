import { describe, expect, it } from 'vitest';
import { formatRate, fromDisplay, toDisplay } from './units.js';

describe('rate units', () => {
  it('converts per second to display units and back', () => {
    expect(toDisplay(2, 'min')).toBe(120);
    expect(toDisplay(2, 'h')).toBe(7200);
    expect(fromDisplay(7200, 'h')).toBe(2);
  });

  it('formats small and fluid rates', () => {
    expect(formatRate(0.00002, 's')).toBe('0.00002/s');
    expect(formatRate(2.4, 'min', true)).toBe('144 mB/min');
  });
});
