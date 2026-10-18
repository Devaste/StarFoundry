import type { ReactNode } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useData } from '../data';
import { usePlanActions } from '../planActions';
import { RecipeCard } from './RecipeCard';

const PAGE = 20;

function RecipeList({ title, recipes, onSelect, actions, extra }: {
  title: string;
  recipes: number[];
  onSelect: (good: number) => void;
  actions?: (recipe: number) => ReactNode;
  extra?: ReactNode;
}) {
  const { t } = useTranslation();
  const { data } = useData();
  const [shown, setShown] = useState(PAGE);
  return (
    <section>
      <h3>
        {title} <span className="muted">({recipes.length})</span> {extra}
      </h3>
      {recipes.slice(0, shown).map((r) => (
        <RecipeCard key={r} recipe={data.recipes[r]!} onSelect={onSelect} actions={actions?.(r)} />
      ))}
      {recipes.length > shown && (
        <button type="button" onClick={() => setShown(shown + PAGE * 5)}>
          {t('item.more', { n: recipes.length - shown })}
        </button>
      )}
    </section>
  );
}

/** One item or fluid: its producer recipes, each of which can start a plan for it, and where it is used. */
export function ItemView({ good, onSelect, onAddTarget }: {
  good: number;
  onSelect: (good: number) => void;
  onAddTarget: (good: number, recipe?: string) => void;
}) {
  const { t } = useTranslation();
  const { data } = useData();
  const { state } = usePlanActions();
  const targeted = state.targets.some((x) => x.good === good);
  const producers = data.producers[good]!;
  return (
    <div className="item-view">
      <h2>
        {data.goodName(good)} <small className="muted">{data.goodIds[good]}</small>
      </h2>
      {producers.length > 0 && <p className="muted">{t('item.planHelp')}</p>}
      <RecipeList
        key={`p${good}`}
        title={t('item.producedBy')}
        recipes={producers}
        onSelect={onSelect}
        extra={producers.length > 0 && (
          <button type="button" className="small" onClick={() => onAddTarget(good)}>{t(targeted ? 'item.inPlanAuto' : 'item.planAuto')}</button>
        )}
        actions={(r) => {
          const recipe = data.recipes[r]!;
          if (recipe.eut < 0) return undefined;
          const picked = targeted && state.locks[good] === recipe.id;
          return picked
            ? <span className="badge locked">{t('item.picked')}</span>
            : <button type="button" className="primary small" onClick={() => onAddTarget(good, recipe.id)}>{t('item.planWith')}</button>;
        }}
      />
      <RecipeList key={`c${good}`} title={t('item.usedIn')} recipes={data.consumers[good]!} onSelect={onSelect} />
    </div>
  );
}
