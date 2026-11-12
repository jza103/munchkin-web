// Combat math and combat lifecycle helpers.
import { cardOf, itemOf, monsterOf, nameOf } from './cards';
import { curseRules, equippedItems, hasPower, itemBonus, matches, races } from './rules';
import { addLog, discard, player } from './state';
import type { CardId, Combat, CombatMonster, GameState, PlayerId } from './types';

export function newCombat(s: GameState, fighter: PlayerId): Combat {
  return {
    fighter,
    helper: null,
    deal: 0,
    monsters: [],
    bonuses: [],
    berserk: {},
    turning: {},
    flight: {},
    backstabs: [],
    yuppie: 0,
    doppleganger: false,
    borrowed: null,
    declined: [],
    halflingRerolls: {},
    autoEscape: [],
    running: false,
    resolving: false,
    mirrored: curseRules(player(s, fighter)).mirror ? [fighter] : [],
  };
}

export function combatants(c: Combat): PlayerId[] {
  return c.helper ? [c.fighter, c.helper] : [c.fighter];
}

export function multiplier(m: CombatMonster) {
  return m.mate ? 2 : 1;
}

export function hasRule(s: GameState, rule: 'levelOnly' | 'fireImmune' | 'noHelp' | 'cantRun') {
  return !!s.combat?.monsters.some((m) => monsterOf(m.card).rules[rule]);
}

export function anyUndead(s: GameState) {
  return !!s.combat?.monsters.some((m) => monsterOf(m.card).undead);
}

/** One monster entry's strength, including its "+N vs" bonus, enhancers and Mate. */
export function monsterStrength(s: GameState, m: CombatMonster): number {
  const c = s.combat!;
  const mc = monsterOf(m.card);
  let lvl = mc.level;
  for (const b of mc.bonusVs) if (combatants(c).some((id) => matches(player(s, id), b.if))) lvl += b.bonus;
  for (const e of m.enhancers) {
    const ec = cardOf(e);
    if (ec.kind === 'enhancer') lvl += ec.monsterBonus;
  }
  return Math.max(1, lvl) * multiplier(m);
}

export function monsterTreasure(m: CombatMonster): number {
  let t = monsterOf(m.card).treasures;
  for (const e of m.enhancers) {
    const ec = cardOf(e);
    if (ec.kind === 'enhancer') t += ec.treasureDelta;
  }
  return Math.max(0, t) * multiplier(m);
}

export function monsterLevels(m: CombatMonster): number {
  return monsterOf(m.card).levelsGained * multiplier(m);
}

/** A combatant's own contribution: level, gear and class powers, after Ghoulfiends / Malign Mirror / fire rules. */
export function personalStrength(s: GameState, id: PlayerId): number {
  const c = s.combat!;
  const p = player(s, id);
  if (c.mirrored.includes(id)) return p.level; // Malign Mirror: only your level counts
  let total = p.level;
  if (!hasRule(s, 'levelOnly')) {
    const fireImmune = hasRule(s, 'fireImmune');
    for (const item of equippedItems(p)) {
      if (fireImmune && itemOf(item)?.fire) continue;
      total += itemBonus(p, item);
    }
  }
  total += c.berserk[id] ?? 0;
  if (anyUndead(s)) total += 3 * (c.turning[id] ?? 0);
  return total;
}

export interface CombatTotals {
  player: number;
  monster: number;
  playerWins: boolean;
  fighter: number;
  helper: number;
  monsters: number[];
  fire: boolean;
}

export function combatTotals(s: GameState): CombatTotals {
  const c = s.combat!;
  const levelOnly = hasRule(s, 'levelOnly');
  const fireImmune = hasRule(s, 'fireImmune');
  let fighter = personalStrength(s, c.fighter);
  if (c.doppleganger && !levelOnly && !c.mirrored.includes(c.fighter)) fighter *= 2;
  const helper = c.helper ? personalStrength(s, c.helper) : 0;
  let total = fighter + helper;
  const elves = combatants(c).filter((id) => races(player(s, id)).includes('elf')).length;
  if (!levelOnly) total += 2 * c.yuppie * elves;
  let fire = false;
  for (const b of c.bonuses) {
    if (b.side !== 'player') continue;
    if (levelOnly && cardOf(b.card).deck === 'treasure') continue; // no item bonuses at all
    if (b.fire && fireImmune) continue;
    if (b.fire) fire = true;
    total += b.value;
  }
  for (const id of combatants(c)) {
    const p = player(s, id);
    if (!levelOnly && !c.mirrored.includes(id) && equippedItems(p).some((i) => itemOf(i)?.fire && itemBonus(p, i) > 0))
      fire = true;
  }
  if (fireImmune) fire = false;
  total -= 2 * c.backstabs.length;
  const monsters = c.monsters.map((m) => monsterStrength(s, m));
  let monster = monsters.reduce((a, b) => a + b, 0);
  for (const b of c.bonuses) if (b.side === 'monster') monster += b.value;
  const warrior = combatants(c).some((id) => !!hasPower(player(s, id), 'winTies'));
  const playerWins = c.monsters.length > 0 && (total > monster || (total === monster && warrior));
  return { player: total, monster, playerWins, fighter, helper, monsters, fire };
}

/** Remove a monster entry (with its enhancers and Mate) to the discard piles. */
export function removeMonster(s: GameState, index: number) {
  const c = s.combat!;
  const [m] = c.monsters.splice(index, 1);
  for (const e of m.enhancers) discard(s, e);
  if (m.mate) discard(s, m.mate);
  discard(s, m.card);
  return m;
}

export function describeCombat(s: GameState): string {
  const c = s.combat;
  if (!c) return '';
  const t = combatTotals(s);
  const ms = c.monsters
    .map((m, i) => `${nameOf(m.card)}${m.mate ? ' x2' : ''}${m.enhancers.length ? ` (+${m.enhancers.map(nameOf).join(', ')})` : ''} = ${t.monsters[i]}`)
    .join('; ');
  return `${c.fighter}${c.helper ? ` + ${c.helper}` : ''} (${t.player}) vs ${ms} (${t.monster})`;
}

export function logCombat(s: GameState) {
  addLog(s, 'combat', describeCombat(s), s.combat?.fighter);
}

export function cardsOnSide(s: GameState): CardId[] {
  return s.combat ? s.combat.bonuses.map((b) => b.card) : [];
}

