import { TIER_NAMES } from '@starfoundry/mechanics';

const numberFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 });

export const formatNumber = (x: number) => numberFormat.format(x);

/** 0.111111 -> "11.11%" */
export const formatPercent = (x: number) => `${formatNumber(Math.round(x * 10000) / 100)}%`;

/** Machines to build for a fractional count: 2.1 needs 3 (counts this close above a whole number are rounding noise). */
export const wholeMachines = (m: number) => (m <= 1e-6 ? 0 : Math.ceil(m - 1e-6));

/** Share of the built machines' time spent working. */
export const machineLoad = (m: number) => (wholeMachines(m) ? m / wholeMachines(m) : 0);

export const formatSeconds = (ticks: number) => `${formatNumber(ticks / 20)} s`;

export const tierName = (tier: number) => TIER_NAMES[tier] ?? `T${tier}`;

/** Large EU values with SI suffixes: 1 966 080 -> "1.97M". */
export function formatEu(eu: number): string {
  const abs = Math.abs(eu);
  for (const [div, suffix] of [[1e12, 'T'], [1e9, 'G'], [1e6, 'M'], [1e3, 'k']] as const) {
    if (abs >= div * 10) return `${formatNumber(Math.round((eu / div) * 100) / 100)}${suffix}`;
  }
  return formatNumber(Math.round(eu * 10) / 10);
}
