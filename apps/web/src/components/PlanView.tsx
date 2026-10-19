import { IMPORT_KINDS, type Plan, type PlanNode } from '@starfoundry/solver';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useData } from '../data';
import { formatEu, formatNumber, tierName } from '../format';
import type { Target } from '../plan';
import { formatRate, useUnit } from '../units';
import { toggleBan, toggleRaw, usePlanActions } from '../planActions';
import { GoodLink } from './GoodLink';
import { OptimizePanel } from './OptimizePanel';
import { PlanGraph } from './PlanGraph';

/** rates below this (per second) are LP noise and hidden */
const EPS = 1e-6;

function Amount({ good, perSecond }: { good: number; perSecond: number }) {
  const { data } = useData();
  const unit = useUnit();
  return <span className="amount">{formatRate(perSecond, unit, data.isFluid(good))}</span>;
}

function GoodRates({ title, rates, onSelect }: { title: string; rates: Map<number, number>; onSelect: (good: number) => void }) {
  const rows = [...rates].filter(([, r]) => r > EPS).sort((a, b) => b[1] - a[1]);
  if (!rows.length) return null;
  return (
    <section>
      <h4>{title}</h4>
      <ul className="rates">
        {rows.map(([good, rate]) => (
          <li key={good}>
            <Amount good={good} perSecond={rate} /> <GoodLink good={good} onSelect={onSelect} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Row buttons on an item: pick its recipe, or switch between buying it raw and producing it. */
function ItemActions({ good }: { good: number }) {
  const { t } = useTranslation();
  const { data } = useData();
  const actions = usePlanActions();
  const locked = actions.state.locks[good] !== undefined;
  const raw = actions.raw.has(good);
  const producible = data.producers[good]!.length > 0;
  return (
    <span className="item-actions">
      {locked && <span className="badge locked" title={t('plan.lockedHint')}>{t('picker.status.locked')}</span>}
      {producible && !raw && (
        <button type="button" className="row-action" onClick={() => actions.openPicker(good)}>{t('plan.chooseRecipe')}</button>
      )}
      {producible && (
        <button type="button" className="row-action" onClick={() => toggleRaw(actions, good)}>
          {raw ? t('plan.produce') : t('plan.makeRaw')}
        </button>
      )}
    </span>
  );
}

/** Opens the machine setup of a recipe; marked when the user set one. */
function SetupButton({ recipe }: { recipe: string }) {
  const { t } = useTranslation();
  const actions = usePlanActions();
  const set = actions.state.configs[recipe] !== undefined;
  return (
    <button type="button" className={set ? 'row-action configured' : 'row-action'} title={t('plan.setupHint')} onClick={() => actions.openConfig(recipe)}>
      {t('plan.setup')}
    </button>
  );
}

/** Machine name, tier, coil and what the overclock did (e.g. "2 OC, ×4 parallel"). */
function MachineLabel({ node }: { node: PlanNode }) {
  const { t } = useTranslation();
  const { data } = useData();
  const { config } = node;
  const name = config.machine !== undefined ? data.machineName(config.machine) : data.recipeTypeName(node.recipe.type);
  const hatch = config.hatch && (config.hatch.count > 1 || config.hatch.amps !== 2) && `${config.hatch.count}× ${config.hatch.amps}A`;
  const details = [
    hatch,
    config.ocLevel > 0 && t('plan.oc', { n: config.ocLevel }),
    config.parallels > 1 && t('plan.parallel', { n: config.parallels }),
    config.coil && t('plan.coil', { coil: config.coil }),
  ].filter(Boolean);
  return (
    <span className="machine-label" title={`${data.recipeTypeName(node.recipe.type)} · ${node.recipe.id}`}>
      <strong>{name}</strong> <span className="tier">{tierName(config.machineTier)}</span>
      {details.length > 0 && <span className="muted"> {details.join(', ')}</span>}
      {config.approximate && <span className="badge approx" title={t('setup.approximate')}>≈</span>}
      {config.configError && <span className="badge banned" title={t('plan.configErrorHint')}>{t('plan.configError')}</span>}
    </span>
  );
}

/**
 * Production tree: each needed item expands into the recipe nodes that supply it, scaled to this branch's share,
 * and each recipe into its inputs. Loops stop where a recipe repeats on the path.
 */
function ItemBranch({ plan, good, rate, depth, path, onSelect }: {
  plan: Plan; good: number; rate: number; depth: number; path: number[]; onSelect: (good: number) => void;
}) {
  const { t } = useTranslation();
  const { data } = useData();
  const actions = usePlanActions();
  const [open, setOpen] = useState(depth < 3);
  const producers = (plan.producersOf.get(good) ?? []).filter((p) => p.amount > EPS);
  const produced = producers.reduce((sum, p) => sum + p.amount, 0);
  const imported = IMPORT_KINDS.find((k) => (plan.imports[k].get(good) ?? 0) > EPS);
  const importedAmount = imported ? plan.imports[imported].get(good)! : 0;
  // share of this good's whole supply (made and imported) that this branch consumes
  const share = produced > EPS ? Math.min(1, rate / (produced + importedAmount)) : 0;

  return (
    <li>
      <div className="tree-row">
        {producers.length > 0 ? (
          <button type="button" className="toggle" onClick={() => setOpen(!open)}>{open ? '▾' : '▸'}</button>
        ) : <span className="toggle" />}
        <Amount good={good} perSecond={rate} /> <GoodLink good={good} onSelect={onSelect} />
        {imported && <span className={`badge ${imported}`}>{t(`plan.import.${imported}`)}</span>}
        <ItemActions good={good} />
      </div>
      {open && producers.length > 0 && (
        <ul>
          {producers.filter((p) => p.amount * share > EPS).map(({ node: n }) => {
            const node = plan.nodes[n]!;
            const loop = path.includes(n);
            return (
              <li key={n}>
                <div className="tree-row recipe-row">
                  <span className="toggle" />
                  <MachineLabel node={node} />
                  <span>{t('plan.machines', { n: formatNumber(node.machines * share) })}</span>
                  <span className="muted">{formatEu(node.eut * share)} EU/t</span>
                  {loop && <span className="badge loop">{t('plan.loop')}</span>}
                  <SetupButton recipe={node.recipe.id} />
                  <button type="button" className="row-action" title={t('plan.banRecipe')} onClick={() => toggleBan(actions, node.recipe.id)}>
                    {t('plan.ban')}
                  </button>
                </div>
                {!loop && (
                  <ul>
                    {[...node.inputs].filter(([, amount]) => amount * share > EPS).map(([input, amount]) => (
                      <ItemBranch
                        key={input}
                        plan={plan}
                        good={input}
                        rate={amount * share}
                        depth={depth + 1}
                        path={[...path, n]}
                        onSelect={onSelect}
                      />
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}

export function PlanView({ plan, targets, solving, error, ms, onSelect }: {
  plan?: Plan; targets: Target[]; solving: boolean; error?: string; ms?: number; onSelect: (good: number) => void;
}) {
  const { t } = useTranslation();
  const { data } = useData();
  const [tab, setTab] = useState<'graph' | 'tree' | 'machines'>('graph');
  const [optimizing, setOptimizing] = useState(false);

  if (!targets.length) return <p className="muted">{t('plan.empty')}</p>;
  if (error) return <p className="error">{error}</p>;
  if (!plan) return <p className="muted">{t('plan.solving')}</p>;
  if (plan.status !== 'Optimal') return <p className="error">{t('plan.failed', { status: plan.status })}</p>;

  const machines = plan.nodes.reduce((sum, n) => sum + n.machines, 0);
  const byTier = new Map<number, number>();
  for (const n of plan.nodes) byTier.set(n.config.machineTier, (byTier.get(n.config.machineTier) ?? 0) + n.eut);

  return (
    <div className={solving ? 'plan solving' : 'plan'}>
      <div className="summary">
        <div><span className="muted">{t('plan.power')}</span><strong>{formatEu(plan.totalEut)} EU/t</strong></div>
        <div><span className="muted">{t('plan.machineTotal')}</span><strong>{formatNumber(Math.round(machines * 10) / 10)}</strong></div>
        <div><span className="muted">{t('plan.recipes')}</span><strong>{plan.nodes.length}</strong></div>
        <div className="by-tier">
          {[...byTier].filter(([, eut]) => eut >= 0.05).sort((a, b) => a[0] - b[0]).map(([tier, eut]) => (
            <span key={tier}><span className="tier">{tierName(tier)}</span> {formatEu(eut)}</span>
          ))}
        </div>
        {ms !== undefined && <small className="muted">{t('plan.solvedIn', { ms })}</small>}
        <button type="button" className="primary optimize-button" onClick={() => setOptimizing(true)}>{t('optimize.button')}</button>
      </div>
      {optimizing && <OptimizePanel onClose={() => setOptimizing(false)} />}
      {plan.unreachable.length > 0 && (
        <p className="error">{t('plan.unreachable', { names: plan.unreachable.map((g) => data.goodName(g)).join(', ') })}</p>
      )}
      <p className="muted note">{t('plan.baseNote')}</p>
      <div className="plan-grid">
        <div>
          <div className="tabs">
            <button type="button" className={tab === 'graph' ? 'active' : ''} onClick={() => setTab('graph')}>{t('plan.graph')}</button>
            <button type="button" className={tab === 'tree' ? 'active' : ''} onClick={() => setTab('tree')}>{t('plan.tree')}</button>
            <button type="button" className={tab === 'machines' ? 'active' : ''} onClick={() => setTab('machines')}>{t('plan.table')}</button>
          </div>
          {tab === 'graph' ? (
            <PlanGraph plan={plan} targets={targets} onSelect={onSelect} />
          ) : tab === 'tree' ? (
            <ul className="tree">
              {targets.map((target) => (
                <ItemBranch key={target.good} plan={plan} good={target.good} rate={target.rate} depth={0} path={[]} onSelect={onSelect} />
              ))}
            </ul>
          ) : (
            <table className="machines">
              <thead>
                <tr>
                  <th>{t('plan.machine')}</th><th>{t('plan.machineCol')}</th><th>EU/t</th><th>{t('plan.outputs')}</th>
                </tr>
              </thead>
              <tbody>
                {plan.nodes.filter((n) => n.machines > EPS).map((node) => (
                  <tr key={node.recipe.id} title={node.recipe.id}>
                    <td><MachineLabel node={node} /> <SetupButton recipe={node.recipe.id} /></td>
                    <td className="num">{formatNumber(Math.round(node.machines * 100) / 100)} <span className="muted">({Math.ceil(node.machines - 1e-6)})</span></td>
                    <td className="num">{formatEu(node.eut)}</td>
                    <td>
                      {[...node.outputs].map(([good, rate], i) => (
                        <span key={good}>{i > 0 && ', '}<Amount good={good} perSecond={rate} /> <GoodLink good={good} onSelect={onSelect} /></span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <aside className="flows-side">
          <GoodRates title={t('plan.leaves')} rates={plan.imports.leaf} onSelect={onSelect} />
          <GoodRates title={t('plan.raw')} rates={plan.imports.raw} onSelect={onSelect} />
          <GoodRates title={t('plan.sources')} rates={plan.imports.source} onSelect={onSelect} />
          <GoodRates title={t('plan.imported')} rates={plan.imports.producible} onSelect={onSelect} />
          <GoodRates title={t('plan.byproducts')} rates={plan.byproducts} onSelect={onSelect} />
        </aside>
      </div>
    </div>
  );
}
