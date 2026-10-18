import type { ProductionSolution } from '@starfoundry/solver';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LANGUAGES } from './i18n';
import { RATE_UNITS, toDisplay, type RateUnit } from './units';

const demoProblem = {
  recipes: [
    { id: 'ingot', inputs: { dust: 1 }, outputs: { ingot: 1 } },
    { id: 'plate', inputs: { ingot: 3 }, outputs: { plate: 2 } },
  ],
  targets: { plate: 4 },
  raw: { dust: 1 },
};

export function App() {
  const { t, i18n } = useTranslation();
  const [unit, setUnit] = useState<RateUnit>('s');
  const [solution, setSolution] = useState<ProductionSolution>();

  useEffect(() => {
    const worker = new Worker(new URL('./solver.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<ProductionSolution>) => setSolution(e.data);
    worker.postMessage(demoProblem);
    return () => worker.terminate();
  }, []);

  return (
    <main>
      <header>
        <h1>{t('title')}</h1>
        <p>{t('tagline')}</p>
        <label>
          {t('unit')}{' '}
          <select value={unit} onChange={(e) => setUnit(e.target.value as RateUnit)}>
            {(Object.keys(RATE_UNITS) as RateUnit[]).map((u) => (
              <option key={u} value={u}>{t(`units.${u}`)}</option>
            ))}
          </select>
        </label>{' '}
        <label>
          {t('language')}{' '}
          <select value={i18n.language} onChange={(e) => void i18n.changeLanguage(e.target.value)}>
            {LANGUAGES.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
          </select>
        </label>
      </header>
      {solution?.status === 'Optimal' && (
        <p>
          {t('demo', {
            plates: toDisplay(demoProblem.targets.plate, unit),
            dust: toDisplay(solution.imports.dust ?? 0, unit),
            unit,
          })}
        </p>
      )}
    </main>
  );
}
