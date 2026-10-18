/**
 * StarDumper dump -> data bundle (SPEC §4.1). See dumps FORMAT.md in StarDumper for the input.
 */
import {
  BUNDLE_FORMAT, GoodKind, type RawBundle, type RawMachine, type RawNames, type RawRecipe,
  type RawRecipeExtra, type RawStack,
} from '@starfoundry/data';

export interface DumpStack {
  content?: unknown;
  chance: number;
  maxChance: number;
  tierChanceBoost: number;
  consumed?: boolean;
  count?: number;
  count_min?: number;
  count_max?: number;
  amount?: number;
  amount_min?: number;
  amount_max?: number;
  items?: string[];
  fluids?: string[];
  circuit?: number;
}

type Contents = Partial<Record<'item' | 'fluid' | 'eu' | 'cwu', DumpStack[]>>;

export interface DumpRecipe {
  duration: number;
  category: string;
  voltage_tier: number;
  energy: { input: { total: number }; output: { total: number } };
  contents: Partial<Record<'inputs' | 'outputs' | 'tick_inputs' | 'tick_outputs', Contents>>;
  conditions?: { type: string; tooltip?: string; reverse?: boolean }[];
  data?: Record<string, unknown>;
}

export type DumpRecipes = Record<string, Record<string, DumpRecipe>>;

export interface DumpMachines {
  recipe_types: Record<string, unknown>;
  machines: Record<string, { tier: number; recipe_types: string[]; multiblock: boolean; generator?: boolean }>;
}

/** names.<locale>.json from StarDumper's resolve_names.py */
export type DumpNames = Partial<Record<'items' | 'fluids' | 'machines' | 'recipe_types', Record<string, string>>>;

export interface BuildOptions {
  dataVersion: string;
  /** keep macerator/arc furnace/extractor recycling recipes (off: SPEC §1) */
  recycling?: boolean;
}

export function buildBundle(recipes: DumpRecipes, machines: DumpMachines, options: BuildOptions): RawBundle {
  const goodIds: string[] = [];
  const goodKinds: GoodKind[] = [];
  const goodIndex = new Map<string, number>();
  const tags: Record<number, number[]> = {};
  const good = (kind: GoodKind, id: string) => {
    const key = `${kind}:${id}`;
    let n = goodIndex.get(key);
    if (n === undefined) {
      n = goodIds.length;
      goodIndex.set(key, n);
      goodIds.push(id);
      goodKinds.push(kind);
    }
    return n;
  };

  const typeIds = [...new Set([...Object.keys(recipes), ...Object.keys(machines.recipe_types)])].sort();
  const typeIndex = new Map(typeIds.map((id, n) => [id, n]));

  const stackGood = (s: DumpStack, fluid: boolean): number => {
    const ids = (fluid ? s.fluids : s.items) ?? [];
    const kind = fluid ? GoodKind.Fluid : GoodKind.Item;
    if (ids.length === 1) return good(kind, ids[0]!);
    const tagId = `#${tagName(s.content, fluid) ?? ids.slice().sort().join('|')}`;
    const n = good(GoodKind.Tag, tagId);
    tags[n] ??= ids.map((id) => good(kind, id));
    return n;
  };

  const toStack = (s: DumpStack, fluid: boolean): RawStack => {
    const amount = fluid
      ? s.amount ?? ((s.amount_min ?? 0) + (s.amount_max ?? 0)) / 2
      : s.count ?? ((s.count_min ?? 0) + (s.count_max ?? 0)) / 2;
    const stack: RawStack = [stackGood(s, fluid), amount];
    if (s.chance < s.maxChance || s.tierChanceBoost) {
      stack.push(round(s.chance / s.maxChance), round(s.tierChanceBoost / s.maxChance));
      if (!stack[3]) stack.pop();
    }
    return stack;
  };

  const out: RawRecipe[] = [];
  for (const [type, byId] of Object.entries(recipes)) {
    for (const [id, r] of Object.entries(byId)) {
      if (!options.recycling && r.category.endsWith('_recycling') && !isMaterialConversion(r)) continue;
      const extra: RawRecipeExtra = {};
      const inputs: RawStack[] = [];
      const outputs: RawStack[] = [];
      for (const fluid of [false, true]) {
        const cap = fluid ? 'fluid' : 'item';
        for (const s of r.contents.inputs?.[cap] ?? []) {
          if (s.circuit !== undefined) extra.circuit = s.circuit;
          else if (s.consumed === false) (extra.keep ??= []).push(toStack(s, fluid));
          else inputs.push(toStack(s, fluid));
        }
        for (const s of r.contents.outputs?.[cap] ?? []) {
          const min = fluid ? s.amount_min : s.count_min;
          const max = fluid ? s.amount_max : s.count_max;
          if (min !== undefined && max !== undefined) (extra.range ??= {})[outputs.length] = [min, max];
          outputs.push(toStack(s, fluid));
        }
      }
      const cwu = r.contents.tick_inputs?.cwu?.reduce((sum, s) => sum + Number(s.content), 0);
      if (cwu) extra.cwu = cwu;
      const cond = r.conditions?.map((c) => cleanTooltip(c.tooltip ?? c.type) + (c.reverse ? ' (reversed)' : ''));
      if (cond?.length) extra.cond = cond;
      if (r.data && Object.keys(r.data).length) extra.data = r.data;

      const eut = r.energy.output.total > 0 ? -r.energy.output.total : r.energy.input.total;
      const row: RawRecipe = [id, typeIndex.get(type)!, r.duration, eut, r.voltage_tier, inputs, outputs];
      if (Object.keys(extra).length) row.push(extra);
      out.push(row);
    }
  }
  out.sort((a, b) => (a[0] < b[0] ? -1 : 1));

  const machineList: RawMachine[] = Object.entries(machines.machines)
    .filter(([, m]) => m.recipe_types.some((t) => typeIndex.has(t)))
    .map(([id, m]) => {
      const raw: RawMachine = { id, tier: m.tier, types: m.recipe_types.map((t) => typeIndex.get(t)!).filter((t) => t !== undefined) };
      if (m.multiblock) raw.multiblock = true;
      if (m.generator) raw.generator = true;
      return raw;
    })
    .sort((a, b) => (a.id < b.id ? -1 : 1));

  return {
    format: BUNDLE_FORMAT,
    dataVersion: options.dataVersion,
    goods: { ids: goodIds, kinds: goodKinds },
    tags,
    recipeTypes: typeIds,
    machines: machineList,
    recipes: out,
  };
}

export function buildNames(bundle: RawBundle, names: DumpNames, locale: string): RawNames {
  return {
    locale,
    goods: bundle.goods.ids.map((id, n) => {
      const kind = bundle.goods.kinds[n];
      if (kind === GoodKind.Tag) return null;
      return (kind === GoodKind.Fluid ? names.fluids : names.items)?.[id] ?? null;
    }),
    recipeTypes: bundle.recipeTypes.map((id) => names.recipe_types?.[id] ?? null),
    machines: bundle.machines.map((m) => names.machines?.[m.id] ?? null),
  };
}

/**
 * Recycling categories also hold the plain material conversions (ingot -> molten metal, block -> dust,
 * nugget -> fluid); those are real production steps, unlike part recycling, so they stay.
 */
const MATERIAL_FORM = /_(ingot|dust|small_dust|tiny_dust|nugget|block)$/;
function isMaterialConversion(r: DumpRecipe): boolean {
  const inputs = r.contents.inputs?.item ?? [];
  return inputs.length === 1 && inputs[0]!.items?.length === 1 && MATERIAL_FORM.test(inputs[0]!.items[0]!);
}

function tagName(content: unknown, fluid: boolean): string | undefined {
  const c = content as { ingredient?: { tag?: string }; value?: { tag?: string }[] } | undefined;
  return fluid ? c?.value?.find((v) => v.tag)?.tag : c?.ingredient?.tag;
}

/** Minecraft formatting codes arrive as "?c" after the dump's charset round trip. */
function cleanTooltip(s: string) {
  return s.replace(/[?§][0-9a-fk-or]/g, '').trim();
}

const round = (x: number) => Math.round(x * 1e6) / 1e6;
