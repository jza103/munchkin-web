// The task queue: everything that happens "by itself" after an action (combat resolution,
// running away, Bad Stuff, curses, death, treasure). Tasks run until one needs a decision.
import { cardOf, goldOf, isRaceClassCard, itemOf, monsterOf, nameOf } from './cards';
import { combatTotals as combatTotalsSafe, combatants, monsterLevels, monsterTreasure, removeMonster } from './combat';
import {
  equipError,
  bigInPlay,
  classCards,
  curseRules,
  equippedItems,
  hasPower,
  isCheated,
  isDwarf,
  itemsInPlay,
  lowestLevel,
  matches,
  qualifies,
  raceCards,
  races,
  hasEquippedAbility,
} from './rules';
import {
  addLog,
  changeLevel,
  deal,
  discard,
  discardOnDeath,
  drawTo,
  leftOf,
  moveCard,
  others,
  player,
  rightOf,
  roll,
  setLevel,
} from './state';
import type { CardId, GameState, Op, Pending, PlayerId, RollPurpose, Task } from './types';

export const IMPLEMENTED_OPS = new Set<Op['op']>([
  'none', 'bonus', 'loseLevels', 'gainLevels', 'goUpLevel', 'setLevel', 'loseSlot', 'loseBelowWaist',
  'loseRace', 'loseClass', 'changeRace', 'changeClass', 'loseBigItems', 'discardHand', 'die',
  'loseAllItems', 'othersTakeItem', 'rollThen', 'loseItems', 'loseGold', 'giveCards', 'choice',
  'if', 'loseItem', 'loseBestItem', 'discardItem', 'custom',
]);
/** custom handlers that run as effect ops (the rest live in actions.ts) */
export const OP_HANDLERS = new Set(['incomeTax']);

// ---------------- queue ----------------

export function now(s: GameState, ...tasks: Task[]) {
  s.queue.unshift(...tasks);
}
export function later(s: GameState, ...tasks: Task[]) {
  s.queue.push(...tasks);
}

export function drain(s: GameState) {
  let guard = 0;
  while (s.phase !== 'gameOver') {
    if (s.winners.length) return endGame(s);
    if (s.pending || !s.queue.length) return;
    if (++guard > 5000) throw new Error('Task loop did not settle');
    runTask(s, s.queue.shift()!);
  }
}

function runTask(s: GameState, t: Task) {
  switch (t.t) {
    case 'ops': {
      if (!t.ops.length || player(s, t.victim).dead) return;
      const [op, ...rest] = t.ops;
      if (rest.length) now(s, { ...t, ops: rest });
      return execOp(s, t.victim, op, t.source, t.roll);
    }
    case 'curse':
      return curseTask(s, t);
    case 'run':
      return runTask_(s, t.runner, t.monster, t.copy);
    case 'winCombat':
      return winCombat(s);
    case 'endCombat':
      return endCombat(s);
    case 'enter':
      return enterMonster(s, t.card);
    case 'checkBig':
      return checkBig(s, t.player);
    case 'takeItem':
      return takeItem(s, t.taker, t.victim, t.source);
    case 'incomeTaxOther':
      return incomeTaxOther(s, t.player, t.value);
    case 'loot':
      return lootTask(s, t.dead, t.looters);
    case 'finishDeath':
      discardOnDeath(s, t.player);
      return addLog(s, 'death', `${t.player}'s remaining cards are discarded (keeps level, race, class and curses).`, t.player);
    case 'drawTreasure':
      return drawTreasure(s, t.player, t.n, t.faceUp, t.split ?? null);
    case 'splitTreasure':
      return splitTreasure(s, t.fighter, t.helper, t.deal, t.cards);
    case 'giveTo':
      return giveTo(s, t.from, t.card);
    case 'theftResult':
      return;
  }
}

function pend(s: GameState, p: Pending) {
  s.pending = p;
}

// ---------------- effect ops ----------------

function srcName(card: CardId) {
  return nameOf(card);
}

export function execOp(s: GameState, v: PlayerId, op: Op, source: CardId, rollValue?: number) {
  const p = player(s, v);
  const why = srcName(source);
  switch (op.op) {
    case 'none':
    case 'bonus':
      return;
    case 'loseLevels': {
      const n = op.n === 'roll' ? (rollValue ?? 0) : op.n;
      addLog(s, 'badStuff', `${why}: ${v} loses ${n} level${n === 1 ? '' : 's'}.`, v);
      return changeLevel(s, v, -n);
    }
    case 'gainLevels':
      addLog(s, 'effect', `${why}: ${v} gains ${op.n} level${op.n === 1 ? '' : 's'}.`, v);
      return changeLevel(s, v, op.n, false);
    case 'goUpLevel':
      addLog(s, 'effect', `${why}: ${v} goes up a level.`, v);
      return changeLevel(s, v, 1, false);
    case 'setLevel': {
      const to = op.to === 'lowest' ? lowestLevel(s) : op.to;
      addLog(s, 'badStuff', `${why}: ${v} drops to Level ${to}.`, v);
      return setLevel(s, v, to);
    }
    case 'loseSlot': {
      // Chicken on Your Head: any curse or Bad Stuff that takes your headgear takes the chicken too.
      if (op.slot === 'head') {
        const chicken = p.curses.find((c) => cardOf(c).id === 'curse-chicken-on-your-head');
        if (chicken) {
          discard(s, chicken);
          addLog(s, 'effect', `${why}: the chicken on ${v}'s head goes too. The curse is lifted.`, v);
        }
      }
      const item = equippedItems(p).find((c) => itemOf(c)!.slot === op.slot && !isBorrowed(s, c));
      if (item) {
        addLog(s, 'badStuff', `${why}: ${v} loses ${nameOf(item)}.`, v);
        return discard(s, item);
      }
      if (op.orElse) now(s, { t: 'ops', victim: v, ops: op.orElse, source });
      else addLog(s, 'badStuff', `${why}: ${v} has no ${op.slot === 'foot' ? 'footgear' : op.slot === 'head' ? 'headgear' : op.slot} to lose.`, v);
      return;
    }
    case 'loseBelowWaist': {
      const lost = equippedItems(p).filter((c) => !isBorrowed(s, c) && (itemOf(c)!.slot === 'foot' || itemOf(c)!.belowWaist));
      for (const c of lost) discard(s, c);
      if (lost.length) addLog(s, 'badStuff', `${why}: ${v} loses ${lost.map(nameOf).join(', ')}.`, v);
      return;
    }
    case 'loseRace': {
      const rc = raceCards(p);
      if (!rc.length) {
        if (op.orElse) now(s, { t: 'ops', victim: v, ops: op.orElse, source });
        return;
      }
      for (const c of rc) discard(s, c);
      addLog(s, 'badStuff', `${why}: ${v} loses ${rc.map(nameOf).join(' and ')}.`, v);
      return normalize(s, v);
    }
    case 'loseClass': {
      const cc = classCards(p).filter((c) => !op.which || (cardOf(c) as { class: string }).class === op.which);
      if (!cc.length) {
        if (op.orElse) now(s, { t: 'ops', victim: v, ops: op.orElse, source });
        return;
      }
      for (const c of cc) discard(s, c);
      addLog(s, 'badStuff', `${why}: ${v} loses ${cc.map(nameOf).join(' and ')}.`, v);
      return normalize(s, v);
    }
    case 'changeRace':
    case 'changeClass': {
      const kind = op.op === 'changeRace' ? 'race' : 'class';
      const mine = kind === 'race' ? raceCards(p) : classCards(p);
      if (!mine.length) return addLog(s, 'curse', `${why}: ${v} has no ${kind}, so nothing happens.`, v);
      const replacement = [...s.discard_door].reverse().find((c) => cardOf(c).kind === kind);
      for (const c of mine) discard(s, c);
      if (replacement) {
        moveCard(s, replacement, `${v}.equipped`);
        addLog(s, 'curse', `${why}: ${v} loses ${mine.map(nameOf).join(', ')} and becomes ${nameOf(replacement)}.`, v);
      } else addLog(s, 'curse', `${why}: ${v} loses ${mine.map(nameOf).join(', ')}; no ${kind} in the discard pile.`, v);
      return normalize(s, v);
    }
    case 'loseBigItems': {
      const big = bigInPlay(p).filter((c) => !isBorrowed(s, c));
      for (const c of big) discard(s, c);
      if (big.length) addLog(s, 'badStuff', `${why}: ${v} drops ${big.map(nameOf).join(', ')}.`, v);
      return;
    }
    case 'discardHand': {
      const n = p.hand.length;
      for (const c of [...p.hand]) discard(s, c);
      return addLog(s, 'badStuff', `${why}: ${v} discards their hand (${n} cards).`, v);
    }
    case 'die':
      addLog(s, 'death', `${why}: ${v} is DEAD.`, v);
      return killPlayer(s, v);
    case 'loseAllItems': {
      const all = ownItems(s, v);
      for (const c of all) discard(s, c);
      return addLog(s, 'badStuff', `${why}: ${v} loses all items${all.length ? ` (${all.map(nameOf).join(', ')})` : ''}.`, v);
    }
    case 'othersTakeItem': {
      let takers: PlayerId[];
      const alive = others(s, v).filter((o) => !player(s, o).dead);
      if (op.who === 'leftRight') takers = [leftOf(s, v), rightOf(s, v)].filter((o) => o !== v && !player(s, o).dead);
      else {
        takers = op.who === 'higherLevel' ? alive.filter((o) => player(s, o).level > p.level) : alive;
        takers = [...takers].sort((a, b) => player(s, b).level - player(s, a).level);
      }
      now(s, ...takers.map((taker) => ({ t: 'takeItem' as const, taker, victim: v, source })));
      return;
    }
    case 'rollThen':
      return startRoll(s, v, { kind: 'ops', victim: v, ops: [op], source });
    case 'loseItems': {
      const opts = ownItems(s, v);
      const n = Math.min(op.n === 'roll' ? (rollValue ?? 0) : op.n, opts.length);
      if (n <= 0) return addLog(s, 'badStuff', `${why}: ${v} has no items to lose.`, v);
      if (n === opts.length) {
        for (const c of opts) discard(s, c);
        return addLog(s, 'badStuff', `${why}: ${v} loses ${opts.map(nameOf).join(', ')}.`, v);
      }
      return pend(s, choose(v, 'loseItems', opts, n, n, { victim: v, source }, `${why}: choose ${n} item(s) to lose`));
    }
    case 'loseGold': {
      const opts = ownItems(s, v).filter((c) => goldOf(c) > 0);
      const total = opts.reduce((a, c) => a + goldOf(c), 0);
      if (total <= op.amount) {
        for (const c of opts) discard(s, c);
        return addLog(s, 'badStuff', `${why}: ${v} loses ${opts.length ? opts.map(nameOf).join(', ') : 'nothing (no valuable items)'}.`, v);
      }
      return pend(s, {
        ...choose(v, 'loseGold', opts, 1, opts.length, { victim: v, source }, `${why}: choose items worth at least ${op.amount} Gold to lose`),
        minGold: op.amount,
      });
    }
    case 'giveCards': {
      const n = Math.min(op.n, p.hand.length);
      const recips = others(s, v).filter((o) => !player(s, o).dead);
      if (!n || !recips.length) return;
      if (n === p.hand.length) {
        now(s, ...p.hand.map((card) => ({ t: 'giveTo' as const, from: v, card })));
        return;
      }
      return pend(s, choose(v, 'giveCards', [...p.hand], n, n, { victim: v, source }, `${why}: choose ${n} card(s) to give away`));
    }
    case 'choice':
      return pend(s, {
        type: 'chooseOption',
        player: v,
        prompt: `${why}: choose your Bad Stuff`,
        options: op.options.map((o) => o.label),
        ctx: { kind: 'opsChoice', victim: v, source, options: op.options.map((o) => o.then) },
      });
    case 'if':
      now(s, { t: 'ops', victim: v, ops: matches(p, op.cond) ? op.then : op.else, source, roll: rollValue });
      return;
    case 'loseItem': {
      const opts = ownItems(s, v).filter((c) => !!itemOf(c)?.big === (op.size === 'big'));
      if (!opts.length) return addLog(s, 'curse', `${why}: ${v} has no ${op.size} item to lose.`, v);
      if (opts.length === 1) {
        addLog(s, 'curse', `${why}: ${v} loses ${nameOf(opts[0])}.`, v);
        return discard(s, opts[0]);
      }
      return pend(s, choose(v, 'loseItem', opts, 1, 1, { victim: v, source }, `${why}: choose a ${op.size} item to lose`));
    }
    case 'loseBestItem': {
      const opts = ownItems(s, v).filter((c) => itemOf(c));
      if (!opts.length) return addLog(s, 'curse', `${why}: ${v} has no items.`, v);
      const val = (c: CardId) => {
        const it = itemOf(c)!;
        return it.bonusIf && matches(p, it.bonusIf.if) ? it.bonusIf.bonus : it.bonus;
      };
      const best = Math.max(...opts.map(val));
      const tied = opts.filter((c) => val(c) === best);
      if (tied.length === 1) {
        addLog(s, 'curse', `${why}: ${v} loses their best item, ${nameOf(tied[0])}.`, v);
        return discard(s, tied[0]);
      }
      return pend(s, choose(v, 'loseBest', tied, 1, 1, { victim: v, source }, `${why}: your best items are tied; choose one to lose`));
    }
    case 'discardItem': {
      const opts = ownItems(s, v);
      if (!opts.length) return addLog(s, 'effect', `${why}: ${v} has no item to discard.`, v);
      if (opts.length === 1) {
        addLog(s, 'effect', `${why}: ${v} discards ${nameOf(opts[0])}.`, v);
        return discard(s, opts[0]);
      }
      return pend(s, choose(v, 'discardItem', opts, 1, 1, { victim: v, source }, `${why}: discard an item before fighting`));
    }
    case 'custom':
      if (op.handler === 'incomeTax') {
        const opts = ownItems(s, v);
        if (!opts.length) return addLog(s, 'curse', `${why}: ${v} has no items, so nothing happens.`, v);
        return pend(s, choose(v, 'incomeTax', opts, 1, 1, { victim: v, source }, `${why}: choose an item to discard`));
      }
      throw new Error(`Custom op ${op.handler} is not an effect op`);
  }
}

function choose(
  player: PlayerId,
  reason: Extract<Pending, { type: 'chooseCards' }>['reason'],
  options: CardId[],
  min: number,
  max: number,
  ctx: Record<string, unknown>,
  prompt: string,
): Extract<Pending, { type: 'chooseCards' }> {
  return { type: 'chooseCards', player, reason, options, min, max, ctx, prompt };
}

/** Items on the table that really belong to the player (not borrowed by Help Me Out Here!). */
export function ownItems(s: GameState, id: PlayerId): CardId[] {
  return itemsInPlay(player(s, id)).filter((c) => !isBorrowed(s, c));
}

export function isBorrowed(s: GameState, card: CardId) {
  return s.combat?.borrowed?.card === card;
}

/** After losing a race or class: unusable equipped items go to carried; extra Big items must go. */
export function normalize(s: GameState, id: PlayerId) {
  const p = player(s, id);
  for (const c of equippedItems(p)) {
    if (isCheated(p, c) || isBorrowed(s, c)) continue;
    if (!qualifies(p, itemOf(c)!)) {
      moveCard(s, c, `${id}.carried`);
      addLog(s, 'effect', `${id} can no longer use ${nameOf(c)}; it is now carried.`, id);
    }
  }
  if (!isDwarf(p) && bigInPlay(p).filter((c) => !isCheated(p, c) && !isBorrowed(s, c)).length > 1) now(s, { t: 'checkBig', player: id });
}

function checkBig(s: GameState, id: PlayerId) {
  const p = player(s, id);
  if (isDwarf(p)) return;
  const big = bigInPlay(p).filter((c) => !isCheated(p, c) && !isBorrowed(s, c));
  if (big.length <= 1) return;
  pend(s, choose(id, 'keepBig', big, 1, 1, { victim: id }, 'You may only have one Big item in play: choose the one to keep'));
}

function takeItem(s: GameState, taker: PlayerId, victim: PlayerId, source: CardId) {
  if (player(s, taker).dead) return;
  const opts = ownItems(s, victim);
  if (!opts.length) return;
  pend(s, choose(taker, 'takeItem', opts, 1, 1, { victim, source }, `${nameOf(source)}: take one item from ${victim}`));
}

function incomeTaxOther(s: GameState, id: PlayerId, value: number) {
  const p = player(s, id);
  if (value <= 0) return;
  const opts = ownItems(s, id).filter((c) => goldOf(c) > 0);
  const total = opts.reduce((a, c) => a + goldOf(c), 0);
  if (total < value) {
    addLog(s, 'curse', `Income Tax: ${id} can't pay ${value} Gold in items and loses a level.`, id);
    return changeLevel(s, id, -1);
  }
  pend(s, {
    ...choose(id, 'incomeTaxPay', opts, 0, opts.length, { victim: id, value }, `Income Tax: discard items worth at least ${value} Gold, or choose none to lose a level`),
    minGold: value,
  });
  void p;
}

function giveTo(s: GameState, from: PlayerId, card: CardId) {
  const recipients = others(s, from).filter((o) => !player(s, o).dead);
  if (!player(s, from).hand.includes(card) || !recipients.length) return;
  if (recipients.length === 1) {
    moveCard(s, card, `${recipients[0]}.hand`);
    return addLog(s, 'badStuff', `${from} gives a card to ${recipients[0]}.`, from);
  }
  pend(s, {
    type: 'chooseOption',
    player: from,
    prompt: `Give ${nameOf(card)} to whom?`,
    options: recipients,
    ctx: { kind: 'giveTo', from, card, recipients },
  });
}

// ---------------- death ----------------

export function killPlayer(s: GameState, id: PlayerId) {
  const p = player(s, id);
  if (p.dead) return;
  if (s.combat?.borrowed && s.combat.fighter === id) returnBorrowed(s);
  p.dead = true;
  const looters = others(s, id)
    .filter((o) => !player(s, o).dead)
    .sort((a, b) => player(s, b).level - player(s, a).level);
  now(s, { t: 'loot', dead: id, looters }, { t: 'finishDeath', player: id });
}

export function lootable(s: GameState, dead: PlayerId): CardId[] {
  const p = player(s, dead);
  return [...p.hand, ...p.equipped, ...p.carried].filter((c) => !isRaceClassCard(c) && cardOf(c).id !== 'cheat' && !isBorrowed(s, c));
}

function lootTask(s: GameState, dead: PlayerId, looters: PlayerId[]) {
  const opts = lootable(s, dead);
  if (!looters.length || !opts.length) return;
  pend(s, choose(looters[0], 'loot', opts, 1, 1, { victim: dead, rest: looters.slice(1) }, `Loot ${dead}'s body: take one card`));
}

// ---------------- curses ----------------

export function wishingRingHolders(s: GameState, first: PlayerId): PlayerId[] {
  return [first, ...others(s, first)].filter((id) => {
    const p = player(s, id);
    return !p.dead && [...p.hand, ...p.carried].some((c) => cardOf(c).id === 'wishing-ring');
  });
}

function curseTask(s: GameState, t: Extract<Task, { t: 'curse' }>) {
  const target = player(s, t.target);
  if (t.fromDoor && hasEquippedAbility(target, 'sandals')) {
    addLog(s, 'curse', `${nameOf(t.card)} bounces off ${t.target}'s Sandals of Protection.`, t.target);
    return discard(s, t.card);
  }
  const queue = wishingRingHolders(s, t.target);
  if (queue.length) return pend(s, { type: 'curseWindow', queue, task: t });
  applyCurse(s, t);
}

export function applyCurse(s: GameState, t: Extract<Task, { t: 'curse' }>) {
  const c = cardOf(t.card);
  if (c.kind !== 'curse') throw new Error('not a curse');
  if (c.persistent) {
    moveCard(s, t.card, `${t.target}.curses`);
    addLog(s, 'curse', `${nameOf(t.card)} now sits on ${t.target}.`, t.target);
    if (c.rules?.levelOnly && s.combat && combatants(s.combat).includes(t.target) && !s.combat.mirrored.includes(t.target))
      s.combat.mirrored.push(t.target);
    return;
  }
  addLog(s, 'curse', `${nameOf(t.card)} hits ${t.target}.`, t.target);
  discard(s, t.card);
  now(s, { t: 'ops', victim: t.target, ops: [c.effect], source: t.card });
}

// ---------------- dice and responses ----------------

export function dieMod(s: GameState, id: PlayerId) {
  return curseRules(player(s, id)).dieRollMod;
}

function holds(s: GameState, id: PlayerId, cardId: string) {
  const p = player(s, id);
  return !p.dead && [...p.hand, ...p.carried].some((c) => cardOf(c).id === cardId);
}

export function runOutcome(s: GameState, runner: PlayerId, monster: number, natural: number) {
  const c = s.combat!;
  const p = player(s, runner);
  const m = monsterOf(c.monsters[monster].card);
  let mods = m.runMod + dieMod(s, runner) + (c.flight[runner] ?? 0);
  for (const pw of [hasPower(p, 'runBonus')]) mods += pw ?? 0;
  for (const it of equippedItems(p)) {
    const ic = itemOf(it)!;
    if (ic.runBonus && (isCheated(p, it) || qualifies(p, ic))) mods += ic.runBonus;
  }
  const tuba = !!hasEquippedAbility(p, 'tuba');
  const success = natural + mods >= 5 || (tuba && natural + dieMod(s, runner) >= 3);
  return { total: natural + mods, mods, need: 5, tuba, success };
}

/** Who can respond to a die roll, in asking order. */
export function rollResponders(s: GameState, roller: PlayerId, purpose: RollPurpose, natural: number): PlayerId[] {
  const order = [roller, ...others(s, roller)];
  return order.filter((id) => rollResponses(s, id, roller, purpose, natural).length > 0);
}

export function rollResponses(s: GameState, id: PlayerId, roller: PlayerId, purpose: RollPurpose, natural: number): string[] {
  const p = player(s, id);
  if (p.dead) return [];
  const out: string[] = [];
  if (holds(s, id, 'loaded-die')) out.push('loadedDie');
  if (purpose.kind === 'run') {
    const { success } = runOutcome(s, purpose.runner, purpose.monster, natural);
    if (success && id !== purpose.runner && holds(s, id, 'flask-of-glue')) out.push('flaskOfGlue');
    if (!success && id === purpose.runner) {
      if (holds(s, id, 'invisibility-potion')) out.push('invisibility');
      const hr = hasPower(p, 'rerollFailedRun');
      if (hr && p.hand.length >= hr.cost && (s.combat!.halflingRerolls[id] ?? 0) < hr.perCombat) out.push('halflingReroll');
    }
  }
  void roller;
  return out;
}

export function startRoll(s: GameState, roller: PlayerId, purpose: RollPurpose) {
  const natural = roll(s);
  addLog(s, 'roll', `${roller} rolls a ${natural}.`, roller, { roll: natural, purpose: purpose.kind });
  openRollWindow(s, roller, purpose, natural);
}

export function openRollWindow(s: GameState, roller: PlayerId, purpose: RollPurpose, natural: number) {
  const queue = rollResponders(s, roller, purpose, natural);
  if (queue.length) return pend(s, { type: 'rollWindow', queue, roller, natural, purpose });
  resolveRoll(s, roller, purpose, natural);
}

export function resolveRoll(s: GameState, roller: PlayerId, purpose: RollPurpose, natural: number) {
  switch (purpose.kind) {
    case 'run': {
      const o = runOutcome(s, purpose.runner, purpose.monster, natural);
      const mname = nameOf(s.combat!.monsters[purpose.monster].card);
      if (o.success) {
        addLog(s, 'run', `${purpose.runner} escapes ${mname} (${natural}${fmt(o.mods)} = ${o.total}${o.tuba ? ', Tuba' : ''}).`, purpose.runner);
        return escape(s, purpose.runner, purpose.monster);
      }
      addLog(s, 'run', `${purpose.runner} fails to escape ${mname} (${natural}${fmt(o.mods)} = ${o.total}, needed 5).`, purpose.runner);
      return badStuff(s, purpose.runner, purpose.monster);
    }
    case 'ops': {
      const value = Math.max(1, Math.min(6, natural + dieMod(s, purpose.victim)));
      const op = purpose.ops[0];
      if (op.op !== 'rollThen') return;
      const row = op.table.find((r) => value >= r.min && value <= r.max);
      if (row) now(s, { t: 'ops', victim: purpose.victim, ops: row.then, source: purpose.source, roll: value });
      return;
    }
    case 'theft': {
      const value = natural + dieMod(s, purpose.thief);
      const owner = player(s, purpose.victim);
      if (value >= 4 && [...owner.equipped, ...owner.carried].includes(purpose.item)) {
        moveCard(s, purpose.item, `${purpose.thief}.carried`);
        addLog(s, 'theft', `${purpose.thief} steals ${nameOf(purpose.item)} from ${purpose.victim}!`, purpose.thief);
        normalize(s, purpose.victim);
        return;
      }
      addLog(s, 'theft', `${purpose.thief} is caught stealing and loses a level.`, purpose.thief);
      return changeLevel(s, purpose.thief, -1);
    }
    case 'free':
      return;
  }
  void roller;
}

function fmt(n: number) {
  return n === 0 ? '' : n > 0 ? ` +${n}` : ` ${n}`;
}

// ---------------- running away ----------------

export function escape(s: GameState, runner: PlayerId, monster: number) {
  const m = monsterOf(s.combat!.monsters[monster].card);
  if (m.rules.onEscape) now(s, { t: 'ops', victim: runner, ops: m.rules.onEscape, source: s.combat!.monsters[monster].card });
}

function badStuff(s: GameState, runner: PlayerId, monster: number) {
  const entry = s.combat!.monsters[monster];
  const m = monsterOf(entry.card);
  if (!m.badStuff.length) return addLog(s, 'badStuff', `${nameOf(entry.card)} has no Bad Stuff.`, runner);
  addLog(s, 'badStuff', `Bad Stuff from ${nameOf(entry.card)} for ${runner}: ${m.text.split('Bad: ')[1]?.split(/\. \d+ Tr/)[0] ?? ''}`, runner);
  now(s, { t: 'ops', victim: runner, ops: m.badStuff, source: entry.card });
}

export function wontPursue(s: GameState, runner: PlayerId, monster: number) {
  const m = monsterOf(s.combat!.monsters[monster].card);
  const p = player(s, runner);
  if (m.noPursueAtOrBelow === null || p.level > m.noPursueAtOrBelow) return false;
  return !(m.noPursueExcept && matches(p, m.noPursueExcept));
}

function runTask_(s: GameState, runner: PlayerId, monster: number, copy: number) {
  const c = s.combat;
  if (!c || player(s, runner).dead || monster >= c.monsters.length) return;
  const entry = c.monsters[monster];
  const m = monsterOf(entry.card);
  const mname = nameOf(entry.card) + (entry.mate ? (copy ? ' (Mate)' : '') : '');
  if (c.autoEscape.includes(runner)) {
    addLog(s, 'run', `${runner} automatically escapes ${mname}.`, runner);
    return escape(s, runner, monster);
  }
  if (m.rules.autoEscape) {
    addLog(s, 'run', `${runner} automatically escapes ${mname}.`, runner);
    return escape(s, runner, monster);
  }
  if (wontPursue(s, runner, monster)) {
    addLog(s, 'run', `${mname} won't pursue someone of Level ${player(s, runner).level}; ${runner} escapes.`, runner);
    return escape(s, runner, monster);
  }
  const rat = ratFor(s, runner);
  if (rat && m.level <= 8) return pend(s, { type: 'preRun', player: runner, monster, copy });
  rollToRun(s, runner, monster, copy);
}

export function ratFor(s: GameState, runner: PlayerId): CardId | null {
  const p = player(s, runner);
  return [...p.equipped, ...p.carried].find((c) => itemOf(c)?.ability === 'ratOnAStick' && !isBorrowed(s, c)) ?? null;
}

export function rollToRun(s: GameState, runner: PlayerId, monster: number, copy: number) {
  const m = monsterOf(s.combat!.monsters[monster].card);
  if (m.rules.cantRun) {
    addLog(s, 'run', `${runner} can't run from ${nameOf(s.combat!.monsters[monster].card)}!`, runner);
    return badStuff(s, runner, monster);
  }
  startRoll(s, runner, { kind: 'run', runner, monster, copy });
}

/** Rat on a Stick: discard it to escape every monster of level 8 or lower in this combat. */
export function useRat(s: GameState, runner: PlayerId, monster: number) {
  const rat = ratFor(s, runner)!;
  discard(s, rat);
  addLog(s, 'run', `${runner} discards Rat on a Stick and escapes.`, runner);
  const c = s.combat!;
  // Escape this monster now; later monsters of L8 or less are escaped by the queued run tasks.
  escape(s, runner, monster);
  s.queue = s.queue.map((t) =>
    t.t === 'run' && t.runner === runner && monsterOf(c.monsters[t.monster].card).level <= 8
      ? ({ t: 'ops', victim: runner, ops: monsterOf(c.monsters[t.monster].card).rules.onEscape ?? [], source: c.monsters[t.monster].card } as Task)
      : t,
  );
}

export function queueRun(s: GameState) {
  const c = s.combat!;
  c.running = true;
  const tasks: Task[] = [];
  for (const runner of combatants(c))
    c.monsters.forEach((m, i) => {
      for (let copy = 0; copy < (m.mate ? 2 : 1); copy++) tasks.push({ t: 'run', runner, monster: i, copy });
    });
  now(s, ...tasks, { t: 'endCombat', won: false });
}

// ---------------- winning ----------------

function winCombat(s: GameState) {
  const c = s.combat!;
  const totals = combatTotalsSafe(s);
  let levels = 0;
  let treasures = 0;
  let kills = 0;
  const elf = combatants(c).some((id) => races(player(s, id)).includes('elf'));
  for (const m of c.monsters) {
    const mc = monsterOf(m.card);
    const mult = m.mate ? 2 : 1;
    levels += monsterLevels(m);
    kills += mult;
    if (mc.rules.fireBonusLevels && totals.fire) levels += mc.rules.fireBonusLevels * mult;
    treasures += monsterTreasure(m);
    if (mc.rules.elfBonusTreasures && elf) treasures += mc.rules.elfBonusTreasures * mult;
  }
  addLog(s, 'win', `${c.fighter}${c.helper ? ` and ${c.helper}` : ''} defeat ${c.monsters.map((m) => nameOf(m.card)).join(', ')}! ${c.fighter} gains ${levels} level${levels === 1 ? '' : 's'}; ${treasures} Treasure.`, c.fighter);
  changeLevel(s, c.fighter, levels, true);
  if (c.helper) {
    const help = hasPower(player(s, c.helper), 'onHelpKill');
    if (help) {
      addLog(s, 'win', `${c.helper} (Elf) gains ${kills * help.levels} level(s) for helping.`, c.helper);
      changeLevel(s, c.helper, kills * help.levels, true);
    }
  }
  if (s.winners.length) return;
  now(
    s,
    {
      t: 'drawTreasure',
      player: c.fighter,
      n: treasures,
      faceUp: !!c.helper,
      split: c.helper ? { helper: c.helper, deal: c.deal } : undefined,
    },
    { t: 'endCombat', won: true },
  );
}


export function canResurrect(s: GameState, id: PlayerId, deck: 'door' | 'treasure') {
  const p = player(s, id);
  const disc = deck === 'door' ? s.discard_door : s.discard_treasure;
  return !p.dead && !!hasPower(p, 'resurrection') && p.hand.length > 0 && disc.length > 0;
}

function drawTreasure(s: GameState, id: PlayerId, n: number, faceUp: boolean, split: { helper: PlayerId; deal: number } | null) {
  if (n <= 0) return;
  if (faceUp && canResurrect(s, id, 'treasure'))
    return pend(s, { type: 'resurrect', player: id, deck: 'treasure', remaining: n, drawn: [], ctx: { kind: 'reward', split } });
  finishTreasure(s, id, drawTo(s, 'treasure', n, faceUp ? 'play' : `${id}.hand`), faceUp, split);
}

export function finishTreasure(s: GameState, id: PlayerId, cards: CardId[], faceUp: boolean, split: { helper: PlayerId; deal: number } | null) {
  if (!faceUp) {
    addLog(s, 'treasure', `${id} draws ${cards.length} Treasure face-down.`, id);
    return;
  }
  addLog(s, 'treasure', `Treasure drawn face-up: ${cards.map(nameOf).join(', ')}.`, id);
  if (split) now(s, { t: 'splitTreasure', fighter: id, helper: split.helper, deal: split.deal, cards });
  else for (const c of cards) moveCard(s, c, `${id}.hand`);
}

function splitTreasure(s: GameState, fighter: PlayerId, helper: PlayerId, dealN: number, cards: CardId[]) {
  const live = cards.filter((c) => s.play.includes(c));
  const n = Math.min(dealN, live.length);
  if (n === 0 || player(s, helper).dead) {
    for (const c of live) moveCard(s, c, `${fighter}.hand`);
    return;
  }
  if (n === live.length) {
    for (const c of live) moveCard(s, c, `${helper}.hand`);
    return addLog(s, 'treasure', `${helper} takes all ${n} Treasure as agreed.`, helper);
  }
  pend(s, choose(helper, 'splitTreasure', live, n, n, { fighter, cards: live }, `Pick your ${n} Treasure (as agreed)`));
}

export function returnBorrowed(s: GameState) {
  const b = s.combat?.borrowed;
  if (!b) return;
  s.combat!.borrowed = null;
  if (player(s, b.owner).dead) {
    discard(s, b.card);
    return addLog(s, 'effect', `${nameOf(b.card)} can't go back to ${b.owner} (dead) and is discarded.`, b.owner);
  }
  const owner = player(s, b.owner);
  // back where it was, unless that slot has been filled meanwhile (a Cheat!-ed item keeps its place)
  const fits = b.zone !== 'equipped' || owner.cheat?.item === b.card || equipError(owner, b.card) === null;
  moveCard(s, b.card, `${b.owner}.${fits ? b.zone : 'carried'}`);
  addLog(s, 'effect', `${nameOf(b.card)} goes back to ${b.owner}${fits ? '' : ' (carried: no free slot)'}.`, b.owner);
  // the owner may have lost the race/class it needs, or picked up another Big item, meanwhile
  normalize(s, b.owner);
  now(s, { t: 'checkBig', player: b.owner });
}

function endCombat(s: GameState) {
  const c = s.combat;
  if (!c) return;
  returnBorrowed(s);
  for (const id of c.mirrored) {
    const p = player(s, id);
    const mirror = p.curses.find((x) => cardOf(x).id === 'curse-malign-mirror');
    if (mirror) discard(s, mirror);
  }
  for (const card of [...s.play]) discard(s, card);
  s.combat = null;
  s.phase = 'charity';
  addLog(s, 'combat', 'The combat is over.');
}

// ---------------- entering monsters ----------------

function enterMonster(s: GameState, card: CardId) {
  const c = s.combat;
  if (!c) return;
  const idx = c.monsters.findIndex((m) => m.card === card);
  if (idx < 0) return;
  const m = monsterOf(card);
  const fighter = player(s, c.fighter);
  if (m.rules.noHelp && c.helper) {
    addLog(s, 'combat', `${nameOf(card)}: nobody can help — ${c.helper} leaves the fight.`, c.helper);
    c.helper = null;
    c.deal = 0;
  }
  const av = m.rules.avoid;
  if (av && !av.optional && matches(fighter, av.if)) {
    removeMonster(s, idx);
    addLog(s, 'combat', `${nameOf(card)} won't fight ${c.fighter}; ${c.fighter} takes ${av.treasures} Treasure instead.`, c.fighter);
    drawTo(s, 'treasure', av.treasures, `${c.fighter}.hand`);
    return afterMonsterRemoved(s);
  }
  if (m.rules.onEnter) now(s, { t: 'ops', victim: c.fighter, ops: m.rules.onEnter, source: card });
}

export function afterMonsterRemoved(s: GameState) {
  if (s.combat && s.combat.monsters.length === 0) {
    s.combat.resolving = false;
    now(s, { t: 'endCombat', won: false });
  }
}

// ---------------- turns ----------------

export function startTurn(s: GameState, id: PlayerId) {
  s.turn = id;
  s.phase = 'setup';
  s.flags = { kicked: false, halflingDoubleUsed: false, acted: false };
  addLog(s, 'turn', `Turn ${s.turnNumber}: ${id}.`, id);
  const p = player(s, id);
  if (p.dead) {
    p.dead = false;
    deal(s, id, true);
    addLog(s, 'revive', `${id} comes back to life and draws 4 Door and 4 Treasure.`, id);
  }
}

export function nextTurn(s: GameState) {
  s.turnNumber += 1;
  startTurn(s, others(s, s.turn)[0]);
}

export function endGame(s: GameState) {
  s.pending = null;
  s.queue = [];
  if (s.combat) {
    returnBorrowed(s);
    for (const card of [...s.play]) discard(s, card);
    s.combat = null;
  }
  s.phase = 'gameOver';
  addLog(s, 'gameOver', `🏆 ${s.winners.join(' and ')} reach${s.winners.length > 1 ? '' : 'es'} Level 10 and win${s.winners.length > 1 ? '' : 's'}!`);
  for (const id of s.order) addLog(s, 'reveal', `${id}'s hand: ${s.players[id].hand.map(nameOf).join(', ') || '-'}`, id);
}
