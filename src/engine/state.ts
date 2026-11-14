// Game state construction and low-level zone operations (the skill's munchkin.py, in TypeScript).
import { baseId, ALL_IDS, DOOR_IDS, TREASURE_IDS, deckOf, isRaceClassCard, nameOf } from './cards';
import { rollDie, seedFrom, shuffle } from './rng';
import type { CardId, Deck, Gender, GameState, PlayerId, PlayerState } from './types';

export interface PlayerSetup {
  name: string;
  gender?: Gender;
  bot?: boolean;
}

export interface NewGameOptions {
  seed: number | string;
  human: PlayerSetup;
  rivals: PlayerSetup[];
}

export class RuleError extends Error {}

export function newGame(opts: NewGameOptions): GameState {
  const seed = seedFrom(opts.seed);
  const setups = [{ ...opts.human, bot: false }, ...opts.rivals.map((r) => ({ ...r, bot: r.bot ?? true }))];
  const names = new Set<string>();
  for (const p of setups) {
    if (!p.name || names.has(p.name)) throw new RuleError(`Player names must be unique and non-empty: "${p.name}"`);
    if (p.name.includes('.')) throw new RuleError('Player names cannot contain "."');
    names.add(p.name);
  }
  if (opts.rivals.length < 1 || opts.rivals.length > 5) throw new RuleError('Pick 1 to 5 rivals');
  const s: GameState = {
    version: 1,
    seed,
    rngState: seed,
    human: opts.human.name,
    order: setups.map((p) => p.name),
    players: {},
    deck_door: [...DOOR_IDS],
    deck_treasure: [...TREASURE_IDS],
    discard_door: [],
    discard_treasure: [],
    play: [],
    turn: opts.human.name,
    turnNumber: 1,
    phase: 'setup',
    combat: null,
    pending: null,
    queue: [],
    flags: { kicked: false, halflingDoubleUsed: false, acted: false },
    winners: [],
    log: [],
    events: [],
    eventSeq: 0,
    lastRoll: null,
  };
  shuffle(s, s.deck_door);
  shuffle(s, s.deck_treasure);
  for (const p of setups) {
    s.players[p.name] = {
      id: p.name,
      name: p.name,
      gender: p.gender ?? 'male',
      bot: p.bot,
      level: 1,
      dead: false,
      equipped: [],
      carried: [],
      curses: [],
      hand: [],
      cheat: null,
    };
  }
  addLog(s, 'newGame', `New game: ${opts.human.name} vs ${opts.rivals.map((r) => r.name).join(', ')}.`);
  for (const id of s.order) deal(s, id);
  addLog(s, 'turn', `Turn 1: ${s.turn}.`, s.turn);
  return s;
}

// ---------------- logging ----------------

export function addLog(s: GameState, type: string, text: string, player?: PlayerId, data?: Record<string, unknown>) {
  s.log.push(text);
  if (s.log.length > 600) s.log.splice(0, s.log.length - 600);
  s.events.push({ seq: ++s.eventSeq, turn: s.turnNumber, type, player, text, data });
  // keep saves small: the event list is a rolling window, the text log is kept whole
  if (s.events.length > 400) s.events.splice(0, s.events.length - 400);
}

// ---------------- players ----------------

export function player(s: GameState, id: PlayerId): PlayerState {
  const p = s.players[id];
  if (!p) throw new RuleError(`Unknown player ${id}`);
  return p;
}

export function others(s: GameState, id: PlayerId): PlayerId[] {
  // in turn order, starting from the player to `id`'s left
  const i = s.order.indexOf(id);
  return [...s.order.slice(i + 1), ...s.order.slice(0, i)];
}

export function leftOf(s: GameState, id: PlayerId): PlayerId {
  const i = s.order.indexOf(id);
  return s.order[(i + 1) % s.order.length];
}

export function rightOf(s: GameState, id: PlayerId): PlayerId {
  const i = s.order.indexOf(id);
  return s.order[(i - 1 + s.order.length) % s.order.length];
}

// ---------------- zones ----------------

export type ZoneName = string; // play | discard_door | ... | PLAYER.hand|equipped|carried|curses

export const PILES = ['play', 'discard_door', 'discard_treasure', 'deck_door', 'deck_treasure'] as const;

export function zone(s: GameState, z: ZoneName): CardId[] {
  if ((PILES as readonly string[]).includes(z)) return s[z as (typeof PILES)[number]];
  const dot = z.lastIndexOf('.');
  if (dot < 0) throw new RuleError(`Unknown zone ${z}`);
  const p = player(s, z.slice(0, dot));
  const part = z.slice(dot + 1);
  if (part === 'hand' || part === 'equipped' || part === 'carried' || part === 'curses') return p[part];
  throw new RuleError(`Unknown zone ${z}`);
}

/** Where is this card right now? */
export function locate(s: GameState, card: CardId): ZoneName | null {
  for (const z of PILES) if (s[z].includes(card)) return z;
  for (const id of s.order) {
    const p = s.players[id];
    for (const part of ['hand', 'equipped', 'carried', 'curses'] as const) if (p[part].includes(card)) return `${id}.${part}`;
  }
  return null;
}

export function removeCard(s: GameState, card: CardId): ZoneName {
  const z = locate(s, card);
  if (!z) throw new RuleError(`Card ${card} is nowhere`);
  const arr = zone(s, z);
  arr.splice(arr.indexOf(card), 1);
  return z;
}

/** Cheat! stays only while both it and its item are equipped by the same player. */
function fixCheats(s: GameState) {
  for (const id of s.order) {
    const p = s.players[id];
    if (!p.cheat) continue;
    // an item out on loan (Help Me Out Here!) comes back after the combat, so its Cheat! waits for it
    const onLoan = s.combat?.borrowed?.card === p.cheat.item && s.combat.borrowed.owner === id;
    if (p.equipped.includes(p.cheat.card) && (p.equipped.includes(p.cheat.item) || onLoan)) continue;
    const ch = p.cheat.card;
    p.cheat = null;
    if (p.equipped.includes(ch)) {
      p.equipped.splice(p.equipped.indexOf(ch), 1);
      s.discard_door.push(ch);
    }
  }
}

export function moveCard(s: GameState, card: CardId, to: ZoneName) {
  removeCard(s, card);
  zone(s, to).push(card);
  fixCheats(s);
}

export function discardPile(s: GameState, card: CardId): CardId[] {
  return deckOf(card) === 'door' ? s.discard_door : s.discard_treasure;
}

/** Move a card (wherever it is) to its discard pile. */
export function discard(s: GameState, card: CardId) {
  removeCard(s, card);
  discardPile(s, card).push(card);
  fixCheats(s);
}

export function drawOne(s: GameState, deck: Deck): CardId | null {
  const pile = deck === 'door' ? s.deck_door : s.deck_treasure;
  const disc = deck === 'door' ? s.discard_door : s.discard_treasure;
  if (!pile.length) {
    if (!disc.length) return null;
    pile.push(...disc.splice(0));
    shuffle(s, pile);
    addLog(s, 'reshuffle', `${deck === 'door' ? 'Door' : 'Treasure'} deck reshuffled from discards.`);
  }
  return pile.pop() ?? null;
}

const DRAW_TRIGGERS = new Set(['divine-intervention', 'hoard']);
export function isDrawTrigger(card: CardId) {
  return DRAW_TRIGGERS.has(baseId(card));
}

/**
 * Resolve a card that takes effect the moment it is drawn. The card must already sit in a zone.
 * Divine Intervention: every Cleric goes up a level (never to 10), then it is discarded.
 * Hoard!: discarded; returns 3 (the extra Treasures the drawer is owed, face-up or face-down like the Hoard! itself).
 */
export function resolveDrawTrigger(s: GameState, card: CardId, who: PlayerId | null, faceUp: boolean): number {
  const id = baseId(card);
  if (id === 'divine-intervention') {
    discard(s, card);
    const clerics = s.order.filter((o) =>
      s.players[o].equipped.some((c) => baseId(c) === 'cleric'),
    );
    addLog(
      s,
      'effect',
      `Divine Intervention is drawn${who ? ` by ${who}` : ''}! ${clerics.length ? `${clerics.join(' and ')} (Cleric) go${clerics.length === 1 ? 'es' : ''} up a level.` : 'There are no Clerics, so nothing happens.'}`,
      who ?? undefined,
    );
    for (const o of clerics) changeLevel(s, o, 1, false);
    return 0;
  }
  if (id === 'hoard') {
    discard(s, card);
    addLog(s, 'effect', `Hoard! is drawn${who ? ` by ${who}` : ''}: 3 more Treasures, ${faceUp ? 'face-up' : 'face-down'}.`, who ?? undefined);
    return 3;
  }
  return 0;
}

/**
 * Draw n cards into a zone; returns the cards that stayed there (fewer if both pile and discards are empty).
 * Draw-triggered cards resolve at once: Divine Intervention uses up its draw, Hoard! is replaced by 3 more Treasures.
 * `faceUp` defaults to true when drawing to the table ("play").
 */
export function drawTo(s: GameState, deck: Deck, n: number, to: ZoneName, faceUp = to === 'play'): CardId[] {
  const out: CardId[] = [];
  const who = to.includes('.') ? (to.split('.')[0] as PlayerId) : null;
  for (let i = 0; i < n; i++) {
    const c = drawOne(s, deck);
    if (!c) break;
    zone(s, to).push(c);
    if (isDrawTrigger(c)) {
      const extra = resolveDrawTrigger(s, c, who, faceUp);
      if (extra) {
        const got = drawTo(s, 'treasure', extra, to, faceUp);
        if (faceUp && to !== 'play' && got.length) addLog(s, 'treasure', `${who} reveals the Hoard!: ${got.map(nameOf).join(', ')}.`, who ?? undefined);
        out.push(...got);
      }
      continue;
    }
    out.push(c);
  }
  return out;
}

/** Safety net: a draw-triggered card that reached a hand some other way (GM move, old save) resolves now. */
export function sweepDrawTriggers(s: GameState) {
  for (let guard = 0; guard < 10; guard++) {
    let hit = false;
    for (const id of s.order) {
      for (const c of [...s.players[id].hand]) {
        if (!isDrawTrigger(c)) continue;
        hit = true;
        const extra = resolveDrawTrigger(s, c, id, false);
        if (extra) drawTo(s, 'treasure', extra, `${id}.hand`, false);
      }
    }
    if (!hit) return;
  }
}

/** Deal a fresh hand. A player coming back from the dead draws Hoard!'s Treasures face-up. */
export function deal(s: GameState, id: PlayerId, backFromDead = false) {
  drawTo(s, 'door', 4, `${id}.hand`, false);
  drawTo(s, 'treasure', 4, `${id}.hand`, backFromDead);
}

// ---------------- levels ----------------

/**
 * Change a level. `canWin` is true only for levels earned by killing monsters
 * (including an Elf helping). Everything else stops at 9.
 */
export function changeLevel(s: GameState, id: PlayerId, delta: number, canWin = false) {
  const p = player(s, id);
  const before = p.level;
  let lvl = Math.max(1, before + delta);
  if (delta > 0 && !canWin) lvl = Math.max(before, Math.min(lvl, 9));
  if (canWin) lvl = Math.min(lvl, 10);
  p.level = lvl;
  if (lvl !== before) addLog(s, 'level', `${id} is now Level ${lvl}.`, id, { from: before, to: lvl });
  if (lvl >= 10 && canWin && !s.winners.includes(id)) s.winners.push(id);
}

export function setLevel(s: GameState, id: PlayerId, to: number) {
  const p = player(s, id);
  const before = p.level;
  p.level = Math.max(1, Math.min(9, to));
  if (before !== p.level) addLog(s, 'level', `${id} is now Level ${p.level}.`, id, { from: before, to: p.level });
}

// ---------------- dice ----------------

export function roll(s: GameState): number {
  const r = rollDie(s);
  s.lastRoll = r;
  return r;
}

// ---------------- skill-parity helpers ----------------

export function handCounts(s: GameState, id: PlayerId) {
  const hand = player(s, id).hand;
  const door = hand.filter((c) => deckOf(c) === 'door').length;
  return { total: hand.length, door, treasure: hand.length - door };
}

/** The skill's `die` command: keep race/class (and curses), discard everything else. */
export function discardOnDeath(s: GameState, id: PlayerId) {
  const p = player(s, id);
  const keep = p.equipped.filter((c) => isRaceClassCard(c));
  for (const c of [...p.equipped.filter((c) => !keep.includes(c)), ...p.carried, ...p.hand]) discard(s, c);
  p.equipped = keep;
  p.cheat = null;
}

export function allCards(s: GameState): CardId[] {
  const out = [...s.deck_door, ...s.deck_treasure, ...s.discard_door, ...s.discard_treasure, ...s.play];
  for (const id of s.order) {
    const p = s.players[id];
    out.push(...p.hand, ...p.equipped, ...p.carried, ...p.curses);
  }
  return out;
}

export function describe(card: CardId) {
  return nameOf(card);
}

export { ALL_IDS };

const deep = <T>(x: T): T => (x === null || x === undefined ? x : JSON.parse(JSON.stringify(x)));

/**
 * Fast copy of a game state. Card zones are copied; log lines and event objects are
 * immutable once written, so those arrays are copied shallowly.
 */
export function cloneState(s: GameState): GameState {
  const players: GameState['players'] = {};
  for (const id of s.order) {
    const p = s.players[id];
    players[id] = {
      ...p,
      equipped: [...p.equipped],
      carried: [...p.carried],
      curses: [...p.curses],
      hand: [...p.hand],
      cheat: p.cheat ? { ...p.cheat } : null,
    };
  }
  return {
    ...s,
    order: [...s.order],
    players,
    deck_door: [...s.deck_door],
    deck_treasure: [...s.deck_treasure],
    discard_door: [...s.discard_door],
    discard_treasure: [...s.discard_treasure],
    play: [...s.play],
    combat: deep(s.combat),
    pending: deep(s.pending),
    queue: deep(s.queue),
    flags: { ...s.flags },
    winners: [...s.winners],
    log: [...s.log],
    events: [...s.events],
  };
}
