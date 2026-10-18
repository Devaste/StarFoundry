# StarFoundry

Production planner for the [Star Technology](https://www.curseforge.com/minecraft/modpacks/star-technology) modpack (1.20.1 Theta 2 HF4, GTM-StarT-Fork 1.7.1c), in the spirit of the Satisfactory calculator: build production lines, let the solver pick cheaper recipes and close self-sustaining loops, with exact GregTech overclock, parallel and chance-boost mechanics.

Everything runs in the browser (installable PWA, works offline). Recipe data comes from [StarDumper](https://github.com/Devaste/StarDumper).

Status: early skeleton. Design and roadmap: [docs/SPEC.md](docs/SPEC.md).

## Layout

| Path | What |
|---|---|
| `apps/web` | React + Vite PWA; solving runs in a Web Worker |
| `packages/mechanics` | GT tiers, overclocking, parallels, chance boost (port of `startech_mechanics.py`) |
| `packages/solver` | production LP/MILP on HiGHS (WebAssembly) |
| `packages/data-pipeline` | StarDumper dump → data bundle |

## Develop

Requires Node 22+ and pnpm 10 (`corepack enable`).

```sh
pnpm install
pnpm dev        # web app at http://localhost:5173
pnpm test       # all packages
pnpm build
```
