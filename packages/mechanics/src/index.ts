/** Voltage tiers as GTValues defines them (ULV = 0 … MAX = 14). */
export const TIER_NAMES = [
  'ULV', 'LV', 'MV', 'HV', 'EV', 'IV', 'LuV', 'ZPM', 'UV', 'UHV', 'UEV', 'UIV', 'UXV', 'OpV', 'MAX',
] as const;

export type TierName = (typeof TIER_NAMES)[number];

/** Max EU/t of each tier: V[0] = 8, then ×4 per tier. */
export const V: readonly number[] = TIER_NAMES.map((_, tier) => 8 * 4 ** tier);

/** Lowest tier whose voltage covers `eut` (GTUtil.getTierByVoltage). */
export function tierOf(eut: number): number {
  const tier = V.findIndex((v) => eut <= v);
  return tier === -1 ? TIER_NAMES.length - 1 : tier;
}

export const TICKS_PER_SECOND = 20;

export * from './oc.js';
