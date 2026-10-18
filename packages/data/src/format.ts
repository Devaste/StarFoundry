/**
 * On-disk data bundle (SPEC §4.1), written by the data pipeline and loaded by the web app.
 *
 * Everything is index based: a "good" is an item, a fluid or a tag (a set of interchangeable
 * items or fluids accepted by a recipe input). Names live in separate per-locale files whose
 * arrays line up with the indices here, so switching language downloads only names.
 */

export const BUNDLE_FORMAT = 1;

export const GoodKind = {
  Item: 0,
  Fluid: 1,
  /** Recipe input accepting any of several items or fluids; members are in `tags`. */
  Tag: 2,
} as const;
export type GoodKind = (typeof GoodKind)[keyof typeof GoodKind];

/**
 * One recipe stack: [good, amount, chance?, boostPerTier?].
 * amount is the expected count (ranged outputs use the mean of min and max).
 * chance and boostPerTier are fractions of one (0.25 = 25 %); omitted when the stack is guaranteed.
 */
export type RawStack = [good: number, amount: number, chance?: number, boostPerTier?: number];

export interface RawRecipeExtra {
  /** programmed circuit configuration (not consumed) */
  circuit?: number;
  /** inputs that are required but not consumed (catalysts, molds, lenses) */
  keep?: RawStack[];
  /** condition tooltips, e.g. "Requires Cleanroom" */
  cond?: string[];
  /** computation per tick (CWU/t), research-style recipes */
  cwu?: number;
  /** ranged outputs, index into outputs -> [min, max] */
  range?: Record<number, [number, number]>;
  /** recipe data (ebf_temp, eu_to_start, ...) as dumped */
  data?: Record<string, unknown>;
}

/**
 * [id, type, durationTicks, eut, voltageTier, inputs, outputs, extra?]
 * eut is EU/t consumed; generators have a negative eut (EU/t produced).
 */
export type RawRecipe = [
  id: string,
  type: number,
  duration: number,
  eut: number,
  tier: number,
  inputs: RawStack[],
  outputs: RawStack[],
  extra?: RawRecipeExtra,
];

export interface RawMachine {
  id: string;
  tier: number;
  types: number[];
  multiblock?: true;
  generator?: true;
}

export interface RawBundle {
  format: typeof BUNDLE_FORMAT;
  dataVersion: string;
  goods: { ids: string[]; kinds: GoodKind[] };
  /** tag good index -> member good indices */
  tags: Record<number, number[]>;
  recipeTypes: string[];
  machines: RawMachine[];
  recipes: RawRecipe[];
}

/** names.<locale>.json; arrays line up with the bundle (tags have no name, the app builds one). */
export interface RawNames {
  locale: string;
  goods: (string | null)[];
  recipeTypes: (string | null)[];
  machines: (string | null)[];
}
