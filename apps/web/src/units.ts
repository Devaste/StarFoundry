/** Plans store every rate per second; the unit only changes display and input (SPEC §2.1). */
export const RATE_UNITS = { s: 1, min: 60, h: 3600 } as const;
export type RateUnit = keyof typeof RATE_UNITS;

export const toDisplay = (perSecond: number, unit: RateUnit) => perSecond * RATE_UNITS[unit];
export const fromDisplay = (value: number, unit: RateUnit) => value / RATE_UNITS[unit];
