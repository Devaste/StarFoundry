import { optimizePlan, type EffectiveRecipe, type Optimization, type PlanScore } from '@starfoundry/solver';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useData } from '../data';
import { formatEu, formatNumber, formatPercent, tierName } from '../format';
import { planRequest, solveInWorker, useDefaultRaw } from '../plan';
import { lockRecipe, usePlanActions } from '../planActions';
import { formatRate, useUnit } from '../units';

/**
 * Optimize (perfect ratio) for the built line: better machine setups, the rates at which every machine runs
 * full time, and other recipes that would make the line take less or leave less.
 */
export function OptimizePanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { data } = useData();
  const unit = useUnit();
  const actions = usePlanActions();
  const { state } = actions;
  const raw = useDefaultRaw(data);
  const [result, setResult] = useState<Optimization>();
  const [error, setError] = useState<string>();
  const [progress, setProgress] = useState(0);

  const key = JSON.stringify(state);
  useEffect(() => {
    let cancelled = false;
    setResult(undefined);
    setError(undefined);
    optimizePlan(data, planRequest(state, raw), solveInWorker, (done, total) => !cancelled && setProgress(done / total)).then(
      (r) => !cancelled && setResult(r),
      (e: unknown) => !cancelled && setError(String(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [data, raw, key]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [onClose]);

  const setup = (e: EffectiveRecipe) =>
    [e.machine !== undefined ? data.machineName(e.machine) : '', e.multiblock && tierName(e.machineTier), e.coil].filter(Boolean).join(', ');
  const perSecond = (x: number) => formatRate(x, unit, false);
  const rows: [string, (s: PlanScore) => string][] = [
    [t('optimize.inputs'), (s) => perSecond(s.inputs)],
    [t('optimize.byproducts'), (s) => perSecond(s.byproducts)],
    [t('optimize.machines'), (s) => formatNumber(s.machines)],
    [t('optimize.power'), (s) => `${formatEu(s.eut)} EU/t`],
  ];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal optimize" role="dialog" aria-label={t('optimize.title')} onClick={(e) => e.stopPropagation()}>
        <header>
          <h3>{t('optimize.title')}</h3>
          <button type="button" className="remove" onClick={onClose} title={t('picker.close')}>×</button>
        </header>
        <p className="muted">{t('optimize.help')}</p>
        {error && <p className="error">{error}</p>}
        {!result && !error && <p className="muted">{t('optimize.running', { n: Math.round(progress * 100) })}</p>}
        {result && (
          <div className="optimize-body">
            <table className="score">
              <thead><tr><th /><th>{t('optimize.before')}</th><th>{t('optimize.after')}</th></tr></thead>
              <tbody>
                {rows.map(([label, show]) => (
                  <tr key={label}>
                    <td>{label}</td>
                    <td>{show(result.before)}</td>
                    <td className={show(result.before) === show(result.after) ? '' : 'changed'}>{show(result.after)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h4>{t('optimize.setups')}</h4>
            {result.changes.length === 0 ? (
              <p className="muted">{t('optimize.noSetups')}</p>
            ) : (
              <>
                <ul className="changes">
                  {result.changes.map((c) => (
                    <li key={c.recipe}>
                      <strong>{data.recipeTypeName(c.to.recipe.type)}</strong>: {setup(c.from)} → <strong>{setup(c.to)}</strong>
                    </li>
                  ))}
                </ul>
                <button type="button" className="primary" onClick={() => actions.setState({ ...state, configs: result.configs })}>
                  {t('optimize.apply')}
                </button>
              </>
            )}

            <h4>{t('optimize.ratio')}</h4>
            {result.rates[0] && result.rates[0].utilization >= 1 - 1e-6 ? (
              <p className="muted">{t('optimize.perfect')}</p>
            ) : (
              <>
                <p className="muted">{t('optimize.ratioHelp')}</p>
                <ul className="changes">
                  {result.rates.map((r) => (
                    <li key={r.scale}>
                      {state.targets.map((x) => `${formatRate(x.rate * r.scale, unit, data.isFluid(x.good))} ${data.goodName(x.good)}`).join(', ')}
                      {' — '}
                      {t('optimize.busy', { busy: formatPercent(r.utilization), n: r.machines })}
                      {r.scale !== 1 && (
                        <button
                          type="button"
                          className="small"
                          onClick={() => actions.setState({ ...state, configs: result.configs, targets: state.targets.map((x) => ({ ...x, rate: x.rate * r.scale })) })}
                        >
                          {t('optimize.useRate')}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}

            <h4>{t('optimize.alternatives')}</h4>
            {result.alternatives.length === 0 ? (
              <p className="muted">{t('optimize.noAlternatives')}</p>
            ) : (
              <ul className="changes">
                {result.alternatives.slice(0, 8).map((a) => {
                  const recipe = data.recipe(a.recipe)!;
                  return (
                    <li key={`${a.good}>${a.recipe}`}>
                      <strong>{data.goodName(a.good)}</strong> ← {data.recipeTypeName(recipe.type)} <span className="tier">{tierName(recipe.tier)}</span>
                      {' — '}
                      {rows.map(([label, show]) => (show(a.score) === show(result.after) ? null : <span key={label} className="delta">{label}: {show(a.score)} </span>))}
                      <button type="button" className="small" onClick={() => lockRecipe(actions, a.good, a.recipe)}>{t('optimize.use')}</button>
                      <br /><small className="id">{a.recipe}</small>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
