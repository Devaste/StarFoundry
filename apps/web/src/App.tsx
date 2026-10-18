import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { goodKey, parseGoodKey } from './components/GoodLink';
import { ItemSearch } from './components/ItemSearch';
import { ItemView } from './components/ItemView';
import { PlanView } from './components/PlanView';
import { RecipePicker } from './components/RecipePicker';
import { Targets } from './components/Targets';
import { DataContext, useData, useLoadData } from './data';
import { LANGUAGES } from './i18n';
import { decodePlan, encodePlan, planRaw, useDefaultRaw, useSolvedPlan, type PlanState } from './plan';
import { PlanActionsContext, type PlanActions } from './planActions';
import { useHash } from './route';
import { RATE_UNITS, UnitContext, type RateUnit } from './units';

export function App() {
  const { t, i18n } = useTranslation();
  const [unit, setUnit] = useState<RateUnit>('s');
  const { loaded, error } = useLoadData(i18n.language);

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
          <UnitContext.Provider value={unit}>
            <Planner />
          </UnitContext.Provider>
        </DataContext.Provider>
      )}
    </div>
  );
}

function Planner() {
  const { t } = useTranslation();
  const { data } = useData();
  const [params, update] = useHash();
  const state = decodePlan(data, params);
  const solved = useSolvedPlan(data, state);
  const defaultRaw = useDefaultRaw(data);
  const [picker, setPicker] = useState<number>();
  const itemKey = params.get('item');
  const selected = itemKey ? parseGoodKey(data, itemKey) : undefined;
  const view = params.get('view') === 'item' && selected !== undefined ? 'item' : 'plan';

  const select = (good: number) => update({ item: goodKey(data, good), view: 'item' });
  const setPlan = (next: PlanState) => update(encodePlan(data, next));
  const addTarget = (good: number) => {
    if (!state.targets.some((x) => x.good === good)) {
      const rate = data.isFluid(good) ? 1000 : 1;
      update({ ...encodePlan(data, { ...state, targets: [...state.targets, { good, rate }] }), view: 'plan' });
    } else update({ view: 'plan' });
  };

  const actions: PlanActions = {
    state,
    raw: new Set(planRaw(defaultRaw, state)),
    active: new Set(solved.plan?.nodes.map((n) => n.recipe.id) ?? []),
    setState: setPlan,
    openPicker: setPicker,
  };

  return (
    <PlanActionsContext.Provider value={actions}>
      <div className="columns">
        <aside>
          <Targets state={state} onChange={setPlan} onSelect={select} />
          <ItemSearch onSelect={select} />
        </aside>
        <main>
          <nav className="tabs main-tabs">
            <button type="button" className={view === 'plan' ? 'active' : ''} onClick={() => update({ view: 'plan' })}>
              {t('plan.title')}{solved.solving && ' …'}
            </button>
            {selected !== undefined && (
              <button type="button" className={view === 'item' ? 'active' : ''} onClick={() => update({ view: 'item' })}>
                {data.goodName(selected)}
              </button>
            )}
          </nav>
          {view === 'item' && selected !== undefined ? (
            <ItemView good={selected} onSelect={select} onAddTarget={addTarget} />
          ) : (
            <PlanView {...solved} targets={state.targets} onSelect={select} />
          )}
        </main>
        {picker !== undefined && <RecipePicker good={picker} onClose={() => setPicker(undefined)} onSelect={select} />}
      </div>
    </PlanActionsContext.Provider>
  );
}
