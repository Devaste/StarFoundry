import type { Recipe, Stack } from '@starfoundry/data';
import { useTranslation } from 'react-i18next';
import { useData } from '../data';
import { formatEu, formatNumber, formatPercent, formatSeconds, tierName } from '../format';
import { GoodLink } from './GoodLink';

/** Recipe card (SPEC §3): machine, tier, EU/t, duration, inputs/outputs with chances, conditions. */
export function RecipeCard({ recipe, onSelect }: { recipe: Recipe; onSelect: (good: number) => void }) {
  const { t } = useTranslation();
  const { data } = useData();
  const { extra } = recipe;
  const generator = recipe.eut < 0;

  const stack = (s: Stack, n: number, output: boolean) => {
    const range = output ? extra.range?.[n] : undefined;
    const amount = range ? `${range[0]}–${range[1]}` : formatNumber(s.amount);
    return (
      <li key={n}>
        <span className="amount">{data.isFluid(s.good) ? `${amount} mB` : `${amount}×`}</span>{' '}
        <GoodLink good={s.good} onSelect={onSelect} />
        {s.chance < 1 && (
          <span className="chance">
            {' '}
            {formatPercent(s.chance)}
            {s.boostPerTier > 0 && ` (+${formatPercent(s.boostPerTier)}/${t('recipe.tier')})`}
          </span>
        )}
      </li>
    );
  };

  return (
    <article className="recipe">
      <header>
        <strong>{data.recipeTypeName(recipe.type)}</strong>
        <span className="tier">{tierName(recipe.tier)}</span>
        <span>
          {formatEu(Math.abs(recipe.eut))} EU/t{generator && ` ${t('recipe.generated')}`}
        </span>
        <span>{formatSeconds(recipe.durationTicks)}</span>
        {extra.cwu !== undefined && <span>{formatNumber(extra.cwu)} CWU/t</span>}
      </header>
      <div className="flows">
        <ul>{recipe.inputs.map((s, n) => stack(s, n, false))}</ul>
        <span className="arrow">→</span>
        <ul>{recipe.outputs.map((s, n) => stack(s, n, true))}</ul>
      </div>
      {(extra.circuit !== undefined || extra.keep || extra.cond || extra.data) && (
        <footer>
          {extra.circuit !== undefined && <span>{t('recipe.circuit', { n: extra.circuit })}</span>}
          {extra.keep && (
            <span>
              {t('recipe.notConsumed')}:{' '}
              {extra.keep.map(([g], n) => (
                <span key={n}>
                  {n > 0 && ', '}
                  <GoodLink good={g} onSelect={onSelect} />
                </span>
              ))}
            </span>
          )}
          {extra.cond?.map((c) => <span key={c} className="cond">{c}</span>)}
          {extra.data && <span className="data">{Object.entries(extra.data).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ')}</span>}
        </footer>
      )}
      <small className="id">{recipe.id}</small>
    </article>
  );
}
