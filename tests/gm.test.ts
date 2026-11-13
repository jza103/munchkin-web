import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { describeTable, narrationPrompt, questionPrompt, skillSection, systemPrompt } from '../src/gm/prompt';
import { streamGm } from '../src/gm/client';
import { pickEvents } from '../src/ui/gm';
import { recap } from '../src/ui/recap';
import { soundFor } from '../src/ui/sound';
import { simulate } from '../src/bots/driver';
import { nameOf } from '../src/engine/cards';
import { A, J, act, blank, give, kick } from './helpers';

describe('GM prompts', () => {
  it('system prompt carries the skill’s narration, rules and rival sections, not its engine commands', () => {
    const sys = systemPrompt();
    expect(skillSection('Narration style')).toContain('⚖️');
    expect(sys).toContain('## Narration style');
    expect(sys).toContain('## Rules cheat sheet');
    expect(sys).toContain('## Playing the rivals');
    expect(sys).toContain('Never invent');
    expect(sys).not.toMatch(/munchkin\.py/);
  });

  it('never leaks rival hand contents, only counts', () => {
    let s = blank();
    const secret = give(s, A, 'Plutonium Dragon');
    give(s, A, 'Wishing Ring');
    const mine = give(s, J, 'Magic Missile');
    s = kick(s, 'Pit Bull');
    const text = narrationPrompt({ state: s, events: s.events, rejected: [], recent: [] }) + questionPrompt(s, 'what now?', s.events) + describeTable(s);
    expect(text).not.toContain(nameOf(secret));
    expect(text).not.toContain('Wishing Ring');
    expect(text).toContain(nameOf(mine));
    expect(text).toContain('2 cards (1 Door, 1 Treasure)');
    expect(text).toContain('Pit Bull');
  });

  it('includes rejected moves for a ⚖️ ruling', () => {
    const s = blank();
    const p = narrationPrompt({ state: s, events: [], rejected: ['Sell Huge Rock — engine says: no Gold value'], recent: [] });
    expect(p).toContain('rejected');
    expect(p).toContain('Huge Rock');
  });

  it('asks for the end-of-game recap when the game is over', () => {
    const { state } = simulate({ seed: 3, rivals: 2 });
    const p = narrationPrompt({ state, events: state.events, rejected: [], recent: [] });
    expect(p).toContain('3 or 4 moments');
  });
});

describe('when the GM speaks', () => {
  it('only when the game is waiting on the human, and only with new events', () => {
    let s = blank();
    expect(pickEvents(s, 0, false)?.length).toBeGreaterThan(0);
    expect(pickEvents(s, s.eventSeq, false)).toBeNull();
    s = act(s, { type: 'kickDoor', player: J });
    s.turn = A; // a bot is acting: wait
    s.phase = 'setup';
    s.combat = null;
    s.pending = null;
    expect(pickEvents(s, 0, false)).toBeNull();
  });

  it('"only my turns" skips events from rival turns', () => {
    const { state } = simulate({ seed: 5, rivals: 2 });
    const all = pickEvents(state, 0, false)!;
    const mine = pickEvents({ ...state, phase: 'setup', turn: state.human, pending: null, combat: null }, 0, true) ?? [];
    expect(mine.length).toBeLessThan(all.length);
  });
});

describe('GM client', () => {
  function fakeClient(chunks: string[], stop = 'end_turn') {
    const calls: unknown[] = [];
    const client = {
      beta: {
        messages: {
          stream(params: unknown) {
            calls.push(params);
            let cb: (d: string) => void = () => {};
            return {
              on(_ev: string, f: (d: string) => void) {
                cb = f;
                return this;
              },
              async finalMessage() {
                for (const c of chunks) cb(c);
                return { stop_reason: stop };
              },
            };
          },
        },
      },
    } as unknown as Anthropic;
    return { client, calls };
  }

  it('streams text and uses the cheap model at low effort with a cached system prompt', async () => {
    const { client, calls } = fakeClient(['🚪 You kick ', 'the door.']);
    const seen: string[] = [];
    const r = await streamGm(client, { model: 'claude-haiku-5-5', system: 'SYS', user: 'U' }, (t) => seen.push(t));
    expect(r).toEqual({ text: '🚪 You kick the door.', refused: false });
    expect(seen).toEqual(['🚪 You kick ', '🚪 You kick the door.']);
    expect(calls[0]).toMatchObject({
      model: 'claude-haiku-5-5',
      output_config: { effort: 'low' },
      system: [{ type: 'text', text: 'SYS', cache_control: { type: 'ephemeral' } }],
    });
    expect(calls[0]).not.toHaveProperty('fallbacks');
  });

  it('opts Opus/Sonnet into server-side fallbacks and reports refusals', async () => {
    const { client, calls } = fakeClient([], 'refusal');
    const r = await streamGm(client, { model: 'claude-opus-5-5', system: 'S', user: 'U' }, () => {});
    expect(r.refused).toBe(true);
    expect(calls[0]).toMatchObject({ betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
  });
});

describe('end-of-game recap and sound', () => {
  it('recap picks at most 4 moments, ending with the winning kill', () => {
    const { state } = simulate({ seed: 11, rivals: 3 });
    const r = recap(state);
    expect(r.length).toBeGreaterThan(0);
    expect(r.length).toBeLessThanOrEqual(4);
    expect(r.at(-1)!.text).toContain('defeat');
    expect(recap(blank())).toEqual([]);
  });

  it('plays the most dramatic sound for a batch of events', () => {
    const ev = (type: string, text = '', data?: Record<string, unknown>) => ({ seq: 1, turn: 1, type, text, data });
    expect(soundFor([ev('door'), ev('death', 'Jason is DEAD.')])).toBe('death');
    expect(soundFor([ev('level', '', { from: 2, to: 3 })])).toBe('levelUp');
    expect(soundFor([ev('note')])).toBeNull();
  });
});
