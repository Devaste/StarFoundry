import { GoodKind } from './format.js';
import type { GameData } from './game-data.js';

export interface SearchIndex {
  search(query: string, limit?: number): number[];
}

/**
 * Item and fluid search by name (current locale and English) or id.
 * Plain scans over ~12k strings take well under a millisecond, so no index structure is needed.
 * Ranking: exact name, name prefix, word prefix, substring; then goods that some recipe produces,
 * then shorter names.
 */
export function buildSearchIndex(data: GameData, englishNames?: (string | null)[]): SearchIndex {
  const goods: number[] = [];
  const keys: string[][] = [];
  data.goodKinds.forEach((kind, good) => {
    if (kind === GoodKind.Tag) return;
    if (!data.producers[good]!.length && !data.consumers[good]!.length) return;
    goods.push(good);
    const k = new Set([data.goodName(good).toLowerCase(), data.goodIds[good]!.toLowerCase()]);
    const en = englishNames?.[good];
    if (en) k.add(en.toLowerCase());
    keys.push([...k]);
  });

  return {
    search(query, limit = 50) {
      const q = query.trim().toLowerCase();
      if (!q) return [];
      const hits: { good: number; score: number }[] = [];
      goods.forEach((good, n) => {
        let best = Infinity;
        for (const key of keys[n]!) {
          const at = key.indexOf(q);
          if (at < 0) continue;
          const score = key === q || key.endsWith(`:${q}`) ? 0 : at === 0 ? 1 : /[\s:_/(-]/.test(key[at - 1]!) ? 2 : 3;
          best = Math.min(best, score * 1000 + key.length);
        }
        if (best === Infinity) return;
        if (!data.producers[good]!.length) best += 500;
        hits.push({ good, score: best });
      });
      hits.sort((a, b) => a.score - b.score);
      return hits.slice(0, limit).map((h) => h.good);
    },
  };
}
