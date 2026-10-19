import { exactLine, type EffectiveRecipe, type ExactResult, type MachineConfig, type Optimization } from '@starfoundry/solver';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useData } from '../data';
import { formatEu, formatNumber, formatPercent, tierName } from '../format';
import { planRequest, solveMipInWorker, useDefaultRaw } from '../plan';
import { usePlanActions } from '../planActions';
import { formatRate, useUnit } from '../units';

const LEVELS = [1, 0.99, 0.97, 0.95, 0.9];
/** seconds the integer search may take */
const TIME_LIMIT = 30;

/**
 * The full-time line: whole machines that all work (nearly) all the time, so nothing backs up and nothing
 * starves. Usually needs a bigger line than asked: it is found on demand, as the search takes a while.
 */
export function ExactLine({ result }: { result: Optimization }) {
  const { t } = useTranslation();
  const { data } = useData();
  const unit = useUnit();
  const actions = usePlanActions();
  const { state } = actions;
  const raw = useDefaultRaw(data);
  const [busy, setBusy] = useState(0.99);
  const [found, setFound] = useState<{ busy: number; result: ExactResult }>();
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string>();

  const find = () => {
    setSearching(true);
    setError(undefined);
    const request = planRequest({ ...state, configs: result.configs }, raw);
    exactLine(data, request, result.plan, result.configs, solveMipInWorker, busy, TIME_LIMIT).then(
      (r) => {
        setFound({ busy, result: r });
        setSearching(false);
      },
      (e: unknown) => {
        setError(String(e));
        setSearching(false);
      },
    );
  };

  const line = found?.result.line;
  const limiting = found?.result.limiting;
  const setup = (e: EffectiveRecipe) =>
    [e.machine !== undefined ? data.machineName(e.machine) : '', e.multiblock && tierName(e.machineTier), e.coil].filter(Boolean).join(', ');
  const recipeName = (id: string) => {
    const recipe = data.recipe(id)!;
    const main = recipe.outputs[0];
    return `${data.recipeTypeName(recipe.type)}${main ? ` (${data.goodName(main.good)})` : ''}`;
  };
  const rates = (m: Map<number, number>) =>
    [...m].map(([g, x]) => `${formatRate(x, unit, data.isFluid(g))} ${data.goodName(g)}`).join(', ');

  const apply = () => {
    if (!line) return;
    const configs: Record<string, MachineConfig> = { ...result.configs };
    for (const r of line.recipes) {
      if (r.config) configs[r.recipe] = r.config;
      else delete configs[r.recipe];
    }
    actions.setState({ ...state, configs, targets: state.targets.map((x) => ({ ...x, rate: Number((line.targets.get(x.good) ?? x.rate).toPrecision(9)) })) });
  };

  return (
    <>
      <h4>{t('optimize.exact')}</h4>
      <p className="muted">{t('optimize.exactHelp')}</p>
      <div className="exact-controls">
        <label>
          {t('optimize.busyAt')}{' '}
          <select value={busy} onChange={(e) => setBusy(Number(e.target.value))} disabled={searching}>
            {LEVELS.map((l) => <option key={l} value={l}>{formatPercent(l)}</option>)}
          </select>
        </label>
        <button type="button" className="small" onClick={find} disabled={searching}>
          {searching ? t('optimize.searching', { s: TIME_LIMIT }) : t('optimize.find')}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {found && !searching && (line ? (
        <div className="exact-result">
          <p>
            {t('optimize.exactFound', { busy: formatPercent(found.busy), scale: formatNumber(Math.round(line.scale * 100) / 100), machines: line.machines, eu: formatEu(line.eut) })}
            {!line.optimal && <> {t('optimize.notProven')}</>}
          </p>
          <p><span className="muted">{t('optimize.makes')}</span> {rates(line.targets)}</p>
          <p><span className="muted">{t('optimize.inputs')}:</span> {rates(line.imports)}</p>
          {line.byproducts.size > 0 && <p><span className="muted">{t('optimize.byproducts')}:</span> {rates(line.byproducts)}</p>}
          <ul className="changes">
            {line.recipes.map((r) => (
              <li key={r.recipe}>
                <strong>{recipeName(r.recipe)}</strong>: {r.machines} × {setup(r.setup)} <span className="muted">({formatPercent(r.busy)})</span>
              </li>
            ))}
          </ul>
          <button type="button" className="primary" onClick={apply}>{t('optimize.useLine')}</button>
        </div>
      ) : (
        <p className="muted">
          {t('optimize.exactNone', { busy: formatPercent(found.busy), s: TIME_LIMIT })}
          {limiting && limiting.scale > 1 && <> {t('optimize.exactLimit', { name: recipeName(limiting.recipe), scale: formatNumber(Math.round(limiting.scale * 100) / 100) })}</>}
        </p>
      ))}
    </>
  );
}
