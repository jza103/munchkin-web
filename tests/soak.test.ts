// Real-play hardening: more seeds with mixed rival counts, a turn cap, and a legalActions/apply fuzz.
import { describe, expect, it } from 'vitest';
import { simulate } from '../src/bots/driver';
import { apply } from '../src/engine/actions';
import { endOfTurnViolations, violations } from '../src/engine/invariants';
import { legalActions } from '../src/engine/legal';
import type { Action, GameState } from '../src/engine/types';

const TURN_CAP = 600;

/** Actions that must never be accepted in state `s`. */
function illegalSamples(s: GameState): Action[] {
  const out: Action[] = [];
  const notTurn = s.order.find((id) => id !== s.turn)!;
  out.push({ type: 'kickDoor', player: notTurn }, { type: 'endTurn', player: notTurn }, { type: 'lootRoom', player: notTurn });
  out.push({ type: 'kickDoor', player: 'Nobody' });
  // equipping a card that is not yours
  const other = s.order.find((id) => id !== s.turn && s.players[id].hand.length > 0);
  if (other) out.push({ type: 'equip', player: s.turn, card: s.players[other].hand[0] });
  // playing a card straight from a draw pile
  if (s.deck_treasure.length) out.push({ type: 'playCard', player: s.turn, card: s.deck_treasure[0] });
  if (s.phase === 'gameOver') out.push({ type: 'kickDoor', player: s.turn });
  return out;
}

describe('soak: 150 more seeded games, mixed rival counts', () => {
  it('every game ends inside the turn cap with no illegal state', () => {
    for (let i = 0; i < 150; i++) {
      const seed = 90_000 + i * 7;
      const rivals = 1 + (i % 5);
      const r = simulate({
        seed,
        rivals,
        onStep: (x) => {
          const v = violations(x.state);
          if (x.state.turn !== x.actor && (x.action.type === 'endTurn' || x.action.type === 'charity')) v.push(...endOfTurnViolations(x.state, x.actor));
          if (x.state.turnNumber > TURN_CAP) v.push(`still going at turn ${x.state.turnNumber}`);
          if (v.length) throw new Error(`seed ${seed} (${rivals} rivals): ${x.actor} ${x.action.type}: ${v.join('; ')}`);
        },
      });
      expect(r.state.phase, `seed ${seed}`).toBe('gameOver');
      expect(r.fallbacks, `seed ${seed}`).toBe(0);
      for (const w of r.state.winners) expect(r.state.players[w].level).toBe(10);
    }
  });
});

describe('fuzz: legalActions against apply', () => {
  it('every legal action applies cleanly; sampled illegal actions are rejected', () => {
    let legalChecked = 0;
    let illegalChecked = 0;
    for (let i = 0; i < 25; i++) {
      const seed = 70_000 + i * 13;
      let step = 0;
      let prev: GameState | null = null;
      simulate({
        seed,
        rivals: 1 + (i % 5),
        onStep: (x) => {
          step++;
          const s = x.state;
          if (step % 9 !== 0 || s.phase === 'gameOver') return void (prev = s);
          for (const id of s.order) {
            for (const a of legalActions(s, id)) {
              const r = apply(s, a);
              if (!r.ok) throw new Error(`seed ${seed} step ${step}: legal ${JSON.stringify(a)} was rejected: ${r.error}`);
              const v = violations(r.state);
              if (v.length) throw new Error(`seed ${seed} step ${step}: ${JSON.stringify(a)} broke: ${v.join('; ')}`);
              legalChecked++;
            }
          }
          for (const a of illegalSamples(s)) {
            const r = apply(s, a);
            if (r.ok) throw new Error(`seed ${seed} step ${step}: illegal ${JSON.stringify(a)} was accepted`);
            illegalChecked++;
          }
          prev = s;
        },
      });
      void prev;
    }
    expect(legalChecked).toBeGreaterThan(5000);
    expect(illegalChecked).toBeGreaterThan(1000);
  });
});
