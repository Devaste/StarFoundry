import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { goodKey, parseGoodKey } from './components/GoodLink';
import { ItemSearch } from './components/ItemSearch';
import { ItemView } from './components/ItemView';
import { DataContext, useLoadData } from './data';
import { LANGUAGES } from './i18n';
import { useHashParam } from './route';
import { RATE_UNITS, type RateUnit } from './units';

export function App() {
  const { t, i18n } = useTranslation();
  const [unit, setUnit] = useState<RateUnit>('s');
  const { loaded, error } = useLoadData(i18n.language);
  const [itemKey, setItemKey] = useHashParam('item');
  const selected = loaded && itemKey ? parseGoodKey(loaded.data, itemKey) : undefined;
  const select = (good: number) => loaded && setItemKey(goodKey(loaded.data, good));

  return (
    <div className="app">
      <header className="topbar">
        <h1>{t('title')}</h1>
        <span className="muted">{t('tagline')}</span>
        <span className="spacer" />
        <label>
          {t('unit')}{' '}
          <select value={unit} onChange={(e) => setUnit(e.target.value as RateUnit)}>
            {(Object.keys(RATE_UNITS) as RateUnit[]).map((u) => (
              <option key={u} value={u}>{t(`units.${u}`)}</option>
            ))}
          </select>
        </label>
        <label>
          {t('language')}{' '}
          <select value={i18n.language} onChange={(e) => void i18n.changeLanguage(e.target.value)}>
            {LANGUAGES.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
          </select>
        </label>
      </header>
      {error && <p className="error">{t('loadError')}: {error}</p>}
      {!loaded && !error && <p className="muted">{t('loading')}</p>}
      {loaded && (
        <DataContext.Provider value={loaded}>
          <div className="columns">
            <aside>
              <ItemSearch onSelect={select} />
            </aside>
            <main>
              {selected !== undefined ? (
                <ItemView good={selected} onSelect={select} />
              ) : (
                <p className="muted">{t('item.pick', { recipes: loaded.data.recipes.length.toLocaleString() })}</p>
              )}
            </main>
          </div>
        </DataContext.Provider>
      )}
    </div>
  );
}
