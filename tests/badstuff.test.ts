// Every monster's Bad Stuff, plus curses, Wishing Ring, Sandals and death.
import { describe, expect, it } from 'vitest';
import type { GameState } from '../src/engine/types';
import { A, J, S, act, blank, err, expectConserved, give, kick, names, rig } from './helpers';

/** Jason (level `lvl`) meets `monster`, can't win, and fails to run (die shows `die`, then `more` for any rolls). */
function lose(monster: string, lvl = 5, setup?: (s: GameState) => void, die = 1, ...more: number[]): GameState {
  let s = blank();
  s.players[J].level = lvl;
  setup?.(s);
  s = kick(s, monster);
  if (s.pending) return s;
  s.combat!.bonuses.push({ card: 'x', by: S, side: 'monster', value: 30, fire: false });
  rig(s, die, ...more);
  return act(s, { type: 'runAway', player: J });
}

describe('Bad Stuff', () => {
  it('3,872 Orcs: roll 1-2 dead, else lose that many levels', () => {
    expect(lose('3,872 Orcs', 6, undefined, 1, 2).players[J].dead).toBe(true);
    expect(lose('3,872 Orcs', 6, undefined, 1, 4).players[J].level).toBe(2);
  });

  it('Amazon: lose your class, or 3 levels if you have none', () => {
    const s = lose('Amazon', 5, (x) => void give(x, J, 'Thief', 'equipped'));
    expect(s.players[J].equipped).toEqual([]);
    expect(s.players[J].level).toBe(5);
    expect(lose('Amazon').players[J].level).toBe(2);
  });

  it('Bigfoot: lose headgear', () => {
    const s = lose('Bigfoot', 5, (x) => void give(x, J, 'Helm of Courage', 'equipped'));
    expect(s.players[J].equipped).toEqual([]);
  });

  it('Bullrog / Plutonium Dragon / Stoned Golem / Squidzilla: dead', () => {
    for (const m of ['Bullrog', 'Plutonium Dragon', 'Stoned Golem', 'Squidzilla']) expect(lose(m, 6).players[J].dead, m).toBe(true);
  });

  it('Drooling Slime: lose footgear, or a level without', () => {
    const s = lose('Drooling Slime', 5, (x) => void give(x, J, 'Boots of Butt-Kicking', 'equipped'));
    expect(s.players[J].equipped).toEqual([]);
    expect(s.players[J].level).toBe(5);
    expect(lose('Drooling Slime').players[J].level).toBe(4);
  });

  it('Face Sucker: lose headgear and a level', () => {
    const s = lose('Face Sucker', 5, (x) => void give(x, J, 'Helm of Courage', 'equipped'));
    expect(s.players[J].equipped).toEqual([]);
    expect(s.players[J].level).toBe(4);
  });

  it('level losses: Floating Nose 3, Flying Frogs 2, Gazebo 3, Harpies 2, Lame Goblin 1, Maul Rat 1, Pit Bull 1, Undead Horse 2, Wannabe Vampire 3', () => {
    const cases: [string, number][] = [
      ['Floating Nose', 3], ['Flying Frogs', 2], ['Gazebo', 3], ['Harpies', 2], ['Lame Goblin', 1],
      ['Maul Rat', 1], ['Pit Bull', 1], ['Undead Horse', 2], ['Wannabe Vampire', 3], ['Large Angry Chicken', 1], ['Pukachu', 1],
    ];
    for (const [m, n] of cases) expect(lose(m, 6).players[J].level, m).toBe(6 - n);
  });

  it('levels never drop below 1', () => {
    expect(lose('Floating Nose', 2).players[J].level).toBe(1);
  });

  it('Gelatinous Octahedron: drop all Big items', () => {
    const s = lose('Gelatinous Octahedron', 5, (x) => {
      give(x, J, 'Dwarf', 'equipped');
      give(x, J, 'Huge Rock', 'equipped');
      give(x, J, 'Stepladder', 'carried');
      give(x, J, 'Helm of Courage', 'equipped');
    });
    expect(names(s.players[J].equipped).sort()).toEqual(['Dwarf', 'Helm of Courage']);
    expect(s.players[J].carried).toEqual([]);
  });

  it('Ghoulfiends: drop to the lowest player’s level', () => {
    const s = lose('Ghoulfiends', 7, (x) => {
      x.players[A].level = 3;
      x.players[S].level = 4;
    });
    expect(s.players[J].level).toBe(3);
  });

  it('Hippogriff: each other player takes an item (highest level first)', () => {
    let s = lose('Hippogriff', 5, (x) => {
      x.players[A].level = 2;
      x.players[S].level = 3;
      give(x, J, 'Helm of Courage', 'equipped');
      give(x, J, 'Leather Armor', 'equipped');
      give(x, J, 'Huge Rock', 'carried');
    });
    expect(s.pending).toMatchObject({ type: 'chooseCards', player: S, reason: 'takeItem' });
    const opts = (s.pending as { options: string[] }).options;
    s = act(s, { type: 'chooseCards', player: S, cards: [opts[2]] });
    expect(s.pending).toMatchObject({ player: A });
    s = act(s, { type: 'chooseCards', player: A, cards: [(s.pending as { options: string[] }).options[0]] });
    expect(s.players[J].equipped).toHaveLength(1);
    expect(s.players[S].carried).toHaveLength(1);
    expect(s.players[A].carried).toHaveLength(1);
    expectConserved(s);
  });

  it('Insurance Salesman: lose 1,000 Gold of items, no change', () => {
    let s = lose('Insurance Salesman', 6, (x) => {
      give(x, J, 'Bow with Ribbons', 'carried'); // 800
      give(x, J, 'Leather Armor', 'equipped'); // 200
      give(x, J, 'Mithril Armor', 'carried'); // 600
    });
    expect(s.pending).toMatchObject({ type: 'chooseCards', minGold: 1000 });
    const [bow, , mith] = (s.pending as { options: string[] }).options;
    const leather = (s.pending as { options: string[] }).options[1];
    err(s, { type: 'chooseCards', player: J, cards: [bow] });
    err(s, { type: 'chooseCards', player: J, cards: [bow, leather, mith] });
    s = act(s, { type: 'chooseCards', player: J, cards: [bow, leather] });
    expect(names(s.players[J].carried)).toEqual(['Mithril Armor']);
    // with too little, lose everything of value
    const t = lose('Insurance Salesman', 6, (x) => void give(x, J, 'Helm of Courage', 'equipped'));
    expect(t.players[J].equipped).toEqual([]);
  });

  it('King Tut: lose all items and your hand', () => {
    const s = lose('King Tut', 6, (x) => {
      give(x, J, 'Helm of Courage', 'equipped');
      give(x, J, 'Huge Rock', 'carried');
      give(x, J, 'Elf', 'equipped');
      give(x, J, 'Ancient');
    });
    expect(names(s.players[J].equipped)).toEqual(['Elf']);
    expect(s.players[J].carried).toEqual([]);
    expect(s.players[J].hand).toEqual([]);
  });

  it('Lawyers: give 2 cards to others', () => {
    let s = lose('Lawyers', 5, (x) => {
      give(x, J, 'Ancient');
      give(x, J, 'Baby');
      give(x, J, 'Mate');
    });
    expect(s.pending).toMatchObject({ type: 'chooseCards', reason: 'giveCards', min: 2 });
    const [a, b] = (s.pending as { options: string[] }).options;
    s = act(s, { type: 'chooseCards', player: J, cards: [a, b] });
    expect(s.pending).toMatchObject({ type: 'chooseOption', options: [A, S] });
    s = act(s, { type: 'chooseOption', player: J, option: 0 });
    s = act(s, { type: 'chooseOption', player: J, option: 1 });
    expect(s.players[A].hand).toEqual([a]);
    expect(s.players[S].hand).toEqual([b]);
  });

  it('Leperchaun: the players to your left and right each take an item', () => {
    let s = lose('Leperchaun', 5, (x) => {
      give(x, J, 'Helm of Courage', 'equipped');
      give(x, J, 'Leather Armor', 'equipped');
    });
    expect(s.pending).toMatchObject({ player: A });
    s = act(s, { type: 'chooseCards', player: A, cards: [(s.pending as { options: string[] }).options[0]] });
    expect(s.pending).toMatchObject({ player: S });
  });

  it('Mr. Bones: lose 2 levels', () => {
    expect(lose('Mr. Bones', 5).players[J].level).toBe(3);
  });

  it('Net Troll: each higher-level player takes an item', () => {
    const s = lose('Net Troll', 4, (x) => {
      x.players[A].level = 6;
      give(x, J, 'Helm of Courage', 'equipped');
    });
    expect(s.pending).toMatchObject({ player: A });
  });

  it('Platycore: your choice of your hand or 2 levels', () => {
    let s = lose('Platycore', 5, (x) => void give(x, J, 'Ancient'));
    expect(s.pending).toMatchObject({ type: 'chooseOption' });
    s = act(s, { type: 'chooseOption', player: J, option: 0 });
    expect(s.players[J].hand).toEqual([]);
    expect(s.players[J].level).toBe(5);
  });

  it('Potted Plant: no Bad Stuff', () => {
    expect(lose('Potted Plant').players[J].level).toBe(5);
  });

  it('Shrieking Geek: lose race and class', () => {
    const s = lose('Shrieking Geek', 5, (x) => {
      give(x, J, 'Elf', 'equipped');
      give(x, J, 'Warrior', 'equipped');
    });
    expect(s.players[J].equipped).toEqual([]);
  });

  it('Snails on Speed: roll, lose that many items', () => {
    let s = lose('Snails on Speed', 5, (x) => {
      give(x, J, 'Helm of Courage', 'equipped');
      give(x, J, 'Leather Armor', 'equipped');
      give(x, J, 'Huge Rock', 'carried');
    }, 1, 2);
    expect(s.pending).toMatchObject({ type: 'chooseCards', reason: 'loseItems', min: 2, max: 2 });
    const o = (s.pending as { options: string[] }).options;
    s = act(s, { type: 'chooseCards', player: J, cards: [o[0], o[2]] });
    expect(s.players[J].equipped).toEqual([o[1]]);
  });

  it('Tongue Demon: lose 2 levels (Elves 3)', () => {
    expect(lose('Tongue Demon', 6).players[J].level).toBe(4);
    expect(lose('Tongue Demon', 6, (x) => void give(x, J, 'Elf', 'equipped')).players[J].level).toBe(3);
  });

  it('Unspeakably Awful Indescribable Horror: dead, but Wizards lose their class', () => {
    expect(lose('Unspeakably Awful Indescribable Horror', 6).players[J].dead).toBe(true);
    const s = lose('Unspeakably Awful Indescribable Horror', 6, (x) => void give(x, J, 'Wizard', 'equipped'));
    expect(s.players[J].dead).toBe(false);
    expect(s.players[J].equipped).toEqual([]);
  });

  it('Wight Brothers: back to Level 1', () => {
    expect(lose('Wight Brothers', 8).players[J].level).toBe(1);
  });

  it('Crabs: lose armor and everything below the waist', () => {
    const s = lose('Crabs', 5, (x) => {
      give(x, J, 'Leather Armor', 'equipped');
      give(x, J, 'Pantyhose of Giant Strength', 'equipped');
      give(x, J, 'Helm of Courage', 'equipped');
    });
    expect(names(s.players[J].equipped)).toEqual(['Helm of Courage']);
  });
});

describe('death', () => {
  it('others loot one card each (highest level first); keep level, race, class and curses', () => {
    let s = lose('Bullrog', 6, (x) => {
      x.players[A].level = 2;
      x.players[S].level = 4;
      give(x, J, 'Elf', 'equipped');
      give(x, J, 'Curse! Chicken on Your Head', 'curses');
      give(x, J, 'Helm of Courage', 'equipped');
      give(x, J, 'Ancient');
      give(x, J, 'Huge Rock', 'carried');
    });
    expect(s.players[J].dead).toBe(true);
    expect(s.pending).toMatchObject({ type: 'chooseCards', player: S, reason: 'loot' });
    const o = (s.pending as { options: string[] }).options;
    expect(names(o).sort()).toEqual(['Ancient', 'Helm of Courage', 'Huge Rock']);
    s = act(s, { type: 'chooseCards', player: S, cards: [o[0]] });
    s = act(s, { type: 'chooseCards', player: A, cards: [(s.pending as { options: string[] }).options[0]] });
    const p = s.players[J];
    expect(p.level).toBe(6);
    expect(names(p.equipped)).toEqual(['Elf']);
    expect(names(p.curses)).toEqual(['Curse! Chicken on Your Head']);
    expect(p.hand).toEqual([]);
    expect(p.carried).toEqual([]);
    expect(s.players[S].hand).toHaveLength(1);
    expect(s.players[A].hand).toHaveLength(1);
    expectConserved(s);
  });

  it('dead players cannot act', () => {
    const s = lose('Bullrog', 6);
    err(s, { type: 'playCard', player: J, card: 'x' });
  });
});

describe('curses', () => {
  const curse = (name: string, setup?: (s: GameState) => void, target = A) => {
    let s = blank();
    s.players[A].level = 5;
    setup?.(s);
    const c = give(s, J, name);
    s = act(s, { type: 'playCard', player: J, card: c, target: { player: target } });
    return s;
  };

  it('Lose a Level / Duck of Doom', () => {
    expect(curse('Curse! Lose a Level').players[A].level).toBe(4);
    expect(curse('Curse! Duck of Doom').players[A].level).toBe(3);
  });

  it('Lose Your Armor / Footgear / Headgear take only worn items', () => {
    const s = curse('Curse! Lose Your Armor', (x) => {
      give(x, A, 'Leather Armor', 'carried');
      give(x, A, 'Slimy Armor', 'equipped');
    });
    expect(names(s.players[A].carried)).toEqual(['Leather Armor']);
    expect(s.players[A].equipped).toEqual([]);
    expect(curse('Curse! Lose Your Footgear', (x) => void give(x, A, 'Boots of Butt-Kicking', 'equipped')).players[A].equipped).toEqual([]);
    expect(curse('Curse! Lose Your Headgear', (x) => void give(x, A, 'Helm of Courage', 'equipped')).players[A].equipped).toEqual([]);
  });

  it('Lose Your Race / Class', () => {
    expect(curse('Curse! Lose Your Race', (x) => void give(x, A, 'Elf', 'equipped')).players[A].equipped).toEqual([]);
    expect(curse('Curse! Lose Your Class', (x) => void give(x, A, 'Thief', 'equipped')).players[A].equipped).toEqual([]);
  });

  it('Change Race / Class: take the top one from the discard pile', () => {
    const s = curse('Curse! Change Class', (x) => {
      give(x, A, 'Thief', 'equipped');
      const w = give(x, S, 'Wizard');
      x.players[S].hand.splice(0);
      x.discard_door.push(w);
    });
    expect(names(s.players[A].equipped)).toEqual(['Wizard']);
    const t = curse('Curse! Change Race', (x) => {
      give(x, A, 'Elf', 'equipped');
      const d = give(x, S, 'Dwarf');
      x.players[S].hand.splice(0);
      x.discard_door.push(d);
    });
    expect(names(t.players[A].equipped)).toEqual(['Dwarf']);
  });

  it('Lose 1 Big Item / Lose 1 Small Item', () => {
    expect(curse('Curse! Lose 1 Big Item', (x) => void give(x, A, 'Huge Rock', 'carried')).players[A].carried).toEqual([]);
    let s = curse('Curse! Lose 1 Small Item', (x) => {
      give(x, A, 'Helm of Courage', 'equipped');
      give(x, A, 'Leather Armor', 'equipped');
      give(x, A, 'Huge Rock', 'carried');
    });
    expect(s.pending).toMatchObject({ type: 'chooseCards', player: A, reason: 'loseItem' });
    expect(names((s.pending as { options: string[] }).options)).toEqual(['Helm of Courage', 'Leather Armor']);
    s = act(s, { type: 'chooseCards', player: A, cards: [(s.pending as { options: string[] }).options[0]] });
    expect(names(s.players[A].equipped)).toEqual(['Leather Armor']);
  });

  it('Truly Obnoxious Curse: lose your best item', () => {
    const s = curse('Curse! Truly Obnoxious Curse', (x) => {
      give(x, A, 'Helm of Courage', 'equipped');
      give(x, A, 'Mithril Armor', 'equipped');
    });
    expect(names(s.players[A].equipped)).toEqual(['Helm of Courage']);
  });

  it('Income Tax: discard an item; others pay its value in items or lose a level', () => {
    let s = blank();
    s.players[A].level = 4;
    s.players[S].level = 4;
    s.players[J].level = 4;
    const bow = give(s, J, 'Bow with Ribbons', 'carried'); // 800
    give(s, J, 'Helm of Courage', 'equipped');
    const m = give(s, A, 'Mithril Armor', 'carried'); // 600
    const l = give(s, A, 'Leather Armor', 'carried'); // 200
    const c = give(s, S, 'Curse! Income Tax');
    s.turn = S;
    s = act(s, { type: 'playCard', player: S, card: c, target: { player: J } });
    s = act(s, { type: 'chooseCards', player: J, cards: [bow] });
    // Alex can pay 800 with Mithril + Leather; Sam has nothing and loses a level
    expect(s.pending).toMatchObject({ type: 'chooseCards', player: A, reason: 'incomeTaxPay', minGold: 800 });
    s = act(s, { type: 'chooseCards', player: A, cards: [m, l] });
    expect(s.players[A].level).toBe(4);
    expect(s.players[S].level).toBe(3);
    expect(s.players[J].level).toBe(4);
    // or Alex could refuse and lose a level
  });

  it('Income Tax: choosing to pay nothing costs a level (ruling)', () => {
    let s = blank();
    for (const id of [A, S, J]) s.players[id].level = 4;
    const bow = give(s, J, 'Bow with Ribbons', 'carried'); // 800
    give(s, A, 'Mithril Armor', 'carried');
    give(s, A, 'Leather Armor', 'carried');
    s.turn = S;
    s = act(s, { type: 'playCard', player: S, card: give(s, S, 'Curse! Income Tax'), target: { player: J } });
    s = act(s, { type: 'chooseCards', player: J, cards: [bow] });
    s = act(s, { type: 'chooseCards', player: A, cards: [] });
    expect(s.players[A].level).toBe(3);
    expect(s.players[A].carried).toHaveLength(2);
  });

  it('Chicken on Your Head leaves with a curse or Bad Stuff that takes headgear', () => {
    const s = curse('Curse! Lose Your Headgear', (x) => {
      give(x, A, 'Curse! Chicken on Your Head', 'curses');
      give(x, A, 'Helm of Courage', 'equipped');
    });
    expect(s.players[A].curses).toEqual([]);
    expect(s.players[A].equipped).toEqual([]);
    const bare = curse('Curse! Lose Your Headgear', (x) => void give(x, A, 'Curse! Chicken on Your Head', 'curses'));
    expect(bare.players[A].curses).toEqual([]);
    const other = curse('Curse! Lose Your Footgear', (x) => void give(x, A, 'Curse! Chicken on Your Head', 'curses'));
    expect(names(other.players[A].curses)).toEqual(['Curse! Chicken on Your Head']);
  });

  it('Chicken on Your Head stays on you', () => {
    const s = curse('Curse! Chicken on Your Head');
    expect(names(s.players[A].curses)).toEqual(['Curse! Chicken on Your Head']);
  });

  it('Wishing Ring cancels a curse as it is played, or removes one that stays', () => {
    let s = blank();
    s.players[A].level = 5;
    const ring = give(s, A, 'Wishing Ring');
    s = act(s, { type: 'playCard', player: J, card: give(s, J, 'Curse! Duck of Doom'), target: { player: A } });
    expect(s.pending).toMatchObject({ type: 'curseWindow', queue: [A] });
    s = act(s, { type: 'playCard', player: A, card: ring });
    expect(s.players[A].level).toBe(5);
    let t = blank();
    const ch = give(t, A, 'Curse! Chicken on Your Head', 'curses');
    t = act(t, { type: 'playCard', player: J, card: give(t, J, 'Wishing Ring'), target: { player: A, card: ch } });
    expect(t.players[A].curses).toEqual([]);
  });

  it('Sandals of Protection block curses from the door only when worn', () => {
    let s = blank();
    s.players[J].level = 3;
    give(s, J, 'Sandals of Protection', 'equipped');
    s = kick(s, 'Curse! Lose a Level');
    expect(s.players[J].level).toBe(3);
    let t = blank();
    t.players[J].level = 3;
    give(t, J, 'Sandals of Protection', 'carried');
    t = kick(t, 'Curse! Lose a Level');
    expect(t.players[J].level).toBe(2);
    // curses played from a hand are not blocked
    let u = blank();
    u.players[J].level = 3;
    give(u, J, 'Sandals of Protection', 'equipped');
    u = act(u, { type: 'playCard', player: A, card: give(u, A, 'Curse! Lose a Level'), target: { player: J } });
    expect(u.players[J].level).toBe(2);
  });
});

describe('thief theft', () => {
  it('discard a card, 4+ steals a small item, else lose a level', () => {
    let s = blank();
    s.players[J].level = 3;
    give(s, J, 'Thief', 'equipped');
    const helm = give(s, A, 'Helm of Courage', 'equipped');
    const c1 = give(s, J, 'Ancient');
    const c2 = give(s, J, 'Baby');
    rig(s, 4);
    s = act(s, { type: 'power', player: J, power: 'theft', discard: [c1], target: { player: A, card: helm } });
    expect(s.players[J].carried).toEqual([helm]);
    const helm2 = give(s, A, 'Leather Armor', 'equipped');
    rig(s, 3);
    s = act(s, { type: 'power', player: J, power: 'theft', discard: [c2], target: { player: A, card: helm2 } });
    expect(s.players[J].level).toBe(2);
    err(s, { type: 'power', player: J, power: 'theft', discard: [give(s, J, 'Mate')], target: { player: A, card: give(s, A, 'Huge Rock', 'carried') } });
  });
});

describe('Cleric Resurrection on face-up treasure', () => {
  it('a helped Cleric may take the top Treasure discard, paying a card each', () => {
    let s = blank();
    s.players[J].level = 5;
    give(s, J, 'Cleric', 'equipped');
    const pay = give(s, J, 'Ancient');
    const want = give(s, A, 'Wishing Ring');
    s.players[A].hand.splice(0);
    s.discard_treasure.push(want);
    s = kick(s, 'Pit Bull');
    s = act(s, { type: 'askHelp', player: J, target: A, offer: 0 });
    s = act(s, { type: 'respondHelp', player: A, accept: true });
    s = act(s, { type: 'fight', player: J });
    expect(s.pending).toMatchObject({ type: 'resurrect', player: J, remaining: 1 });
    s = act(s, { type: 'resurrect', player: J, discard: pay });
    expect(s.players[J].hand).toEqual([want]);
    expectConserved(s);
  });
});
