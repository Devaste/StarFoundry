import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useData } from '../data';

export function ItemSearch({ onSelect }: { onSelect: (good: number) => void }) {
  const { t } = useTranslation();
  const { data, search } = useData();
  const [query, setQuery] = useState('');
  const results = useMemo(() => search.search(query, 60), [search, query]);

  return (
    <section className="search">
      <input
        type="search"
        autoFocus
        placeholder={t('search.placeholder')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <ul>
        {results.map((good) => (
          <li key={good}>
            <button type="button" onClick={() => onSelect(good)} title={data.goodIds[good]}>
              <span className={data.isFluid(good) ? 'good fluid' : 'good'}>{data.goodName(good)}</span>
              <small>{data.goodIds[good]}</small>
            </button>
          </li>
        ))}
      </ul>
      {query.trim() && !results.length && <p className="muted">{t('search.none')}</p>}
    </section>
  );
}
