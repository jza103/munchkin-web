// "Bots play 500 full games" (1 to 5 rivals) with no illegal states.
import { describe, expect, it } from 'vitest';
import { simulate } from '../src/bots/driver';
import { violations } from '../src/engine/invariants';
import { handLimit } from '../src/engine/rules';

describe.each([1, 2, 3, 4, 5])('%i rival(s): 100 seeded games', (rivals) => {
  it('every game ends with a Level 10 winner and no illegal state', () => {
    let fallbacks = 0;
    for (let i = 0; i < 100; i++) {
      const seed = rivals * 1000 + i;
      const r = simulate({
        seed,
        rivals,
        onStep: (x) => {
          const v = violations(x.state);
          if (v.length) throw new Error(`seed ${seed}: ${x.actor} ${x.action.type}: ${v.join('; ')}`);
          if ((x.action.type === 'endTurn' || x.action.type === 'charity') && x.state.turn !== x.actor) {
            const p = x.state.players[x.actor];
            if (p.hand.length > handLimit(p)) throw new Error(`seed ${seed}: ${x.actor} ended the turn over the hand limit`);
          }
        },
      });
      expect(r.state.phase, `seed ${seed}`).toBe('gameOver');
      expect(r.state.winners.length).toBeGreaterThan(0);
      for (const w of r.state.winners) expect(r.state.players[w].level).toBe(10);
      fallbacks += r.fallbacks;
    }
    // bots should essentially never pick an illegal move
    expect(fallbacks).toBe(0);
  });
});
