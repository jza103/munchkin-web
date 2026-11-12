// Enumerate concrete legal actions for a player. Used by the UI action bar, the bots and the fuzz tests.
// Multi-card choices (selling, charity, "lose 1,000 Gold of items") get a sensible suggestion
// rather than every subset; the UI builds custom selections and validates them with check().
import { check, enumeratePlays } from './actions';
import { cardOf, goldOf, isRaceClassCard, itemOf } from './cards';
import { monsterTreasure } from './combat';
import { ownItems } from './flow';
import { player } from './state';
import type { Action, CardId, GameState, Pending, PlayerId } from './types';

export function legalActions(s: GameState, id: PlayerId): Action[] {
  if (s.phase === 'gameOver' || !s.players[id]) return [];
  return candidates(s, id).filter((a) => check(s, a) === null);
}

function candidates(s: GameState, id: PlayerId): Action[] {
  const p = player(s, id);
  const pend = s.pending;
  if (pend) {
    if ('queue' in pend) return pend.queue[0] === id ? [{ type: 'pass', player: id }, ...enumeratePlays(s, id)] : [];
    if (pend.player !== id) return [];
    return pendingCandidates(s, id, pend);
  }
  const out: Action[] = [];
  if (s.turn === id) {
    out.push({ type: 'kickDoor', player: id }, { type: 'lootRoom', player: id }, { type: 'endTurn', player: id });
    if (s.phase === 'setup') for (const c of p.hand) out.push({ type: 'kickDoor', player: id, resurrect: c });
    for (const c of p.hand) {
      const k = cardOf(c).kind;
      if (k === 'monster') out.push({ type: 'lookForTrouble', player: id, card: c });
      if (k === 'item' || k === 'oneShot') out.push({ type: 'carry', player: id, card: c });
      if (isRaceClassCard(c)) {
        out.push({ type: 'playRaceClass', player: id, card: c });
        for (const r of p.equipped) if (cardOf(r).kind === k) out.push({ type: 'playRaceClass', player: id, card: c, replace: r });
      }
    }
    for (const c of [...p.hand, ...p.carried]) if (itemOf(c)) out.push({ type: 'equip', player: id, card: c });
    for (const c of p.equipped) {
      if (itemOf(c)) out.push({ type: 'carry', player: id, card: c });
      if (isRaceClassCard(c)) out.push({ type: 'discardRaceClass', player: id, card: c });
    }
    const sell = suggestSell(s, id);
    if (sell) out.push(sell);
  } else for (const c of p.equipped) if (isRaceClassCard(c)) out.push({ type: 'discardRaceClass', player: id, card: c });
  const c = s.combat;
  if (c && c.fighter === id) {
    out.push({ type: 'fight', player: id }, { type: 'runAway', player: id });
    c.monsters.forEach((_, i) => out.push({ type: 'avoidMonster', player: id, monster: i }));
    const total = c.monsters.reduce((a, m) => a + monsterTreasure(m), 0);
    for (const o of s.order) if (o !== id) for (let k = 0; k <= total; k++) out.push({ type: 'askHelp', player: id, target: o, offer: k });
  }
  out.push(...enumeratePlays(s, id));
  if (p.hand.length && !c)
    for (const o of s.order)
      if (o !== id) for (const it of ownItems(s, o)) out.push({ type: 'power', player: id, power: 'theft', discard: [p.hand[0]], target: { player: o, card: it } });
  return out;
}

function pendingCandidates(s: GameState, id: PlayerId, pend: Exclude<Pending, { queue: PlayerId[] }>): Action[] {
  const p = player(s, id);
  switch (pend.type) {
    case 'helpRequest':
      return [{ type: 'respondHelp', player: id, accept: true }, { type: 'respondHelp', player: id, accept: false }];
    case 'trade':
      return [{ type: 'respondTrade', player: id, accept: true }, { type: 'respondTrade', player: id, accept: false }];
    case 'chooseOption':
      return pend.options.map((_, option) => ({ type: 'chooseOption', player: id, option }));
    case 'resurrect':
      return [{ type: 'resurrect', player: id, discard: null }, ...p.hand.map((c) => ({ type: 'resurrect' as const, player: id, discard: c }))];
    case 'preRun':
      return [{ type: 'useRat', player: id, use: true }, { type: 'useRat', player: id, use: false }];
    case 'charity':
      return [{ type: 'charity', player: id, cards: p.hand.slice(0, pend.excess) }];
    case 'chooseCards': {
      const out: Action[] = [];
      if (pend.min === 0) out.push({ type: 'chooseCards', player: id, cards: [] });
      if (pend.minGold !== undefined) {
        const pick = minimalGold(pend.options, pend.minGold);
        if (pick) out.push({ type: 'chooseCards', player: id, cards: pick });
      } else if (pend.max === 1) for (const c of pend.options) out.push({ type: 'chooseCards', player: id, cards: [c] });
      else out.push({ type: 'chooseCards', player: id, cards: pend.options.slice(0, pend.min) });
      return out;
    }
  }
}

/** Smallest-value set of cards worth at least `need` Gold with no card to spare. */
export function minimalGold(options: CardId[], need: number): CardId[] | null {
  const sorted = [...options].sort((a, b) => goldOf(b) - goldOf(a));
  let best: CardId[] | null = null;
  let bestSum = Infinity;
  const n = Math.min(sorted.length, 14);
  for (let mask = 1; mask < 1 << n; mask++) {
    let sum = 0;
    const pick: CardId[] = [];
    for (let i = 0; i < n; i++) if (mask & (1 << i)) (sum += goldOf(sorted[i]), pick.push(sorted[i]));
    if (sum < need || sum >= bestSum) continue;
    if (pick.some((c) => sum - goldOf(c) >= need)) continue;
    best = pick;
    bestSum = sum;
  }
  return best;
}

/** A sale that gains as many levels as allowed while giving up the least (hand and carried first). */
export function suggestSell(s: GameState, id: PlayerId): Action | null {
  const p = player(s, id);
  const pool = [...p.hand, ...p.carried].filter((c) => cardOf(c).deck === 'treasure' && goldOf(c) > 0);
  const total = pool.reduce((a, c) => a + goldOf(c), 0);
  const maxLevels = Math.min(Math.floor(total / 1000), 9 - p.level);
  if (maxLevels < 1) return null;
  const pick = minimalGold(pool, maxLevels * 1000);
  return pick ? { type: 'sell', player: id, cards: pick } : null;
}
