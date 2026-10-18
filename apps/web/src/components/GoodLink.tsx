import { GoodKind, type GameData } from '@starfoundry/data';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useData } from '../data';

export const goodKey = (data: GameData, good: number) =>
  `${data.goodKinds[good] === GoodKind.Fluid ? 'fluid' : 'item'}:${data.goodIds[good]}`;

export function parseGoodKey(data: GameData, key: string): number | undefined {
  const [kind, ...rest] = key.split(':');
  return data.good(kind === 'fluid' ? GoodKind.Fluid : GoodKind.Item, rest.join(':'));
}

/** tag members shown before "+N" */
const SHOWN = 3;

/** Clickable item or fluid name; a tag shows its members, each opening itself, and "+N" lists the rest. */
export function GoodLink({ good, onSelect }: { good: number; onSelect: (good: number) => void }) {
  const { t } = useTranslation();
  const { data } = useData();
  const [open, setOpen] = useState(false);
  const members = data.tags.get(good);
  if (!members) return <Link good={good} onSelect={onSelect} />;
  const shown = open ? members : members.slice(0, SHOWN);
  return (
    <span className="tag-members" title={data.goodIds[good]}>
      {shown.map((m, n) => (
        <span key={m}>
          {n > 0 && ' / '}
          <Link good={m} onSelect={onSelect} />
        </span>
      ))}
      {members.length > SHOWN && (
        <button type="button" className="link more" onClick={() => setOpen(!open)} title={open ? undefined : members.slice(SHOWN).map((m) => data.goodName(m)).join('\n')}>
          {open ? t('tag.less') : `+${members.length - SHOWN}`}
        </button>
      )}
    </span>
  );
}

function Link({ good, onSelect }: { good: number; onSelect: (good: number) => void }) {
  const { data } = useData();
  return (
    <a
      href={`#item=${encodeURIComponent(goodKey(data, good))}`}
      className={data.isFluid(good) ? 'good fluid' : 'good'}
      title={data.goodIds[good]}
      onClick={(e) => {
        e.preventDefault();
        onSelect(good);
      }}
    >
      {data.goodName(good)}
    </a>
  );
}
