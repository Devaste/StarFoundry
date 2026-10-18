#!/usr/bin/env node
/**
 * Data pipeline entry point (SPEC §4.1, milestone M1).
 * Planned steps: read gtceu_new_recipes.json, gtceu_machines.json and names.<lang>.json,
 * drop recycling, normalize stacks, expand tags, build producers/consumers and rawCost,
 * then write the bundle the web app loads.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dumpDir = process.argv[2];
if (!dumpDir) {
  console.error('usage: starfoundry-bundle <dump dir>');
  process.exit(1);
}
const names = JSON.parse(readFileSync(join(dumpDir, 'names.en.json'), 'utf8')) as Record<string, Record<string, string>>;
for (const [section, entries] of Object.entries(names)) console.log(`${section}: ${Object.keys(entries).length} names`);
