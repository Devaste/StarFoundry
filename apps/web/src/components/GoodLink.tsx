import { GoodKind, type GameData } from '@starfoundry/data';
import { useData } from '../data';

export const goodKey = (data: GameData, good: number) =>
  `${data.goodKinds[good] === GoodKind.Fluid ? 'fluid' : 'item'}:${data.goodIds[good]}`;

export function parseGoodKey(data: GameData, key: string): number | undefined {
  const [kind, ...rest] = key.split(':');
  return data.good(kind === 'fluid' ? GoodKind.Fluid : GoodKind.Item, rest.join(':'));
}

/** Clickable item or fluid name; tags link to their first member. */
export function GoodLink({ good, onSelect }: { good: number; onSelect: (good: number) => void }) {
  const { data } = useData();
  const members = data.tags.get(good);
  const target = members?.[0] ?? good;
  return (
    <a
      href={`#item=${encodeURIComponent(goodKey(data, target))}`}
      className={data.isFluid(good) ? 'good fluid' : 'good'}
      title={members ? members.map((m) => data.goodName(m)).join('\n') : data.goodIds[good]}
      onClick={(e) => {
        e.preventDefault();
        onSelect(target);
      }}
    >
      {data.goodName(good)}
    </a>
  );
}
