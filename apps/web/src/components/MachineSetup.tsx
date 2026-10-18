import { BULKING_TYPES, COILS, TIER_NAMES, furnaceTemperature } from '@starfoundry/mechanics';
import { effectiveRecipe, machineFeatures, machineOptions, type MachineConfig } from '@starfoundry/solver';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useData } from '../data';
import { formatEu, formatNumber, formatSeconds, tierName } from '../format';
import { setConfig, usePlanActions } from '../planActions';
import { formatRate, useUnit } from '../units';

/** Energy hatch amperages: normal (2A), 4A and 16A hatches, substation-style 64A, laser hatches. */
const AMPS = [2, 4, 16, 64, 256, 1024, 4096, 16384, 65536];
/** Parallel hatch maximum by tier with StarT's mixin (IV 8 … UIV 4096). */
const PARALLEL_HATCHES: [tier: number, parallel: number][] = [[5, 8], [6, 16], [7, 64], [8, 256], [9, 1024], [10, 2048], [11, 4096]];
const KNOWN_ERRORS = new Set(['unknown_machine', 'wrong_machine', 'insufficient_voltage', 'coil_temperature_too_low']);

/** Machine setup of one recipe in the plan (SPEC §2.1 item 4): machine, energy hatches, parallel hatch, coil, bulking. */
export function MachineSetup({ recipeId, onClose }: { recipeId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const { data } = useData();
  const unit = useUnit();
  const actions = usePlanActions();
  const recipe = data.recipe(recipeId);
  const config = actions.state.configs[recipeId];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!recipe) return null;
  const maxTier = Math.max(actions.state.maxTier, recipe.tier);
  const e = effectiveRecipe(data, recipe, maxTier, config);
  const options = machineOptions(data, recipe);
  const machineId = e?.machine === undefined ? undefined : data.machines[e.machine]!.id;
  const features = machineFeatures(machineId);
  const current: MachineConfig = {
    ...(machineId === undefined ? {} : { machine: machineId }),
    ...(e?.hatch ? { hatch: e.hatch } : {}),
    ...(config?.parallel ? { parallel: config.parallel } : {}),
    ...(config?.coil ? { coil: config.coil } : {}),
    ...(e?.bulking ? { bulking: e.bulking } : {}),
  };
  const change = (patch: { [K in keyof MachineConfig]?: MachineConfig[K] | undefined }) => {
    const next = { ...current, ...patch };
    for (const k of Object.keys(next) as (keyof MachineConfig)[]) if (next[k] === undefined || next[k] === 0) delete next[k];
    setConfig(actions, recipeId, next as MachineConfig);
  };
  const changeMachine = (id: string) => {
    const multiblock = data.machines[data.machineIndex(id)!]!.multiblock;
    setConfig(actions, recipeId, { machine: id, ...(multiblock ? { hatch: e?.hatch ?? { tier: maxTier, amps: 2, count: 1 } } : {}) });
  };
  const hatch = e?.hatch;
  const runsPerSecond = e ? 20 / e.durationTicks : 0;
  const error = e?.configError;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal setup" role="dialog" aria-label={t('setup.title')} onClick={(ev) => ev.stopPropagation()}>
        <header>
          <h3>{t('setup.title')}: {data.recipeTypeName(recipe.type)}</h3>
          <button type="button" className="remove" onClick={onClose} title={t('picker.close')}>×</button>
        </header>
        <p className="muted">{recipe.id}</p>
        {!e ? <p className="error">{t('setup.cannotRun')}</p> : (
          <>
            <div className="setup-grid">
              <label>
                {t('setup.machine')}
                <select value={machineId ?? ''} onChange={(ev) => changeMachine(ev.target.value)}>
                  {options.map((m) => {
                    const info = data.machines[m]!;
                    return <option key={m} value={info.id}>{data.machineName(m)}{info.multiblock ? '' : ` (${tierName(info.tier)})`}</option>;
                  })}
                </select>
              </label>
              {hatch && (
                <fieldset>
                  <legend>{t('setup.hatches')}</legend>
                  <input
                    type="number" min={1} max={64} value={hatch.count} aria-label={t('setup.count')}
                    onChange={(ev) => change({ hatch: { ...hatch, count: Math.max(1, Math.min(64, Math.round(Number(ev.target.value)) || 1)) } })}
                  />
                  <span>×</span>
                  <select value={hatch.amps} aria-label={t('setup.amps')} onChange={(ev) => change({ hatch: { ...hatch, amps: Number(ev.target.value) } })}>
                    {AMPS.map((a) => <option key={a} value={a}>{a}A</option>)}
                  </select>
                  <select value={hatch.tier} aria-label={t('setup.voltage')} onChange={(ev) => change({ hatch: { ...hatch, tier: Number(ev.target.value) } })}>
                    {TIER_NAMES.map((name, tier) => <option key={tier} value={tier}>{name}</option>)}
                  </select>
                </fieldset>
              )}
              {features.parallel && (
                <label>
                  {t('setup.parallel')}
                  <select value={config?.parallel ?? 0} onChange={(ev) => change({ parallel: Number(ev.target.value) })}>
                    <option value={0}>{t('setup.none')}</option>
                    {PARALLEL_HATCHES.map(([tier, p]) => <option key={tier} value={p}>{tierName(tier)} ({p})</option>)}
                  </select>
                </label>
              )}
              {features.coil && (
                <label>
                  {t('setup.coil')}
                  <select value={config?.coil ?? ''} onChange={(ev) => change({ coil: ev.target.value || undefined })}>
                    <option value="">{t('setup.autoCoil', { coil: e.coil ?? '—' })}</option>
                    {Object.keys(COILS).map((c) => (
                      <option key={c} value={c}>{c} ({formatNumber(furnaceTemperature(c, e.machineTier))} K)</option>
                    ))}
                  </select>
                </label>
              )}
              {features.bulking && (
                <label>
                  {t('setup.bulking')}
                  <select value={config?.bulking ?? ''} onChange={(ev) => change({ bulking: ev.target.value || undefined })}>
                    <option value="">{t('setup.none')}</option>
                    {Object.keys(BULKING_TYPES).map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>
                </label>
              )}
            </div>
            {error && <p className="error">{KNOWN_ERRORS.has(error) ? t(`setup.error.${error}`) : error} {t('setup.fallback')}</p>}
            {e.approximate && <p className="muted note">{t('setup.approximate')}</p>}
            <dl className="setup-result">
              <dt>{t('setup.time')}</dt><dd>{formatSeconds(e.durationTicks)}</dd>
              <dt>EU/t</dt><dd>{formatEu(e.eut)} <span className="tier">{tierName(e.machineTier)}</span></dd>
              <dt>{t('setup.parallels')}</dt><dd>×{formatNumber(e.parallels)}{e.ocLevel > 0 && `, ${t('plan.oc', { n: e.ocLevel })}`}</dd>
              <dt>{t('setup.perMachine')}</dt>
              <dd>
                {e.outputs.map((o, i) => (
                  <span key={i}>{i > 0 && ', '}{formatRate(o.amount * runsPerSecond, unit, data.isFluid(o.good))} {data.goodName(o.good)}</span>
                ))}
              </dd>
            </dl>
          </>
        )}
        <div className="setup-actions">
          {config && <button type="button" onClick={() => setConfig(actions, recipeId, undefined)}>{t('setup.reset')}</button>}
          <button type="button" onClick={onClose}>{t('setup.done')}</button>
        </div>
      </div>
    </div>
  );
}
