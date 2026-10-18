import { GoodKind, type RawBundle, type RawNames, type RawRecipeExtra, type RawStack } from './format.js';

export interface Stack {
  good: number;
  /** expected amount per operation, before chance */
  amount: number;
  /** base chance, 1 = guaranteed */
  chance: number;
  /** chance added per tier above the recipe tier */
  boostPerTier: number;
}

export interface Recipe {
  index: number;
  id: string;
  type: number;
  durationTicks: number;
  /** EU/t consumed; negative for generators */
  eut: number;
  tier: number;
  inputs: Stack[];
  outputs: Stack[];
  extra: RawRecipeExtra;
}

const toStack = ([good, amount, chance = 1, boostPerTier = 0]: RawStack): Stack => ({ good, amount, chance, boostPerTier });

/** Decoded bundle with lookup indexes; names are swapped in per locale. */
export class GameData {
  readonly dataVersion: string;
  readonly goodIds: string[];
  readonly goodKinds: GoodKind[];
  readonly tags: ReadonlyMap<number, number[]>;
  readonly recipeTypes: string[];
  readonly machines: RawBundle['machines'];
  readonly recipes: Recipe[];
  /** good -> recipes that output it (tags are never outputs) */
  readonly producers: number[][];
  /** good -> recipes that consume it, directly or through a tag it belongs to */
  readonly consumers: number[][];
  /** good -> tags it belongs to */
  readonly memberOf: number[][];
  /** recipe type -> machines that run it, by tier */
  readonly machinesByType: number[][];
  private readonly goodIndex = new Map<string, number>();
  private readonly recipeIndex = new Map<string, number>();
  private names: RawNames | undefined;
  private fallbackNames: RawNames | undefined;

  constructor(bundle: RawBundle) {
    this.dataVersion = bundle.dataVersion;
    this.goodIds = bundle.goods.ids;
    this.goodKinds = bundle.goods.kinds;
    this.tags = new Map(Object.entries(bundle.tags).map(([k, v]) => [Number(k), v]));
    this.recipeTypes = bundle.recipeTypes;
    this.machines = bundle.machines;
    this.goodIds.forEach((id, n) => this.goodIndex.set(`${this.goodKinds[n]}:${id}`, n));

    const goods = this.goodIds.length;
    this.producers = Array.from({ length: goods }, () => []);
    this.consumers = Array.from({ length: goods }, () => []);
    this.memberOf = Array.from({ length: goods }, () => []);
    for (const [tag, members] of this.tags) for (const m of members) this.memberOf[m]!.push(tag);

    this.recipes = bundle.recipes.map(([id, type, durationTicks, eut, tier, inputs, outputs, extra], index) => {
      this.recipeIndex.set(id, index);
      const r: Recipe = {
        index, id, type, durationTicks, eut, tier,
        inputs: inputs.map(toStack), outputs: outputs.map(toStack), extra: extra ?? {},
      };
      for (const s of r.outputs) addOnce(this.producers[s.good]!, index);
      for (const s of r.inputs) {
        addOnce(this.consumers[s.good]!, index);
        for (const m of this.tags.get(s.good) ?? []) addOnce(this.consumers[m]!, index);
      }
      return r;
    });

    const byTier = (a: number, b: number) => this.recipes[a]!.tier - this.recipes[b]!.tier || this.recipes[a]!.eut - this.recipes[b]!.eut;
    for (const list of this.producers) list.sort(byTier);
    for (const list of this.consumers) list.sort(byTier);

    this.machinesByType = this.recipeTypes.map(() => []);
    this.machines.forEach((m, n) => m.types.forEach((t) => this.machinesByType[t]!.push(n)));
    for (const list of this.machinesByType) list.sort((a, b) => this.machines[a]!.tier - this.machines[b]!.tier);
  }

  /** Sets the active names; `fallback` (English) fills names missing in `names`. */
  setNames(names: RawNames, fallback?: RawNames) {
    this.names = names;
    this.fallbackNames = fallback;
  }

  get locale() {
    return this.names?.locale ?? 'en';
  }

  good(kind: GoodKind, id: string): number | undefined {
    return this.goodIndex.get(`${kind}:${id}`);
  }

  recipe(id: string): Recipe | undefined {
    const n = this.recipeIndex.get(id);
    return n === undefined ? undefined : this.recipes[n];
  }

  isFluid(good: number) {
    return this.goodKinds[good] === GoodKind.Fluid || (this.goodKinds[good] === GoodKind.Tag && this.goodKinds[this.tags.get(good)?.[0] ?? good] === GoodKind.Fluid);
  }

  goodName(good: number): string {
    if (this.goodKinds[good] === GoodKind.Tag) {
      const members = this.tags.get(good) ?? [];
      const shown = members.slice(0, 3).map((m) => this.goodName(m));
      return shown.join(' / ') + (members.length > 3 ? ` (+${members.length - 3})` : '');
    }
    return this.names?.goods[good] ?? this.fallbackNames?.goods[good] ?? this.goodIds[good]!;
  }

  recipeTypeName(type: number): string {
    return this.names?.recipeTypes[type] ?? this.fallbackNames?.recipeTypes[type] ?? this.recipeTypes[type]!;
  }

  machineName(machine: number): string {
    return this.names?.machines[machine] ?? this.fallbackNames?.machines[machine] ?? this.machines[machine]!.id;
  }
}

function addOnce(list: number[], value: number) {
  if (list[list.length - 1] !== value) list.push(value);
}
