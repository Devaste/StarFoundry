import { TIER_NAMES } from '@starfoundry/mechanics';
import { useTranslation } from 'react-i18next';
import { useData } from '../data';
import type { PlanState } from '../plan';
import { fromDisplay, toDisplay, useUnit } from '../units';

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
      <label>
        {t('plan.maxTier')}{' '}
        <select value={state.maxTier} onChange={(e) => onChange({ ...state, maxTier: Number(e.target.value) })}>
          {TIER_NAMES.map((name, tier) => <option key={name} value={tier}>{name}</option>)}
        </select>
      </label>
    </section>
  );
}
