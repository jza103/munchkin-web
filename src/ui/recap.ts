// End-of-game recap without Claude: pick the 3-4 moments that decided the game from the event log.
import type { GameEvent, GameState } from '../engine/types';

export interface Moment {
  turn: number;
  text: string;
  lesson: string;
  score: number;
}

const DENIALS = /Friendship Potion|Pollymorph|Out to Lunch|Transferral Potion|Backstabs|Magic Lamp|Charm/;

export function recap(s: GameState): Moment[] {
  if (s.phase !== 'gameOver') return [];
  const events = s.events;
  const winners = new Set(s.winners);
  const out: Moment[] = [];
  let lastFightWasWin = false;
  for (let i = 0; i < events.length; i++) {
    const e: GameEvent = events[i];
    const d = e.data as { from?: number; to?: number } | undefined;
    if (e.type === 'level' && d?.from !== undefined && d.to !== undefined) {
      const delta = d.to - d.from;
      if (delta <= -2)
        out.push({
          turn: e.turn,
          text: e.text,
          lesson: `${e.player} dropped ${-delta} levels at once: big Bad Stuff is worth a Wishing Ring, an escape card or a helper.`,
          score: -delta * 2 + (winners.has(e.player!) ? 0 : 1),
        });
      if (delta >= 2 && !/sells/.test(events[i - 1]?.text ?? ''))
        out.push({
          turn: e.turn,
          text: e.text,
          lesson: `${e.player} jumped ${delta} levels: 2-level monsters and Mates swing games.`,
          score: delta * 2 + (winners.has(e.player!) ? 2 : 0),
        });
    }
    if (e.type === 'death')
      if (/is DEAD/.test(e.text))
        out.push({ turn: e.turn, text: e.text, lesson: 'A death costs your whole hand and table. Run from deadly monsters you cannot beat.', score: 6 });
    if (e.type === 'play' && DENIALS.test(e.text))
      out.push({ turn: e.turn, text: e.text, lesson: 'A cheap denial at the right moment can stop a rival’s big fight.', score: 3 + (lastFightWasWin ? 2 : 0) });
    if (e.type === 'play' && /Curse!/.test(e.text) && /on /.test(e.text))
      out.push({ turn: e.turn, text: e.text, lesson: 'Curses hit hardest on the leader, at the worst moment for them.', score: 2 });
    if (e.type === 'combat') lastFightWasWin = /ready to finish/.test(e.text);
  }
  const final = [...events].reverse().find((e) => e.type === 'win');
  const top = out
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .sort((a, b) => a.turn - b.turn);
  if (final)
    top.push({ turn: final.turn, text: final.text, lesson: 'Level 10 only comes from killing a monster: save your bonuses for that last fight.', score: 99 });
  return top;
}
