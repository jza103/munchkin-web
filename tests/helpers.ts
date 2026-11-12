import { applyOrThrow, check } from '../src/engine/actions';
import { ALL_IDS, cardOf, nameOf } from '../src/engine/cards';
import { allCards, locate, moveCard, newGame } from '../src/engine/state';
import type { Action, CardId, GameState, PlayerId } from '../src/engine/types';
import { expect } from 'vitest';

export const J = 'Jason';
export const A = 'Alex';
export const S = 'Sam';

/** A fresh game with empty hands (cards returned to the decks) so tests can set up exact situations. */
export function blank(rivals = 2, seed = 1): GameState {
  const names = [A, S, 'Morgan', 'Riley', 'Quinn'].slice(0, rivals);
  const s = newGame({
    seed,
    human: { name: J, gender: 'male' },
    rivals: names.map((n) => ({ name: n, gender: n === S ? 'female' : 'male' })),
  });
  for (const id of s.order) {
    const p = s.players[id];
    for (const c of p.hand.splice(0)) (cardOf(c).deck === 'door' ? s.deck_door : s.deck_treasure).unshift(c);
  }
  return s;
}

/** First free instance of a card by name (one not held by any player and not in play). */
export function inst(s: GameState, name: string, n?: number): CardId {
  const ids = ALL_IDS.filter((id) => cardOf(id).name === name);
  if (!ids.length) throw new Error(`No card named ${name}`);
  if (n) return ids[n - 1];
  const free = ids.find((id) => {
    const z = locate(s, id)!;
    return z.startsWith('deck_') || z.startsWith('discard_');
  });
  if (!free) throw new Error(`No free copy of ${name}`);
  return free;
}

/** Put a named card into a zone ("Jason.hand", "Jason.equipped", ...). */
export function give(s: GameState, pid: PlayerId, name: string, part: 'hand' | 'equipped' | 'carried' | 'curses' = 'hand'): CardId {
  const id = inst(s, name);
  moveCard(s, id, `${pid}.${part}`);
  return id;
}

/** Put a named card on top of its draw pile. */
export function top(s: GameState, name: string): CardId {
  const id = inst(s, name);
  const deck = cardOf(id).deck === 'door' ? 'deck_door' : 'deck_treasure';
  moveCard(s, id, deck);
  return id;
}

/** Force the next die rolls by searching for an rngState that yields them. */
export function rig(s: GameState, ...rolls: number[]) {
  // brute-force a seed that produces the wanted sequence from mulberry32
  for (let seed = 1; seed < 5_000_000; seed++) {
    let st = seed;
    let ok = true;
    for (const r of rolls) {
      const [v, next] = mulberry(st);
      st = next;
      if (1 + Math.floor(v * 6) !== r) {
        ok = false;
        break;
      }
    }
    if (ok) {
      s.rngState = seed;
      return;
    }
  }
  throw new Error('could not rig dice');
}
function mulberry(state: number): [number, number] {
  let t = (state + 0x6d2b79f5) >>> 0;
  const next = t;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next];
}

export function act(s: GameState, a: Action): GameState {
  return applyOrThrow(s, a);
}

export function err(s: GameState, a: Action): string {
  const e = check(s, a);
  expect(e, `expected ${a.type} to be illegal`).not.toBeNull();
  return e!;
}

/** Pass every open response window. */
export function passAll(s: GameState): GameState {
  let guard = 0;
  while (s.pending && 'queue' in s.pending && guard++ < 50) s = act(s, { type: 'pass', player: s.pending.queue[0] });
  return s;
}

export function names(cards: CardId[]) {
  return cards.map(nameOf);
}

export function expectConserved(s: GameState) {
  const all = allCards(s);
  expect(all.length).toBe(ALL_IDS.length);
  expect(new Set(all).size).toBe(ALL_IDS.length);
}

/** Kick the door with a chosen top card, as the current turn player. */
export function kick(s: GameState, name: string, pid = s.turn): GameState {
  top(s, name);
  return act(s, { type: 'kickDoor', player: pid });
}
