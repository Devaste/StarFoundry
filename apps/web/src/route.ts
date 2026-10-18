import { useEffect, useState } from 'react';

/** Selected good in the URL hash (#item=<kind>:<id>), so links and back/forward work. */
export function useHashParam(name: string): [string | undefined, (value: string | undefined) => void] {
  const read = () => new URLSearchParams(location.hash.slice(1)).get(name) ?? undefined;
  const [value, setValue] = useState(read);
  useEffect(() => {
    const onChange = () => setValue(read());
    addEventListener('hashchange', onChange);
    return () => removeEventListener('hashchange', onChange);
  });
  const set = (next: string | undefined) => {
    const params = new URLSearchParams(location.hash.slice(1));
    if (next === undefined) params.delete(name);
    else params.set(name, next);
    location.hash = params.toString();
  };
  return [value, set];
}
