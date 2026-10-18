import { useEffect, useState } from 'react';

const read = () => new URLSearchParams(location.hash.slice(1));

/**
 * App state that belongs in links (selected item, view, plan targets) lives in the URL hash,
 * so links can be shared and back/forward works.
 */
export function useHash(): [URLSearchParams, (changes: Record<string, string | undefined>) => void] {
  const [params, setParams] = useState(read);
  useEffect(() => {
    const onChange = () => setParams(read());
    addEventListener('hashchange', onChange);
    return () => removeEventListener('hashchange', onChange);
  }, []);
  const update = (changes: Record<string, string | undefined>) => {
    const next = read();
    for (const [k, v] of Object.entries(changes)) {
      if (v === undefined) next.delete(k);
      else next.set(k, v);
    }
    location.hash = next.toString();
  };
  return [params, update];
}
