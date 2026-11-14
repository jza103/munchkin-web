import { describe, expect, it } from 'vitest';
import { chooseAction } from '../src/bots/bot';
import { PERSONALITIES } from '../src/bots/personalities';
import { viewFor } from '../src/engine/view';
import { strength } from '../src/engine/rules';
import type { Action, GameState, PlayerId } from '../src/engine/types';
import { A, J, S, act, blank, expectConserved, give, kick } from './helpers';

const alex = PERSONALITIES[0];
const decide = (s: GameState, id: PlayerId): Action => chooseAction(viewFor(s, id), id, { ...alex, name: id });

describe('rival bots', () => {
  it('equip the best legal gear on their turn', () => {
    let s = blank();
    s.turn = A;
    give(s, A, 'Helm of Courage');
    give(s, A, 'Bad-Ass Bandana');
    give(s, A, 'Bow with Ribbons'); // Elves only
    for (let i = 0; i < 5; i++) {
      const a = decide(s, A);
      if (a.type === 'kickDoor') break;
      s = act(s, a);
    }
    // Bandana (+3) goes on; the unusable Bow and the spare Helm are sold for a level
    expect(s.players[A].equipped.map((c) => c.split('#')[0])).toEqual(['bad-ass-bandana']);
    expect(s.players[A].level).toBe(2);
    expect(strength(s, A)).toBe(5);
  });

  it('sell for a level, never to 10; Halflings double', () => {
    let s = blank();
    s.turn = S;
    give(s, S, 'Halfling', 'equipped');
    give(s, S, 'Bow with Ribbons'); // 800, unusable
    const a = decide(s, S);
    expect(a).toMatchObject({ type: 'sell', double: expect.any(String) });
    s = act(s, a);
    expect(s.players[S].level).toBe(2);
  });

  it('fight when winning, run when hopeless', () => {
    let s = blank();
    s.turn = A;
    s.players[A].level = 4;
    s = kick(s, 'Pit Bull', A);
    expect(decide(s, A).type).toBe('fight');
    let t = blank();
    t.turn = A;
    t = kick(t, 'Plutonium Dragon', A);
    t.players[A].level = 6; // dragon pursues
    expect(['runAway', 'askHelp']).toContain(decide(t, A).type);
  });

  it('never help someone reach Level 10', () => {
    let s = blank();
    s.players[J].level = 9;
    s = kick(s, 'Floating Nose');
    s = act(s, { type: 'askHelp', player: J, target: A, offer: 3 });
    expect(decide(s, A)).toEqual({ type: 'respondHelp', player: A, accept: false });
  });

  it('always try to stop a Level 10 win', () => {
    let s = blank();
    s.players[J].level = 9;
    give(s, J, 'Boots of Butt-Kicking', 'equipped');
    give(s, A, 'Enraged');
    s = kick(s, 'Pit Bull');
    s = act(s, { type: 'fight', player: J });
    expect(s.pending).toMatchObject({ type: 'combatWindow', queue: [A] });
    const a = decide(s, A);
    expect(a).toMatchObject({ type: 'playCard', target: { monster: 0 } });
  });

  it('prefer cheap denials like Friendship Potion', () => {
    let s = blank();
    s.players[J].level = 9;
    give(s, J, 'Boots of Butt-Kicking', 'equipped');
    give(s, A, 'Enraged');
    const f = give(s, A, 'Friendship Potion');
    s = kick(s, 'Pit Bull');
    s = act(s, { type: 'fight', player: J });
    expect(decide(s, A)).toMatchObject({ type: 'playCard', card: f });
  });

  it('give away the least useful cards for charity', () => {
    let s = blank();
    s.turn = A;
    s.flags.kicked = true;
    s.phase = 'charity';
    s.players[A].level = 3;
    const junk = give(s, A, 'Lame Goblin');
    for (const n of ['Boil an Anthill', 'Wishing Ring', 'Magic Missile', 'Mace of Sharpness', 'Doppleganger']) give(s, A, n);
    s = act(s, { type: 'endTurn', player: A });
    expect(decide(s, A)).toEqual({ type: 'charity', player: A, cards: [junk] });
    expectConserved(s);
  });
});

describe('regressions found by the 500-game run', () => {
  it('an item borrowed from a player who dies is discarded, not returned to the body', () => {
    let s = blank();
    s.players[J].level = 3;
    s.players[A].level = 3;
    const h = give(s, J, 'Help Me Out Here!');
    const sw = give(s, A, 'Sneaky Bastard Sword', 'equipped');
    s = kick(s, 'Bullrog');
    s = act(s, { type: 'playCard', player: J, card: h, target: { card: sw } });
    s.players[A].dead = true; // e.g. killed while the sword was on loan
    s.combat!.bonuses.push({ card: 'x', by: J, side: 'player', value: 30, fire: false });
    s = act(s, { type: 'fight', player: J });
    expect(s.players[A].equipped).toEqual([]);
    expect(s.discard_treasure).toContain(sw);
  });

  it('a Big item coming back from loan re-checks the one-Big-item rule', () => {
    let s = blank();
    s.players[J].level = 3;
    const h = give(s, J, 'Help Me Out Here!');
    const rock = give(s, A, 'Huge Rock', 'equipped');
    s = kick(s, 'Pit Bull');
    s = act(s, { type: 'playCard', player: J, card: h, target: { card: rock } });
    give(s, A, 'Mithril Armor', 'carried'); // e.g. taken from someone's Bad Stuff meanwhile
    s = act(s, { type: 'fight', player: J });
    expect(s.pending).toMatchObject({ type: 'chooseCards', player: A, reason: 'keepBig' });
  });

  it('a returned item the owner can no longer use goes to carried', () => {
    let s = blank();
    s.players[J].level = 3;
    const h = give(s, J, 'Help Me Out Here!');
    const dwarf = give(s, A, 'Dwarf', 'equipped');
    const ham = give(s, A, 'Hammer of Kneecapping', 'equipped');
    give(s, J, 'Dwarf', 'equipped'); // Jason must qualify to borrow the Hammer
    s = kick(s, 'Pit Bull');
    s = act(s, { type: 'playCard', player: J, card: h, target: { card: ham } });
    s.players[A].equipped = s.players[A].equipped.filter((c) => c !== dwarf);
    s.discard_door.push(dwarf); // Alex lost Dwarf mid-combat
    s = act(s, { type: 'fight', player: J });
    expect(s.players[A].carried).toEqual([ham]);
    expectConserved(s);
  });

  it('a Cheat!-ed item lent out with Help Me Out Here! comes back still Cheat!-ed', () => {
    let s = blank();
    give(s, A, 'Flaming Armor', 'equipped');
    const sw = give(s, A, 'Short Wide Armor');
    s.turn = A;
    s = act(s, { type: 'playCard', player: A, card: give(s, A, 'Cheat!'), target: { card: sw } });
    give(s, J, 'Dwarf', 'equipped');
    s.turn = J;
    s.flags.kicked = false;
    s = kick(s, 'Pit Bull');
    s = act(s, { type: 'playCard', player: J, card: give(s, J, 'Help Me Out Here!'), target: { card: sw } });
    expect(s.players[A].cheat).not.toBeNull();
    s = act(s, { type: 'fight', player: J });
    while (s.pending?.type === 'combatWindow') s = act(s, { type: 'pass', player: s.pending.queue[0] });
    expect(s.combat).toBeNull();
    expect(s.players[A].equipped).toContain(sw);
    expect(s.players[A].cheat?.item).toBe(sw);
    expectConserved(s);
  });

  it('propose a trade: an item they cannot use for one the other player cannot use', () => {
    let s = blank();
    s.turn = A;
    give(s, A, 'Elf', 'equipped');
    give(s, S, 'Dwarf', 'equipped');
    give(s, A, 'Bad-Ass Bandana', 'carried'); // Humans only: no use to Alex (Elf) or Sam (Dwarf)
    give(s, J, 'Bow with Ribbons', 'carried'); // Elves only: no use to Jason (Human)
    const a = decide(s, A);
    expect(a).toMatchObject({ type: 'trade', to: J });
    s = act(s, a);
    expect(s.pending).toMatchObject({ type: 'trade', player: J, from: A });
    s = act(s, { type: 'respondTrade', player: J, accept: true });
    expect(s.players[A].carried.map((c) => c.split('#')[0])).toContain('bow-with-ribbons');
    // only one offer a turn
    expect(decide(act(blankTradeDeclined(), { type: 'respondTrade', player: J, accept: false }), A).type).not.toBe('trade');
  });

  it('use Cheat! to equip a strong item they could not otherwise use', () => {
    let s = blank();
    s.turn = A;
    give(s, A, 'Cheat!');
    give(s, A, 'Bow with Ribbons'); // +4, Elves only
    const a = decide(s, A);
    expect(a).toMatchObject({ type: 'playCard' });
    s = act(s, a);
    expect(s.players[A].cheat).not.toBeNull();
    expect(strength(s, A)).toBe(5);
  });

  it('use Illusion to stop a Level 10 win', () => {
    let s = blank();
    s.players[J].level = 9;
    s = kick(s, 'Pit Bull');
    give(s, A, 'Illusion');
    give(s, A, 'Plutonium Dragon');
    s = act(s, { type: 'fight', player: J });
    const a = decide(s, A);
    expect(a).toMatchObject({ type: 'playCard' });
    s = act(s, a);
    expect(s.log.join(' ')).toMatch(/Alex plays Illusion/);
  });
});

function blankTradeDeclined(): GameState {
  const s = blank();
  s.turn = A;
  give(s, A, 'Elf', 'equipped');
  give(s, A, 'Bad-Ass Bandana', 'carried');
  give(s, J, 'Bow with Ribbons', 'carried');
  return act(s, decide(s, A));
}
