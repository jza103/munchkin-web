// Placeholder card art: a deterministic colour band per card, with its emoji.
import { baseId, cardOf } from '../engine/cards';
import type { CardId } from '../engine/types';

export function artStyle(card: CardId): string {
  const id = baseId(card);
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const c = cardOf(card);
  const base = { monster: 0, curse: 280, enhancer: 20, race: 140, class: 200, item: 40, oneShot: 170, other: 260 }[c.kind];
  const hue = (base + (h % 50) - 25 + 360) % 360;
  return `background: linear-gradient(135deg, hsl(${hue} 55% 45%), hsl(${(hue + 40) % 360} 60% 30%));`;
}
