// Player-level rules: races, classes, item legality, strength, limits.
import { cardOf, isRaceClassCard, itemOf } from './cards';
import { player } from './state';
import type { CardId, ClassName, Cond, GameState, ItemCard, PlayerId, PlayerState, Powers, Race } from './types';

export function raceCards(p: PlayerState): CardId[] {
  return p.equipped.filter((c) => cardOf(c).kind === 'race');
}
export function classCards(p: PlayerState): CardId[] {
  return p.equipped.filter((c) => cardOf(c).kind === 'class');
}
export function hasHalfBreed(p: PlayerState) {
  return p.equipped.some((c) => cardOf(c).id === 'half-breed');
}
export function hasSuperMunchkin(p: PlayerState) {
  return p.equipped.some((c) => cardOf(c).id === 'super-munchkin');
}

/** Races including 'human' when the player has no race, or is a Half-Breed with one race. */
export function races(p: PlayerState): Race[] {
  const rs = raceCards(p).map((c) => (cardOf(c) as { race: Race }).race);
  if (rs.length === 0 || (hasHalfBreed(p) && rs.length < 2)) rs.push('human');
  return rs;
}
export function classes(p: PlayerState): ClassName[] {
  return classCards(p).map((c) => (cardOf(c) as { class: ClassName }).class);
}
export function hasRace(p: PlayerState, r: Race) {
  return races(p).includes(r);
}
export function hasClass(p: PlayerState, c: ClassName) {
  return classes(p).includes(c);
}
export function maxRaces(p: PlayerState) {
  return hasHalfBreed(p) ? 2 : 1;
}
export function maxClasses(p: PlayerState) {
  return hasSuperMunchkin(p) ? 2 : 1;
}

export function powers(p: PlayerState): Powers[] {
  return [...raceCards(p), ...classCards(p)].map((c) => (cardOf(c) as { powers: Powers }).powers);
}
export function hasPower<K extends keyof Powers>(p: PlayerState, k: K): Powers[K] | undefined {
  for (const pw of powers(p)) if (pw[k]) return pw[k];
  return undefined;
}

export function matches(p: PlayerState, cond: Cond): boolean {
  const rs = races(p);
  const cs = classes(p);
  if (cond.race !== undefined) {
    const want = Array.isArray(cond.race) ? cond.race : [cond.race];
    if (!want.some((r) => rs.includes(r))) return false;
  }
  if (cond.notRace !== undefined && rs.includes(cond.notRace)) return false;
  if (cond.class !== undefined) {
    const want = Array.isArray(cond.class) ? cond.class : [cond.class];
    if (!want.some((c) => cs.includes(c))) return false;
  }
  if (cond.gender !== undefined && p.gender !== cond.gender) return false;
  return true;
}

export function handLimit(p: PlayerState): number {
  return hasPower(p, 'handLimit') ?? 5;
}

export function isDwarf(p: PlayerState) {
  return !!hasPower(p, 'bigItemsUnlimited');
}

/** Item cards on the table (equipped or carried). Excludes race/class/Cheat!. */
export function itemsInPlay(p: PlayerState): CardId[] {
  return [...p.equipped, ...p.carried].filter((c) => {
    const k = cardOf(c).kind;
    return k === 'item' || k === 'oneShot';
  });
}
export function equippedItems(p: PlayerState): CardId[] {
  return p.equipped.filter((c) => cardOf(c).kind === 'item');
}
export function bigInPlay(p: PlayerState): CardId[] {
  return itemsInPlay(p).filter((c) => itemOf(c)?.big);
}

/** Does the player qualify for this item's race/class/gender restrictions? */
export function qualifies(p: PlayerState, item: ItemCard): boolean {
  if (item.requires && !matches(p, item.requires)) return false;
  if (item.forbids && matchesAny(p, item.forbids)) return false;
  return true;
}

function matchesAny(p: PlayerState, cond: Cond): boolean {
  // forbids: true if ANY listed attribute applies
  if (cond.race !== undefined && matches(p, { race: cond.race })) return true;
  if (cond.class !== undefined && matches(p, { class: cond.class })) return true;
  if (cond.gender !== undefined && p.gender === cond.gender) return true;
  return false;
}

export function isCheated(p: PlayerState, card: CardId) {
  return p.cheat?.item === card;
}

function slotUse(p: PlayerState, except?: CardId) {
  const used = { head: 0, armor: 0, foot: 0, hands: 0 };
  for (const c of equippedItems(p)) {
    if (c === except || isCheated(p, c)) continue;
    const it = itemOf(c)!;
    if (it.slot === 'hands') used.hands += it.hands;
    else if (it.slot !== 'none') used[it.slot] += 1;
  }
  return used;
}

/**
 * Can `card` be equipped by p? Returns an error string or null.
 * With `cheat`, restrictions, slot limits and the Big-item limit are all ignored for that item.
 */
export function equipError(p: PlayerState, card: CardId, cheat = false): string | null {
  const it = itemOf(card);
  if (!it) return 'Only items can be equipped';
  if (cheat) return null;
  if (!qualifies(p, it)) return `${it.name} can't be used by you (restricted)`;
  const used = slotUse(p, card);
  if (it.slot === 'hands' && used.hands + it.hands > 2) return 'Your hands are full (two hands max)';
  if (it.slot === 'head' && used.head >= 1) return 'You already wear headgear';
  if (it.slot === 'armor' && used.armor >= 1) return 'You already wear armor';
  if (it.slot === 'foot' && used.foot >= 1) return 'You already wear footgear';
  const bigErr = bigError(p, card);
  if (bigErr) return bigErr;
  return null;
}

/** Adding `card` to the table (equipped or carried) would break the one-Big-item rule? */
export function bigError(p: PlayerState, card: CardId): string | null {
  const it = itemOf(card);
  if (!it?.big || isDwarf(p)) return null;
  const others = bigInPlay(p).filter((c) => c !== card && !isCheated(p, c));
  return others.length ? 'Only one Big item in play unless you are a Dwarf' : null;
}

/** Bonus this item gives the player right now (0 if they no longer qualify). */
export function itemBonus(p: PlayerState, card: CardId): number {
  const it = itemOf(card);
  if (!it) return 0;
  if (!isCheated(p, card) && !qualifies(p, it)) return 0;
  if (it.bonusIf && matches(p, it.bonusIf.if)) return it.bonusIf.bonus;
  return it.bonus;
}

/** Level + equipped item bonuses (the skill's "strength"). */
export function strength(s: GameState, id: PlayerId): number {
  const p = player(s, id);
  return p.level + equippedItems(p).reduce((a, c) => a + itemBonus(p, c), 0);
}

export function hasEquippedAbility(p: PlayerState, ability: string): CardId | null {
  return equippedItems(p).find((c) => itemOf(c)?.ability === ability) ?? null;
}

export function curseRules(p: PlayerState) {
  let dieRollMod = 0;
  let mirror = false;
  for (const c of p.curses) {
    const cc = cardOf(c);
    if (cc.kind === 'curse' && cc.rules?.dieRollMod) dieRollMod += cc.rules.dieRollMod;
    if (cc.kind === 'curse' && cc.rules?.levelOnly) mirror = true;
  }
  return { dieRollMod, mirror };
}

/** Leader = highest level (ties count as leading). */
export function isLeader(s: GameState, id: PlayerId) {
  const lvl = player(s, id).level;
  return s.order.every((o) => s.players[o].level <= lvl);
}

export function lowestLevel(s: GameState) {
  return Math.min(...s.order.map((o) => s.players[o].level));
}

export function raceClassKeepers(p: PlayerState): CardId[] {
  return p.equipped.filter((c) => isRaceClassCard(c));
}
