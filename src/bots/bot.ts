// Rule-based rival bots. A bot sees only its own view (other hands as Door/Treasure counts)
// and returns one action. Heuristics follow the skill's "Playing the rivals" section.
import { apply, check, combatResponders } from '../engine/actions';
import { cardOf, goldOf, itemOf, monsterOf } from '../engine/cards';
import { combatTotals, combatants, monsterLevels, monsterTreasure } from '../engine/combat';
import { legalActions, minimalGold } from '../engine/legal';
import {
  classes,
  equipError,
  equippedItems,
  handLimit,
  hasPower,
  isLeader,
  itemBonus,
  qualifies,
  raceCards,
  classCards,
  races,
  strength,
} from '../engine/rules';
import type { Action, CardId, GameState, Pending, PlayerId } from '../engine/types';
import type { Personality } from './personalities';

export type Decision = Action;

/** Who must act next: the pending decision-maker, else the fighter, else the turn player. */
export function actor(s: GameState): PlayerId | null {
  if (s.phase === 'gameOver') return null;
  const p = s.pending;
  if (p) return 'queue' in p ? p.queue[0] : p.player;
  if (s.combat) return s.combat.fighter;
  return s.turn;
}

// ---------------- valuation ----------------

function me(v: GameState, id: PlayerId) {
  return v.players[id];
}

/** How much a card is worth keeping, for player `id` (higher = keep). */
export function keepValue(v: GameState, id: PlayerId, card: CardId): number {
  if (card.startsWith('?')) return 100;
  const c = cardOf(card);
  const p = me(v, id);
  switch (c.kind) {
    case 'item': {
      const usable = qualifies(p, c);
      return (usable ? Math.max(c.bonus, c.bonusIf && itemBonus(p, card) > c.bonus ? c.bonusIf.bonus : 0) * 250 : 0) + c.gold * 0.5 + (c.ability ? 200 : 0) + (c.runBonus ? 300 : 0);
    }
    case 'oneShot':
      return 300 + c.bonus * 120 + (c.effect.op === 'custom' ? 300 : 0);
    case 'other':
      return c.effect.op === 'goUpLevel' ? 1000 : 450;
    case 'curse':
      return 350;
    case 'enhancer':
      return 250;
    case 'monster':
      return 120 - c.level * 5;
    case 'race':
    case 'class':
      return (c.kind === 'race' ? raceCards(p).length : classCards(p).length) ? 60 : 500;
  }
}

function cheapest(v: GameState, id: PlayerId, cards: CardId[], n = 1, except: CardId[] = []): CardId[] {
  return [...cards].filter((c) => !except.includes(c)).sort((a, b) => keepValue(v, id, a) - keepValue(v, id, b)).slice(0, n);
}

/** Deterministic "coin flip" from the state so games replay exactly. */
function chance(v: GameState, id: PlayerId, salt: string, p: number) {
  let h = 2166136261;
  for (const ch of `${id}|${salt}|${v.eventSeq}|${v.turnNumber}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return ((h >>> 0) % 1000) / 1000 < p;
}

function leader(v: GameState): PlayerId {
  return [...v.order].sort((a, b) => v.players[b].level - v.players[a].level)[0];
}

function threat(v: GameState, id: PlayerId, other: PlayerId) {
  // how dangerous `other` is to `id` (0..)
  return v.players[other].level - v.players[id].level + (isLeader(v, other) ? 2 : 0);
}

function sim(v: GameState, a: Action): GameState | null {
  const r = apply(v, a);
  return r.ok ? r.state : null;
}

function margin(v: GameState): number {
  if (!v.combat || !v.combat.monsters.length) return 99;
  const t = combatTotals(v);
  const warrior = combatants(v.combat).some((id) => hasPower(v.players[id], 'winTies'));
  return t.player - t.monster - (warrior ? 0 : 1) + 1; // > 0 means winning
}

function rewardLevels(v: GameState): number {
  return v.combat ? v.combat.monsters.reduce((a, m) => a + monsterLevels(m), 0) : 0;
}

function badStuffSeverity(v: GameState): number {
  if (!v.combat) return 0;
  let sev = 0;
  for (const m of v.combat.monsters) {
    const mc = monsterOf(m.card);
    const txt = JSON.stringify(mc.badStuff);
    if (txt.includes('"die"')) sev += 10;
    else if (txt.includes('setLevel')) sev += 6;
    else if (txt.includes('loseAllItems') || txt.includes('othersTakeItem')) sev += 6;
    else sev += 3;
  }
  return sev;
}

// ---------------- main entry ----------------

export function chooseAction(v: GameState, id: PlayerId, pers: Personality): Decision {
  const legal = legalActions(v, id);
  if (!legal.length) throw new Error(`${id} has no legal action`);
  const pick = (a: Action | null | undefined) => (a && check(v, a) === null ? a : null);
  const p = v.pending;
  if (p) return pick(onPending(v, id, pers, p, legal)) ?? fallback(legal);
  if (v.combat?.fighter === id) return pick(asFighter(v, id, pers, legal)) ?? fallback(legal);
  if (v.turn === id) return pick(onTurn(v, id, pers, legal)) ?? fallback(legal);
  return fallback(legal);
}

function fallback(legal: Action[]): Action {
  const prefer = ['pass', 'respondHelp', 'respondTrade', 'chooseCards', 'chooseOption', 'resurrect', 'useRat', 'charity', 'runAway', 'endTurn', 'lootRoom', 'kickDoor'];
  for (const t of prefer) {
    const a = legal.find((x) => x.type === t && !(x.type === 'respondHelp' && x.accept));
    if (a) return a;
  }
  return legal[0];
}

// ---------------- pending decisions ----------------

function onPending(v: GameState, id: PlayerId, pers: Personality, p: Pending, legal: Action[]): Action | null {
  const P = v.players[id];
  switch (p.type) {
    case 'combatWindow':
      return interfere(v, id, pers, legal) ?? { type: 'pass', player: id };
    case 'curseWindow': {
      if (p.task.target !== id) return { type: 'pass', player: id };
      const ring = legal.find((a) => a.type === 'playCard' && cardOf(a.card).id === 'wishing-ring' && !a.target);
      const c = cardOf(p.task.card);
      const harmful = c.kind === 'curse' && !['curse-lose-a-level'].includes(c.id) ? true : P.level > 2;
      return ring && harmful && (P.level >= 3 || (c.kind === 'curse' && c.persistent) || equippedItems(P).length > 1) ? ring : { type: 'pass', player: id };
    }
    case 'rollWindow':
      return onRoll(v, id, pers, p, legal) ?? { type: 'pass', player: id };
    case 'helpRequest':
      return { type: 'respondHelp', player: id, accept: p.forced || wantsToHelp(v, id, pers, p.fighter, p.offer) };
    case 'trade': {
      const gain = p.give.reduce((a, c) => a + keepValue(v, id, c), 0);
      const loss = p.get.reduce((a, c) => a + keepValue(v, id, c), 0);
      const ok = gain > loss * (1 + pers.greed) && !(isLeader(v, p.from) && pers.spite > 0.5);
      return { type: 'respondTrade', player: id, accept: ok };
    }
    case 'chooseCards':
      return chooseCards(v, id, pers, p);
    case 'chooseOption': {
      if (p.ctx.kind === 'giveTo') {
        const best = [...p.ctx.recipients].sort((a, b) => v.players[a].level - v.players[b].level)[0];
        return { type: 'chooseOption', player: id, option: p.ctx.recipients.indexOf(best) };
      }
      // Platycore-style: hand or levels
      const handValue = P.hand.reduce((a, c) => a + keepValue(v, id, c), 0);
      const levelsIdx = p.options.findIndex((o) => /level/i.test(o));
      const handIdx = p.options.findIndex((o) => /hand/i.test(o));
      if (levelsIdx >= 0 && handIdx >= 0) return { type: 'chooseOption', player: id, option: P.level <= 2 || handValue > 1500 ? levelsIdx : handIdx };
      return { type: 'chooseOption', player: id, option: 0 };
    }
    case 'resurrect': {
      const top = v.discard_treasure.at(-1);
      const pay = cheapest(v, id, P.hand)[0];
      if (top && pay && keepValue(v, id, top) > keepValue(v, id, pay) + 150) return { type: 'resurrect', player: id, discard: pay };
      return { type: 'resurrect', player: id, discard: null };
    }
    case 'preRun':
      return { type: 'useRat', player: id, use: true };
    case 'charity':
      return { type: 'charity', player: id, cards: cheapest(v, id, P.hand, p.excess) };
  }
}

function chooseCards(v: GameState, id: PlayerId, pers: Personality, p: Extract<Pending, { type: 'chooseCards' }>): Action {
  const P = v.players[id];
  const asc = [...p.options].sort((a, b) => keepValue(v, id, a) - keepValue(v, id, b));
  const desc = [...asc].reverse();
  const take = (cards: CardId[]) => ({ type: 'chooseCards' as const, player: id, cards });
  switch (p.reason) {
    case 'takeItem':
    case 'loot':
    case 'keepBig':
    case 'splitTreasure':
      return take(desc.slice(0, p.min || 1));
    case 'incomeTaxPay': {
      if (P.level <= 1) return take([]);
      const pay = minimalGold(asc, p.minGold!);
      const cost = (pay ?? []).reduce((a, c) => a + keepValue(v, id, c), 0);
      return take(pay && cost < 900 ? pay : []);
    }
    default: {
      if (p.minGold !== undefined) {
        // lose the least useful set that covers the amount
        for (let n = 1; n <= asc.length; n++) {
          const pick = minimalGold(asc.slice(0, n), p.minGold);
          if (pick) return take(pick);
        }
        return take(minimalGold(asc, p.minGold) ?? asc);
      }
      return take(asc.slice(0, p.min));
    }
  }
  void pers;
}

function onRoll(v: GameState, id: PlayerId, pers: Personality, p: Extract<Pending, { type: 'rollWindow' }>, legal: Action[]): Action | null {
  const plays = legal.filter((a) => a.type === 'playCard' || a.type === 'power');
  const find = (cid: string, value?: number) =>
    plays.find((a) => a.type === 'playCard' && cardOf(a.card).id === cid && (value === undefined || a.target?.value === value)) ?? null;
  const pu = p.purpose;
  if (pu.kind === 'run') {
    if (pu.runner === id) {
      // failing: save ourselves
      return (
        find('invisibility-potion') ??
        (() => {
          const hr = plays.find((a) => a.type === 'power' && a.power === 'halflingReroll');
          if (hr) return { type: 'power', player: id, power: 'halflingReroll', discard: cheapest(v, id, v.players[id].hand) } as Action;
          return find('loaded-die', 6);
        })()
      );
    }
    if (threat(v, id, pu.runner) > 0 && chance(v, id, 'glue', pers.aggression)) return find('flask-of-glue') ?? find('loaded-die', 1);
    return null;
  }
  if (pu.kind === 'ops' && pu.victim === id) {
    const op = pu.ops[0];
    if (op.op !== 'rollThen') return null;
    const harm = (val: number) => {
      const row = op.table.find((r) => val >= r.min && val <= r.max);
      const t = JSON.stringify(row?.then ?? []);
      return t.includes('"die"') ? 100 : val;
    };
    let best = p.natural;
    for (let val = 1; val <= 6; val++) if (harm(val) < harm(best)) best = val;
    if (harm(best) + 1 < harm(p.natural)) return find('loaded-die', best);
    return null;
  }
  if (pu.kind === 'theft' && pu.thief === id && p.natural < 4) return find('loaded-die', 6);
  return null;
}

function wantsToHelp(v: GameState, id: PlayerId, pers: Personality, fighter: PlayerId, offer: number): boolean {
  const c = v.combat!;
  const F = v.players[fighter];
  if (F.level + rewardLevels(v) >= 10) return false; // never help anyone to Level 10
  const joined = sim(v, { type: 'respondHelp', player: id, accept: true });
  if (!joined || margin(joined) <= 0) return false; // we'd both lose
  const elf = !!hasPower(v.players[id], 'onHelpKill');
  if (elf && v.players[id].level + c.monsters.length >= 10) return true; // helping wins us the game
  const total = c.monsters.reduce((a, m) => a + monsterTreasure(m), 0);
  let demand = Math.round(total * pers.greed * 0.6);
  if (isLeader(v, fighter) && fighter !== id) demand = Math.max(demand + 1, Math.ceil(total * 0.6));
  if (elf) demand = Math.max(0, demand - 2);
  return offer >= demand;
}

// ---------------- interfering in others' fights ----------------

function interfere(v: GameState, id: PlayerId, pers: Personality, legal: Action[]): Action | null {
  const c = v.combat;
  if (!c) return null;
  if (c.helper === id) return null; // on the fighter's side
  const F = v.players[c.fighter];
  const winsGame = F.level + rewardLevels(v) >= 10 || (c.helper && hasPower(v.players[c.helper], 'onHelpKill') && v.players[c.helper].level + c.monsters.length >= 10);
  const isThreat = threat(v, id, c.fighter) >= 0;
  const want = winsGame || (isThreat && chance(v, id, 'interfere', pers.aggression * (isLeader(v, c.fighter) ? 1 : 0.5)));
  if (!want) return null;
  const plays = legal.filter((a) => a.type === 'playCard' || a.type === 'power');
  let best: { a: Action; cost: number; stops: boolean; m: number } | null = null;
  const before = margin(v);
  for (const raw of plays) {
    let a = raw;
    if (a.type === 'power') {
      if (a.power !== 'backstab') continue;
      a = { ...a, discard: cheapest(v, id, v.players[id].hand) };
    }
    if (a.type === 'playCard') {
      const cc = cardOf(a.card);
      // don't help the fighter
      if (cc.kind === 'oneShot' && cc.effect.op === 'bonus' && a.target?.side === 'player') continue;
      if (cc.id === 'out-to-lunch' && !winsGame) continue;
      if (cc.kind === 'curse' && a.target?.player !== c.fighter && a.target?.player !== c.helper) continue;
      if (cc.kind === 'other' && cc.effect.op === 'goUpLevel') continue;
      if (cc.id === 'transferral-potion' && a.target?.player === id) continue;
      if (cc.id === 'wishing-ring' || cc.id === 'hoard' || cc.id === 'divine-intervention') continue;
      // Illusion as a weapon: always to stop a win, otherwise only the spiteful bother
      if (cc.id === 'illusion' && !winsGame && !chance(v, id, 'illusion', pers.spite)) continue;
    }
    const after = sim(v, a);
    if (!after) continue;
    const stops = !after.combat || after.combat.fighter !== c.fighter || (!after.pending && margin(after) <= 0) || (after.combat && margin(after) <= 0);
    const m = after.combat ? margin(after) : -99;
    if (m >= before && !stops) continue;
    let cost = a.type === 'power' ? 150 : keepValue(v, id, a.card);
    if (a.type === 'playCard' && ['friendship-potion', 'pollymorph-potion'].includes(cardOf(a.card).id)) cost -= 200; // cheap denials
    if (a.type === 'power') cost -= 250;
    const cand = { a, cost, stops, m };
    if (!best || (cand.stops && !best.stops) || (cand.stops === best.stops && (cand.stops ? cand.cost < best.cost : cand.m < best.m))) best = cand;
  }
  if (!best) return null;
  if (best.stops || winsGame) return best.a;
  return null;
}

// ---------------- own combat ----------------

function asFighter(v: GameState, id: PlayerId, pers: Personality, legal: Action[]): Action | null {
  const c = v.combat!;
  const P = v.players[id];
  const m = margin(v);
  const goingToWin = P.level + rewardLevels(v) >= 10;
  if (m > 0) {
    // winning: add a cushion only when the game is on the line and others can still respond
    if (goingToWin && m <= 3 && combatResponders(v).length) {
      const boost = bestBoost(v, id, legal, 1);
      if (boost) return boost;
    }
    return { type: 'fight', player: id };
  }
  // skip optional monsters (Stoned Golem, Wannabe Vampire, Lawyers) when we can't win
  const avoid = legal.find((a) => a.type === 'avoidMonster');
  if (avoid) return avoid;
  // can we close the gap ourselves?
  const boost = bestBoost(v, id, legal, -m + 1);
  if (boost) return boost;
  // ask for help
  const helpAsk = askForHelp(v, id, pers, legal);
  if (helpAsk) return helpAsk;
  // escape hatches when the Bad Stuff is nasty
  const sev = badStuffSeverity(v);
  const plays = legal.filter((a) => a.type === 'playCard') as Extract<Action, { type: 'playCard' }>[];
  const byId = (cid: string) => plays.find((a) => cardOf(a.card).id === cid);
  if (sev >= 6) {
    const ld = leader(v) !== id ? leader(v) : null;
    const hatch =
      byId('pollymorph-potion') ??
      byId('magic-lamp') ??
      (P.hand.length >= 3 && legal.find((a) => a.type === 'power' && a.power === 'charm')) ??
      byId('out-to-lunch') ??
      byId('friendship-potion') ??
      byId('instant-wall') ??
      (ld ? plays.find((a) => cardOf(a.card).id === 'transferral-potion' && a.target?.player === ld) : undefined);
    if (hatch) {
      if (hatch.type === 'power') return { ...hatch, discard: [...P.hand] };
      return hatch;
    }
  }
  // Wizard Flight before running
  if (hasPower(P, 'flight') && (c.flight[id] ?? 0) < 3 && P.hand.length > 1 && sev >= 3) {
    const card = cheapest(v, id, P.hand)[0];
    const a: Action = { type: 'power', player: id, power: 'flight', discard: [card] };
    if (check(v, a) === null) return a;
  }
  return { type: 'runAway', player: id };
}

/** The cheapest single play that improves our margin; prefer one that wins outright. */
function bestBoost(v: GameState, id: PlayerId, legal: Action[], need: number): Action | null {
  const P = v.players[id];
  const before = margin(v);
  let best: { a: Action; gain: number; cost: number } | null = null;
  let totalGain = 0;
  for (const raw of legal) {
    let a = raw;
    if (a.type === 'power') {
      if (!['berserk', 'turn'].includes(a.power)) continue;
      a = { ...a, discard: cheapest(v, id, P.hand) };
    } else if (a.type === 'playCard') {
      const cc = cardOf(a.card);
      const ok =
        (cc.kind === 'oneShot' && cc.effect.op === 'bonus' && a.target?.side !== 'monster') ||
        cc.id === 'doppleganger' ||
        cc.id === 'yuppie-water' ||
        (cc.id === 'help-me-out-here' && true) ||
        (cc.kind === 'curse' && false);
      if (!ok) continue;
    } else continue;
    const after = sim(v, a);
    if (!after?.combat) continue;
    const gain = margin(after) - before;
    if (gain <= 0) continue;
    totalGain += gain;
    const cost = a.type === 'power' ? keepValue(v, id, a.discard[0]) : keepValue(v, id, a.card);
    const wins = gain >= need;
    if (!best || (wins && (best.gain < need || cost < best.cost)) || (!wins && best.gain < need && gain > best.gain)) best = { a, gain, cost };
  }
  if (!best) return null;
  return best.gain >= need || totalGain >= need ? best.a : null;
}

function askForHelp(v: GameState, id: PlayerId, pers: Personality, legal: Action[]): Action | null {
  const c = v.combat!;
  const asks = legal.filter((a) => a.type === 'askHelp') as Extract<Action, { type: 'askHelp' }>[];
  if (!asks.length) return null;
  const total = c.monsters.reduce((a, m) => a + monsterTreasure(m), 0);
  const offer = Math.min(total, Math.max(total > 1 ? 1 : 0, Math.round(total * (1 - pers.greed))));
  const deficit = -margin(v) + 1;
  const helpers = [...new Set(asks.map((a) => a.target))]
    .filter((t) => strength(v, t) >= deficit)
    .sort((a, b) => threat(v, id, a) - threat(v, id, b) || strength(v, b) - strength(v, a));
  for (const t of helpers) {
    const a = asks.find((x) => x.target === t && x.offer === offer) ?? asks.find((x) => x.target === t);
    if (a) return a;
  }
  return null;
}

// ---------------- own turn ----------------

function onTurn(v: GameState, id: PlayerId, pers: Personality, legal: Action[]): Action | null {
  const P = v.players[id];
  const has = (t: Action['type']) => legal.filter((a) => a.type === t);
  if (v.phase === 'setup' || v.phase === 'charity' || v.phase === 'afterDoor') {
    const setup = improveTable(v, id, pers, legal);
    if (setup) return setup;
  }
  if (v.phase === 'setup') {
    // curses on the leader at the start of our turn
    if (leader(v) !== id && P.level <= v.players[leader(v)].level && chance(v, id, 'curse', pers.spite)) {
      const curse = legal.find(
        (a) => a.type === 'playCard' && cardOf(a.card).kind === 'curse' && a.target?.player === leader(v),
      );
      if (curse) return curse;
    }
    const offer = proposeTrade(v, id, pers);
    if (offer) return offer;
    const kick = legal.find((a) => a.type === 'kickDoor' && !a.resurrect);
    return kick ?? null;
  }
  if (v.phase === 'afterDoor') {
    const lft = (has('lookForTrouble') as Extract<Action, { type: 'lookForTrouble' }>[])
      .map((a) => ({ a, lvl: monsterOf(a.card).level }))
      .filter(({ a }) => {
        const mc = monsterOf(a.card);
        const vs = mc.bonusVs.reduce((x, b) => x + (races(P).some((r) => [b.if.race].flat().includes(r)) || classes(P).some((c) => [b.if.class].flat().includes(c)) ? b.bonus : 0), 0);
        return strength(v, id) > mc.level + vs + 2 && P.level + mc.levelsGained < 10 + (P.level + mc.levelsGained >= 10 ? 1 : 0);
      })
      .sort((x, y) => y.lvl - x.lvl);
    if (lft.length) return lft[0].a;
    return { type: 'lootRoom', player: id };
  }
  if (v.phase === 'charity') return { type: 'endTurn', player: id };
  return null;
}

/** Setup moves: race/class, equip, sell, Go Up a Level, Hoard. One action per call. */
function improveTable(v: GameState, id: PlayerId, pers: Personality, legal: Action[]): Action | null {
  const P = v.players[id];
  // race / class
  for (const a of legal) {
    if (a.type !== 'playRaceClass' || a.replace) continue;
    const c = cardOf(a.card);
    if (c.kind === 'race' && raceCards(P).length === 0) return a;
    if (c.kind === 'class' && classCards(P).length === 0) return a;
    if (c.id === 'half-breed' && P.hand.some((x) => cardOf(x).kind === 'race') && raceCards(P).length === 1) return a;
    if (c.id === 'super-munchkin' && P.hand.some((x) => cardOf(x).kind === 'class') && classCards(P).length === 1) return a;
    if (c.kind === 'race' && c.race === pers.prefers.race && raceCards(P).length < (P.equipped.some((x) => cardOf(x).id === 'half-breed') ? 2 : 1)) return a;
    if (c.kind === 'class' && classCards(P).length < (P.equipped.some((x) => cardOf(x).id === 'super-munchkin') ? 2 : 1)) return a;
  }
  // equip anything that adds strength (or a useful no-bonus item in a free slot)
  const equips = (legal.filter((a) => a.type === 'equip' && !a.cheat) as Extract<Action, { type: 'equip' }>[])
    .map((a) => ({ a, b: itemBonus(P, a.card) + (itemOf(a.card)!.runBonus ?? 0) * 0.5 + (itemOf(a.card)!.ability ? 0.25 : 0) }))
    .filter((x) => x.b > 0)
    .sort((x, y) => y.b - x.b);
  if (equips.length) return equips[0].a;
  // swap out a worse item for a better one we can't fit
  for (const c of [...P.hand, ...P.carried]) {
    const it = itemOf(c);
    if (!it || !qualifies(P, it) || it.bonus <= 0) continue;
    const blockers = equippedItems(P).filter((e) => {
      const ei = itemOf(e)!;
      return ei.slot === it.slot && it.slot !== 'none' && itemBonus(P, e) < itemBonus(P, c);
    });
    for (const b of blockers) {
      const unequip: Action = { type: 'carry', player: id, card: b };
      if (check(v, unequip) !== null) continue;
      const after = sim(v, unequip);
      if (after && equipError(after.players[id], c) === null) return unequip;
    }
  }
  // Cheat!: put on the best item we otherwise couldn't use. Pushier, greedier bots cheat for smaller gains.
  const cheatMin = 4 - Math.round(2 * Math.max(pers.aggression, pers.greed));
  const cheats = (legal.filter((a) => a.type === 'playCard' && cardOf(a.card).id === 'cheat' && a.target?.card) as Extract<Action, { type: 'playCard' }>[])
    .map((a) => ({ a, b: itemOf(a.target!.card!)?.bonus ?? 0 }))
    .filter((x) => x.b >= cheatMin && equipError(P, x.a.target!.card!) !== null)
    .sort((x, y) => y.b - x.b);
  if (cheats.length) return cheats[0].a;
  // Big items in hand: carry them if allowed (Dwarves hoard)
  // Go Up a Level / Hoard!
  const lvl = legal.find((a) => a.type === 'playCard' && cardOf(a.card).kind === 'other' && (cardOf(a.card) as { effect: { op: string } }).effect.op === 'goUpLevel');
  if (lvl) return lvl;
  const hoard = legal.find((a) => a.type === 'playCard' && cardOf(a.card).id === 'hoard');
  if (hoard) return hoard;
  // sell for levels (Halflings double the best item once a turn)
  const sell = sellPlan(v, id, pers);
  if (sell) return sell;
  // Thief: steal a good small item from the leader when we have a spare card
  if (hasPower(P, 'theft') && P.hand.length > handLimit(P) && P.level > 2) {
    const target = leader(v) !== id ? leader(v) : null;
    if (target) {
      const t = legal
        .filter((a) => a.type === 'power' && a.power === 'theft' && a.target?.player === target)
        .sort((a, b) => itemBonus(v.players[target], (b as { target: { card: string } }).target.card) - itemBonus(v.players[target], (a as { target: { card: string } }).target.card))[0];
      if (t && t.type === 'power') return { ...t, discard: cheapest(v, id, P.hand) };
    }
  }
  return null;
}

/**
 * Offer one trade a turn: an item on our table that we can't use, for an item the other player can't use
 * and we can. Bots rarely trade with the leader (the more spiteful, the less), and greedy bots want a better deal.
 */
function proposeTrade(v: GameState, id: PlayerId, pers: Personality): Action | null {
  if (v.events.some((e) => e.type === 'trade' && e.turn === v.turnNumber && e.player === id)) return null;
  const P = v.players[id];
  const table = (x: PlayerId) => [...equippedItems(v.players[x]), ...v.players[x].carried.filter((c) => itemOf(c))];
  const spare = table(id).filter((c) => !qualifies(P, itemOf(c)!));
  if (!spare.length) return null;
  let best: { a: Action; score: number } | null = null;
  for (const o of v.order) {
    if (o === id || v.players[o].dead) continue;
    if (isLeader(v, o) && v.players[o].level > P.level && !chance(v, id, `trade-leader-${o}`, (1 - pers.spite) * 0.3)) continue;
    const O = v.players[o];
    for (const get of table(o)) {
      const gi = itemOf(get)!;
      if (qualifies(O, gi) || !qualifies(P, gi) || gi.bonus <= 0) continue;
      if (equipError(P, get) !== null && gi.slot !== 'none') continue;
      for (const give of spare) {
        const mine = itemOf(give)!;
        if (!qualifies(O, mine)) continue;
        // greedy bots won't hand over much more than they get
        if (mine.bonus > gi.bonus + Math.round(2 * (1 - pers.greed))) continue;
        const a: Action = { type: 'trade', player: id, to: o, give: [give], get: [get] };
        if (check(v, a) !== null) continue;
        const score = gi.bonus - mine.bonus * pers.greed;
        if (!best || score > best.score) best = { a, score };
      }
    }
  }
  return best?.a ?? null;
}

function sellPlan(v: GameState, id: PlayerId, pers: Personality): Action | null {
  const P = v.players[id];
  if (P.level >= 9) return null;
  // sell what we can't or don't use: hand items not usable, one-shots when greedy, carried junk
  const pool = [...P.hand, ...P.carried].filter((c) => {
    if (cardOf(c).deck !== 'treasure' || goldOf(c) <= 0) return false;
    const it = itemOf(c);
    if (it) return !qualifies(P, it) || equipError(P, c) !== null;
    return cardOf(c).kind === 'oneShot' && (pers.greed > 0.6 || P.hand.length > handLimit(P));
  });
  const double = hasPower(P, 'sellDouble') && !v.flags.halflingDoubleUsed ? [...pool].sort((a, b) => goldOf(b) - goldOf(a))[0] : undefined;
  const total = pool.reduce((a, c) => a + goldOf(c), 0) + (double ? goldOf(double) : 0);
  const levels = Math.min(Math.floor(total / 1000), 9 - P.level);
  if (levels < 1) return null;
  const need = levels * 1000 - (double ? 2 * goldOf(double) : 0);
  const rest = pool.filter((c) => c !== double);
  const pick = need <= 0 ? [] : minimalGold(rest, need);
  if (!pick) return null;
  const cards = double ? [double, ...pick] : pick;
  const a: Action = { type: 'sell', player: id, cards, ...(double ? { double } : {}) };
  return check(v, a) === null ? a : null;
}
