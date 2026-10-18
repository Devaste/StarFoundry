# StarFoundry: Star Technology production planner, spec (draft v0.3)

> Working name **StarFoundry** (pending Anton's pick; alternative StarLoom). Rename freely.

Goal: a production-line planner in the spirit of [satisfactory-calculator.com/planners/production](https://satisfactory-calculator.com/en/planners/production), built for Star Technology 1.20.1 Theta 2 HF4 (GTM-StarT-Fork 1.7.1c), with exact GT mechanics: overclocking, subtick parallels, parallel hatches, coils, tier chance boost, amperage.

Status: design stage, no code yet. Project language is English (code, docs, UI); Russian is the secondary UI language.

Changelog: v0.1 first draft (RU) · v0.2 tech stack · v0.3 English, Anton's decisions applied (§11).

---

## 1. Inputs and what they imply

| Source | Provides |
|---|---|
| `dumps/theta2-hf4/gtceu_new_recipes.json` | 45,748 GT recipes, 135 recipe types, every GTRecipe field (see FORMAT.md) |
| `dumps/theta2-hf4/gtceu_machines.json` | 1,749 machines: tier, recipe types, multiblock/generator flags; slot limits per recipe type |
| `mechanics/star_technology_mechanics.md`, `machine_modifiers.md` | OC/parallel/chance formulas and each machine's modifier chain |
| `mechanics/startech_mechanics.py` + `verify_oc.py` | reference implementation, verified bit-for-bit against the pack jar; becomes the test oracle for the port |

Facts from the dump that drive the design (computed from the file):

* 15,732 recipes are recycling (`macerator/arc_furnace/extractor_recycling`). Noise for planning: off by default.
* The remaining 30,016 recipes produce 11,421 items/fluids; **5,882** have more than one producer recipe, 1,402 have more than five. Picking recipes without help is impossible, so ranking and auto-selection are core features (§5).
* 4,177 chanced outputs (boost depends on machine tier), 193 ranged outputs (`count_min/max`), 1,277 tag inputs with several member items, 42 layered recipes, 64 generator recipes, ~10.5k recipes with a programmed circuit (not consumed).
* Conditions: cleanroom 472, research 413, daytime 60, eu_to_start 36, dimension 22, adjacent_fluid 15. Progression filters are needed.

Missing from the data (details in §9): display names (being added, §9), icons, crafting-table recipes, raw resource sources (veins, bedrock fluids), machine build costs.

---

## 2. Features

### 2.1. MVP

1. **Production targets.** A list of "item → rate". Rate unit is a global **dropdown: per second / per minute / per hour** (internally everything is per second; the unit only affects display and input). Item search by name (EN or RU), id, tag, JEI-style.
2. **Manual line building.** The user picks the recipe for each item: clicking a node's input opens the list of producer recipes (machine, tier, EU/t, duration, raw cost). A chosen node can be locked.
3. **Auto-completion.** Unlocked inputs are filled by the solver using the default-choice rule (§5.2). Mixed mode: some nodes locked by hand, the rest chosen by the solver.
4. **Per-node machine config.** Machine (any that runs this recipe type), tier / energy hatches (voltage × amps), parallel hatch, coils, batch, StarT modifiers (threading, bulking, throughput). Real duration, EU/t, parallels and chance boost come from the mechanics port (§8).
5. **Summary.** Machines per node (fractional and rounded up, with utilization %), total EU/t, breakdown by voltage and amperage, raw inputs, byproduct outputs.
6. **Recipe replacement suggestions** (§6).
7. **Closed loops / self-sustained lines** (§7).
8. **Progression filters.** Max available tier, cleanroom / sterile cleanroom, completed research, dimensions. Recipes outside the filter are not offered.
9. **Save and share.** Plans stored locally; JSON export/import; shareable URL with the plan encoded in it.
10. **Language switch** EN (default) / RU for UI strings and item names.

### 2.2. Later versions

* Power: pick generators (64 recipes) to cover the line, with fuel as part of the same model.
* Integer machine counts (MILP) and "fit the rate to N machines".
* Side-by-side comparison of two plans.
* "Where is X used": consumer lookup to find a use for a byproduct.
* Ore processing: from a vein to every product of the chain, with byproducts.
* Several factories in one project with item transfers between them (like SC factories).
* Build cost of a line (machine and hatch materials): needs a crafting dump (§9).

---

## 3. UX

The layout follows SC where it fits, plus GT specifics.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Plan: "Polyethylene 10/s"  [Save] [Link] [JSON]  Tier ≤ IV  Cleanroom ✓  [/s ▾] [EN▾]│
├──────────────┬───────────────────────────────────────────┬───────────────────┤
│ TARGETS      │  [Graph] [Table] [Power] [Raw & byproducts]│ SUGGESTIONS       │
│ + Add        │                                           │                   │
│ Polyethylene │   node graph: recipe = node, flow = edge  │ Ethylene:         │
│  10 /s  🔒   │   labeled with rate; edge color by        │  swap cracking →  │
│              │   item / fluid / byproduct                │  dehydration      │
│ RAW          │                                           │  −32% raw         │
│ (what counts │                                           │  [Apply]          │
│  as raw,     │                                           │                   │
│  weights,    │                                           │ Sulfuric acid     │
│  limits)     │                                           │ loop can be closed│
│ SETTINGS     │                                           │  [Apply]          │
│ objective    │                                           │                   │
└──────────────┴───────────────────────────────────────────┴───────────────────┘
```

* **Left column**: targets, raw resources (list with weights and limits, §5.1), solver settings (what to minimize, whether importing intermediates is allowed).
* **Center tabs**:
  * *Graph*: recipe nodes (machine icon, tier, machine count, EU/t), flow edges; loops highlighted. Click a node: machine config panel. Click an input: recipe picker.
  * *Table*: one row per node: recipe, machine, config, machines (fraction/integer), utilization, EU/t, inputs/outputs in the plan's unit. For large lines where the graph gets unreadable.
  * *Power*: total EU/t, per voltage, amps at each voltage; generator sizing later.
  * *Raw & byproducts*: what enters the line, what leaves as surplus, with raw cost.
* **Right column**: solver suggestions (recipe swaps, loop closing), each with its estimated gain and Apply / Dismiss.
* **Recipe card** (in the picker and on a node): inputs/outputs with chances (base → boosted at the selected tier), non-consumed inputs (circuit, catalyst) shown separately, conditions (cleanroom, research), recipe id, machines that can run it.

---

## 4. Data model

### 4.1. Data bundle (pipeline output, loaded into the browser)

```ts
Item      { id, kind: 'item'|'fluid', name: {en, ru?}, icon?, tags[] }
Recipe    { id, type, category, duration, eut, amps, voltageTier,
            inputs:  Stack[], outputs: Stack[],
            tickInputs?, tickOutputs?,           // per-tick content (EU, CWU, fluids)
            circuit?, conditions[], data{ebf_temp, eu_to_start, ...},
            layeredSteps?, flags{recycling, generator} }
Stack     { ref: itemId | tagId, amount | {min,max}, chance, maxChance,
            boostPerTier, consumed }
Tag       { id, members: itemId[], preferred: itemId }
Machine   { id, name: {en, ru?}, tier, recipeTypes[], multiblock, generator,
            modifiers: ModifierId[] }   // chain from machine_modifiers.md
RecipeType{ id, name: {en, ru?}, slots{maxIn, maxOut}, layered }
Derived   { rawCost[itemId], producers[itemId] -> recipeId[] (sorted),
            consumers[itemId] -> recipeId[] }
```

* Size after packing: ~30k non-recycling recipes, expected 5–10 MB raw, 1–2 MB brotli. Recycling ships as a separate lazily loaded chunk.
* Tag inputs: the plan uses the tag's `preferred` member (by default the cheapest to produce); the user can switch it.
* Ranged outputs: mean `(min+max)/2`. Chances: expected value after boost. Correct for rates; variance shown only as a hint.

### 4.2. Plan (what is saved)

```ts
Plan {
  version, dataVersion: 'theta2-hf4',
  targets:   { item, ratePerSec }[],
  raw:       { item, weight, limit? }[],        // what counts as raw
  nodes:     { recipeId, locked, config: MachineConfig }[],
  bans:      recipeId[],                        // recipes the user forbade
  settings:  { displayUnit: 's'|'min'|'h', locale: 'en'|'ru',
               objective, maxTier, cleanroom, research[], allowImports },
}
MachineConfig { machineId, energy: {voltageTier, amps, hatches}, parallelHatch?,
                coilTier?, batch?, threading?, bulking?, throughput? }
```

### 4.3. Node after mechanics

`EffectiveRecipe = applyModifiers(recipe, config)` → `{ durationTicks, eut, parallels, outputs with boosted chances, ocLevel, baseOcLevel }`. Node rate `x` = operations/s; machines = `x · durationTicks / 20 / parallels`. This is exactly what `startech_mechanics.py` does today; the TypeScript port is checked against the same vectors (`java_oc_reference.txt.gz`).

---

## 5. Solver

### 5.1. Formulation (linear programming, as in SC)

Variables: `x_r ≥ 0`, operations per second for each candidate recipe (already with its machine config, i.e. effective inputs/outputs). Plus `imp_i ≥ 0` (import) and `exp_i ≥ 0` (surplus) per item.

Balance for every item `i`:

```
Σ_r (out_{r,i} − in_{r,i}) · x_r  + imp_i − exp_i  =  target_i
```

* `imp_i` is allowed only for raw items (unless "allow importing intermediates" is on). Raw items respect their limit if set.
* `exp_i` is byproduct. Free by default; optionally penalized ("minimum waste" mode).
* Non-consumed inputs (programmed circuit, catalysts with `consumed=false`) stay out of the balance and show up as one-time equipment.
* EU: a separate row `Σ eut_r · machines_r`, priced in the objective.

Objective (chosen in settings; default is a weighted sum):

```
min  Σ_i w_i · imp_i   +  w_EU · EU/t   +  w_m · Σ machines_r   +  w_waste · Σ exp_i
```

Default raw weights: 1 per unit (like SC's "sum of resources"); user-editable. Presets: minimum raw, minimum power, minimum machines, minimum waste.

Implementation: HiGHS compiled to WebAssembly, running in the browser. After pruning (§5.3) problems have hundreds to thousands of variables and solve in milliseconds.

### 5.2. Default recipe choice

`rawCost[i]` = cheapest raw cost of an item using all allowed recipes (Bellman–Ford-style iteration over the recipe graph, cycle-aware, or one big LP read through its duals). Ranking an item's producers by per-unit cost through each recipe gives:

* the default recipe for auto-completion;
* the order in the picker (best on top, others tagged "+18% raw");
* pruning of clearly bad options.

Ranking depends on progression filters (tier, cleanroom), so it is recomputed in the browser on demand; the bundle ships only the "everything unlocked" version.

### 5.3. Graph pruning

Candidates = recipes reachable backwards from the targets, but for each item only the top-K producers by `rawCost` (K≈3–5, configurable) plus everything locked or chosen by hand. Recipes that yield an item as a byproduct are added when that item is already needed, so the solver finds "free" sources by itself.

### 5.4. Tier and machine config in the LP

Config changes coefficients (chance boost depends on tier, EU on OC). Two modes:

1. **Fixed config** (MVP): each node has a machine and tier (default: best machine at the highest allowed tier). One column per recipe.
2. **Solver picks the tier** (v2): each recipe is expanded into "machine × tier" variants and the LP picks the cheapest under the objective. This answers questions like "is it worth running this centrifuge recipe in LuV for the chance boost".

### 5.5. Integer machines

The LP returns fractional machines. MVP: round up and show utilization. v2: MILP (HiGHS supports it) with integer `machines_r` for nodes where the user asks.

---

## 6. Recipe replacement suggestions

Built on the LP's dual prices, i.e. "what one unit of each item costs this line".

1. After solving, every item has a shadow price `π_i`.
2. For each unused recipe `r'` (alternatives of active items, outside top-K, soft-filtered), compute the reduced cost `c_{r'} − Σ_i π_i · (out_{r',i} − in_{r',i})`. Negative means "swapping makes the line cheaper".
3. The best candidates are verified by an honest re-solve with the recipe added; the panel shows the exact gain: "−32% raw, −1.2M EU/t, +4 machines, needs cleanroom".
4. A separate, muted kind of suggestion: "a recipe above your tier would save X%" (progression motivation).

One click applies a suggestion; for a locked node the suggestion is shown but never auto-applied.

---

## 7. Self-sustained loops

GT is full of loops: sulfuric acid ↔ diluted acid, catalysts, chlorine/hydrogen from electrolysis, mercury, solvents, Na/K in platinum processing, etc. The LP closes them naturally: when one node's byproduct is another node's input, the balance routes it around. Planner specifics:

* **Closed-line mode**: imports allowed only for explicit raw items; everything else must be produced inside. If infeasible, the planner shows which item cannot be closed and which recipes could produce it.
* **Loop detection**: SCC (Tarjan) on the solution graph; the loop is highlighted on the graph, and the table shows its circulation (units going around) and makeup (top-up needed because of losses/chances).
* **Close-the-loop suggestions**: for each imported non-raw item, look for recipes that make it from current byproducts; for each byproduct, look for consumers that produce something currently imported. Scored the same way as §6.
* **Initial fill**: a closed loop needs a starting stock (e.g. a tank of acid). Shown as a one-time resource "fill at start ≈ circulation × loop time".

---

## 8. Mechanics port

`startech_mechanics.py` is ported to TypeScript one-to-one:

* OC algorithms (`NON_PERFECT`, `PERFECT`, subtick variants, EBF/coils, fusion), parallel hatch and absolute hatch, batch, StarT throughput/bulking/threading, chance boost (`chanceUseRecipeOC=true`), integer truncation of duration at every step.
* The modifier chain comes from `machine_modifiers.md` and ships in the bundle as data (`Machine.modifiers`).
* Tests: `java_oc_reference.txt.gz` and the examples in §9 of the mechanics write-up become golden tests in CI.

For multiblocks the config sets energy hatches (count × voltage × amps), and the machine tier is derived exactly as in `WorkableElectricMultiblockMachine`.

---

## 9. Data gaps and how to close them

| Missing | Why | Plan |
|---|---|---|
| Item/fluid/machine names, EN + RU | UI, search | **StarDumper exports an id → name map** (decided). A dedicated server has no client translations, and GT material names are composed (`"%s Dust"` + material key). So the dumper exports, per id, the translation key plus its arguments (component JSON); the pipeline resolves them with `en_us.json` / `ru_ru.json` from every pack jar and KubeJS assets, and also writes a flat `names.en.json` / `names.ru.json` (id → name). Missing RU falls back to EN. |
| Icons | UI | Textures from the pack jars → atlas; models that are not a plain texture need client-side rendering (separate task, deferred; text first) |
| Crafting-table and other non-GT recipes | build cost, some intermediates (components) | Extend StarDumper: dump `RecipeManager` (shaped/shapeless/smelting) |
| Raw sources | what counts as raw and how much exists | Default: "no producer = raw". Later: dump ore veins and bedrock fluids as hints |
| Multiblock structures | build cost | Deferred |

The MVP needs only the existing dump plus names.

---

## 10. Architecture and tech stack

Requirement: a fully optimized Web/PWA app with a lot of computation, **all of it on the user's machine**. Decision: **TypeScript end to end (Node.js for tooling and the data pipeline), heavy computation in Web Workers, LP solver native code in WebAssembly**. No backend: the server only hosts static files.

```
StarDumper (mod, Java) ──► dump JSON + names ──► data-pipeline (Node/TS, CI) ──► bundle (typed arrays + JSON, brotli)
                                                                                       │
   PWA (TS, React) ── main thread: UI ──Comlink──► Workers: mechanics + LP (HiGHS wasm) ◄┘
```

### 10.1. Why this and not "pure Node" or a mix for its own sake

* Computation runs **in the user's browser**, not on a server: instant feedback on every click, offline use, free hosting, no server load no matter how many users.
* One language (TypeScript) for the pipeline, mechanics, solver glue and UI: shared types from bundle to components, one test setup.
* The only foreign piece is HiGHS (C++ → wasm): writing an LP/MILP solver in JS makes no sense, and HiGHS is an order of magnitude faster than any JS one.
* Mechanics (OC, parallels, chances) is cheap integer math per node; in TS it takes microseconds. Rust → wasm is justified only if profiling shows a bottleneck (e.g. massive "machine × tier" expansion in §5.4). So the compute core lives behind an interface inside a worker and can be swapped for Rust → wasm without touching the UI.

### 10.2. Stack

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript (strict) | shared types across the project |
| Monorepo | pnpm workspaces + Turborepo | packages: `data-pipeline`, `mechanics`, `solver`, `web` |
| Build | Vite | fast dev, native workers and wasm |
| UI | React 19 | mature ecosystem for graphs and tables (SolidJS would render faster, but heavy work already lives in workers) |
| Line graph | React Flow (xyflow) + ELK.js (layout in a worker) | editable node graph, auto layout |
| Tables | TanStack Table + TanStack Virtual | thousands of rows without lag |
| State | Zustand (+ Immer) | simple, no extra re-renders |
| Compute | Web Workers via Comlink | UI never blocks; worker pool for evaluating suggestions in §6 |
| LP/MILP | HiGHS wasm (`highs-js`) | simplex + duals for §6, MILP for §5.5 |
| Search | FlexSearch (index built in a worker), EN + RU | instant search over 11k+ items and tags |
| i18n | i18next (EN default, RU secondary); item names from the bundle's name maps | one switch for UI strings and game names |
| Units | display-layer formatter, plan state always per second | /s, /min, /h dropdown without touching the solver |
| Storage | IndexedDB (Dexie) | cached data bundle and saved plans |
| PWA | vite-plugin-pwa (Workbox) | offline, installable, bundle update on a new dump |
| Data format | recipes in dense typed arrays (`Int32Array`/`Float64Array` + string table), metadata in JSON; brotli | fast load, zero parsing on the solver hot path |
| Tests | Vitest (golden mechanics tests from `java_oc_reference.txt.gz`), Playwright (e2e) | guarantee results match the game |
| Hosting | GitHub Pages or Cloudflare Pages, deployed from GitHub Actions | static, free |

`startech_mechanics.py` stays the oracle: CI compares the TS port against it and the Java vectors.

### 10.3. Optimizations built in from the start

* The bundle is downloaded once and cached in IndexedDB; recycling and rare data load lazily.
* The pipeline prebuilds `producers/consumers` indexes and `rawCost` for "everything unlocked"; recomputation under filters is incremental, in a worker.
* The LP is rebuilt incrementally: editing one node changes only its columns; suggestions (§6) reuse duals from the already solved problem, with full re-solves only for top candidates, in parallel across the worker pool.
* The UI renders only what is visible (virtualized tables, graph culling).

### 10.4. Repositories

* **StarDumper** (existing): data source, Java mod. Gets the names export.
* **StarFoundry** (new, name pending): the planner monorepo above. The data bundle is generated in its CI from a pinned dump release.

---

## 11. Decisions

Made (Anton, 2026-10-18):

1. Stack: as in §10, final call delegated to Claude; computation on the user's machine.
2. Project language English; rate unit is a /s, /min, /h dropdown.
3. Separate repository with a short, catchy name that doesn't clash with existing products (shortlist: StarFoundry, StarLoom; "Forge" avoided because of Minecraft Forge).
4. StarDumper will export names, including an id → name map.
5. UI languages: EN primary, RU secondary.

Open: final repository name.

Next steps: M1 below, starting with the names export in StarDumper.

### Milestones

1. **M1, data**: names export in StarDumper + data pipeline + bundle. Check: item search, recipe card.
2. **M2, core**: mechanics port with golden tests; LP with fixed config; table and summary. This is already a working calculator.
3. **M3, planner**: graph, manual building and locks, auto-completion, progression filters, save/share.
4. **M4, smart features**: replacement suggestions (§6), closed lines and loops (§7), solver-chosen tier.
5. **M5**: power with generators, MILP, plan comparison, icons, crafting recipes.
