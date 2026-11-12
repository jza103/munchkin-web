// Steps bots against the real engine state. Bots only ever see viewFor(state, bot).
import { apply } from '../engine/actions';
import { legalActions } from '../engine/legal';
import { newGame } from '../engine/state';
import { viewFor } from '../engine/view';
import type { Action, GameState, PlayerId } from '../engine/types';
import { actor, chooseAction } from './bot';
import { PERSONALITIES, type Personality, personalityFor } from './personalities';

export interface StepResult {
  state: GameState;
  actor: PlayerId;
  action: Action;
  /** true when the bot's own choice was illegal and a safe default was used */
  fallback: boolean;
}

export function botStep(s: GameState, personality: (id: PlayerId) => Personality, isBot: (id: PlayerId) => boolean): StepResult | null {
  const who = actor(s);
  if (!who || !isBot(who)) return null;
  let action: Action;
  try {
    action = chooseAction(viewFor(s, who), who, personality(who));
  } catch {
    action = legalActions(s, who)[0];
  }
  let r = apply(s, action);
  let fallback = false;
  if (!r.ok) {
    fallback = true;
    const legal = legalActions(s, who);
    action = legal.find((a) => a.type === 'pass') ?? legal.find((a) => a.type === 'runAway') ?? legal.find((a) => a.type === 'endTurn') ?? legal[0];
    r = apply(s, action);
    if (!r.ok) throw new Error(`No legal fallback for ${who}: ${r.error}`);
  }
  return { state: r.state, actor: who, action, fallback };
}

export interface SimOptions {
  seed: number;
  rivals: number;
  maxSteps?: number;
  onStep?: (r: StepResult) => void;
}

/** Play a whole game with every seat (including the human's) run by a bot. */
export function simulate(opts: SimOptions): { state: GameState; steps: number; fallbacks: number } {
  const rivals = PERSONALITIES.slice(0, opts.rivals).map((p) => ({ name: p.name, gender: p.gender }));
  let s = newGame({ seed: opts.seed, human: { name: 'Jason', gender: 'male' }, rivals });
  const pers = (id: PlayerId) => personalityFor(id, s.order.indexOf(id));
  let steps = 0;
  let fallbacks = 0;
  const max = opts.maxSteps ?? 20000;
  while (s.phase !== 'gameOver' && steps < max) {
    const r = botStep(s, pers, () => true)!;
    s = r.state;
    steps++;
    if (r.fallback) fallbacks++;
    opts.onStep?.(r);
  }
  return { state: s, steps, fallbacks };
}
