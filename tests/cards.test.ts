import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ALL_IDS, CARDS, DOOR_IDS, TREASURE_IDS, cardOf, nameOf } from '../src/engine/cards';
import type { Card, Op } from '../src/engine/types';

const skill = readFileSync(new URL('../reference/SKILL.md', import.meta.url), 'utf8');

function pyEntries(list: string) {
  const start = skill.indexOf(`${list} = [`);
  const body = skill.slice(start, skill.indexOf('\n]', start));
  return [...body.matchAll(/^ \("((?:[^"\\]|\\.)*)",(\d+),"((?:[^"\\]|\\.)*)"\),?$/gm)].map((m) => ({
    name: m[1],
    copies: Number(m[2]),
    text: m[3],
  }));
}

const REQUIRED: Record<Card['kind'], string[]> = {
  monster: ['level', 'treasures', 'levelsGained', 'undead', 'bonusVs', 'runMod', 'noPursueAtOrBelow', 'badStuff', 'rules'],
  enhancer: ['monsterBonus', 'treasureDelta'],
  curse: ['effect', 'persistent'],
  race: ['race', 'powers'],
  class: ['class', 'powers'],
  item: ['slot', 'hands', 'big', 'bonus', 'gold', 'requires', 'forbids', 'fire'],
  oneShot: ['bonus', 'usable', 'effect', 'gold', 'fire', 'side'],
  other: ['effect', 'usable'],
};

describe('cards.json', () => {
  it('matches cards.py exactly (names, copies, text, deck)', () => {
    const doors = pyEntries('DOORS');
    const treasures = pyEntries('TREASURES');
    expect(doors.length + treasures.length).toBe(CARDS.length);
    for (const [deck, list] of [['door', doors], ['treasure', treasures]] as const) {
      for (const e of list) {
        const c = CARDS.find((x) => x.name === e.name);
        expect(c, e.name).toBeDefined();
        expect(c!.copies).toBe(e.copies);
        expect(c!.text).toBe(e.text);
        expect(c!.deck).toBe(deck);
      }
    }
  });

  it('has unique ids and expands copies into instances', () => {
    expect(new Set(CARDS.map((c) => c.id)).size).toBe(CARDS.length);
    const total = CARDS.reduce((a, c) => a + c.copies, 0);
    expect(ALL_IDS.length).toBe(total);
    expect(new Set(ALL_IDS).size).toBe(total);
    expect(DOOR_IDS.every((id) => cardOf(id).deck === 'door')).toBe(true);
    expect(TREASURE_IDS.every((id) => cardOf(id).deck === 'treasure')).toBe(true);
    expect(nameOf('enraged#2')).toBe('Enraged (2)');
  });

  it('every card has the fields its kind needs', () => {
    for (const c of CARDS) {
      expect(REQUIRED[c.kind], `${c.name} kind ${c.kind}`).toBeDefined();
      for (const f of REQUIRED[c.kind]) expect(c, `${c.name}.${f}`).toHaveProperty(f);
    }
  });

  it('monster stats agree with the card text', () => {
    for (const c of CARDS) {
      if (c.kind !== 'monster') continue;
      expect(c.text).toContain(`Monster L${c.level}.`);
      expect(c.text).toMatch(new RegExp(`${c.treasures} Tr`));
      if (c.levelsGained === 2) expect(c.text).toContain('2 levels.');
      expect(c.undead).toBe(c.text.includes('Undead'));
      if (c.noPursueAtOrBelow) expect(c.text).toContain(`Won't pursue L${c.noPursueAtOrBelow} or below`);
      for (const b of c.bonusVs) expect(c.text).toContain(`+${b.bonus} vs`);
    }
  });

  it('item stats agree with the card text', () => {
    for (const c of CARDS) {
      if (c.kind !== 'item') continue;
      if (c.gold) expect(c.text.replace(',', '')).toContain(`${c.gold}g`);
      else expect(c.text).toContain('No value');
      if (c.big) expect(c.text).toContain('Big');
      if (c.hands === 2) expect(c.text).toContain('2 Hands');
      if (c.bonus) expect(c.text).toContain(`+${c.bonus}`);
    }
  });

  it('every effect op is well-formed', () => {
    const walk = (ops: Op[]) => {
      for (const o of ops) {
        expect(typeof o.op).toBe('string');
        if (o.op === 'rollThen') {
          const covered = new Set<number>();
          for (const row of o.table) {
            for (let i = row.min; i <= row.max; i++) covered.add(i);
            walk(row.then);
          }
          expect([...covered].sort()).toEqual([1, 2, 3, 4, 5, 6]);
        }
        if (o.op === 'if') (walk(o.then), walk(o.else));
        if (o.op === 'choice') o.options.forEach((x) => walk(x.then));
        if ('orElse' in o && o.orElse) walk(o.orElse);
      }
    };
    for (const c of CARDS) {
      if (c.kind === 'monster') {
        walk(c.badStuff);
        walk(c.rules.onEscape ?? []);
        walk(c.rules.onEnter ?? []);
      }
      if ('effect' in c) walk([c.effect]);
    }
  });
});
