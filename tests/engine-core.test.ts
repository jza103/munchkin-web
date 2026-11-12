import { describe, expect, it } from 'vitest';
import { apply } from '../src/engine/actions';
import { ALL_IDS, DOOR_IDS, TREASURE_IDS, cardOf } from '../src/engine/cards';
import { newGame } from '../src/engine/state';
import { viewFor } from '../src/engine/view';
import { legalActions } from '../src/engine/legal';
import { A, J, S, act, blank, err, expectConserved, give, top } from './helpers';

const fresh = (seed: number | string = 42) =>
  newGame({ seed, human: { name: J }, rivals: [{ name: A }, { name: S, gender: 'female' }] });

describe('new game', () => {
  it('shuffles both decks and deals 4 Door + 4 Treasure to everyone', () => {
    const s = fresh();
    for (const id of s.order) {
      const hand = s.players[id].hand;
      expect(hand.filter((c) => cardOf(c).deck === 'door')).toHaveLength(4);
      expect(hand.filter((c) => cardOf(c).deck === 'treasure')).toHaveLength(4);
      expect(s.players[id].level).toBe(1);
    }
    expect(s.deck_door).toHaveLength(DOOR_IDS.length - 12);
    expect(s.deck_treasure).toHaveLength(TREASURE_IDS.length - 12);
    expect(s.turn).toBe(J);
    expect(s.phase).toBe('setup');
    expectConserved(s);
  });

  it('is replayable from the seed', () => {
    expect(fresh(7)).toEqual(fresh(7));
    expect(fresh(7).deck_door).not.toEqual(fresh(8).deck_door);
    expect(fresh('abc').deck_door).toEqual(fresh('abc').deck_door);
  });

  it('accepts 1 to 5 rivals with unique names', () => {
    expect(() => newGame({ seed: 1, human: { name: J }, rivals: [] })).toThrow();
    expect(() => newGame({ seed: 1, human: { name: J }, rivals: [{ name: J }] })).toThrow();
    const six = ['a', 'b', 'c', 'd', 'e', 'f'].map((name) => ({ name }));
    expect(() => newGame({ seed: 1, human: { name: J }, rivals: six })).toThrow();
    expect(newGame({ seed: 1, human: { name: J }, rivals: six.slice(0, 5) }).order).toHaveLength(6);
  });
});

describe('skill commands', () => {
  it('draw moves cards from a deck to a zone', () => {
    let s = blank();
    const t = top(s, 'Ancient');
    s = act(s, { type: 'draw', deck: 'door', n: 1, dest: `${J}.hand` });
    expect(s.players[J].hand).toEqual([t]);
    s = act(s, { type: 'draw', deck: 'treasure', n: 2, dest: 'play' });
    expect(s.play).toHaveLength(2);
    expectConserved(s);
  });

  it('reshuffles the discards when a deck runs out', () => {
    let s = blank();
    s.discard_door.push(...s.deck_door.splice(0, s.deck_door.length - 1));
    s = act(s, { type: 'draw', deck: 'door', n: 3, dest: `${J}.hand` });
    expect(s.players[J].hand).toHaveLength(3);
    expect(s.discard_door).toHaveLength(0);
    expect(s.log.some((l) => l.includes('reshuffled'))).toBe(true);
    expectConserved(s);
  });

  it('move only moves a card that is in the source zone', () => {
    let s = blank();
    const c = give(s, J, 'Wishing Ring');
    expect(apply(s, { type: 'move', card: c, from: `${A}.hand`, to: 'discard_treasure' }).ok).toBe(false);
    s = act(s, { type: 'move', card: c, from: `${J}.hand`, to: `${A}.carried` });
    expect(s.players[A].carried).toContain(c);
  });

  it('level supports +N, -N and =N and never goes below 1', () => {
    let s = blank();
    s = act(s, { type: 'level', player: J, change: '+3' });
    expect(s.players[J].level).toBe(4);
    s = act(s, { type: 'level', player: J, change: '-10' });
    expect(s.players[J].level).toBe(1);
    s = act(s, { type: 'level', player: J, change: '=6' });
    expect(s.players[J].level).toBe(6);
    expect(apply(s, { type: 'level', player: J, change: '6' }).ok).toBe(false);
  });

  it('die keeps race and class, discards the rest; revive deals 4 + 4', () => {
    let s = blank();
    const elf = give(s, J, 'Elf', 'equipped');
    const wiz = give(s, J, 'Wizard', 'equipped');
    give(s, J, 'Helm of Courage', 'equipped');
    give(s, J, 'Huge Rock', 'carried');
    give(s, J, 'Ancient');
    s = act(s, { type: 'die', player: J });
    const p = s.players[J];
    expect(p.dead).toBe(true);
    expect(p.equipped.sort()).toEqual([elf, wiz].sort());
    expect(p.carried).toEqual([]);
    expect(p.hand).toEqual([]);
    s = act(s, { type: 'revive', player: J });
    expect(s.players[J].dead).toBe(false);
    expect(s.players[J].hand).toHaveLength(8);
    expectConserved(s);
  });

  it('roll gives 1-6 and is deterministic', () => {
    const s = blank();
    const a = act(s, { type: 'roll', player: J, n: 20 });
    const b = act(s, { type: 'roll', player: J, n: 20 });
    expect(a.log.at(-1)).toEqual(b.log.at(-1));
    const rolls = (a.events.at(-1)!.data!.rolls as number[]);
    expect(rolls.every((r) => r >= 1 && r <= 6)).toBe(true);
  });

  it('check reports the hand limit (5, Dwarf 6)', () => {
    let s = blank();
    for (let i = 0; i < 6; i++) s = act(s, { type: 'draw', deck: 'treasure', n: 1, dest: `${J}.hand` });
    s = act(s, { type: 'check', player: J });
    expect(s.log.at(-1)).toContain('6/5 -> 1 over');
    give(s, J, 'Dwarf', 'equipped');
    s = act(s, { type: 'check', player: J });
    expect(s.log.at(-1)).toBe('Jason: 6/6 OK');
  });

  it('log appends a line', () => {
    const s = act(blank(), { type: 'log', text: 'Hello' });
    expect(s.log.at(-1)).toBe('Hello');
  });
});

describe('apply()', () => {
  it('never mutates the input state and reports rule errors', () => {
    const s = blank();
    const before = JSON.stringify(s);
    const r = apply(s, { type: 'kickDoor', player: A });
    expect(r.ok).toBe(false);
    act(s, { type: 'kickDoor', player: J });
    expect(JSON.stringify(s)).toBe(before);
  });

  it('rejects unknown players and actions', () => {
    const s = blank();
    err(s, { type: 'kickDoor', player: 'Nobody' });
    expect(apply(s, { type: 'nope' } as never).ok).toBe(false);
  });

  it('keeps every card in exactly one place', () => {
    expect(ALL_IDS.length).toBe(163);
    expectConserved(fresh());
  });
});

describe('player view', () => {
  it('shows your own hand and only Door/Treasure counts for others', () => {
    const s = fresh();
    const v = viewFor(s, J);
    expect(v.players[J].hand).toEqual(s.players[J].hand);
    expect(v.players[A].hand.every((c) => c.startsWith('?'))).toBe(true);
    expect(v.players[A].hand.filter((c) => c.startsWith('?door'))).toHaveLength(4);
    expect(v.deck_door.every((c) => c.startsWith('?'))).toBe(true);
    // legal moves can be computed from a view
    expect(legalActions(v, J).length).toBeGreaterThan(0);
  });
});
