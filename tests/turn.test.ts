import { describe, expect, it } from 'vitest';
import { strength } from '../src/engine/rules';
import { A, J, S, act, blank, err, expectConserved, give, kick, names, top } from './helpers';
import { legalActions } from '../src/engine/legal';

describe('kick open the door', () => {
  it('a monster starts a fight', () => {
    const s = kick(blank(), 'Pit Bull');
    expect(s.phase).toBe('combat');
    expect(s.combat!.fighter).toBe(J);
    expect(names(s.combat!.monsters.map((m) => m.card))).toEqual(['Pit Bull']);
  });

  it('a curse hits the kicker', () => {
    let s = blank();
    s.players[J].level = 3;
    s = kick(s, 'Curse! Lose a Level');
    expect(s.players[J].level).toBe(2);
    expect(s.phase).toBe('afterDoor');
    expectConserved(s);
  });

  it('anything else goes to the hand, then Look for Trouble or Loot the Room', () => {
    let s = kick(blank(), 'Elf');
    expect(names(s.players[J].hand)).toEqual(['Elf']);
    expect(s.phase).toBe('afterDoor');
    err(s, { type: 'endTurn', player: J });
    const t = top(s, 'Mate');
    s = act(s, { type: 'lootRoom', player: J });
    expect(s.players[J].hand).toContain(t);
    expect(s.phase).toBe('charity');
    s = act(s, { type: 'endTurn', player: J });
    expect(s.turn).toBe(A);
  });

  it('Look for Trouble fights a monster from your hand', () => {
    let s = kick(blank(), 'Elf');
    const rat = give(s, J, 'Maul Rat');
    s = act(s, { type: 'lookForTrouble', player: J, card: rat });
    expect(s.phase).toBe('combat');
    expect(s.combat!.monsters[0].card).toBe(rat);
  });

  it('only once per turn, and only on your turn', () => {
    let s = kick(blank(), 'Elf');
    err(s, { type: 'kickDoor', player: J });
    err(blank(), { type: 'kickDoor', player: A });
    s = blank();
    err(s, { type: 'endTurn', player: J });
  });

  it('Cleric Resurrection replaces the kick with the top Door discard', () => {
    let s = blank();
    give(s, J, 'Cleric', 'equipped');
    const pay = give(s, J, 'Ancient');
    const disc = s.discard_door;
    const elf = top(s, 'Elf');
    s.deck_door.splice(s.deck_door.indexOf(elf), 1);
    disc.push(elf);
    s = act(s, { type: 'kickDoor', player: J, resurrect: pay });
    expect(s.players[J].hand).toEqual([elf]);
    expect(s.discard_door.at(-1)).toBe(pay);
    expectConserved(s);
  });
});

describe('charity and hand limit', () => {
  const ready = () => {
    const s = kick(blank(), 'Elf');
    return act(s, { type: 'lootRoom', player: J });
  };

  it('extra cards go to the lowest-level player', () => {
    let s = ready();
    s.players[J].level = 3;
    s.players[A].level = 2;
    s.players[S].level = 4;
    while (s.players[J].hand.length < 7) s.players[J].hand.push(s.deck_treasure.pop()!);
    s = act(s, { type: 'endTurn', player: J });
    expect(s.pending).toMatchObject({ type: 'charity', excess: 2 });
    const two = s.players[J].hand.slice(0, 2);
    s = act(s, { type: 'charity', player: J, cards: two });
    expect(s.players[A].hand).toEqual(two);
    expect(s.turn).toBe(A);
  });

  it('ties for lowest share the cards; if you are lowest, discard', () => {
    let s = ready();
    s.players[J].level = 3;
    while (s.players[J].hand.length < 8) s.players[J].hand.push(s.deck_treasure.pop()!);
    s = act(s, { type: 'endTurn', player: J });
    const give3 = s.players[J].hand.slice(0, 3);
    let t = act(s, { type: 'charity', player: J, cards: give3 });
    expect(t.players[A].hand.length + t.players[S].hand.length).toBe(3);
    expect(Math.abs(t.players[A].hand.length - t.players[S].hand.length)).toBe(1);
    s.players[J].level = 1;
    t = act(s, { type: 'charity', player: J, cards: give3 });
    expect(t.players[A].hand.length + t.players[S].hand.length).toBe(0);
    expect([...t.discard_treasure, ...t.discard_door]).toEqual(expect.arrayContaining(give3));
  });

  it('Dwarves can hold 6', () => {
    let s = ready();
    give(s, J, 'Dwarf', 'equipped');
    while (s.players[J].hand.length < 6) s.players[J].hand.push(s.deck_treasure.pop()!);
    s = act(s, { type: 'endTurn', player: J });
    expect(s.turn).toBe(A);
  });
});

describe('items', () => {
  it('equip only on your own turn, never in combat', () => {
    let s = blank();
    const h = give(s, A, 'Helm of Courage');
    err(s, { type: 'equip', player: A, card: h });
    const b = give(s, J, 'Boots of Butt-Kicking');
    s = kick(s, 'Pit Bull');
    err(s, { type: 'equip', player: J, card: b });
  });

  it('slot limits: 1 head, 1 armor, 1 foot, 2 hands', () => {
    let s = blank();
    const h1 = give(s, J, 'Helm of Courage');
    const h2 = give(s, J, 'Horny Helmet');
    s = act(s, { type: 'equip', player: J, card: h1 });
    expect(err(s, { type: 'equip', player: J, card: h2 })).toMatch(/headgear/);
    const a = give(s, J, 'Buckler of Swashing');
    const b = give(s, J, 'Sneaky Bastard Sword');
    const pole = give(s, J, 'Eleven-Foot Pole');
    s = act(s, { type: 'equip', player: J, card: a });
    expect(err(s, { type: 'equip', player: J, card: pole })).toMatch(/hands/);
    s = act(s, { type: 'equip', player: J, card: b });
    const sds = give(s, J, 'Singing & Dancing Sword');
    s = act(s, { type: 'equip', player: J, card: sds });
    expect(strength(s, J)).toBe(1 + 1 + 2 + 2 + 2);
  });

  it('only one Big item in play unless you are a Dwarf', () => {
    let s = blank();
    const rock = give(s, J, 'Huge Rock');
    const chain = give(s, J, 'Chainsaw of Bloody Dismemberment');
    s = act(s, { type: 'carry', player: J, card: rock });
    expect(err(s, { type: 'carry', player: J, card: chain })).toMatch(/Big/);
    expect(err(s, { type: 'equip', player: J, card: chain })).toMatch(/Big/);
    give(s, J, 'Dwarf', 'equipped');
    s = act(s, { type: 'equip', player: J, card: chain });
    s = act(s, { type: 'carry', player: J, card: give(s, J, 'Stepladder') });
    expect(strength(s, J)).toBe(4);
    expect(s.players[J].carried).toHaveLength(2);
  });

  it('restricted items can be carried but only equipped if you qualify', () => {
    let s = blank();
    const bow = give(s, J, 'Bow with Ribbons');
    expect(err(s, { type: 'equip', player: J, card: bow })).toMatch(/restricted/);
    s = act(s, { type: 'carry', player: J, card: bow });
    const elf = give(s, J, 'Elf');
    s = act(s, { type: 'playRaceClass', player: J, card: elf });
    s = act(s, { type: 'equip', player: J, card: bow });
    expect(strength(s, J)).toBe(5);
  });

  it('gender restrictions (Broad Sword, Gentlemen\'s Club)', () => {
    let s = blank();
    s.turn = S;
    const sword = give(s, S, 'Broad Sword');
    const club = give(s, J, "Gentlemen's Club");
    err(s, { type: 'equip', player: S, card: sword });
    s.turn = J;
    s = act(s, { type: 'equip', player: J, card: club });
    expect(strength(s, J)).toBe(4);
  });

  it('Humans only: a Half-Breed with one race still counts as Human', () => {
    let s = blank();
    const band = give(s, J, 'Bad-Ass Bandana');
    s = act(s, { type: 'equip', player: J, card: band });
    expect(strength(s, J)).toBe(4);
    s = act(s, { type: 'playRaceClass', player: J, card: give(s, J, 'Elf') });
    // no longer human: the Bandana is moved to carried
    expect(s.players[J].carried).toContain(band);
    expect(strength(s, J)).toBe(1);
    s = act(s, { type: 'playRaceClass', player: J, card: give(s, J, 'Half-Breed') });
    s = act(s, { type: 'equip', player: J, card: band });
    expect(strength(s, J)).toBe(4);
  });

  it('Horny Helmet is +3 for Elves', () => {
    let s = blank();
    give(s, J, 'Horny Helmet', 'equipped');
    expect(strength(s, J)).toBe(2);
    give(s, J, 'Elf', 'equipped');
    expect(strength(s, J)).toBe(4);
  });

  it('Cheat! equips one item you normally could not', () => {
    let s = blank();
    const hammer = give(s, J, 'Hammer of Kneecapping');
    const cheat = give(s, J, 'Cheat!');
    s = act(s, { type: 'playCard', player: J, card: cheat, target: { card: hammer } });
    expect(strength(s, J)).toBe(5);
    expect(s.players[J].cheat).toEqual({ card: cheat, item: hammer });
    // unequipping the item discards Cheat!
    s = act(s, { type: 'carry', player: J, card: hammer });
    expect(s.discard_door).toContain(cheat);
    expect(s.players[J].cheat).toBeNull();
    expectConserved(s);
  });

  it('once on the table, a card never goes back to the hand', () => {
    let s = blank();
    const h = give(s, J, 'Helm of Courage');
    s = act(s, { type: 'equip', player: J, card: h });
    s = act(s, { type: 'carry', player: J, card: h });
    expect(s.players[J].hand).not.toContain(h);
    s = act(s, { type: 'equip', player: J, card: h });
    expect(s.players[J].equipped).toContain(h);
  });
});

describe('race and class', () => {
  it('one race and one class, unless Half-Breed / Super Munchkin', () => {
    let s = blank();
    s = act(s, { type: 'playRaceClass', player: J, card: give(s, J, 'Elf') });
    const dwarf = give(s, J, 'Dwarf');
    err(s, { type: 'playRaceClass', player: J, card: dwarf });
    const hb = give(s, J, 'Half-Breed');
    s = act(s, { type: 'playRaceClass', player: J, card: hb });
    s = act(s, { type: 'playRaceClass', player: J, card: dwarf });
    expect(s.players[J].equipped).toHaveLength(3);
    s = act(s, { type: 'playRaceClass', player: J, card: give(s, J, 'Warrior') });
    err(s, { type: 'playRaceClass', player: J, card: give(s, J, 'Thief') });
    s = act(s, { type: 'playRaceClass', player: J, card: give(s, J, 'Super Munchkin') });
    s = act(s, { type: 'playRaceClass', player: J, card: s.players[J].hand.find((c) => c.startsWith('thief'))! });
  });

  it('can replace your race on your turn, never in combat', () => {
    let s = blank();
    const elf = give(s, J, 'Elf', 'equipped');
    const dwarf = give(s, J, 'Dwarf');
    s = act(s, { type: 'playRaceClass', player: J, card: dwarf, replace: elf });
    expect(s.discard_door).toContain(elf);
    const thief = give(s, J, 'Thief');
    s = kick(s, 'Pit Bull');
    err(s, { type: 'playRaceClass', player: J, card: thief });
  });

  it('you may discard your race or class at any time', () => {
    let s = blank();
    const w = give(s, A, 'Wizard', 'equipped');
    s = act(s, { type: 'discardRaceClass', player: A, card: w });
    expect(s.players[A].equipped).toEqual([]);
  });

  it('losing Dwarf with two Big items makes you keep only one', () => {
    let s = blank();
    const dwarf = give(s, J, 'Dwarf', 'equipped');
    const rock = give(s, J, 'Huge Rock', 'equipped');
    const chain = give(s, J, 'Chainsaw of Bloody Dismemberment', 'carried');
    s = act(s, { type: 'discardRaceClass', player: J, card: dwarf });
    expect(s.pending).toMatchObject({ type: 'chooseCards', reason: 'keepBig' });
    s = act(s, { type: 'chooseCards', player: J, cards: [chain] });
    expect(s.players[J].carried).toEqual([chain]);
    expect(s.discard_treasure).toContain(rock);
  });
});

describe('selling', () => {
  it('1,000 Gold per level, no change, from hand or table', () => {
    let s = blank();
    const a = give(s, J, 'Bow with Ribbons'); // 800
    const b = give(s, J, 'Leather Armor', 'equipped'); // 200
    const c = give(s, J, 'Sleep Potion'); // 100
    expect(err(s, { type: 'sell', player: J, cards: [a] })).toMatch(/1,000/);
    s = act(s, { type: 'sell', player: J, cards: [a, b, c] });
    expect(s.players[J].level).toBe(2);
    expect(s.discard_treasure).toEqual(expect.arrayContaining([a, b, c]));
  });

  it('can never give Level 10', () => {
    let s = blank();
    s.players[J].level = 9;
    err(s, { type: 'sell', player: J, cards: [give(s, J, 'Pollymorph Potion')] });
    s.players[J].level = 8;
    s = act(s, { type: 'sell', player: J, cards: [s.players[J].hand[0]] });
    expect(s.players[J].level).toBe(9);
  });

  it('Halflings sell one item per turn for double', () => {
    let s = blank();
    give(s, J, 'Halfling', 'equipped');
    const bow = give(s, J, 'Bow with Ribbons');
    err(s, { type: 'sell', player: J, cards: [bow] });
    s = act(s, { type: 'sell', player: J, cards: [bow], double: bow });
    expect(s.players[J].level).toBe(2);
    const st = give(s, J, 'Staff of Napalm');
    err(s, { type: 'sell', player: J, cards: [st], double: st });
  });

  it('only on your turn and not in combat; no-value cards cannot be sold', () => {
    let s = blank();
    err(s, { type: 'sell', player: A, cards: [give(s, A, 'Pollymorph Potion')] });
    err(s, { type: 'sell', player: J, cards: [give(s, J, 'Huge Rock')] });
    const p = give(s, J, 'Bow with Ribbons');
    const q = give(s, J, 'Leather Armor');
    s = kick(s, 'Pit Bull');
    err(s, { type: 'sell', player: J, cards: [p, q] });
  });
});

describe('Go Up a Level', () => {
  it('any time, never to Level 10', () => {
    let s = blank();
    const g = give(s, A, 'Boil an Anthill');
    s = act(s, { type: 'playCard', player: A, card: g });
    expect(s.players[A].level).toBe(2);
    s.players[A].level = 9;
    err(s, { type: 'playCard', player: A, card: give(s, A, 'Bribe GM With Food') });
  });

  it('Whine at the GM is not for the leader', () => {
    let s = blank();
    const w = give(s, J, 'Whine at the GM');
    err(s, { type: 'playCard', player: J, card: w }); // everyone tied: J leads
    s.players[A].level = 3;
    s = act(s, { type: 'playCard', player: J, card: w });
    expect(s.players[J].level).toBe(2);
  });

  it('Divine Intervention resolves when kicked open: every Cleric goes up, never to 10', () => {
    let s = blank();
    give(s, A, 'Cleric', 'equipped');
    give(s, S, 'Cleric', 'equipped');
    s.players[S].level = 9;
    s = kick(s, 'Divine Intervention');
    expect([s.players[J].level, s.players[A].level, s.players[S].level]).toEqual([1, 2, 9]);
    expect(names(s.discard_door)).toContain('Divine Intervention');
    expect(s.phase).toBe('afterDoor');
  });

  it('Divine Intervention resolves when drawn face-down (Loot the Room) and never stays in a hand', () => {
    let s = kick(blank(), 'Elf');
    give(s, A, 'Cleric', 'equipped');
    top(s, 'Divine Intervention');
    s = act(s, { type: 'lootRoom', player: J });
    expect(s.players[A].level).toBe(2);
    expect(names(s.players[J].hand)).not.toContain('Divine Intervention');
    expect(names(s.discard_door)).toContain('Divine Intervention');
  });

  it('Divine Intervention and Hoard! cannot be played from a hand; a stray copy resolves at once', () => {
    let s = blank();
    give(s, A, 'Cleric', 'equipped');
    const di = give(s, J, 'Divine Intervention');
    expect(legalActions(s, J).some((a) => a.type === 'playCard' && a.card === di)).toBe(false);
    s = act(s, { type: 'log', text: 'x' } as never);
    expect(s.players[A].level).toBe(2);
    expect(s.players[J].hand).toHaveLength(0);
  });

  it('Hoard! drawn face-down gives 3 more Treasures face-down', () => {
    let s = blank();
    top(s, 'Hoard!');
    s = act(s, { type: 'draw', deck: 'treasure', n: 1, dest: `${J}.hand` } as never);
    expect(s.players[J].hand).toHaveLength(3);
    expect(names(s.players[J].hand)).not.toContain('Hoard!');
    expect(names(s.discard_treasure)).toContain('Hoard!');
  });

  it('Hoard! drawn face-up puts its 3 Treasures face-up on the table', () => {
    let s = blank();
    top(s, 'Hoard!');
    s = act(s, { type: 'draw', deck: 'treasure', n: 1, dest: 'play' } as never);
    expect(s.play).toHaveLength(3);
    expect(s.log.join(' ')).toMatch(/3 more Treasures, face-up/);
  });

  it('Hoard! in the new hand of a player back from the dead is drawn face-up', () => {
    let s = blank();
    s = act(s, { type: 'die', player: A } as never);
    top(s, 'Hoard!');
    s = act(s, { type: 'revive', player: A } as never);
    expect(s.players[A].hand).toHaveLength(8 - 1 + 3);
    expect(s.log.join(' ')).toMatch(/Alex reveals the Hoard!/);
  });
});

describe('race and class edge cases', () => {
  it('Super Munchkin cannot replace Half-Breed (found by the legalActions fuzz)', () => {
    const s = blank();
    const hb = give(s, J, 'Half-Breed', 'equipped');
    give(s, J, 'Elf', 'equipped');
    give(s, J, 'Dwarf', 'equipped');
    const sm = give(s, J, 'Super Munchkin');
    expect(err(s, { type: 'playRaceClass', player: J, card: sm, replace: hb })).toMatch(/does not replace/);
    expect(legalActions(s, J).some((a) => a.type === 'playRaceClass' && a.card === sm && a.replace)).toBe(false);
  });
});

describe('trading', () => {
  it('trade table items on your turn; the other player accepts or declines', () => {
    let s = blank();
    const mine = give(s, J, 'Helm of Courage', 'carried');
    const theirs = give(s, A, 'Leather Armor', 'equipped');
    s = act(s, { type: 'trade', player: J, to: A, give: [mine], get: [theirs] });
    err(s, { type: 'respondTrade', player: J, accept: true });
    s = act(s, { type: 'respondTrade', player: A, accept: true });
    expect(s.players[J].carried).toEqual([theirs]);
    expect(s.players[A].carried).toEqual([mine]);
    err(s, { type: 'trade', player: J, to: A, give: [give(s, J, 'Sleep Potion')], get: [] });
  });
});

describe('death and revival', () => {
  it('a dead player revives at the start of their next turn with 4 + 4', () => {
    let s = blank();
    s.players[A].dead = true;
    s = kick(s, 'Elf');
    s = act(s, { type: 'lootRoom', player: J });
    s = act(s, { type: 'endTurn', player: J });
    expect(s.turn).toBe(A);
    expect(s.players[A].dead).toBe(false);
    expect(s.players[A].hand).toHaveLength(8);
    expect(top).toBeDefined();
  });
});
