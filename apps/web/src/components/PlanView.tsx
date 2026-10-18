import type { Plan } from '@starfoundry/solver';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useData } from '../data';
import { formatEu, formatNumber, tierName } from '../format';
import type { Target } from '../plan';
import { formatRate, useUnit } from '../units';
import { GoodLink } from './GoodLink';

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

/**
 * Production tree: each needed item expands into the recipe nodes that supply it, scaled to this branch's share,
 * and each recipe into its inputs. Loops stop where a recipe repeats on the path.
 */
function ItemBranch({ plan, good, rate, depth, path, onSelect }: {
  plan: Plan; good: number; rate: number; depth: number; path: number[]; onSelect: (good: number) => void;
}) {
  const { t } = useTranslation();
  const { data } = useData();
  const [open, setOpen] = useState(depth < 3);
  const producers = (plan.producersOf.get(good) ?? []).filter((p) => p.amount > EPS);
  const produced = producers.reduce((sum, p) => sum + p.amount, 0);
  const imported = (['raw', 'source', 'producible'] as const).find((k) => (plan.imports[k].get(good) ?? 0) > EPS);
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
                  <strong>{data.recipeTypeName(node.recipe.type)}</strong>
                  <span className="tier">{tierName(node.recipe.tier)}</span>
                  <span>{t('plan.machines', { n: formatNumber(node.machines * share) })}</span>
                  <span className="muted">{formatEu(node.eut * share)} EU/t</span>
                  {loop && <span className="badge loop">{t('plan.loop')}</span>}
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
  const [tab, setTab] = useState<'tree' | 'machines'>('tree');

  if (!targets.length) return <p className="muted">{t('plan.empty')}</p>;
  if (error) return <p className="error">{error}</p>;
  if (!plan) return <p className="muted">{t('plan.solving')}</p>;
  if (plan.status !== 'Optimal') return <p className="error">{t('plan.failed', { status: plan.status })}</p>;

  const machines = plan.nodes.reduce((sum, n) => sum + n.machines, 0);
  const byTier = new Map<number, number>();
  for (const n of plan.nodes) byTier.set(n.recipe.tier, (byTier.get(n.recipe.tier) ?? 0) + n.eut);

  return (
    <div className={solving ? 'plan solving' : 'plan'}>
      <div className="summary">
        <div><span className="muted">{t('plan.power')}</span><strong>{formatEu(plan.totalEut)} EU/t</strong></div>
        <div><span className="muted">{t('plan.machineTotal')}</span><strong>{formatNumber(Math.round(machines * 10) / 10)}</strong></div>
        <div><span className="muted">{t('plan.recipes')}</span><strong>{plan.nodes.length}</strong></div>
        <div className="by-tier">
          {[...byTier].sort((a, b) => a[0] - b[0]).map(([tier, eut]) => (
            <span key={tier}><span className="tier">{tierName(tier)}</span> {formatEu(eut)}</span>
          ))}
        </div>
        {ms !== undefined && <small className="muted">{t('plan.solvedIn', { ms })}</small>}
      </div>
      <p className="muted note">{t('plan.baseNote')}</p>
      <div className="plan-grid">
        <div>
          <div className="tabs">
            <button type="button" className={tab === 'tree' ? 'active' : ''} onClick={() => setTab('tree')}>{t('plan.tree')}</button>
            <button type="button" className={tab === 'machines' ? 'active' : ''} onClick={() => setTab('machines')}>{t('plan.table')}</button>
          </div>
          {tab === 'tree' ? (
            <ul className="tree">
              {targets.map((target) => (
                <ItemBranch key={target.good} plan={plan} good={target.good} rate={target.rate} depth={0} path={[]} onSelect={onSelect} />
              ))}
            </ul>
          ) : (
            <table className="machines">
              <thead>
                <tr>
                  <th>{t('plan.recipe')}</th><th>{t('plan.tier')}</th><th>{t('plan.machineCol')}</th><th>EU/t</th><th>{t('plan.outputs')}</th>
                </tr>
              </thead>
              <tbody>
                {plan.nodes.filter((n) => n.machines > EPS).map((node) => (
                  <tr key={node.recipe.id} title={node.recipe.id}>
                    <td>{data.recipeTypeName(node.recipe.type)}</td>
                    <td className="tier">{tierName(node.recipe.tier)}</td>
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
          <GoodRates title={t('plan.raw')} rates={plan.imports.raw} onSelect={onSelect} />
          <GoodRates title={t('plan.sources')} rates={plan.imports.source} onSelect={onSelect} />
          <GoodRates title={t('plan.imported')} rates={plan.imports.producible} onSelect={onSelect} />
          <GoodRates title={t('plan.byproducts')} rates={plan.byproducts} onSelect={onSelect} />
        </aside>
      </div>
    </div>
  );
}
