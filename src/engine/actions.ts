// apply(state, action): validate, then execute on a copy, then run queued tasks.
import { baseId, cardOf, deckOf, goldOf, isRaceClassCard, itemOf, monsterOf, nameOf } from './cards';
import { combatTotals, combatants, monsterTreasure, newCombat, removeMonster } from './combat';
import {
  afterMonsterRemoved,
  applyCurse,
  canResurrect,
  drain,
  escape,
  finishTreasure,
  isBorrowed,
  nextTurn,
  normalize,
  now,
  openRollWindow,
  ownItems,
  queueRun,
  resolveRoll,
  returnBorrowed,
  rollResponses,
  rollToRun,
  runOutcome,
  startRoll,
  useRat,
} from './flow';
import {
  classCards,
  classes,
  curseRules,
  equipError,
  bigError,
  handLimit,
  hasEquippedAbility,
  hasHalfBreed,
  hasPower,
  hasSuperMunchkin,
  isLeader,
  matches,
  maxClasses,
  maxRaces,
  qualifies,
  raceCards,
} from './rules';
import {
  addLog,
  changeLevel,
  discard,
  discardOnDeath,
  deal,
  drawOne,
  drawTo,
  handCounts,
  locate,
  moveCard,
  others,
  player,
  cloneState,
  roll,
  zone,
} from './state';
import type { Action, ApplyResult, CardId, GameState, Pending, PlayerId, Target } from './types';

type A<K extends Action['type']> = Extract<Action, { type: K }>;
interface Handler<K extends Action['type']> {
  check(s: GameState, a: A<K>): string | null;
  exec(s: GameState, a: A<K>): void;
}

export const GM_ACTIONS = new Set(['draw', 'move', 'level', 'die', 'revive', 'roll', 'check', 'log']);

// ---------------- guards ----------------

function who(p: Pending): PlayerId {
  return 'queue' in p ? p.queue[0] : p.player;
}

function aliveErr(s: GameState, id: PlayerId): string | null {
  const p = s.players[id];
  if (!p) return `Unknown player ${id}`;
  if (p.dead) return `${id} is dead`;
  return null;
}

function freeErr(s: GameState): string | null {
  return s.pending ? `Waiting for ${who(s.pending)} (${s.pending.type})` : null;
}

function ownTurnSetupErr(s: GameState, id: PlayerId): string | null {
  return (
    aliveErr(s, id) ??
    freeErr(s) ??
    (s.turn !== id ? 'Only on your own turn' : null) ??
    (s.combat ? 'Not during combat' : null)
  );
}

function fighterErr(s: GameState, id: PlayerId): string | null {
  if (!s.combat) return 'There is no combat';
  if (s.combat.fighter !== id) return 'Only the fighter can do that';
  return freeErr(s) ?? (s.combat.running ? 'You are already running away' : null);
}

function inHand(s: GameState, id: PlayerId, card: CardId): boolean {
  return player(s, id).hand.includes(card);
}

/** Cards a player can play from: hand, plus carried one-shot treasures. */
function playable(s: GameState, id: PlayerId, card: CardId): boolean {
  const p = player(s, id);
  if (p.hand.includes(card)) return true;
  return p.carried.includes(card) && cardOf(card).kind === 'oneShot';
}

type Ctx = 'free' | 'combatWindow' | 'curseWindow' | 'rollWindow';

/** In which context is this player acting? null = they can't act now. */
function context(s: GameState, id: PlayerId): Ctx | null {
  if (!s.pending) return 'free';
  const p = s.pending;
  if ((p.type === 'combatWindow' || p.type === 'curseWindow' || p.type === 'rollWindow') && p.queue[0] === id) return p.type;
  return null;
}

function inCombatErr(s: GameState): string | null {
  if (!s.combat) return 'Only during combat';
  if (s.combat.running) return 'The fighters are already running away';
  return null;
}

function monsterIdxErr(s: GameState, t?: Target): string | null {
  if (!s.combat) return 'Only during combat';
  if (t?.monster === undefined || !Number.isInteger(t.monster) || t.monster < 0 || t.monster >= s.combat.monsters.length)
    return 'Choose a monster in the combat';
  return null;
}

/** A card played into a combat that was waiting on responses gives the fighter control back. */
function interrupt(s: GameState) {
  if (s.pending?.type === 'combatWindow') s.pending = null;
  if (s.combat) s.combat.resolving = false;
}

function toPlay(s: GameState, card: CardId) {
  moveCard(s, card, 'play');
}

// ---------------- card handlers (playCard) ----------------

interface CardHandler {
  ctx: Ctx[];
  check(s: GameState, id: PlayerId, card: CardId, t: Target | undefined): string | null;
  exec(s: GameState, id: PlayerId, card: CardId, t: Target | undefined): void;
}

const COMBAT: Ctx[] = ['free', 'combatWindow'];

export const CARD_HANDLERS: Record<string, CardHandler> = {
  // ---- generic kinds ----
  bonus: {
    ctx: COMBAT,
    check(s, id, card, t) {
      const e = inCombatErr(s);
      if (e) return e;
      const c = cardOf(card);
      if (c.kind !== 'oneShot') return 'Not a one-shot';
      if (c.side === 'own') {
        if (!combatants(s.combat!).includes(id)) return `${c.name} only works for your own side in a combat you're in`;
        if (t?.side && t.side !== 'player') return `${c.name} only works for your side`;
        return null;
      }
      if (t?.side !== 'player' && t?.side !== 'monster') return 'Choose a side: player or monster';
      return null;
    },
    exec(s, id, card, t) {
      const c = cardOf(card) as { bonus: number; fire: boolean; side: string };
      const side = c.side === 'own' ? 'player' : t!.side!;
      toPlay(s, card);
      s.combat!.bonuses.push({ card, by: id, side, value: c.bonus, fire: c.fire });
      addLog(s, 'play', `${id} plays ${nameOf(card)}: +${c.bonus} to the ${side === 'player' ? 'munchkins' : 'monsters'}.`, id);
    },
  },
  enhancer: {
    ctx: COMBAT,
    check(s, _id, _card, t) {
      return inCombatErr(s) ?? monsterIdxErr(s, t);
    },
    exec(s, id, card, t) {
      toPlay(s, card);
      const m = s.combat!.monsters[t!.monster!];
      m.enhancers.push(card);
      addLog(s, 'play', `${id} plays ${nameOf(card)} on ${nameOf(m.card)}.`, id);
    },
  },
  curse: {
    ctx: COMBAT,
    check(s, _id, _card, t) {
      if (!t?.player || !s.players[t.player]) return 'Choose a player to curse';
      return null;
    },
    exec(s, id, card, t) {
      toPlay(s, card);
      addLog(s, 'play', `${id} plays ${nameOf(card)} on ${t!.player}.`, id);
      now(s, { t: 'curse', card, target: t!.player!, fromDoor: false, by: id });
    },
  },
  goUpLevel: {
    ctx: COMBAT,
    check(s, id, card) {
      const c = cardOf(card);
      if (player(s, id).level >= 9) return 'Go Up a Level cards can never give Level 10';
      if (c.kind === 'other' && c.effect.op === 'goUpLevel' && c.effect.notIfLeader && isLeader(s, id))
        return `${c.name} can't be played by the leader`;
      return null;
    },
    exec(s, id, card) {
      discard(s, card);
      addLog(s, 'play', `${id} plays ${nameOf(card)}.`, id);
      changeLevel(s, id, 1, false);
    },
  },

  // ---- door specials ----
  halfBreed: {
    ctx: ['free'],
    check: (s, id, card) => raceClassErr(s, id, card),
    exec: (s, id, card) => raceClassExec(s, id, card),
  },
  superMunchkin: {
    ctx: ['free'],
    check: (s, id, card) => raceClassErr(s, id, card),
    exec: (s, id, card) => raceClassExec(s, id, card),
  },
  cheat: {
    ctx: ['free'],
    check(s, id, card, t) {
      if (!t?.card) return 'Choose the item to equip with Cheat!';
      return H.equip.check(s, { type: 'equip', player: id, card: t.card, cheat: card });
    },
    exec(s, id, card, t) {
      H.equip.exec(s, { type: 'equip', player: id, card: t!.card!, cheat: card });
    },
  },
  wanderingMonster: {
    ctx: COMBAT,
    check(s, id, _card, t) {
      const e = inCombatErr(s);
      if (e) return e;
      if (!t?.card || !inHand(s, id, t.card) || cardOf(t.card).kind !== 'monster') return 'Choose a monster from your hand';
      return null;
    },
    exec(s, id, card, t) {
      toPlay(s, card);
      toPlay(s, t!.card!);
      s.combat!.monsters.push({ card: t!.card!, enhancers: [], mate: null });
      addLog(s, 'play', `${id} plays Wandering Monster: ${nameOf(t!.card!)} joins the fight!`, id);
      now(s, { t: 'enter', card: t!.card! });
    },
  },
  divineIntervention: {
    ctx: COMBAT,
    check: () => null,
    exec(s, id, card) {
      discard(s, card);
      addLog(s, 'play', `${id} plays Divine Intervention: every Cleric goes up a level.`, id);
      for (const o of s.order) if (classes(player(s, o)).includes('cleric')) changeLevel(s, o, 1, false);
    },
  },
  helpMeOutHere: {
    ctx: COMBAT,
    check(s, id, _card, t) {
      const e = inCombatErr(s);
      if (e) return e;
      if (s.combat!.fighter !== id) return 'Only in your own combat';
      if (s.combat!.borrowed) return 'You already borrowed an item this combat';
      const item = t?.card;
      if (!item || !itemOf(item)) return 'Choose an item from another player';
      const owner = s.order.find((o) => o !== id && ownItems(s, o).includes(item));
      if (!owner) return "That item isn't on another player's table";
      if (!qualifies(player(s, id), itemOf(item)!)) return `You can't use ${nameOf(item)}`;
      return null;
    },
    exec(s, id, card, t) {
      const item = t!.card!;
      const z = locate(s, item)!;
      const owner = z.slice(0, z.lastIndexOf('.'));
      toPlay(s, card);
      moveCard(s, item, `${id}.equipped`);
      s.combat!.borrowed = { card: item, owner, zone: z.endsWith('equipped') ? 'equipped' : 'carried' };
      addLog(s, 'play', `${id} plays Help Me Out Here! and borrows ${nameOf(item)} from ${owner} for this combat.`, id);
    },
  },
  illusion: {
    ctx: COMBAT,
    check(s, id, _card, t) {
      const e = inCombatErr(s) ?? monsterIdxErr(s, t);
      if (e) return e;
      if (!t?.card || !inHand(s, id, t.card) || cardOf(t.card).kind !== 'monster') return 'Choose a monster from your hand';
      return null;
    },
    exec(s, id, card, t) {
      const c = s.combat!;
      toPlay(s, card);
      const old = removeMonster(s, t!.monster!);
      toPlay(s, t!.card!);
      c.monsters.splice(t!.monster!, 0, { card: t!.card!, enhancers: [], mate: null });
      addLog(s, 'play', `${id} plays Illusion: ${nameOf(old.card)} is replaced by ${nameOf(t!.card!)}.`, id);
      now(s, { t: 'enter', card: t!.card! });
    },
  },
  mate: {
    ctx: COMBAT,
    check(s, _id, _card, t) {
      const e = inCombatErr(s) ?? monsterIdxErr(s, t);
      if (e) return e;
      if (s.combat!.monsters[t!.monster!].mate) return 'That monster already has a Mate';
      return null;
    },
    exec(s, id, card, t) {
      toPlay(s, card);
      const m = s.combat!.monsters[t!.monster!];
      m.mate = card;
      addLog(s, 'play', `${id} plays Mate: ${nameOf(m.card)} brings its mate (double level and rewards).`, id);
    },
  },
  outToLunch: {
    ctx: COMBAT,
    check: (s, _id, _card, t) => inCombatErr(s) ?? monsterIdxErr(s, t),
    exec(s, id, card, t) {
      toPlay(s, card);
      const m = removeMonster(s, t!.monster!);
      const f = s.combat!.fighter;
      addLog(s, 'play', `${id} plays Out to Lunch: ${nameOf(m.card)} leaves; ${f} takes 2 Treasure (no level).`, id);
      drawTo(s, 'treasure', 2, `${f}.hand`);
      afterMonsterRemoved(s);
    },
  },

  // ---- treasure one-shots ----
  doppleganger: {
    ctx: COMBAT,
    check(s, id) {
      const e = inCombatErr(s);
      if (e) return e;
      if (s.combat!.fighter !== id) return 'Only in your own combat';
      if (s.combat!.doppleganger) return 'Already doubled';
      return null;
    },
    exec(s, id, card) {
      toPlay(s, card);
      s.combat!.doppleganger = true;
      addLog(s, 'play', `${id} plays Doppleganger: their strength is doubled.`, id);
    },
  },
  friendshipPotion: {
    ctx: COMBAT,
    check: (s) => inCombatErr(s),
    exec(s, id, card) {
      toPlay(s, card);
      while (s.combat!.monsters.length) removeMonster(s, 0);
      addLog(s, 'play', `${id} plays Friendship Potion: all monsters leave. No treasure, no levels.`, id);
      afterMonsterRemoved(s);
    },
  },
  instantWall: {
    ctx: COMBAT,
    check: (s) => inCombatErr(s),
    exec(s, id, card) {
      const c = s.combat!;
      toPlay(s, card);
      c.running = true;
      addLog(s, 'play', `${id} plays Instant Wall: ${combatants(c).join(' and ')} escape automatically.`, id);
      now(s, { t: 'endCombat', won: false });
      for (const r of combatants(c)) c.monsters.forEach((m, i) => { for (let k = 0; k < (m.mate ? 2 : 1); k++) escape(s, r, i); });
    },
  },
  magicLamp: {
    ctx: COMBAT,
    check(s, id, _card, t) {
      const e = inCombatErr(s) ?? monsterIdxErr(s, t);
      if (e) return e;
      if (s.turn !== id || s.combat!.fighter !== id) return 'Magic Lamp works on your own turn, in your own combat';
      return null;
    },
    exec(s, id, card, t) {
      toPlay(s, card);
      const m = removeMonster(s, t!.monster!);
      const n = monsterTreasure(m);
      addLog(s, 'play', `${id} rubs the Magic Lamp: ${nameOf(m.card)} vanishes; ${id} takes ${n} Treasure.`, id);
      drawTo(s, 'treasure', n, `${id}.hand`);
      afterMonsterRemoved(s);
    },
  },
  pollymorph: {
    ctx: COMBAT,
    check: (s, _id, _card, t) => inCombatErr(s) ?? monsterIdxErr(s, t),
    exec(s, id, card, t) {
      toPlay(s, card);
      const m = removeMonster(s, t!.monster!);
      const n = monsterTreasure(m);
      addLog(s, 'play', `${id} plays Pollymorph Potion: ${nameOf(m.card)} becomes a parrot and flies off; ${id} takes ${n} Treasure.`, id);
      drawTo(s, 'treasure', n, `${id}.hand`);
      afterMonsterRemoved(s);
    },
  },
  transferral: {
    ctx: COMBAT,
    check(s, _id, _card, t) {
      const e = inCombatErr(s);
      if (e) return e;
      if (!t?.player || !s.players[t.player]) return 'Choose a player to take over the combat';
      if (t.player === s.combat!.fighter) return 'Choose someone other than the fighter';
      return aliveErr(s, t.player);
    },
    exec(s, id, card, t) {
      const c = s.combat!;
      toPlay(s, card);
      returnBorrowed(s);
      const old = c.fighter;
      c.fighter = t!.player!;
      c.helper = null;
      c.deal = 0;
      c.backstabs = [];
      c.doppleganger = false;
      c.declined = [];
      c.mirrored = curseRules(player(s, c.fighter)).mirror ? [c.fighter] : [];
      addLog(s, 'play', `${id} plays Transferral Potion: ${old} escapes and ${c.fighter} must fight!`, id);
      now(s, ...c.monsters.map((m) => ({ t: 'enter' as const, card: m.card })));
    },
  },
  yuppieWater: {
    ctx: COMBAT,
    check: (s) => inCombatErr(s),
    exec(s, id, card) {
      toPlay(s, card);
      s.combat!.yuppie += 1;
      addLog(s, 'play', `${id} plays Yuppie Water: +2 to every Elf in the combat.`, id);
    },
  },
  flaskOfGlue: {
    ctx: ['rollWindow'],
    check(s, id) {
      const w = s.pending;
      if (w?.type !== 'rollWindow' || w.purpose.kind !== 'run') return 'Play Flask of Glue when someone escapes';
      if (w.purpose.runner === id) return "You can't glue yourself";
      if (!runOutcome(s, w.purpose.runner, w.purpose.monster, w.natural).success) return 'Nobody escaped';
      return null;
    },
    exec(s, id, card) {
      const w = s.pending as Extract<Pending, { type: 'rollWindow' }>;
      discard(s, card);
      s.pending = null;
      addLog(s, 'play', `${id} plays Flask of Glue: ${w.roller} must roll again!`, id);
      startRoll(s, w.roller, w.purpose);
    },
  },
  invisibility: {
    ctx: ['rollWindow'],
    check(s, id) {
      const w = s.pending;
      if (w?.type !== 'rollWindow' || w.purpose.kind !== 'run' || w.purpose.runner !== id) return 'Play it after your own failed run';
      if (runOutcome(s, id, w.purpose.monster, w.natural).success) return "You haven't failed";
      return null;
    },
    exec(s, id, card) {
      const w = s.pending as Extract<Pending, { type: 'rollWindow' }>;
      discard(s, card);
      s.pending = null;
      const purpose = w.purpose as { kind: 'run'; monster: number };
      addLog(s, 'play', `${id} drinks an Invisibility Potion and escapes!`, id);
      escape(s, id, purpose.monster);
    },
  },
  loadedDie: {
    ctx: ['rollWindow'],
    check(s, _id, _card, t) {
      if (s.pending?.type !== 'rollWindow') return 'Play Loaded Die right after a die roll';
      if (!t?.value || !Number.isInteger(t.value) || t.value < 1 || t.value > 6) return 'Choose a number from 1 to 6';
      return null;
    },
    exec(s, id, card, t) {
      const w = s.pending as Extract<Pending, { type: 'rollWindow' }>;
      discard(s, card);
      s.pending = null;
      addLog(s, 'play', `${id} plays Loaded Die: the roll becomes a ${t!.value}.`, id);
      openRollWindow(s, w.roller, w.purpose, t!.value!);
    },
  },
  wishingRing: {
    ctx: ['free', 'combatWindow', 'curseWindow'],
    check(s, _id, _card, t) {
      if (s.pending?.type === 'curseWindow') return null;
      if (!t?.player || !s.players[t.player]) return 'Choose the cursed player';
      if (!t.card || !player(s, t.player).curses.includes(t.card)) return 'Choose a curse that is on them';
      return null;
    },
    exec(s, id, card, t) {
      discard(s, card);
      if (s.pending?.type === 'curseWindow') {
        const w = s.pending;
        s.pending = null;
        discard(s, w.task.card);
        addLog(s, 'play', `${id} uses a Wishing Ring: ${nameOf(w.task.card)} is cancelled.`, id);
        return;
      }
      discard(s, t!.card!);
      if (s.combat) s.combat.mirrored = s.combat.mirrored.filter((x) => curseRules(player(s, x)).mirror);
      addLog(s, 'play', `${id} uses a Wishing Ring to remove ${nameOf(t!.card!)} from ${t!.player}.`, id);
    },
  },
  hoard: {
    ctx: COMBAT,
    check: () => null,
    exec(s, id, card) {
      discard(s, card);
      const got = drawTo(s, 'treasure', 3, `${id}.hand`);
      addLog(s, 'play', `${id} plays Hoard! and draws ${got.length} Treasure face-down.`, id);
    },
  },
};

/** Every custom handler name referenced by cards.json must be one of these. */
export const CUSTOM_CARD_HANDLERS = Object.keys(CARD_HANDLERS);

export function handlerFor(card: CardId): { name: string; h: CardHandler } | null {
  const c = cardOf(card);
  if (c.kind === 'enhancer') return { name: 'enhancer', h: CARD_HANDLERS.enhancer };
  if (c.kind === 'curse') return { name: 'curse', h: CARD_HANDLERS.curse };
  if (c.kind === 'oneShot') {
    if (c.effect.op === 'bonus') return { name: 'bonus', h: CARD_HANDLERS.bonus };
    if (c.effect.op === 'custom') return { name: c.effect.handler, h: CARD_HANDLERS[c.effect.handler] };
  }
  if (c.kind === 'other') {
    if (c.effect.op === 'goUpLevel') return { name: 'goUpLevel', h: CARD_HANDLERS.goUpLevel };
    if (c.effect.op === 'custom') return { name: c.effect.handler, h: CARD_HANDLERS[c.effect.handler] };
  }
  return null;
}

// ---------------- race / class ----------------

function raceClassErr(s: GameState, id: PlayerId, card: CardId, replace?: CardId): string | null {
  const e = ownTurnSetupErr(s, id);
  if (e) return e;
  if (!inHand(s, id, card)) return 'That card is not in your hand';
  if (!isRaceClassCard(card)) return 'Not a race or class card';
  const p = player(s, id);
  const c = cardOf(card);
  if (replace !== undefined) {
    if (!p.equipped.includes(replace) || cardOf(replace).kind !== c.kind) return `You can only replace a ${c.kind} you have`;
  }
  if (c.kind === 'race') {
    const mine = raceCards(p).filter((x) => x !== replace);
    if (mine.some((x) => baseId(x) === c.id)) return `You are already ${c.name}`;
    if (mine.length >= maxRaces(p)) return 'You already have a race (play Half-Breed for two, or replace it)';
  } else if (c.kind === 'class') {
    const mine = classCards(p).filter((x) => x !== replace);
    if (mine.some((x) => baseId(x) === c.id)) return `You are already a ${c.name}`;
    if (mine.length >= maxClasses(p)) return 'You already have a class (play Super Munchkin for two, or replace it)';
  } else if (c.id === 'half-breed' && hasHalfBreed(p)) return 'You are already a Half-Breed';
  else if (c.id === 'super-munchkin' && hasSuperMunchkin(p)) return 'You are already a Super Munchkin';
  return null;
}

function raceClassExec(s: GameState, id: PlayerId, card: CardId, replace?: CardId) {
  if (replace) discard(s, replace);
  moveCard(s, card, `${id}.equipped`);
  addLog(s, 'play', `${id} plays ${nameOf(card)}${replace ? ` (replacing ${nameOf(replace)})` : ''}.`, id);
  normalize(s, id);
}

// ---------------- action handlers ----------------

function startCombat(s: GameState, fighter: PlayerId, card: CardId) {
  s.combat = newCombat(s, fighter);
  s.combat.monsters.push({ card, enhancers: [], mate: null });
  s.phase = 'combat';
  now(s, { t: 'enter', card });
}

const H: { [K in Action['type']]: Handler<K> } = {
  // ---- skill parity (GM) ----
  draw: {
    check: (s, a) => (a.n < 1 ? 'Draw at least one card' : (zone(s, a.dest), null)),
    exec(s, a) {
      const got = drawTo(s, a.deck, a.n, a.dest);
      addLog(s, 'gm', `Drew ${got.map(nameOf).join(', ')} to ${a.dest}.`);
    },
  },
  move: {
    check: (s, a) => (zone(s, a.from).includes(a.card) ? (zone(s, a.to), null) : `${a.card} is not in ${a.from}`),
    exec(s, a) {
      zone(s, a.from).splice(zone(s, a.from).indexOf(a.card), 1);
      zone(s, a.to).push(a.card);
      addLog(s, 'gm', `${nameOf(a.card)}: ${a.from} -> ${a.to}`);
    },
  },
  level: {
    check: (s, a) => (s.players[a.player] ? (/^[+\-=]\d+$/.test(a.change) ? null : 'Use +N, -N or =N') : `Unknown player ${a.player}`),
    exec(s, a) {
      const p = player(s, a.player);
      const v = Number(a.change.slice(1));
      const before = p.level;
      p.level = Math.max(1, a.change[0] === '=' ? v : p.level + (a.change[0] === '-' ? -v : v));
      addLog(s, 'level', `${a.player} is Level ${p.level}`, a.player, { from: before, to: p.level });
    },
  },
  die: {
    check: (s, a) => (s.players[a.player] ? null : `Unknown player ${a.player}`),
    exec(s, a) {
      discardOnDeath(s, a.player);
      player(s, a.player).dead = true;
      addLog(s, 'death', `${a.player} is dead; kept ${player(s, a.player).equipped.map(nameOf).join(', ') || 'nothing'}`, a.player);
    },
  },
  revive: {
    check: (s, a) => (s.players[a.player] ? null : `Unknown player ${a.player}`),
    exec(s, a) {
      player(s, a.player).dead = false;
      deal(s, a.player);
      addLog(s, 'revive', `${a.player} revives and draws 4 Door + 4 Treasure.`, a.player);
    },
  },
  roll: {
    check: (_s, a) => ((a.n ?? 1) < 1 ? 'Roll at least one die' : null),
    exec(s, a) {
      const rolls = Array.from({ length: a.n ?? 1 }, () => roll(s));
      addLog(s, 'roll', `${a.player} rolls ${rolls.join(' ')}`, a.player, { rolls });
    },
  },
  check: {
    check: (s, a) => (s.players[a.player] ? null : `Unknown player ${a.player}`),
    exec(s, a) {
      const p = player(s, a.player);
      const over = p.hand.length - handLimit(p);
      addLog(
        s,
        'check',
        `${a.player}: ${p.hand.length}/${handLimit(p)}` +
          (over > 0 ? ` -> ${over} over: play cards or give to lowest-level player (discard if you are lowest)` : ' OK'),
        a.player,
      );
    },
  },
  log: {
    check: (_s, a) => (a.text ? null : 'Empty log line'),
    exec: (s, a) => addLog(s, 'note', a.text),
  },

  // ---- setup ----
  equip: {
    check(s, a) {
      const e = ownTurnSetupErr(s, a.player);
      if (e) return e;
      const p = player(s, a.player);
      if (!p.hand.includes(a.card) && !p.carried.includes(a.card)) return 'Equip from your hand or your carried items';
      if (a.cheat !== undefined) {
        if (!inHand(s, a.player, a.cheat) || baseId(a.cheat) !== 'cheat') return 'You need Cheat! in your hand';
        if (p.cheat) return 'You already have a Cheat! in play';
      }
      return equipError(p, a.card, a.cheat !== undefined);
    },
    exec(s, a) {
      const p = player(s, a.player);
      if (a.cheat) moveCard(s, a.cheat, `${a.player}.equipped`);
      moveCard(s, a.card, `${a.player}.equipped`);
      if (a.cheat) p.cheat = { card: a.cheat, item: a.card };
      addLog(s, 'equip', `${a.player} equips ${nameOf(a.card)}${a.cheat ? ' (Cheat!)' : ''}.`, a.player);
    },
  },
  carry: {
    check(s, a) {
      const e = ownTurnSetupErr(s, a.player);
      if (e) return e;
      const p = player(s, a.player);
      const k = cardOf(a.card).kind;
      if (p.equipped.includes(a.card)) return k === 'item' ? null : 'Only items can be unequipped';
      if (!p.hand.includes(a.card)) return 'That card is not in your hand';
      if (k !== 'item' && k !== 'oneShot') return 'Only items can go on the table';
      return bigError(p, a.card);
    },
    exec(s, a) {
      const p = player(s, a.player);
      const wasEquipped = p.equipped.includes(a.card);
      moveCard(s, a.card, `${a.player}.carried`);
      addLog(s, 'equip', `${a.player} ${wasEquipped ? 'unequips' : 'puts on the table'} ${nameOf(a.card)} (carried).`, a.player);
    },
  },
  playRaceClass: {
    check: (s, a) => raceClassErr(s, a.player, a.card, a.replace),
    exec: (s, a) => raceClassExec(s, a.player, a.card, a.replace),
  },
  discardRaceClass: {
    check(s, a) {
      const e = aliveErr(s, a.player) ?? freeErr(s);
      if (e) return e;
      const p = player(s, a.player);
      if (!p.equipped.includes(a.card) || !isRaceClassCard(a.card)) return 'Choose one of your race or class cards';
      if (baseId(a.card) === 'half-breed' && raceCards(p).length > 1) return 'Discard one of your races first';
      if (baseId(a.card) === 'super-munchkin' && classCards(p).length > 1) return 'Discard one of your classes first';
      return null;
    },
    exec(s, a) {
      discard(s, a.card);
      addLog(s, 'play', `${a.player} discards ${nameOf(a.card)}.`, a.player);
      normalize(s, a.player);
    },
  },
  sell: {
    check(s, a) {
      const e = ownTurnSetupErr(s, a.player);
      if (e) return e;
      const p = player(s, a.player);
      if (!a.cards.length || new Set(a.cards).size !== a.cards.length) return 'Choose cards to sell';
      for (const c of a.cards) {
        if (![...p.hand, ...p.equipped, ...p.carried].includes(c)) return `${nameOf(c)} is not yours to sell`;
        if (deckOf(c) !== 'treasure' || goldOf(c) <= 0) return `${nameOf(c)} has no Gold value`;
      }
      if (a.double !== undefined) {
        if (!a.cards.includes(a.double)) return 'The doubled item must be one you are selling';
        if (!hasPower(p, 'sellDouble')) return 'Only Halflings sell an item for double';
        if (s.flags.halflingDoubleUsed) return 'You already doubled an item this turn';
      }
      const levels = Math.floor(sellValue(a.cards, a.double) / 1000);
      if (levels < 1) return 'Not enough Gold for a level (1,000 Gold per level, no change)';
      if (p.level + levels >= 10) return 'Selling can never give you Level 10';
      return null;
    },
    exec(s, a) {
      const levels = Math.floor(sellValue(a.cards, a.double) / 1000);
      for (const c of a.cards) discard(s, c);
      if (a.double) s.flags.halflingDoubleUsed = true;
      addLog(s, 'sell', `${a.player} sells ${a.cards.map(nameOf).join(', ')}${a.double ? ` (${nameOf(a.double)} doubled)` : ''} for ${levels} level${levels > 1 ? 's' : ''}.`, a.player);
      changeLevel(s, a.player, levels, false);
    },
  },
  trade: {
    check(s, a) {
      const e = ownTurnSetupErr(s, a.player) ?? aliveErr(s, a.to);
      if (e) return e;
      if (a.to === a.player) return 'Trade with someone else';
      if (!a.give.length && !a.get.length) return 'Choose items to trade';
      const mine = ownItems(s, a.player);
      const theirs = ownItems(s, a.to);
      if (!a.give.every((c) => mine.includes(c))) return 'You can only trade items on your table';
      if (!a.get.every((c) => theirs.includes(c))) return `Those items are not on ${a.to}'s table`;
      return null;
    },
    exec(s, a) {
      s.pending = { type: 'trade', player: a.to, from: a.player, give: a.give, get: a.get };
      addLog(s, 'trade', `${a.player} offers ${a.to} a trade: ${a.give.map(nameOf).join(', ') || 'nothing'} for ${a.get.map(nameOf).join(', ') || 'nothing'}.`, a.player);
    },
  },
  respondTrade: {
    check: (s, a) => (s.pending?.type === 'trade' && s.pending.player === a.player ? null : 'No trade offer for you'),
    exec(s, a) {
      const t = s.pending as Extract<Pending, { type: 'trade' }>;
      s.pending = null;
      if (!a.accept) return addLog(s, 'trade', `${a.player} declines the trade.`, a.player);
      for (const c of t.give) moveCard(s, c, `${t.player}.carried`);
      for (const c of t.get) moveCard(s, c, `${t.from}.carried`);
      addLog(s, 'trade', `${a.player} accepts the trade.`, a.player);
      normalize(s, t.from);
      normalize(s, t.player);
      now(s, { t: 'checkBig', player: t.from }, { t: 'checkBig', player: t.player });
    },
  },

  // ---- door ----
  kickDoor: {
    check(s, a) {
      const e = aliveErr(s, a.player) ?? freeErr(s);
      if (e) return e;
      if (s.turn !== a.player) return 'Not your turn';
      if (s.phase !== 'setup' || s.flags.kicked) return 'You already kicked open the door';
      if (a.resurrect !== undefined) {
        if (!hasPower(player(s, a.player), 'resurrection')) return 'Only Clerics can use Resurrection';
        if (!inHand(s, a.player, a.resurrect)) return 'Pay with a card from your hand';
        if (!s.discard_door.length) return 'The Door discard pile is empty';
      }
      return null;
    },
    exec(s, a) {
      s.flags.kicked = true;
      s.phase = 'afterDoor';
      let card: CardId | null;
      if (a.resurrect) {
        card = s.discard_door.pop()!;
        discard(s, a.resurrect);
        addLog(s, 'play', `${a.player} uses Resurrection (paying ${nameOf(a.resurrect)}) and takes ${nameOf(card)} from the discards.`, a.player);
      } else card = drawOne(s, 'door');
      if (!card) return addLog(s, 'door', 'There are no Door cards left anywhere.', a.player);
      const c = cardOf(card);
      addLog(s, 'door', `${a.player} kicks open the door: ${nameOf(card)}!`, a.player, { card });
      if (c.kind === 'monster') {
        s.play.push(card);
        startCombat(s, a.player, card);
      } else if (c.kind === 'curse') {
        s.play.push(card);
        now(s, { t: 'curse', card, target: a.player, fromDoor: true, by: null });
      } else player(s, a.player).hand.push(card);
    },
  },
  lookForTrouble: {
    check(s, a) {
      const e = aliveErr(s, a.player) ?? freeErr(s);
      if (e) return e;
      if (s.turn !== a.player || s.phase !== 'afterDoor') return 'Look for Trouble after kicking open the door, when there was no fight';
      if (!inHand(s, a.player, a.card) || cardOf(a.card).kind !== 'monster') return 'Choose a monster from your hand';
      return null;
    },
    exec(s, a) {
      moveCard(s, a.card, 'play');
      addLog(s, 'door', `${a.player} looks for trouble with ${nameOf(a.card)}.`, a.player);
      startCombat(s, a.player, a.card);
    },
  },
  lootRoom: {
    check(s, a) {
      const e = aliveErr(s, a.player) ?? freeErr(s);
      if (e) return e;
      if (s.turn !== a.player || s.phase !== 'afterDoor') return 'Loot the Room after kicking open the door, when there was no fight';
      return null;
    },
    exec(s, a) {
      const got = drawTo(s, 'door', 1, `${a.player}.hand`);
      s.phase = 'charity';
      addLog(s, 'door', `${a.player} loots the room${got.length ? ' (1 Door face-down)' : ' but finds nothing'}.`, a.player);
    },
  },

  // ---- combat ----
  askHelp: {
    check(s, a) {
      const e = fighterErr(s, a.player) ?? aliveErr(s, a.target);
      if (e) return e;
      const c = s.combat!;
      if (c.helper) return 'You already have a helper';
      if (c.monsters.some((m) => monsterOf(m.card).rules.noHelp)) return 'Nobody can help you against this monster';
      if (a.target === a.player) return "You can't help yourself";
      if (c.declined.includes(a.target)) return `${a.target} already refused`;
      const total = c.monsters.reduce((x, m) => x + monsterTreasure(m), 0);
      if (!Number.isInteger(a.offer) || a.offer < 0 || a.offer > Math.max(total, 0)) return `Offer between 0 and ${total} Treasure`;
      return null;
    },
    exec(s, a) {
      const f = player(s, a.player);
      const forced = !!hasEquippedAbility(f, 'kneepads') && player(s, a.target).level < f.level;
      const offer = forced ? 0 : a.offer;
      s.pending = { type: 'helpRequest', player: a.target, fighter: a.player, offer, forced };
      addLog(s, 'help', forced
        ? `${a.player} flashes the Kneepads of Allure: ${a.target} must help, for nothing.`
        : `${a.player} asks ${a.target} for help, offering ${offer} Treasure.`, a.player);
    },
  },
  respondHelp: {
    check(s, a) {
      const p = s.pending;
      if (p?.type !== 'helpRequest' || p.player !== a.player) return 'Nobody asked you for help';
      if (!a.accept && p.forced) return 'Kneepads of Allure: you must help';
      return null;
    },
    exec(s, a) {
      const p = s.pending as Extract<Pending, { type: 'helpRequest' }>;
      s.pending = null;
      const c = s.combat!;
      if (!a.accept) {
        c.declined.push(a.player);
        return addLog(s, 'help', `${a.player} refuses to help.`, a.player);
      }
      c.helper = a.player;
      c.deal = p.offer;
      if (curseRules(player(s, a.player)).mirror && !c.mirrored.includes(a.player)) c.mirrored.push(a.player);
      addLog(s, 'help', `${a.player} joins the fight${p.offer ? ` for ${p.offer} Treasure` : ''}.`, a.player);
    },
  },
  avoidMonster: {
    check(s, a) {
      const e = fighterErr(s, a.player) ?? monsterIdxErr(s, { monster: a.monster });
      if (e) return e;
      const av = monsterOf(s.combat!.monsters[a.monster].card).rules.avoid;
      if (!av?.optional) return "You can't skip this monster";
      if (!matches(player(s, a.player), av.if)) return "This monster's escape clause doesn't apply to you";
      return null;
    },
    exec(s, a) {
      const m = removeMonster(s, a.monster);
      const av = monsterOf(m.card).rules.avoid!;
      addLog(s, 'combat', `${a.player} lets ${nameOf(m.card)} go${av.treasures ? ` and takes ${av.treasures} Treasure` : ' (no Treasure)'}.`, a.player);
      drawTo(s, 'treasure', av.treasures, `${a.player}.hand`);
      afterMonsterRemoved(s);
    },
  },
  fight: {
    check(s, a) {
      const e = fighterErr(s, a.player);
      if (e) return e;
      if (!combatTotals(s).playerWins) return "You're not winning: add cards, ask for help, or run away";
      return null;
    },
    exec(s, a) {
      s.combat!.resolving = true;
      const queue = combatResponders(s);
      addLog(s, 'combat', `${a.player} is ready to finish the fight.`, a.player);
      if (queue.length) s.pending = { type: 'combatWindow', queue };
      else now(s, { t: 'winCombat' });
    },
  },
  runAway: {
    check: (s, a) => fighterErr(s, a.player),
    exec(s, a) {
      interrupt(s);
      addLog(s, 'run', `${a.player}${s.combat!.helper ? ` and ${s.combat!.helper}` : ''} run away!`, a.player);
      queueRun(s);
    },
  },
  useRat: {
    check: (s, a) => (s.pending?.type === 'preRun' && s.pending.player === a.player ? null : 'Nothing to decide'),
    exec(s, a) {
      const p = s.pending as Extract<Pending, { type: 'preRun' }>;
      s.pending = null;
      if (a.use) useRat(s, a.player, p.monster);
      else rollToRun(s, a.player, p.monster, p.copy);
    },
  },
  pass: {
    check(s, a) {
      const p = s.pending;
      if (!p || !('queue' in p) || p.queue[0] !== a.player) return 'Nothing to pass on';
      return null;
    },
    exec(s, a) {
      const p = s.pending!;
      if (!('queue' in p)) return;
      p.queue.shift();
      if (p.queue.length) return;
      s.pending = null;
      if (p.type === 'combatWindow') now(s, { t: 'winCombat' });
      else if (p.type === 'curseWindow') applyCurse(s, p.task);
      else if (p.type === 'rollWindow') resolveRoll(s, p.roller, p.purpose, p.natural);
      void a;
    },
  },
  playCard: {
    check(s, a) {
      const e = aliveErr(s, a.player);
      if (e) return e;
      const ctx = context(s, a.player);
      if (!ctx) return freeErr(s);
      if (!playable(s, a.player, a.card)) return 'You can only play cards from your hand (or carried one-shots)';
      const c = cardOf(a.card);
      if (c.kind === 'monster') return 'Monsters are played with Look for Trouble or Wandering Monster';
      if (c.kind === 'race' || c.kind === 'class') return 'Use playRaceClass for race and class cards';
      if (c.kind === 'item') return 'Items are equipped or carried, not played';
      const h = handlerFor(a.card);
      if (!h?.h) return `${c.name} has no effect to play`;
      if (!h.h.ctx.includes(ctx)) return ctx === 'free' ? `${c.name} can't be played right now` : `${c.name} isn't a response to this`;
      if (c.kind === 'oneShot' && c.usable === 'ownCombat' && s.combat?.fighter !== a.player) return 'Only in your own combat';
      return h.h.check(s, a.player, a.card, a.target);
    },
    exec(s, a) {
      const h = handlerFor(a.card)!;
      if (h.h.ctx.includes('combatWindow') && s.pending?.type === 'combatWindow') interrupt(s);
      h.h.exec(s, a.player, a.card, a.target);
    },
  },
  power: {
    check: (s, a) => powerErr(s, a),
    exec: (s, a) => powerExec(s, a),
  },
  chooseCards: {
    check(s, a) {
      const p = s.pending;
      if (p?.type !== 'chooseCards' || p.player !== a.player) return 'Nothing to choose';
      if (new Set(a.cards).size !== a.cards.length) return 'Duplicate cards';
      if (!a.cards.every((c) => p.options.includes(c))) return 'Choose from the offered cards';
      if (a.cards.length < p.min || a.cards.length > p.max) return p.min === p.max ? `Choose exactly ${p.min}` : `Choose ${p.min} to ${p.max}`;
      if (p.minGold !== undefined && a.cards.length) {
        const sum = a.cards.reduce((x, c) => x + goldOf(c), 0);
        if (sum < p.minGold) return `That's only ${sum} Gold; you need ${p.minGold}`;
        if (a.cards.some((c) => sum - goldOf(c) >= p.minGold!)) return 'No change is given: drop the items you do not need';
      }
      return null;
    },
    exec(s, a) {
      const p = s.pending as Extract<Pending, { type: 'chooseCards' }>;
      s.pending = null;
      resolveChoice(s, p, a.cards);
    },
  },
  chooseOption: {
    check(s, a) {
      const p = s.pending;
      if (p?.type !== 'chooseOption' || p.player !== a.player) return 'Nothing to choose';
      if (!Number.isInteger(a.option) || a.option < 0 || a.option >= p.options.length) return 'Invalid option';
      return null;
    },
    exec(s, a) {
      const p = s.pending as Extract<Pending, { type: 'chooseOption' }>;
      s.pending = null;
      if (p.ctx.kind === 'opsChoice') {
        addLog(s, 'badStuff', `${a.player} chooses: ${p.options[a.option]}.`, a.player);
        now(s, { t: 'ops', victim: p.ctx.victim, ops: p.ctx.options[a.option], source: p.ctx.source });
      } else {
        moveCard(s, p.ctx.card, `${p.ctx.recipients[a.option]}.hand`);
        addLog(s, 'badStuff', `${p.ctx.from} gives a card to ${p.ctx.recipients[a.option]}.`, p.ctx.from);
      }
    },
  },
  resurrect: {
    check(s, a) {
      const p = s.pending;
      if (p?.type !== 'resurrect' || p.player !== a.player) return 'Nothing to resurrect';
      if (a.discard !== null && !inHand(s, a.player, a.discard)) return 'Pay with a card from your hand';
      return null;
    },
    exec(s, a) {
      const p = s.pending as Extract<Pending, { type: 'resurrect' }>;
      if (a.discard) {
        const top = s.discard_treasure.pop()!;
        s.play.push(top);
        discard(s, a.discard);
        p.drawn.push(top);
        p.remaining -= 1;
        addLog(s, 'play', `${a.player} uses Resurrection: takes ${nameOf(top)} from the discards (paying ${nameOf(a.discard)}).`, a.player);
      } else {
        p.drawn.push(...drawTo(s, 'treasure', p.remaining, 'play'));
        p.remaining = 0;
      }
      if (p.remaining > 0 && canResurrect(s, a.player, 'treasure')) return;
      if (p.remaining > 0) p.drawn.push(...drawTo(s, 'treasure', p.remaining, 'play'));
      s.pending = null;
      const split = p.ctx.kind === 'reward' ? p.ctx.split : null;
      finishTreasure(s, a.player, p.drawn, true, split);
    },
  },
  endTurn: {
    check(s, a) {
      const e = freeErr(s);
      if (e) return e;
      if (s.turn !== a.player) return 'Not your turn';
      if (s.combat) return 'Finish the combat first';
      if (!s.flags.kicked) return 'Kick open the door first';
      if (s.phase === 'afterDoor') return 'Look for Trouble or Loot the Room first';
      return null;
    },
    exec(s, a) {
      const p = player(s, a.player);
      const excess = p.hand.length - handLimit(p);
      if (excess > 0) {
        s.pending = { type: 'charity', player: a.player, excess };
        return addLog(s, 'charity', `${a.player} has ${p.hand.length} cards (limit ${handLimit(p)}): ${excess} must go to charity.`, a.player);
      }
      nextTurn(s);
    },
  },
  charity: {
    check(s, a) {
      const p = s.pending;
      if (p?.type !== 'charity' || p.player !== a.player) return 'No charity due';
      if (a.cards.length !== p.excess || new Set(a.cards).size !== a.cards.length) return `Choose exactly ${p.excess} cards`;
      if (!a.cards.every((c) => inHand(s, a.player, c))) return 'Choose cards from your hand';
      return null;
    },
    exec(s, a) {
      s.pending = null;
      const me = player(s, a.player);
      const alive = others(s, a.player).filter((o) => !player(s, o).dead);
      const low = alive.length ? Math.min(...alive.map((o) => player(s, o).level)) : Infinity;
      if (!alive.length || me.level <= low) {
        for (const c of a.cards) discard(s, c);
        addLog(s, 'charity', `${a.player} is the lowest level and discards ${a.cards.length} card(s).`, a.player);
      } else {
        const recips = alive.filter((o) => player(s, o).level === low);
        a.cards.forEach((c, i) => moveCard(s, c, `${recips[i % recips.length]}.hand`));
        addLog(s, 'charity', `${a.player} gives ${a.cards.length} card(s) to ${recips.join(', ')} (charity).`, a.player);
      }
      nextTurn(s);
    },
  },
};

export function sellValue(cards: CardId[], double?: CardId) {
  return cards.reduce((x, c) => x + goldOf(c), 0) + (double ? goldOf(double) : 0);
}

/** Players (other than the fighter) with at least one legal card to play into this combat. */
export function combatResponders(s: GameState): PlayerId[] {
  const c = s.combat!;
  return others(s, c.fighter).filter((id) => {
    if (player(s, id).dead) return false;
    const probe: GameState = { ...s, pending: { type: 'combatWindow', queue: [id] } };
    return hasAnyPlay(probe, id);
  });
}

/** Cheap legality probe: can `id` play anything at all right now? */
export function hasAnyPlay(s: GameState, id: PlayerId): boolean {
  return enumeratePlays(s, id).some((a) => check(s, a) === null);
}

/** Candidate playCard / power actions for a player (unfiltered). */
export function enumeratePlays(s: GameState, id: PlayerId): Action[] {
  const p = player(s, id);
  const out: Action[] = [];
  const cards = [...p.hand, ...p.carried.filter((c) => cardOf(c).kind === 'oneShot')];
  const nm = s.combat?.monsters.length ?? 0;
  for (const card of cards) {
    const h = handlerFor(card);
    if (!h?.h) continue;
    const base = { type: 'playCard' as const, player: id, card };
    switch (h.name) {
      case 'bonus':
        out.push({ ...base, target: { side: 'player' } }, { ...base, target: { side: 'monster' } });
        break;
      case 'enhancer':
      case 'mate':
      case 'outToLunch':
      case 'magicLamp':
      case 'pollymorph':
        for (let i = 0; i < nm; i++) out.push({ ...base, target: { monster: i } });
        break;
      case 'curse':
      case 'transferral':
        for (const o of s.order) out.push({ ...base, target: { player: o } });
        break;
      case 'wanderingMonster':
        for (const m of p.hand) if (cardOf(m).kind === 'monster') out.push({ ...base, target: { card: m } });
        break;
      case 'illusion':
        for (const m of p.hand) if (cardOf(m).kind === 'monster') for (let i = 0; i < nm; i++) out.push({ ...base, target: { card: m, monster: i } });
        break;
      case 'helpMeOutHere':
        for (const o of s.order) if (o !== id) for (const it of ownItems(s, o)) out.push({ ...base, target: { card: it } });
        break;
      case 'loadedDie':
        for (let v = 1; v <= 6; v++) out.push({ ...base, target: { value: v } });
        break;
      case 'wishingRing':
        out.push(base);
        for (const o of s.order) for (const cu of player(s, o).curses) out.push({ ...base, target: { player: o, card: cu } });
        break;
      case 'cheat':
        for (const it of [...p.hand, ...p.carried]) if (itemOf(it)) out.push({ ...base, target: { card: it } });
        break;
      default:
        out.push(base);
    }
  }
  // class powers
  const hand = p.hand;
  if (hand.length) {
    const one = [hand[0]];
    for (const power of ['berserk', 'turn', 'flight', 'halflingReroll'] as const) out.push({ type: 'power', player: id, power, discard: one });
    out.push({ type: 'power', player: id, power: 'charm', discard: [...hand], target: { monster: 0 } });
    for (let i = 1; i < nm; i++) out.push({ type: 'power', player: id, power: 'charm', discard: [...hand], target: { monster: i } });
    if (s.combat) for (const v of combatants(s.combat)) out.push({ type: 'power', player: id, power: 'backstab', discard: one, target: { player: v } });
  }
  return out;
}

// ---------------- class powers ----------------

function powerErr(s: GameState, a: A<'power'>): string | null {
  const e = aliveErr(s, a.player);
  if (e) return e;
  const ctx = context(s, a.player);
  if (!ctx) return freeErr(s);
  const p = player(s, a.player);
  if (!a.discard.length && a.power !== 'charm') return 'Discard at least one card';
  if (new Set(a.discard).size !== a.discard.length || !a.discard.every((c) => p.hand.includes(c))) return 'Discard cards from your hand';
  const c = s.combat;
  const inFight = c ? combatants(c).includes(a.player) : false;
  const combatCtx = ctx === 'free' || ctx === 'combatWindow';
  switch (a.power) {
    case 'berserk': {
      const pw = hasPower(p, 'berserking');
      if (!pw) return 'Only Warriors can Berserk';
      if (!combatCtx || !c || c.running || !inFight) return 'Berserk in a combat you are in';
      if ((c.berserk[a.player] ?? 0) + a.discard.length > pw.max) return `Berserking: at most ${pw.max} cards per combat`;
      return null;
    }
    case 'turn': {
      const pw = hasPower(p, 'turning');
      if (!pw) return 'Only Clerics can Turn';
      if (!combatCtx || !c || c.running || !inFight) return 'Turn in a combat you are in';
      if (!c.monsters.some((m) => monsterOf(m.card).undead)) return 'Turning only works against Undead';
      if ((c.turning[a.player] ?? 0) + a.discard.length > pw.max) return `Turning: at most ${pw.max} cards per combat`;
      return null;
    }
    case 'flight': {
      const pw = hasPower(p, 'flight');
      if (!pw) return 'Only Wizards can use Flight';
      if (!combatCtx || !c || c.running || !inFight) return 'Use Flight in a combat you are in';
      if ((c.flight[a.player] ?? 0) + a.discard.length > pw.max) return `Flight: at most ${pw.max} cards per combat`;
      return null;
    }
    case 'charm': {
      const pw = hasPower(p, 'charm');
      if (!pw) return 'Only Wizards can Charm';
      if (ctx !== 'free' || !c || c.running || c.fighter !== a.player) return 'Charm a monster in your own combat';
      if (p.hand.length < pw.minHand) return `Charm needs a hand of at least ${pw.minHand} cards`;
      if (a.discard.length !== p.hand.length) return 'Charm discards your whole hand';
      return monsterIdxErr(s, a.target);
    }
    case 'backstab': {
      const pw = hasPower(p, 'backstab');
      if (!pw) return 'Only Thieves can Backstab';
      if (!combatCtx || !c || c.running) return 'Backstab during a combat';
      if (a.discard.length !== pw.cost) return `Backstab costs ${pw.cost} card`;
      const v = a.target?.player;
      if (!v || !combatants(c).includes(v)) return 'Backstab the fighter or the helper';
      if (v === a.player) return "You can't backstab yourself";
      if (c.backstabs.some((b) => b.thief === a.player && b.victim === v)) return 'Only once per victim per combat';
      return null;
    }
    case 'theft': {
      const pw = hasPower(p, 'theft');
      if (!pw) return 'Only Thieves can steal';
      if (ctx !== 'free' || c) return 'You cannot steal during combat';
      if (a.discard.length !== pw.cost) return `Theft costs ${pw.cost} card`;
      const v = a.target?.player;
      const item = a.target?.card;
      if (!v || v === a.player || !s.players[v]) return 'Choose a player to steal from';
      if (!item || !ownItems(s, v).includes(item) || !itemOf(item) || itemOf(item)!.big) return 'Choose a small item on their table';
      return null;
    }
    case 'halflingReroll': {
      const pw = hasPower(p, 'rerollFailedRun');
      if (!pw) return 'Only Halflings can reroll a failed run';
      if (ctx !== 'rollWindow') return 'Use it right after a failed run';
      const w = s.pending as Extract<Pending, { type: 'rollWindow' }>;
      if (!rollResponses(s, a.player, w.roller, w.purpose, w.natural).includes('halflingReroll')) return 'No failed run to reroll';
      if (a.discard.length !== pw.cost) return `Costs ${pw.cost} card`;
      return null;
    }
  }
  return 'Unknown power';
}

function powerExec(s: GameState, a: A<'power'>) {
  const c = s.combat;
  if (a.power !== 'halflingReroll' && a.power !== 'theft') interrupt(s);
  for (const d of a.discard) discard(s, d);
  const n = a.discard.length;
  switch (a.power) {
    case 'berserk':
      c!.berserk[a.player] = (c!.berserk[a.player] ?? 0) + n;
      return addLog(s, 'power', `${a.player} goes Berserk (+${n}).`, a.player);
    case 'turn':
      c!.turning[a.player] = (c!.turning[a.player] ?? 0) + n;
      return addLog(s, 'power', `${a.player} Turns the Undead (+${3 * n}).`, a.player);
    case 'flight':
      c!.flight[a.player] = (c!.flight[a.player] ?? 0) + n;
      return addLog(s, 'power', `${a.player} readies Flight (+${n} to run).`, a.player);
    case 'charm': {
      const m = removeMonster(s, a.target!.monster!);
      const t = monsterTreasure(m);
      addLog(s, 'power', `${a.player} discards their hand to Charm ${nameOf(m.card)} and takes ${t} Treasure (no level).`, a.player);
      drawTo(s, 'treasure', t, `${a.player}.hand`);
      return afterMonsterRemoved(s);
    }
    case 'backstab':
      c!.backstabs.push({ thief: a.player, victim: a.target!.player! });
      return addLog(s, 'power', `${a.player} Backstabs ${a.target!.player} (-2).`, a.player);
    case 'theft':
      addLog(s, 'power', `${a.player} tries to steal ${nameOf(a.target!.card!)} from ${a.target!.player}.`, a.player);
      return startRoll(s, a.player, { kind: 'theft', thief: a.player, victim: a.target!.player!, item: a.target!.card! });
    case 'halflingReroll': {
      const w = s.pending as Extract<Pending, { type: 'rollWindow' }>;
      s.pending = null;
      c!.halflingRerolls[a.player] = (c!.halflingRerolls[a.player] ?? 0) + 1;
      addLog(s, 'power', `${a.player} (Halfling) discards a card to try running again.`, a.player);
      return startRoll(s, w.roller, w.purpose);
    }
  }
}

// ---------------- choices ----------------

function resolveChoice(s: GameState, p: Extract<Pending, { type: 'chooseCards' }>, cards: CardId[]) {
  const id = p.player;
  const names = cards.map(nameOf).join(', ');
  switch (p.reason) {
    case 'discardItem':
    case 'loseItem':
    case 'loseItems':
    case 'loseGold':
    case 'loseBest':
      for (const c of cards) discard(s, c);
      return addLog(s, 'badStuff', `${id} loses ${names}.`, id);
    case 'incomeTax': {
      const value = goldOf(cards[0]);
      discard(s, cards[0]);
      addLog(s, 'curse', `Income Tax: ${id} discards ${names} (${value} Gold). Everyone else pays ${value} Gold in items or loses a level.`, id);
      now(s, ...others(s, id).filter((o) => !player(s, o).dead).map((o) => ({ t: 'incomeTaxOther' as const, player: o, value })));
      return;
    }
    case 'incomeTaxPay':
      if (!cards.length) {
        addLog(s, 'curse', `Income Tax: ${id} keeps their items and loses a level.`, id);
        return changeLevel(s, id, -1);
      }
      for (const c of cards) discard(s, c);
      return addLog(s, 'curse', `Income Tax: ${id} pays with ${names}.`, id);
    case 'keepBig':
      for (const c of p.options) if (!cards.includes(c)) discard(s, c);
      return addLog(s, 'effect', `${id} keeps ${names} and discards their other Big items.`, id);
    case 'takeItem': {
      const victim = p.ctx.victim as PlayerId;
      moveCard(s, cards[0], `${id}.carried`);
      addLog(s, 'badStuff', `${id} takes ${names} from ${victim}.`, id);
      now(s, { t: 'checkBig', player: id });
      return;
    }
    case 'loot': {
      const dead = p.ctx.victim as PlayerId;
      moveCard(s, cards[0], `${id}.hand`);
      addLog(s, 'loot', `${id} loots ${names} from ${dead}'s body.`, id);
      now(s, { t: 'loot', dead, looters: p.ctx.rest as PlayerId[] });
      return;
    }
    case 'giveCards':
      now(s, ...cards.map((card) => ({ t: 'giveTo' as const, from: id, card })));
      return;
    case 'splitTreasure': {
      const fighter = p.ctx.fighter as PlayerId;
      for (const c of cards) moveCard(s, c, `${id}.hand`);
      for (const c of (p.ctx.cards as CardId[]).filter((x) => !cards.includes(x) && s.play.includes(x))) moveCard(s, c, `${fighter}.hand`);
      return addLog(s, 'treasure', `${id} takes ${cards.length} Treasure as agreed; ${fighter} keeps the rest.`, id);
    }
    default:
      for (const c of cards) discard(s, c);
  }
}

// ---------------- public API ----------------

export function check(s: GameState, a: Action): string | null {
  if (!a || typeof a !== 'object' || !(a.type in H)) return 'Unknown action';
  if (s.phase === 'gameOver' && !GM_ACTIONS.has(a.type)) return 'The game is over';
  if (!GM_ACTIONS.has(a.type) && 'player' in a && !s.players[a.player]) return `Unknown player ${a.player}`;
  try {
    return (H[a.type] as Handler<typeof a.type>).check(s, a as never);
  } catch (e) {
    return (e as Error).message;
  }
}

export function apply(s: GameState, a: Action): ApplyResult {
  const err = check(s, a);
  if (err) return { ok: false, error: err };
  const n = cloneState(s);
  (H[a.type] as Handler<typeof a.type>).exec(n, a as never);
  if (!GM_ACTIONS.has(a.type)) n.flags.acted = true;
  drain(n);
  return { ok: true, state: n };
}

/** apply() that throws on a rule error — handy in tests and scripts. */
export function applyOrThrow(s: GameState, a: Action): GameState {
  const r = apply(s, a);
  if (!r.ok) throw new Error(`${a.type}: ${r.error}`);
  return r.state;
}

export { handCounts, isBorrowed };
