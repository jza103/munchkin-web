// Run seeded all-bot games from the command line: npx vite-node scripts/sim.ts [games] [firstSeed]
import { simulate } from '../src/bots/driver';
import { violations } from '../src/engine/invariants';

const games = Number(process.argv[2] ?? 20);
const first = Number(process.argv[3] ?? 1);
const t0 = Date.now();
let finished = 0;
let steps = 0;
let fallbacks = 0;
const wins: Record<string, number> = {};
for (let seed = first; seed < first + games; seed++) {
  const r = simulate({
    seed,
    rivals: 1 + (seed % 5),
    onStep: (x) => {
      const v = violations(x.state);
      if (v.length) throw new Error(`seed ${seed} after ${x.actor} ${x.action.type}: ${v.join('; ')}`);
    },
  });
  if (r.state.phase === 'gameOver') finished++;
  for (const w of r.state.winners) wins[w] = (wins[w] ?? 0) + 1;
  steps += r.steps;
  fallbacks += r.fallbacks;
}
console.log({ games, finished, steps, fallbacks, wins, ms: Date.now() - t0 });
