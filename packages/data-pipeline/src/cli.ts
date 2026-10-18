#!/usr/bin/env node
/**
 * Builds the web app's data bundle from a StarDumper dump directory:
 *   starfoundry-bundle <dump dir> <out dir> [--data-version theta2-hf4]
 * Reads gtceu_new_recipes.json, gtceu_machines.json, names.en.json and names.ru.json,
 * writes bundle.json and names.<locale>.json.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { buildBundle, buildNames, type DumpMachines, type DumpNames, type DumpRecipes } from './build.js';

const args = process.argv.slice(2);
const flag = args.indexOf('--data-version');
const dataVersion = flag >= 0 ? args.splice(flag, 2)[1] : undefined;
const [dumpDir, outDir] = args;
if (!dumpDir || !outDir) {
  console.error('usage: starfoundry-bundle <dump dir> <out dir> [--data-version <name>]');
  process.exit(1);
}

const read = <T>(file: string) => JSON.parse(readFileSync(join(dumpDir, file), 'utf8')) as T;
const bundle = buildBundle(read<DumpRecipes>('gtceu_new_recipes.json'), read<DumpMachines>('gtceu_machines.json'), {
  dataVersion: dataVersion ?? basename(dumpDir),
});

mkdirSync(outDir, { recursive: true });
const write = (file: string, value: unknown) => {
  const json = JSON.stringify(value);
  writeFileSync(join(outDir, file), json);
  console.log(`${file}: ${(json.length / 1e6).toFixed(2)} MB`);
};
write('bundle.json', bundle);
for (const locale of ['en', 'ru']) write(`names.${locale}.json`, buildNames(bundle, read<DumpNames>(`names.${locale}.json`), locale));
console.log(`${bundle.recipes.length} recipes, ${bundle.goods.ids.length} goods, ${bundle.machines.length} machines`);
