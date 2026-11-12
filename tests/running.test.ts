import { describe, expect, it } from 'vitest';
import type { GameState } from '../src/engine/types';
import { A, J, S, act, blank, err, give, kick, rig } from './helpers';

const run = (s: GameState, who = s.combat!.fighter) => act(s, { type: 'runAway', player: who });

describe('running away', () => {
  it('escape on 5+ after modifiers', () => {
    let s = kick(blank(), 'Pit Bull');
    s.players[J].level = 3;
    rig(s, 5);
    s = run(s);
    expect(s.players[J].level).toBe(3);
    expect(s.combat).toBeNull();
    let t = kick(blank(), 'Pit Bull');
    t.players[J].level = 3;
    rig(t, 4);
    t = run(t);
    expect(t.players[J].level).toBe(2);
  });

  it('Elf +1: a 4 is enough', () => {
    let s = blank();
    give(s, J, 'Elf', 'equipped');
    s.players[J].level = 3;
    s = kick(s, 'Pit Bull');
    rig(s, 4);
    s = run(s);
    expect(s.players[J].level).toBe(3);
  });

  it('Boots of Running Really Fast +2', () => {
    let s = blank();
    give(s, J, 'Boots of Running Really Fast', 'equipped');
    s.players[J].level = 3;
    s = kick(s, 'Pit Bull');
    rig(s, 3);
    s = run(s);
    expect(s.players[J].level).toBe(3);
  });

  it('monster run penalties (Flying Frogs -1) and bonuses (Lame Goblin +1)', () => {
    let s = blank();
    s.players[J].level = 4;
    s = kick(s, 'Flying Frogs');
    rig(s, 5);
    s = run(s);
    expect(s.players[J].level).toBe(2);
    let t = blank();
    t.players[J].level = 4;
    give(t, J, 'Curse! Malign Mirror', 'curses');
    t = kick(t, 'Lame Goblin');
    rig(t, 4);
    t = run(t);
    expect(t.players[J].level).toBe(4);
  });

  it('Chicken on Your Head: -1 to all die rolls', () => {
    let s = blank();
    s.players[J].level = 3;
    give(s, J, 'Curse! Chicken on Your Head', 'curses');
    s = kick(s, 'Pit Bull');
    rig(s, 5);
    s = run(s);
    expect(s.players[J].level).toBe(2);
  });

  it('roll separately for each monster', () => {
    let s = blank();
    s.players[J].level = 5;
    const w = give(s, A, 'Wandering Monster');
    const m = give(s, A, 'Floating Nose');
    s = kick(s, 'Pit Bull');
    s = act(s, { type: 'playCard', player: A, card: w, target: { card: m } });
    rig(s, 6, 1);
    s = run(s);
    expect(s.players[J].level).toBe(2); // escaped Pit Bull, caught by the Nose (-3)
  });

  it('a Mate is a second monster to run from', () => {
    let s = blank();
    s.players[J].level = 5;
    const m = give(s, A, 'Mate');
    s = kick(s, 'Floating Nose');
    s = act(s, { type: 'playCard', player: A, card: m, target: { monster: 0 } });
    rig(s, 1, 1);
    s = run(s);
    expect(s.players[J].level).toBe(1);
  });

  it("won't pursue low-level players", () => {
    let s = kick(blank(), 'Plutonium Dragon');
    s.players[J].level = 5;
    s = run(s);
    expect(s.players[J].dead).toBe(false);
    expect(s.combat).toBeNull();
  });

  it('Squidzilla pursues Elves anyway', () => {
    let s = blank();
    give(s, J, 'Elf', 'equipped');
    s = kick(s, 'Squidzilla');
    rig(s, 1);
    s = run(s);
    expect(s.players[J].dead).toBe(true);
  });

  it('Potted Plant: automatic escape', () => {
    let s = kick(blank(), 'Potted Plant');
    s = run(s);
    expect(s.combat).toBeNull();
  });

  it('Crabs: you can’t run', () => {
    let s = blank();
    const armor = give(s, J, 'Leather Armor', 'equipped');
    const boots = give(s, J, 'Boots of Butt-Kicking', 'equipped');
    const knees = give(s, J, 'Spiky Knees', 'equipped');
    const helm = give(s, J, 'Helm of Courage', 'equipped');
    s.players[J].level = 1;
    s.players[A].level = 5;
    // weaken: add a big monster-side bonus so Jason loses
    s = kick(s, 'Crabs');
    s.combat!.bonuses.push({ card: 'x', by: A, side: 'monster', value: 10, fire: false });
    rig(s, 6);
    s = run(s);
    expect(s.players[J].equipped).toEqual([helm]);
    expect(s.discard_treasure).toEqual(expect.arrayContaining([armor, boots, knees]));
  });

  it('Tuba of Charm: escape on a 3+', () => {
    let s = blank();
    s.players[J].level = 3;
    give(s, J, 'Tuba of Charm', 'equipped');
    s = kick(s, 'Snails on Speed');
    rig(s, 3);
    s = run(s);
    expect(s.players[J].level).toBe(3);
  });

  it('Rat on a Stick: discard to escape a monster of level 8 or lower', () => {
    let s = blank();
    s.players[J].level = 3;
    const rat = give(s, J, 'Rat on a Stick', 'equipped');
    s = kick(s, 'Floating Nose');
    s = run(s);
    expect(s.pending).toBeNull(); // L10: Rat doesn't work
    let t = blank();
    t.players[J].level = 4;
    give(t, J, 'Rat on a Stick', 'equipped');
    t = kick(t, 'Gazebo');
    t = run(t);
    expect(t.pending).toMatchObject({ type: 'preRun', player: J });
    t = act(t, { type: 'useRat', player: J, use: true });
    expect(t.players[J].level).toBe(4);
    expect(t.combat).toBeNull();
    void rat;
  });

  it('Invisibility Potion: escape after a failed run', () => {
    let s = blank();
    s.players[J].level = 4;
    give(s, J, 'Invisibility Potion');
    s = kick(s, 'Floating Nose');
    rig(s, 2);
    s = run(s);
    expect(s.pending).toMatchObject({ type: 'rollWindow', queue: [J] });
    s = act(s, { type: 'playCard', player: J, card: s.players[J].hand[0] });
    expect(s.players[J].level).toBe(4);
    expect(s.combat).toBeNull();
  });

  it('Flask of Glue: someone who escaped must roll again', () => {
    let s = blank();
    s.players[J].level = 4;
    const g = give(s, A, 'Flask of Glue');
    s = kick(s, 'Floating Nose');
    rig(s, 6, 1);
    s = run(s);
    expect(s.pending).toMatchObject({ type: 'rollWindow', queue: [A] });
    s = act(s, { type: 'playCard', player: A, card: g });
    expect(s.players[J].level).toBe(1);
  });

  it('Loaded Die sets a roll', () => {
    let s = blank();
    s.players[J].level = 4;
    const d = give(s, J, 'Loaded Die');
    s = kick(s, 'Floating Nose');
    rig(s, 1);
    s = run(s);
    err(s, { type: 'playCard', player: J, card: d, target: { value: 7 } });
    s = act(s, { type: 'playCard', player: J, card: d, target: { value: 6 } });
    expect(s.players[J].level).toBe(4);
  });

  it('Halfling: discard a card to reroll a failed run, once', () => {
    let s = blank();
    s.players[J].level = 4;
    give(s, J, 'Halfling', 'equipped');
    const c1 = give(s, J, 'Ancient');
    give(s, J, 'Baby');
    s = kick(s, 'Floating Nose');
    rig(s, 2, 1);
    s = run(s);
    s = act(s, { type: 'power', player: J, power: 'halflingReroll', discard: [c1] });
    expect(s.pending).toBeNull(); // second failure: no more rerolls
    expect(s.players[J].level).toBe(1);
  });

  it('Wizard Flight: +1 to run per discard', () => {
    let s = blank();
    s.players[J].level = 4;
    give(s, J, 'Wizard', 'equipped');
    const c = [give(s, J, 'Ancient'), give(s, J, 'Baby')];
    s = kick(s, 'Floating Nose');
    s = act(s, { type: 'power', player: J, power: 'flight', discard: c });
    rig(s, 3);
    s = run(s);
    expect(s.players[J].level).toBe(4);
  });

  it('Mr. Bones: lose a level even if you escape; Pukachu: gain one', () => {
    let s = kick(blank(), 'Mr. Bones');
    s.players[J].level = 3;
    s.combat!.bonuses.push({ card: 'x', by: A, side: 'monster', value: 9, fire: false });
    rig(s, 6);
    s = run(s);
    expect(s.players[J].level).toBe(2);
    let t = kick(blank(), 'Pukachu');
    rig(t, 6);
    t = run(t);
    expect(t.players[J].level).toBe(2);
  });

  it('the helper runs too, and suffers their own Bad Stuff', () => {
    let s = blank();
    s.players[J].level = 4;
    s.players[A].level = 4;
    s = kick(s, 'Floating Nose');
    s = act(s, { type: 'askHelp', player: J, target: A, offer: 1 });
    s = act(s, { type: 'respondHelp', player: A, accept: true });
    s.combat!.bonuses.push({ card: 'x', by: S, side: 'monster', value: 5, fire: false });
    rig(s, 6, 1);
    s = run(s);
    expect(s.players[J].level).toBe(4);
    expect(s.players[A].level).toBe(1);
  });
});
