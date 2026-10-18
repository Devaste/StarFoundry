import { TIER_NAMES } from '@starfoundry/mechanics';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useData } from '../data';
import type { PlanState } from '../plan';
import { fromDisplay, toDisplay, useUnit } from '../units';
import { GoodLink } from './GoodLink';

/** Left column of the planner: production targets and progression settings. */
export function Targets({ state, onChange, onSelect }: {
  state: PlanState;
  onChange: (state: PlanState) => void;
  onSelect: (good: number) => void;
}) {
  const { t } = useTranslation();
  const { data } = useData();
  const unit = useUnit();
  const setRate = (n: number, value: number) =>
    onChange({ ...state, targets: state.targets.map((x, i) => (i === n ? { ...x, rate: fromDisplay(value, unit) } : x)) });

  return (
    <section className="targets">
      <h3>{t('plan.targets')}</h3>
      {!state.targets.length && <p className="muted">{t('plan.noTargets')}</p>}
      <ul>
        {state.targets.map((target, n) => (
          <li key={target.good}>
            <button type="button" className="link" onClick={() => onSelect(target.good)}>
              <span className={data.isFluid(target.good) ? 'good fluid' : 'good'}>{data.goodName(target.good)}</span>
            </button>
            <span className="rate-input">
              <input
                type="number"
                min="0"
                step="any"
                value={Number(toDisplay(target.rate, unit).toPrecision(6))}
                onChange={(e) => Number(e.target.value) > 0 && setRate(n, Number(e.target.value))}
              />
              {data.isFluid(target.good) ? ` mB/${unit}` : `/${unit}`}
            </span>
            <button
              type="button"
              className="remove"
              title={t('plan.remove')}
              onClick={() => onChange({ ...state, targets: state.targets.filter((_, i) => i !== n) })}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <Adjustments state={state} onChange={onChange} onSelect={onSelect} />
      <label>
        {t('plan.maxTier')}{' '}
        <select value={state.maxTier} onChange={(e) => onChange({ ...state, maxTier: Number(e.target.value) })}>
          {TIER_NAMES.map((name, tier) => <option key={name} value={tier}>{name}</option>)}
        </select>
      </label>
    </section>
  );
}

/** The user's recipe locks, bans and raw resource changes, each removable. */
function Adjustments({ state, onChange, onSelect }: {
  state: PlanState;
  onChange: (state: PlanState) => void;
  onSelect: (good: number) => void;
}) {
  const { t } = useTranslation();
  const { data } = useData();
  const rows: { key: string; label: ReactNode; remove: () => void }[] = [];
  const recipeLabel = (id: string) => {
    const r = data.recipe(id);
    return r ? `${data.recipeTypeName(r.type)} (${id.split('/').pop()})` : id;
  };
  for (const [good, recipe] of Object.entries(state.locks)) {
    const g = Number(good);
    const locks = { ...state.locks };
    delete locks[g];
    rows.push({
      key: `l${good}`,
      label: <>{t('adjust.lock')}: <GoodLink good={g} onSelect={onSelect} /> ← {recipeLabel(recipe)}</>,
      remove: () => onChange({ ...state, locks }),
    });
  }
  for (const id of state.bans) {
    rows.push({ key: `b${id}`, label: <>{t('adjust.ban')}: {recipeLabel(id)}</>, remove: () => onChange({ ...state, bans: state.bans.filter((b) => b !== id) }) });
  }
  for (const g of state.rawAdd) {
    rows.push({ key: `a${g}`, label: <>{t('adjust.raw')}: <GoodLink good={g} onSelect={onSelect} /></>, remove: () => onChange({ ...state, rawAdd: state.rawAdd.filter((x) => x !== g) }) });
  }
  for (const g of state.rawRemove) {
    rows.push({ key: `r${g}`, label: <>{t('adjust.produce')}: <GoodLink good={g} onSelect={onSelect} /></>, remove: () => onChange({ ...state, rawRemove: state.rawRemove.filter((x) => x !== g) }) });
  }
  if (!rows.length) return null;
  return (
    <div className="adjustments">
      <h4>{t('adjust.title')}</h4>
      <ul>
        {rows.map((row) => (
          <li key={row.key}>
            <span>{row.label}</span>
            <button type="button" className="remove" title={t('plan.remove')} onClick={row.remove}>×</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
