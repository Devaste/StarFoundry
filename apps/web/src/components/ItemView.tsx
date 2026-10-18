import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useData } from '../data';
import { RecipeCard } from './RecipeCard';

const PAGE = 20;

function RecipeList({ title, recipes, onSelect }: { title: string; recipes: number[]; onSelect: (good: number) => void }) {
  const { t } = useTranslation();
  const { data } = useData();
  const [shown, setShown] = useState(PAGE);
  return (
    <section>
      <h3>
        {title} <span className="muted">({recipes.length})</span>
      </h3>
      {recipes.slice(0, shown).map((r) => (
        <RecipeCard key={r} recipe={data.recipes[r]!} onSelect={onSelect} />
      ))}
      {recipes.length > shown && (
        <button type="button" onClick={() => setShown(shown + PAGE * 5)}>
          {t('item.more', { n: recipes.length - shown })}
        </button>
      )}
    </section>
  );
}

/** One item or fluid: its producer recipes and where it is used. */
export function ItemView({ good, onSelect, onAddTarget }: {
  good: number;
  onSelect: (good: number) => void;
  onAddTarget: (good: number) => void;
}) {
  const { t } = useTranslation();
  const { data } = useData();
  return (
    <div className="item-view">
      <h2>
        {data.goodName(good)} <small className="muted">{data.goodIds[good]}</small>
      </h2>
      {data.producers[good]!.length > 0 && (
        <button type="button" className="primary" onClick={() => onAddTarget(good)}>{t('item.addTarget')}</button>
      )}
      <RecipeList key={`p${good}`} title={t('item.producedBy')} recipes={data.producers[good]!} onSelect={onSelect} />
      <RecipeList key={`c${good}`} title={t('item.usedIn')} recipes={data.consumers[good]!} onSelect={onSelect} />
    </div>
  );
}
