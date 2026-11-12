// Replay one seeded all-bot game and dump the state at the first invariant violation: npx vite-node scripts/debug-seed.ts SEED
import { simulate } from '../src/bots/driver';
import { violations } from '../src/engine/invariants';
import { nameOf } from '../src/engine/cards';
const seed = Number(process.argv[2]);
let prev: { pending: unknown; queue: unknown } | null = null;
try {
  simulate({ seed, rivals: Number(process.argv[3] ?? 1 + (seed % 5)), onStep: (x) => { const v = violations(x.state); if (v.length) { console.log(x.state.log.slice(-25).join('\n')); console.log(JSON.stringify(x.action), v, JSON.stringify(x.state.pending), JSON.stringify(x.state.queue)); for (const id of x.state.order) { const p = x.state.players[id]; console.log(id, p.dead, p.hand.map(nameOf), p.carried.map(nameOf), p.equipped.map(nameOf)); } console.log('prev pending', JSON.stringify(prev?.pending), JSON.stringify(prev?.queue)); throw new Error('stop'); } prev = x.state; } });
} catch (e) { console.log(String(e)); }
