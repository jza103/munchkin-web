// Rival personalities are parameters, not code.
import type { ClassName, Gender, Race } from '../engine/types';

export interface Personality {
  name: string;
  gender: Gender;
  /** how readily they interfere in others' fights (0..1) */
  aggression: number;
  /** how much treasure they demand / keep (0..1) */
  greed: number;
  /** how hard they go after the leader with curses and denials (0..1) */
  spite: number;
  prefers: { race?: Race; class?: ClassName };
  blurb: string;
}

export const PERSONALITIES: Personality[] = [
  {
    name: 'Alex',
    gender: 'male',
    aggression: 0.6,
    greed: 0.7,
    spite: 0.6,
    prefers: { race: 'dwarf', class: 'thief' },
    blurb: 'A scheming Dwarf who hoards Big items and never forgets a slight.',
  },
  {
    name: 'Sam',
    gender: 'female',
    aggression: 0.5,
    greed: 0.8,
    spite: 0.4,
    prefers: { race: 'halfling', class: 'wizard' },
    blurb: 'A sly Halfling who sells anything that is not nailed down.',
  },
  {
    name: 'Morgan',
    gender: 'female',
    aggression: 0.9,
    greed: 0.4,
    spite: 0.5,
    prefers: { race: 'elf', class: 'warrior' },
    blurb: 'A reckless Elf Warrior who picks fights for fun.',
  },
  {
    name: 'Riley',
    gender: 'male',
    aggression: 0.3,
    greed: 0.5,
    spite: 0.3,
    prefers: { race: 'human', class: 'cleric' },
    blurb: 'A cautious Cleric who keeps a Wishing Ring for a rainy day.',
  },
  {
    name: 'Quinn',
    gender: 'female',
    aggression: 0.7,
    greed: 0.6,
    spite: 0.9,
    prefers: { race: 'elf', class: 'wizard' },
    blurb: 'A spiteful Wizard who saves every curse for the leader.',
  },
];

export const DEFAULT_PERSONALITY: Personality = { ...PERSONALITIES[0], name: 'Bot' };

export function personalityFor(name: string, index: number): Personality {
  return PERSONALITIES.find((p) => p.name === name) ?? { ...PERSONALITIES[index % PERSONALITIES.length], name };
}
