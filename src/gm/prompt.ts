// Builds the GM prompts. Claude only ever sees the human player's view: rival hands are
// reduced to Door/Treasure counts, and the draw piles are hidden. Nothing here changes state.
import skillRaw from '../../reference/SKILL.md?raw';
import { cardOf, nameOf } from '../engine/cards';
import { combatTotals, monsterStrength } from '../engine/combat';
import { classes, handLimit, races, strength } from '../engine/rules';
import { viewFor } from '../engine/view';
import type { GameEvent, GameState, PlayerId } from '../engine/types';
import { PERSONALITIES } from '../bots/personalities';

/** Pull one "## Heading" section (up to the next "## ") out of the skill. */
export function skillSection(heading: string, raw = skillRaw): string {
  const start = raw.indexOf(`## ${heading}`);
  if (start < 0) return '';
  const next = raw.indexOf('\n## ', start + 3);
  return raw.slice(start, next < 0 ? undefined : next).trim();
}

export function systemPrompt(): string {
  const sections = ['Narration style', 'Rules cheat sheet (apply carefully)', 'Playing the rivals', 'Game end']
    .map((h) => skillSection(h))
    .filter(Boolean)
    // the app has no engine commands; drop lines that tell the GM to run them
    .map((t) => t.split('\n').filter((l) => !/munchkin\.py|SendUserFile|game_state\.md/.test(l)).join('\n'));
  return [
    'You are the game master voice for a single-player Munchkin web app. A rules engine runs the game:',
    'it shuffles, rolls, enforces every rule and moves every card. You never change the game. You describe',
    'what the engine reports and you teach.',
    '',
    'Hard rules:',
    '- Narrate only what appears in the events you are given. Never invent a card, a roll, a choice or an outcome.',
    '- You see the human player\'s view only. Rival hands are counts by card back; never guess their contents.',
    '- The app already shows the rules decisions; do not ask the player questions or offer menus. Speak in',
    '  second person to the human player.',
    '- Be brief and mobile-friendly: 2 to 6 short lines, light flavour, emojis for monsters and cards.',
    '- When the events include a move the player tried that the engine rejected, open with "⚖️ Not valid:" and',
    '  explain the rule. For notable legal plays you may say "⚖️ Valid" or "⚖️ Valid but…".',
    '- Add at most one "🎓" teaching note, only when there is a real lesson (a missed line, a risk, a rule interaction).',
    '- Optionally add one short line of table talk from a rival, in character.',
    '',
    'Rivals and their personalities:',
    ...PERSONALITIES.map((p) => `- ${p.name}: ${p.blurb}`),
    '',
    'Reference from the original game-master skill (its engine commands do not apply here):',
    '',
    ...sections,
  ].join('\n');
}

/** A compact, human-view description of the table. */
export function describeTable(s: GameState): string {
  const me = s.human;
  const v = viewFor(s, me);
  const lines: string[] = [];
  lines.push(`Turn ${v.turnNumber}, ${v.turn === me ? 'your' : `${v.turn}'s`} turn, phase: ${v.phase}.`);
  for (const id of v.order) {
    const p = v.players[id];
    const rc = [...races(p), ...classes(p)].join(' ');
    const doors = p.hand.filter((c) => cardOf(c).deck === 'door').length;
    const hand =
      id === me
        ? `hand [${p.hand.length}/${handLimit(p)}]: ${p.hand.map((c) => `${nameOf(c)} (${cardOf(c).text})`).join('; ') || 'empty'}`
        : `hand: ${p.hand.length} cards (${doors} Door, ${p.hand.length - doors} Treasure)`;
    lines.push(
      `${id === me ? `${id} (you)` : id}: Level ${p.level}${p.dead ? ' DEAD' : ''}, ${rc}, strength ${strength(v, id)}; ` +
        `equipped: ${p.equipped.map(nameOf).join(', ') || '-'}; carried: ${p.carried.map(nameOf).join(', ') || '-'}; ` +
        `curses: ${p.curses.map(nameOf).join(', ') || '-'}; ${hand}`,
    );
  }
  if (v.combat) {
    const t = combatTotals(v);
    lines.push(
      `Combat: ${v.combat.fighter}${v.combat.helper ? ` + ${v.combat.helper}` : ''} (${t.player}) vs ` +
        v.combat.monsters.map((m) => `${nameOf(m.card)}${m.mate ? ' + Mate' : ''} (${monsterStrength(v, m)})`).join(', ') +
        ` (${t.monster}). Munchkins ${t.playerWins ? 'winning' : 'losing'}.`,
    );
  }
  if (v.winners.length) lines.push(`Winner: ${v.winners.join(', ')}.`);
  return lines.join('\n');
}

/** Turn player for each event, from the 'turn' markers in the event stream. */
export function eventsWithTurnPlayer(events: GameEvent[], fallback: PlayerId): { e: GameEvent; turnPlayer: PlayerId }[] {
  let current = fallback;
  return events.map((e) => {
    if (e.type === 'turn' && e.player) current = e.player;
    return { e, turnPlayer: current };
  });
}

export interface NarrationInput {
  state: GameState;
  events: GameEvent[];
  rejected: string[];
  recent: string[];
}

export function narrationPrompt({ state, events, rejected, recent }: NarrationInput): string {
  const evs = events.filter((e) => state.phase === 'gameOver' || e.type !== 'reveal');
  return [
    recent.length ? `Your last narration (for continuity, do not repeat it):\n${recent.join('\n---\n')}\n` : '',
    'New engine events since you last spoke:',
    ...evs.map((e) => `- ${e.text}`),
    ...(rejected.length ? ['', 'Moves the player tried that the engine rejected:', ...rejected.map((r) => `- ${r}`)] : []),
    '',
    'The table now (your view):',
    describeTable(state),
    '',
    state.phase === 'gameOver'
      ? 'The game is over. Announce the winner, then give the end-of-game recap: the 3 or 4 moments that decided it, each as a 🎓 lesson.'
      : 'Narrate these events as the GM.',
  ]
    .filter((l) => l !== '')
    .join('\n');
}

export function questionPrompt(state: GameState, question: string, recentEvents: GameEvent[]): string {
  return [
    'Recent engine events:',
    ...recentEvents.map((e) => `- ${e.text}`),
    '',
    'The table now (your view):',
    describeTable(state),
    '',
    `The player asks you, as GM: ${question}`,
    'Answer briefly and accurately from the rules. If it is about a move, rule on it with ⚖️ Valid / Not valid / Valid but….',
  ].join('\n');
}
