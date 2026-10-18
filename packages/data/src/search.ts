import { GoodKind } from './format.js';
import type { GameData } from './game-data.js';

export interface SearchIndex {
  search(query: string, limit?: number): number[];
}

/** Russian and English keyboard layouts, key for key: a query typed in the wrong layout is retried in the other. */
const RU = 'йцукенгшщзхъфывапролджэячсмитьбю';
const EN = "qwertyuiop[]asdfghjkl;'zxcvbnm,.";
const SWAP = new Map([...RU].flatMap((r, i) => [[r, EN[i]!], [EN[i]!, r]]));
const otherLayout = (q: string) => [...q].map((c) => SWAP.get(c) ?? c).join('');

const SEPARATOR = /[\s:_/(),.#-]+/;
const words = (s: string) => s.split(SEPARATOR).filter(Boolean);

/** At most one edit (substitution, insertion or deletion) apart. */
function oneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

interface Key {
  text: string;
  words: string[];
  /** added to the score: a tag the good is in ranks below the good's own name */
  penalty: number;
}

/**
 * How well one key matches the query words, lower is better; Infinity if some word is missing.
 * Every query word must appear in the key, in any order: as a whole word, a word prefix, a substring,
 * or (with `typos`, words of 4+ letters) a word one typo away.
 */
function score(key: Key, query: string, terms: string[], typos: boolean): number {
  if (key.text === query || key.text.endsWith(`:${query}`)) return 0;
  let total = key.text.startsWith(query) ? 1000 : 3000;
  for (const term of terms) {
    let best = Infinity;
    for (const word of key.words) {
      if (word === term) best = 0;
      else if (word.startsWith(term)) best = Math.min(best, 100);
      else if (word.includes(term)) best = Math.min(best, 400);
      else if (typos && term.length >= 4 && (oneEdit(word, term) || oneEdit(word.slice(0, term.length), term))) best = Math.min(best, 700);
    }
    if (best === Infinity) {
      // a term spanning words, like "steel ingot" typed as "steelin"
      if (!key.text.includes(term)) return Infinity;
      best = 500;
    }
    total += best;
  }
  return total + key.text.length + key.penalty;
}

/**
 * Item and fluid search by name (current locale and English), id or the id of a tag it is in.
 * Query words match in any order and at word starts first; when nothing matches, the query is retried
 * in the other keyboard layout (RU/EN) and then with one typo per word.
 * Ties go to goods that some recipe produces, then to shorter names.
 * Plain scans over ~12k strings take a few milliseconds, so no index structure is needed.
 */
export function buildSearchIndex(data: GameData, englishNames?: (string | null)[]): SearchIndex {
  const goods: number[] = [];
  const keys: Key[][] = [];
  data.goodKinds.forEach((kind, good) => {
    if (kind === GoodKind.Tag) return;
    if (!data.producers[good]!.length && !data.consumers[good]!.length) return;
    goods.push(good);
    const k = new Set([data.goodName(good).toLowerCase(), data.goodIds[good]!.toLowerCase()]);
    const en = englishNames?.[good];
    if (en) k.add(en.toLowerCase());
    const own = [...k].map((text) => ({ text, words: words(text), penalty: 0 }));
    // tags make groups findable by what they are: "circuit hv" finds every HV-tier circuit in #gtceu:circuits/hv
    const tags = (data.memberOf[good] ?? []).map((tag) => data.goodIds[tag]!.toLowerCase()).map((text) => ({ text, words: words(text), penalty: 50 }));
    keys.push([...own, ...tags]);
  });

  const run = (query: string, typos: boolean) => {
    const terms = words(query);
    if (!terms.length) return [];
    const hits: { good: number; score: number }[] = [];
    goods.forEach((good, n) => {
      let best = Infinity;
      for (const key of keys[n]!) best = Math.min(best, score(key, query, terms, typos));
      if (best === Infinity) return;
      if (!data.producers[good]!.length) best += 500;
      hits.push({ good, score: best });
    });
    return hits.sort((a, b) => a.score - b.score);
  };

  return {
    search(query, limit = 50) {
      const q = query.trim().toLowerCase();
      if (!q) return [];
      let hits = run(q, false);
      if (!hits.length && otherLayout(q) !== q) hits = run(otherLayout(q), false);
      if (!hits.length) hits = run(q, true);
      return hits.slice(0, limit).map((h) => h.good);
    },
  };
}
