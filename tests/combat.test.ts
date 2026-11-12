import { describe, expect, it } from 'vitest';
import { combatTotals } from '../src/engine/combat';
import type { GameState } from '../src/engine/types';
import { A, J, S, act, blank, err, expectConserved, give, kick, names, passAll, top } from './helpers';

const fight = (s: GameState, who = s.combat!.fighter) => passAll(act(s, { type: 'fight', player: who }));

describe('winning a fight', () => {
  it('gain levels and draw treasure face-down', () => {
    let s = blank();
    give(s, J, 'Boots of Butt-Kicking', 'equipped');
    s = kick(s, 'Flying Frogs'); // L2 vs 3
    s = fight(s);
    expect(s.players[J].level).toBe(2);
    expect(s.players[J].hand).toHaveLength(1);
    expect(s.combat).toBeNull();
    expect(s.phase).toBe('charity');
    expectConserved(s);
  });

  it('the monster wins ties', () => {
    let s = blank();
    give(s, J, 'Helm of Courage', 'equipped');
    s = kick(s, 'Flying Frogs'); // 2 vs 2
    expect(combatTotals(s).playerWins).toBe(false);
    expect(err(s, { type: 'fight', player: J })).toMatch(/not winning/);
  });

  it('except for Warriors', () => {
    let s = blank();
    give(s, J, 'Helm of Courage', 'equipped');
    give(s, J, 'Warrior', 'equipped');
    s = kick(s, 'Flying Frogs');
    expect(combatTotals(s).playerWins).toBe(true);
  });

  it('2-level monsters give 2 levels', () => {
    let s = blank();
    s.players[J].level = 5;
    s = kick(s, 'Bullrog');
    s.combat!.bonuses.push({ card: 'x', by: J, side: 'player', value: 20, fire: false });
    s = act(s, { type: 'fight', player: J });
    expect(s.players[J].level).toBe(7);
    expect(s.players[J].hand).toHaveLength(5);
  });

  it('Level 10 only by killing a monster, and it ends the game', () => {
    let s = blank();
    s.players[J].level = 9;
    give(s, J, 'Boots of Butt-Kicking', 'equipped');
    s = kick(s, 'Pit Bull');
    s = fight(s);
    expect(s.phase).toBe('gameOver');
    expect(s.winners).toEqual([J]);
    err(s, { type: 'endTurn', player: J });
  });

  it('"+N vs" bonuses apply to the matching race/class', () => {
    let s = blank();
    give(s, J, 'Dwarf', 'equipped');
    s = kick(s, 'Undead Horse');
    expect(combatTotals(s).monster).toBe(9);
  });
});

describe('the 2.6 second rule', () => {
  it('others get a chance to respond before a win resolves', () => {
    let s = blank();
    give(s, J, 'Boots of Butt-Kicking', 'equipped');
    const enr = give(s, A, 'Enraged');
    s = kick(s, 'Pit Bull');
    s = act(s, { type: 'fight', player: J });
    expect(s.pending).toMatchObject({ type: 'combatWindow', queue: [A] });
    s = act(s, { type: 'playCard', player: A, card: enr, target: { monster: 0 } });
    // control goes back to the fighter, who is now losing
    expect(s.pending).toBeNull();
    expect(combatTotals(s)).toMatchObject({ player: 3, monster: 7, playerWins: false });
    err(s, { type: 'fight', player: J });
  });

  it('players with nothing to play are not asked', () => {
    let s = blank();
    give(s, J, 'Boots of Butt-Kicking', 'equipped');
    give(s, A, 'Helm of Courage');
    s = kick(s, 'Pit Bull');
    s = act(s, { type: 'fight', player: J });
    expect(s.pending).toBeNull();
    expect(s.players[J].level).toBe(2);
  });

  it('a curse can be played on the fighter mid-fight', () => {
    let s = blank();
    s.players[J].level = 2;
    give(s, J, 'Boots of Butt-Kicking', 'equipped');
    const c = give(s, A, 'Curse! Lose Your Footgear');
    s = kick(s, 'Pit Bull');
    s = act(s, { type: 'fight', player: J });
    s = act(s, { type: 'playCard', player: A, card: c, target: { player: J } });
    expect(combatTotals(s).player).toBe(2);
  });
});

describe('one-shots and enhancers', () => {
  it('either-side potions and enhancers change the totals', () => {
    let s = blank();
    const p = give(s, J, 'Magic Missile');
    const q = give(s, A, 'Freezing Explosive Potion');
    const e = give(s, S, 'Baby');
    s = kick(s, 'Floating Nose'); // 10
    s = act(s, { type: 'playCard', player: J, card: p, target: { side: 'player' } });
    s = act(s, { type: 'playCard', player: A, card: q, target: { side: 'monster' } });
    s = act(s, { type: 'playCard', player: S, card: e, target: { monster: 0 } });
    expect(combatTotals(s)).toMatchObject({ player: 6, monster: 8 });
  });

  it('enhancers change the treasure', () => {
    let s = blank();
    s.players[J].level = 8;
    const a = give(s, J, 'Ancient');
    s = kick(s, 'Pit Bull');
    s = act(s, { type: 'playCard', player: J, card: a, target: { monster: 0 } });
    s.combat!.bonuses.push({ card: 'x', by: J, side: 'player', value: 10, fire: false });
    s = act(s, { type: 'fight', player: J });
    expect(s.players[J].hand).toHaveLength(3);
  });

  it('Pretty Balloons only for your own side, when you are in the fight', () => {
    let s = blank();
    const b = give(s, A, 'Pretty Balloons');
    s = kick(s, 'Pit Bull');
    err(s, { type: 'playCard', player: A, card: b });
    s.players[J].hand.push(...s.players[A].hand.splice(0));
    s = act(s, { type: 'playCard', player: J, card: b });
    expect(combatTotals(s).player).toBe(6);
  });

  it('Mate doubles the monster, its levels and its treasure', () => {
    let s = blank();
    s.players[J].level = 5;
    const m = give(s, A, 'Mate');
    s = kick(s, 'Pit Bull');
    s = act(s, { type: 'playCard', player: A, card: m, target: { monster: 0 } });
    expect(combatTotals(s).monster).toBe(4);
    s = act(s, { type: 'fight', player: J });
    expect(s.players[J].level).toBe(7);
    expect(s.players[J].hand).toHaveLength(2);
  });

  it('Wandering Monster adds a monster from hand', () => {
    let s = blank();
    s.players[J].level = 5;
    const w = give(s, A, 'Wandering Monster');
    const m = give(s, A, 'Lame Goblin');
    s = kick(s, 'Pit Bull');
    s = act(s, { type: 'playCard', player: A, card: w, target: { card: m } });
    expect(combatTotals(s).monster).toBe(3);
    s = act(s, { type: 'fight', player: J });
    expect(s.players[J].level).toBe(7);
    expect(s.players[J].hand).toHaveLength(2);
  });

  it('Illusion replaces a monster with one from hand', () => {
    let s = blank();
    const i = give(s, A, 'Illusion');
    const m = give(s, A, 'Floating Nose');
    s = kick(s, 'Pit Bull');
    const pit = s.combat!.monsters[0].card;
    s = act(s, { type: 'playCard', player: A, card: i, target: { monster: 0, card: m } });
    expect(names(s.combat!.monsters.map((x) => x.card))).toEqual(['Floating Nose']);
    expect(s.discard_door).toContain(pit);
  });

  it('Out to Lunch: monster leaves, fighter takes 2 Treasure, no level', () => {
    let s = blank();
    const o = give(s, J, 'Out to Lunch');
    s = kick(s, 'Floating Nose');
    s = act(s, { type: 'playCard', player: J, card: o, target: { monster: 0 } });
    expect(s.combat).toBeNull();
    expect(s.players[J].level).toBe(1);
    expect(s.players[J].hand).toHaveLength(2);
    expect(s.phase).toBe('charity');
  });

  it('Friendship Potion: all monsters leave, no treasure, no level', () => {
    let s = blank();
    const f = give(s, A, 'Friendship Potion');
    s = kick(s, 'Pit Bull');
    s = act(s, { type: 'playCard', player: A, card: f });
    expect(s.combat).toBeNull();
    expect(s.players[J].hand).toHaveLength(0);
    expectConserved(s);
  });

  it('Pollymorph: the monster leaves and whoever played it takes the treasure', () => {
    let s = blank();
    const p = give(s, A, 'Pollymorph Potion');
    s = kick(s, 'Floating Nose');
    s = act(s, { type: 'playCard', player: A, card: p, target: { monster: 0 } });
    expect(s.players[A].hand).toHaveLength(3);
    expect(s.players[J].level).toBe(1);
  });

  it('Magic Lamp: your turn only; the monster vanishes and you take its treasure', () => {
    let s = blank();
    const l = give(s, J, 'Magic Lamp');
    const l2 = l;
    s = kick(s, 'Floating Nose');
    s.players[A].hand.push(l2);
    s.players[J].hand.splice(s.players[J].hand.indexOf(l2), 1);
    err(s, { type: 'playCard', player: A, card: l2, target: { monster: 0 } });
    s.players[A].hand.pop();
    s.players[J].hand.push(l2);
    s = act(s, { type: 'playCard', player: J, card: l, target: { monster: 0 } });
    expect(s.players[J].hand).toHaveLength(3);
  });

  it('Transferral Potion moves the combat to another player', () => {
    let s = blank();
    const t = give(s, J, 'Transferral Potion');
    s = kick(s, 'Floating Nose');
    s = act(s, { type: 'playCard', player: J, card: t, target: { player: A } });
    expect(s.combat!.fighter).toBe(A);
    expect(s.turn).toBe(J);
  });

  it('Doppleganger doubles your strength, in your combat', () => {
    let s = blank();
    s.players[J].level = 3;
    give(s, J, 'Boots of Butt-Kicking', 'equipped');
    const d = give(s, J, 'Doppleganger');
    s = kick(s, 'Floating Nose');
    s = act(s, { type: 'playCard', player: J, card: d });
    expect(combatTotals(s).player).toBe(10);
  });

  it('Yuppie Water: +2 per Elf in the fight', () => {
    let s = blank();
    give(s, J, 'Elf', 'equipped');
    const y = give(s, J, 'Yuppie Water');
    s = kick(s, 'Floating Nose');
    s = act(s, { type: 'playCard', player: J, card: y });
    expect(combatTotals(s).player).toBe(3);
  });

  it('Help Me Out Here! borrows an item for this combat', () => {
    let s = blank();
    const h = give(s, J, 'Help Me Out Here!');
    const sw = give(s, A, 'Sneaky Bastard Sword', 'equipped');
    s = kick(s, 'Pit Bull');
    s = act(s, { type: 'playCard', player: J, card: h, target: { card: sw } });
    expect(combatTotals(s).player).toBe(3);
    s = act(s, { type: 'fight', player: J });
    expect(s.players[A].equipped).toEqual([sw]);
    expectConserved(s);
  });

  it('Instant Wall: the fighters escape automatically', () => {
    let s = blank();
    const w = give(s, J, 'Instant Wall');
    s = kick(s, 'Mr. Bones');
    s.players[J].level = 3;
    s = act(s, { type: 'playCard', player: J, card: w });
    expect(s.combat).toBeNull();
    expect(s.players[J].level).toBe(2); // Mr. Bones: lose 1 even if you escape
  });
});

describe('helping', () => {
  it('one helper; strengths add; treasure drawn face-up and split as agreed', () => {
    let s = blank();
    s.players[J].level = 4;
    s.players[A].level = 5;
    s = kick(s, 'Harpies'); // L4
    s.combat!.bonuses.push({ card: 'x', by: J, side: 'monster', value: 4, fire: false }); // 8
    s = act(s, { type: 'askHelp', player: J, target: A, offer: 1 });
    s = act(s, { type: 'respondHelp', player: A, accept: true });
    expect(combatTotals(s).player).toBe(9);
    s = act(s, { type: 'fight', player: J });
    expect(s.pending).toMatchObject({ type: 'chooseCards', player: A, reason: 'splitTreasure', min: 1 });
    const pick = (s.pending as { options: string[] }).options[1];
    s = act(s, { type: 'chooseCards', player: A, cards: [pick] });
    expect(s.players[A].hand).toEqual([pick]);
    expect(s.players[J].hand).toHaveLength(1);
    expect(s.players[J].level).toBe(5);
    expect(s.players[A].level).toBe(5);
    expectConserved(s);
  });

  it('a refusal is final for that combat', () => {
    let s = blank();
    s = kick(s, 'Floating Nose');
    s = act(s, { type: 'askHelp', player: J, target: A, offer: 2 });
    s = act(s, { type: 'respondHelp', player: A, accept: false });
    err(s, { type: 'askHelp', player: J, target: A, offer: 3 });
  });

  it('Elves gain a level for each monster they help kill', () => {
    let s = blank();
    s.players[J].level = 6;
    give(s, A, 'Elf', 'equipped');
    s = kick(s, 'Pit Bull');
    s = act(s, { type: 'askHelp', player: J, target: A, offer: 0 });
    s = act(s, { type: 'respondHelp', player: A, accept: true });
    s = act(s, { type: 'fight', player: J });
    expect(s.players[A].level).toBe(2);
  });

  it('Gazebo: nobody can help', () => {
    const s = kick(blank(), 'Gazebo');
    expect(err(s, { type: 'askHelp', player: J, target: A, offer: 0 })).toMatch(/Nobody/);
  });

  it('Kneepads of Allure: a lower-level player must help, for nothing', () => {
    let s = blank();
    s.players[J].level = 3;
    give(s, J, 'Kneepads of Allure', 'equipped');
    s = kick(s, 'Floating Nose');
    s = act(s, { type: 'askHelp', player: J, target: A, offer: 2 });
    expect(s.pending).toMatchObject({ type: 'helpRequest', forced: true, offer: 0 });
    err(s, { type: 'respondHelp', player: A, accept: false });
    s = act(s, { type: 'respondHelp', player: A, accept: true });
    expect(s.combat!.helper).toBe(A);
  });
});

describe('class powers in combat', () => {
  it('Warrior Berserking: +1 per discard, max 3', () => {
    let s = blank();
    give(s, J, 'Warrior', 'equipped');
    const cards = [give(s, J, 'Ancient'), give(s, J, 'Baby'), give(s, J, 'Mate'), give(s, J, 'Illusion')];
    s = kick(s, 'Floating Nose');
    s = act(s, { type: 'power', player: J, power: 'berserk', discard: cards.slice(0, 2) });
    s = act(s, { type: 'power', player: J, power: 'berserk', discard: [cards[2]] });
    err(s, { type: 'power', player: J, power: 'berserk', discard: [cards[3]] });
    expect(combatTotals(s).player).toBe(4);
  });

  it('Cleric Turning: +3 per discard vs Undead only', () => {
    let s = blank();
    give(s, J, 'Cleric', 'equipped');
    const c = give(s, J, 'Ancient');
    let t = kick(s, 'Pit Bull');
    err(t, { type: 'power', player: J, power: 'turn', discard: [c] });
    t = kick(blank(), 'Mr. Bones');
    give(t, J, 'Cleric', 'equipped');
    const d = give(t, J, 'Ancient');
    t = act(t, { type: 'power', player: J, power: 'turn', discard: [d] });
    expect(combatTotals(t).player).toBe(4);
    void s;
  });

  it('Thief Backstab: -2 to someone in the fight, once per victim', () => {
    let s = blank();
    give(s, A, 'Thief', 'equipped');
    const c1 = give(s, A, 'Ancient');
    const c2 = give(s, A, 'Baby');
    s.players[J].level = 3;
    s = kick(s, 'Pit Bull');
    s = act(s, { type: 'power', player: A, power: 'backstab', discard: [c1], target: { player: J } });
    expect(combatTotals(s).player).toBe(1);
    err(s, { type: 'power', player: A, power: 'backstab', discard: [c2], target: { player: J } });
  });

  it('Wizard Charm: discard a hand of 3+ to take the monster’s treasure (no level)', () => {
    let s = blank();
    give(s, J, 'Wizard', 'equipped');
    const h = [give(s, J, 'Ancient'), give(s, J, 'Baby')];
    s = kick(s, 'Floating Nose');
    err(s, { type: 'power', player: J, power: 'charm', discard: h, target: { monster: 0 } });
    h.push(give(s, J, 'Mate'));
    s = act(s, { type: 'power', player: J, power: 'charm', discard: h, target: { monster: 0 } });
    expect(s.combat).toBeNull();
    expect(s.players[J].hand).toHaveLength(3);
    expect(s.players[J].level).toBe(1);
  });
});

describe('special monsters', () => {
  it('Ghoulfiends: level only, no item bonuses', () => {
    let s = blank();
    s.players[J].level = 5;
    give(s, J, 'Boots of Butt-Kicking', 'equipped');
    const p = give(s, J, 'Magic Missile');
    s = kick(s, 'Ghoulfiends');
    s = act(s, { type: 'playCard', player: J, card: p, target: { side: 'player' } });
    expect(combatTotals(s).player).toBe(5);
  });

  it('Insurance Salesman: fire does nothing', () => {
    let s = blank();
    give(s, J, 'Flaming Armor', 'equipped');
    give(s, J, 'Boots of Butt-Kicking', 'equipped');
    s = kick(s, 'Insurance Salesman');
    expect(combatTotals(s).player).toBe(3);
  });

  it('Large Angry Chicken: an extra level if killed with fire', () => {
    let s = blank();
    give(s, J, 'Flaming Armor', 'equipped');
    s = kick(s, 'Large Angry Chicken');
    s = act(s, { type: 'fight', player: J });
    expect(s.players[J].level).toBe(3);
    let t = blank();
    give(t, J, 'Boots of Butt-Kicking', 'equipped');
    t = kick(t, 'Large Angry Chicken');
    t = act(t, { type: 'fight', player: J });
    expect(t.players[J].level).toBe(2);
  });

  it('Amazon: women don’t fight, they take 1 Treasure', () => {
    let s = blank();
    s.turn = S;
    s = kick(s, 'Amazon', S);
    expect(s.combat).toBeNull();
    expect(s.players[S].hand).toHaveLength(1);
    expect(s.players[S].level).toBe(1);
  });

  it('Stoned Golem: non-Halflings may skip it (no treasure)', () => {
    let s = kick(blank(), 'Stoned Golem');
    s = act(s, { type: 'avoidMonster', player: J, monster: 0 });
    expect(s.combat).toBeNull();
    expect(s.players[J].hand).toHaveLength(0);
    let t = blank();
    give(t, J, 'Halfling', 'equipped');
    t = kick(t, 'Stoned Golem');
    err(t, { type: 'avoidMonster', player: J, monster: 0 });
  });

  it('Wannabe Vampire: Clerics may chase it away and take 1 Treasure', () => {
    let s = blank();
    give(s, J, 'Cleric', 'equipped');
    s = kick(s, 'Wannabe Vampire');
    s = act(s, { type: 'avoidMonster', player: J, monster: 0 });
    expect(s.players[J].hand).toHaveLength(1);
  });

  it('Lawyers won’t attack Thieves', () => {
    let s = blank();
    give(s, J, 'Thief', 'equipped');
    s = kick(s, 'Lawyers');
    s = act(s, { type: 'avoidMonster', player: J, monster: 0 });
    expect(s.combat).toBeNull();
  });

  it('Tongue Demon: discard an item before fighting', () => {
    let s = blank();
    const a = give(s, J, 'Helm of Courage', 'equipped');
    const b = give(s, J, 'Leather Armor', 'equipped');
    s = kick(s, 'Tongue Demon');
    expect(s.pending).toMatchObject({ type: 'chooseCards', reason: 'discardItem', options: [a, b] });
    s = act(s, { type: 'chooseCards', player: J, cards: [b] });
    expect(s.players[J].equipped).toEqual([a]);
  });

  it('Potted Plant: Elves draw an extra treasure', () => {
    let s = blank();
    give(s, J, 'Elf', 'equipped');
    give(s, J, 'Helm of Courage', 'equipped');
    s = kick(s, 'Potted Plant');
    s = act(s, { type: 'fight', player: J });
    expect(s.players[J].hand).toHaveLength(2);
  });

  it('Malign Mirror: in your next combat only your level counts, then it goes', () => {
    let s = blank();
    s.players[J].level = 2;
    give(s, J, 'Boots of Butt-Kicking', 'equipped');
    const m = give(s, J, 'Curse! Malign Mirror', 'curses');
    s = kick(s, 'Lame Goblin');
    expect(combatTotals(s).player).toBe(2);
    s = act(s, { type: 'fight', player: J });
    expect(s.players[J].curses).toEqual([]);
    expect(s.discard_door).toContain(m);
  });
});

describe('the fighter must commit', () => {
  it('cannot ask for help, fight or run outside your own combat', () => {
    const s = kick(blank(), 'Pit Bull');
    err(s, { type: 'fight', player: A });
    err(s, { type: 'runAway', player: A });
    err(s, { type: 'askHelp', player: A, target: S, offer: 0 });
    void top;
  });
});
