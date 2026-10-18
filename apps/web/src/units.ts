import { createContext, useContext } from 'react';
import { formatNumber } from './format';

/** Plans store every rate per second; the unit only changes display and input (SPEC §2.1). */
export const RATE_UNITS = { s: 1, min: 60, h: 3600 } as const;
export type RateUnit = keyof typeof RATE_UNITS;

export const toDisplay = (perSecond: number, unit: RateUnit) => perSecond * RATE_UNITS[unit];
export const fromDisplay = (value: number, unit: RateUnit) => value / RATE_UNITS[unit];

export const UnitContext = createContext<RateUnit>('s');
export const useUnit = () => useContext(UnitContext);

/** "1.5/s" or "144 mB/s", with 3 significant digits for small rates. */
export function formatRate(perSecond: number, unit: RateUnit, fluid = false): string {
  const v = toDisplay(perSecond, unit);
  const shown = v !== 0 && Math.abs(v) < 0.01 ? Number(v.toPrecision(3)) : v;
  return `${formatNumber(shown)}${fluid ? ' mB' : ''}/${unit}`;
}
