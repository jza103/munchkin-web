// Checks that a state is legal. Used by the seeded bot-game tests.
import { ALL_IDS, cardOf, itemOf } from './cards';
import { allCards } from './state';
import {
  bigInPlay,
  classCards,
  equippedItems,
  isCheated,
  isDwarf,
  maxClasses,
  maxRaces,
  qualifies,
  raceCards,
} from './rules';
import type { GameState } from './types';

export function violations(s: GameState): string[] {
  const out: string[] = [];
  const all = allCards(s);
  if (all.length !== ALL_IDS.length || new Set(all).size !== ALL_IDS.length) out.push(`card count ${all.length}/${new Set(all).size}`);
  const borrowed = s.combat?.borrowed?.card;
  const settling = !!s.pending || s.queue.length > 0;
  for (const id of s.order) {
    const p = s.players[id];
    if (p.level < 1 || p.level > 10) out.push(`${id} level ${p.level}`);
    if (p.level === 10 && !s.winners.includes(id)) out.push(`${id} reached 10 without winning`);
    if (p.curses.some((c) => cardOf(c).kind !== 'curse')) out.push(`${id} non-curse in curses`);
    if (p.equipped.some((c) => !['item', 'race', 'class', 'other'].includes(cardOf(c).kind))) out.push(`${id} bad equipped card`);
    if (p.carried.some((c) => !['item', 'oneShot'].includes(cardOf(c).kind))) out.push(`${id} bad carried card`);
    if (raceCards(p).length > maxRaces(p)) out.push(`${id} too many races`);
    if (classCards(p).length > maxClasses(p)) out.push(`${id} too many classes`);
    const slots = { head: 0, armor: 0, foot: 0, hands: 0 };
    for (const c of equippedItems(p)) {
      if (isCheated(p, c) || c === borrowed) continue;
      const it = itemOf(c)!;
      if (!qualifies(p, it) && !settling) out.push(`${id} has unusable ${it.name} equipped`);
      if (it.slot === 'hands') slots.hands += it.hands;
      else if (it.slot !== 'none') slots[it.slot]++;
    }
    if (slots.head > 1 || slots.armor > 1 || slots.foot > 1 || slots.hands > 2) out.push(`${id} slots ${JSON.stringify(slots)}`);
    if (!isDwarf(p) && !settling && bigInPlay(p).filter((c) => !isCheated(p, c) && c !== borrowed).length > 1) out.push(`${id} two Big items`);
    if (p.dead && !settling && (p.hand.length || p.carried.length || equippedItems(p).length)) out.push(`${id} dead with cards`);
    if (p.cheat && (!p.equipped.includes(p.cheat.card) || !p.equipped.includes(p.cheat.item))) out.push(`${id} dangling Cheat!`);
    for (const c of p.equipped) if (cardOf(c).id === 'cheat' && p.cheat?.card !== c) out.push(`${id} unattached Cheat!`);
  }
  if (!!s.combat !== (s.phase === 'combat')) out.push(`combat/phase mismatch: ${s.phase}`);
  if (!s.combat && !settling && s.play.length) out.push(`cards left in play: ${s.play.join(',')}`);
  if (s.phase === 'gameOver' && !s.winners.length) out.push('game over without a winner');
  return out;
}
