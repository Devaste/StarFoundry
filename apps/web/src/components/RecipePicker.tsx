import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useData } from '../data';
import { lockRecipe, toggleBan, usePlanActions } from '../planActions';
import { RecipeCard } from './RecipeCard';

/** Producer recipes of one good, to lock one for the plan or ban some (SPEC §2.1 item 2). */
export function RecipePicker({ good, onClose, onSelect }: { good: number; onClose: () => void; onSelect: (good: number) => void }) {
  const { t } = useTranslation();
  const { data } = useData();
  const actions = usePlanActions();
  const { state } = actions;
  const locked = state.locks[good];
  const recipes = data.producers[good]!.map((r) => data.recipes[r]!).filter((r) => r.eut >= 0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-label={t('picker.title', { name: data.goodName(good) })} onClick={(e) => e.stopPropagation()}>
        <header>
          <h3>{t('picker.title', { name: data.goodName(good) })}</h3>
          <button type="button" className="remove" onClick={onClose} title={t('picker.close')}>×</button>
        </header>
        <p className="muted">{t('picker.help')}</p>
        {locked && (
          <button type="button" onClick={() => lockRecipe(actions, good, undefined)}>{state.manual ? t('picker.unexpand') : t('picker.auto')}</button>
        )}
        <div className="picker-list">
          {recipes.map((r) => {
            const banned = state.bans.includes(r.id);
            const status = locked === r.id ? 'locked' : banned ? 'banned' : actions.active.has(r.id) ? 'active' : r.tier > state.maxTier ? 'aboveTier' : undefined;
            return (
              <div key={r.id} className={`picker-item ${status ?? ''}`}>
                <RecipeCard
                  recipe={r}
                  onSelect={(g) => {
                    onClose();
                    onSelect(g);
                  }}
                  actions={
                    <>
                      {status && <span className={`badge ${status}`}>{t(`picker.status.${status}`)}</span>}
                      {locked !== r.id && (
                        <button type="button" onClick={() => { lockRecipe(actions, good, r.id); onClose(); }}>{t('picker.use')}</button>
                      )}
                      <button type="button" onClick={() => toggleBan(actions, r.id)}>{banned ? t('picker.unban') : t('picker.ban')}</button>
                    </>
                  }
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
