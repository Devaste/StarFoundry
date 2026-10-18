import { GameData, buildSearchIndex, type RawBundle, type RawNames, type SearchIndex } from '@starfoundry/data';
import { createContext, useContext, useEffect, useState } from 'react';

export const DATA_VERSION = 'theta2-hf4';
const dataUrl = (file: string) => `${import.meta.env.BASE_URL}data/${DATA_VERSION}/${file}`;

async function fetchJson<T>(file: string): Promise<T> {
  const res = await fetch(dataUrl(file));
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export interface LoadedData {
  data: GameData;
  search: SearchIndex;
}

const english = fetchJson<RawNames>('names.en.json');
const bundle = Promise.all([fetchJson<RawBundle>('bundle.json'), english]).then(([b, en]) => {
  const data = new GameData(b);
  data.setNames(en);
  return data;
});

/** Loads the bundle once and re-indexes names when the locale changes. */
export function useLoadData(locale: string): { loaded?: LoadedData; error?: string } {
  const [state, setState] = useState<{ loaded?: LoadedData; error?: string }>({});
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [data, en] = await Promise.all([bundle, english]);
      const names = locale === 'en' ? en : await fetchJson<RawNames>(`names.${locale}.json`);
      if (cancelled) return;
      data.setNames(names, en);
      setState({ loaded: { data, search: buildSearchIndex(data, en.goods) } });
    })().catch((e: unknown) => !cancelled && setState({ error: String(e) }));
    return () => {
      cancelled = true;
    };
  }, [locale]);
  return state;
}

export const DataContext = createContext<LoadedData | undefined>(undefined);

export function useData(): LoadedData {
  const loaded = useContext(DataContext);
  if (!loaded) throw new Error('useData outside DataContext');
  return loaded;
}
