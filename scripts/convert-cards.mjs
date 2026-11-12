#!/usr/bin/env node
// One-pass conversion of Appendix A (cards.py) in reference/SKILL.md to data/cards.json.
// Names, copies and text are parsed verbatim from the skill; the structured fields
// below are the hand-written interpretation of each card's text.
// Usage: node scripts/convert-cards.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const skill = readFileSync(join(root, 'reference/SKILL.md'), 'utf8');

function parseList(name) {
  const start = skill.indexOf(`${name} = [`);
  const end = skill.indexOf('\n]', start);
  const body = skill.slice(start, end);
  const re = /^ \("((?:[^"\\]|\\.)*)",(\d+),"((?:[^"\\]|\\.)*)"\),?$/gm;
  const out = [];
  let m;
  while ((m = re.exec(body))) out.push({ name: m[1], copies: Number(m[2]), text: m[3] });
  return out;
}

export const slug = (n) =>
  n.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// ---------- effect-op helpers ----------
const L = (n) => ({ op: 'loseLevels', n });
const die = { op: 'die' };

// ---------- monsters ----------
const M = (level, treasures, opts = {}) => ({
  kind: 'monster',
  level,
  treasures,
  levelsGained: opts.levelsGained ?? 1,
  undead: opts.undead ?? false,
  bonusVs: opts.bonusVs ?? [],
  runMod: opts.runMod ?? 0,
  noPursueAtOrBelow: opts.noPursueAtOrBelow ?? null,
  ...(opts.noPursueExcept ? { noPursueExcept: opts.noPursueExcept } : {}),
  badStuff: opts.badStuff,
  rules: opts.rules ?? {},
});

const STRUCT = {
  '3,872 Orcs': M(10, 3, {
    bonusVs: [{ if: { race: 'dwarf' }, bonus: 6 }],
    badStuff: [{ op: 'rollThen', table: [
      { min: 1, max: 2, then: [die] },
      { min: 3, max: 6, then: [L('roll')] },
    ] }],
  }),
  Amazon: M(8, 2, {
    badStuff: [{ op: 'loseClass', orElse: [L(3)] }],
    rules: { avoid: { if: { gender: 'female' }, optional: false, treasures: 1 } },
  }),
  Bigfoot: M(12, 3, {
    bonusVs: [{ if: { race: ['dwarf', 'halfling'] }, bonus: 3 }],
    badStuff: [{ op: 'loseSlot', slot: 'head' }],
  }),
  Bullrog: M(18, 5, { levelsGained: 2, noPursueAtOrBelow: 4, badStuff: [die] }),
  Crabs: M(1, 1, {
    badStuff: [{ op: 'loseSlot', slot: 'armor' }, { op: 'loseBelowWaist' }],
    rules: { cantRun: true },
  }),
  'Drooling Slime': M(1, 1, {
    bonusVs: [{ if: { race: 'elf' }, bonus: 4 }],
    badStuff: [{ op: 'loseSlot', slot: 'foot', orElse: [L(1)] }],
  }),
  'Face Sucker': M(8, 2, {
    bonusVs: [{ if: { race: 'elf' }, bonus: 6 }],
    badStuff: [{ op: 'loseSlot', slot: 'head' }, L(1)],
  }),
  'Floating Nose': M(10, 3, { badStuff: [L(3)] }),
  'Flying Frogs': M(2, 1, { runMod: -1, badStuff: [L(2)] }),
  Gazebo: M(8, 2, { badStuff: [L(3)], rules: { noHelp: true } }),
  'Gelatinous Octahedron': M(2, 1, { runMod: 1, badStuff: [{ op: 'loseBigItems' }] }),
  Ghoulfiends: M(8, 2, {
    undead: true,
    badStuff: [{ op: 'setLevel', to: 'lowest' }],
    rules: { levelOnly: true },
  }),
  Harpies: M(4, 2, { bonusVs: [{ if: { class: 'wizard' }, bonus: 5 }], badStuff: [L(2)] }),
  Hippogriff: M(16, 4, {
    levelsGained: 2,
    noPursueAtOrBelow: 3,
    badStuff: [{ op: 'othersTakeItem', who: 'each' }],
  }),
  'Insurance Salesman': M(14, 4, {
    badStuff: [{ op: 'loseGold', amount: 1000 }],
    rules: { fireImmune: true },
  }),
  'King Tut': M(16, 4, {
    levelsGained: 2,
    undead: true,
    noPursueAtOrBelow: 3,
    badStuff: [{ op: 'loseAllItems' }, { op: 'discardHand' }],
  }),
  'Lame Goblin': M(1, 1, { runMod: 1, badStuff: [L(1)] }),
  'Large Angry Chicken': M(2, 1, { badStuff: [L(1)], rules: { fireBonusLevels: 1 } }),
  Lawyers: M(6, 2, {
    badStuff: [{ op: 'if', cond: { class: 'thief' }, then: [], else: [{ op: 'giveCards', n: 2 }] }],
    rules: { avoid: { if: { class: 'thief' }, optional: true, treasures: 0 } },
  }),
  Leperchaun: M(4, 2, {
    bonusVs: [{ if: { race: 'elf' }, bonus: 5 }],
    badStuff: [{ op: 'othersTakeItem', who: 'leftRight' }],
  }),
  'Maul Rat': M(1, 1, { bonusVs: [{ if: { class: 'cleric' }, bonus: 3 }], badStuff: [L(1)] }),
  'Mr. Bones': M(2, 1, { undead: true, badStuff: [L(2)], rules: { onEscape: [L(1)] } }),
  'Net Troll': M(10, 3, { badStuff: [{ op: 'othersTakeItem', who: 'higherLevel' }] }),
  'Pit Bull': M(2, 1, { badStuff: [L(1)] }),
  Platycore: M(6, 2, {
    bonusVs: [{ if: { class: 'wizard' }, bonus: 6 }],
    badStuff: [{ op: 'choice', options: [
      { label: 'Discard your whole hand', then: [{ op: 'discardHand' }] },
      { label: 'Lose 2 levels', then: [L(2)] },
    ] }],
  }),
  'Plutonium Dragon': M(20, 5, { levelsGained: 2, noPursueAtOrBelow: 5, badStuff: [die] }),
  'Potted Plant': M(1, 1, { badStuff: [], rules: { autoEscape: true, elfBonusTreasures: 1 } }),
  Pukachu: M(6, 2, { badStuff: [L(1)], rules: { onEscape: [{ op: 'gainLevels', n: 1 }] } }),
  'Shrieking Geek': M(6, 2, {
    bonusVs: [{ if: { class: 'warrior' }, bonus: 6 }],
    badStuff: [{ op: 'loseRace' }, { op: 'loseClass' }],
  }),
  'Snails on Speed': M(4, 2, {
    runMod: -2,
    badStuff: [{ op: 'rollThen', table: [{ min: 1, max: 6, then: [{ op: 'loseItems', n: 'roll' }] }] }],
  }),
  Squidzilla: M(18, 4, {
    levelsGained: 2,
    bonusVs: [{ if: { race: 'elf' }, bonus: 4 }],
    noPursueAtOrBelow: 4,
    noPursueExcept: { race: 'elf' },
    badStuff: [die],
  }),
  'Stoned Golem': M(14, 4, {
    badStuff: [die],
    rules: { avoid: { if: { notRace: 'halfling' }, optional: true, treasures: 0 } },
  }),
  'Tongue Demon': M(12, 3, {
    bonusVs: [{ if: { class: 'cleric' }, bonus: 4 }],
    badStuff: [{ op: 'if', cond: { race: 'elf' }, then: [L(3)], else: [L(2)] }],
    rules: { onEnter: [{ op: 'discardItem' }] },
  }),
  'Undead Horse': M(4, 2, { undead: true, bonusVs: [{ if: { race: 'dwarf' }, bonus: 5 }], badStuff: [L(2)] }),
  'Unspeakably Awful Indescribable Horror': M(14, 4, {
    bonusVs: [{ if: { class: 'warrior' }, bonus: 4 }],
    badStuff: [{ op: 'if', cond: { class: 'wizard' }, then: [{ op: 'loseClass', which: 'wizard' }], else: [die] }],
  }),
  'Wannabe Vampire': M(12, 4, {
    badStuff: [L(3)],
    rules: { avoid: { if: { class: 'cleric' }, optional: true, treasures: 1 } },
  }),
  'Wight Brothers': M(16, 4, {
    levelsGained: 2,
    undead: true,
    noPursueAtOrBelow: 3,
    badStuff: [{ op: 'setLevel', to: 1 }],
  }),

  // ---------- enhancers ----------
  Ancient: { kind: 'enhancer', monsterBonus: 10, treasureDelta: 2 },
  Baby: { kind: 'enhancer', monsterBonus: -5, treasureDelta: -1 },
  Enraged: { kind: 'enhancer', monsterBonus: 5, treasureDelta: 1 },
  Humongous: { kind: 'enhancer', monsterBonus: 10, treasureDelta: 2 },
  Intelligent: { kind: 'enhancer', monsterBonus: 5, treasureDelta: 1 },

  // ---------- curses ----------
  'Curse! Change Class': { kind: 'curse', persistent: false, effect: { op: 'changeClass' } },
  'Curse! Change Race': { kind: 'curse', persistent: false, effect: { op: 'changeRace' } },
  'Curse! Chicken on Your Head': {
    kind: 'curse', persistent: true, duration: 'untilRemoved', effect: { op: 'none' }, rules: { dieRollMod: -1 },
  },
  'Curse! Duck of Doom': { kind: 'curse', persistent: false, effect: L(2) },
  'Curse! Income Tax': { kind: 'curse', persistent: false, effect: { op: 'custom', handler: 'incomeTax' } },
  'Curse! Lose 1 Big Item': { kind: 'curse', persistent: false, effect: { op: 'loseItem', size: 'big' } },
  'Curse! Lose 1 Small Item': { kind: 'curse', persistent: false, effect: { op: 'loseItem', size: 'small' } },
  'Curse! Lose a Level': { kind: 'curse', persistent: false, effect: L(1) },
  'Curse! Lose Your Armor': { kind: 'curse', persistent: false, effect: { op: 'loseSlot', slot: 'armor' } },
  'Curse! Lose Your Class': { kind: 'curse', persistent: false, effect: { op: 'loseClass' } },
  'Curse! Lose Your Footgear': { kind: 'curse', persistent: false, effect: { op: 'loseSlot', slot: 'foot' } },
  'Curse! Lose Your Headgear': { kind: 'curse', persistent: false, effect: { op: 'loseSlot', slot: 'head' } },
  'Curse! Lose Your Race': { kind: 'curse', persistent: false, effect: { op: 'loseRace' } },
  'Curse! Malign Mirror': {
    kind: 'curse', persistent: true, duration: 'nextCombat', effect: { op: 'none' }, rules: { levelOnly: true },
  },
  'Curse! Truly Obnoxious Curse': { kind: 'curse', persistent: false, effect: { op: 'loseBestItem' } },

  // ---------- races / classes ----------
  Elf: { kind: 'race', race: 'elf', powers: { runBonus: 1, onHelpKill: { levels: 1 } } },
  Dwarf: { kind: 'race', race: 'dwarf', powers: { bigItemsUnlimited: true, handLimit: 6 } },
  Halfling: { kind: 'race', race: 'halfling', powers: { sellDouble: true, rerollFailedRun: { cost: 1, perCombat: 1 } } },
  Cleric: {
    kind: 'class', class: 'cleric',
    powers: { resurrection: true, turning: { perDiscard: 3, max: 3, vs: 'undead' } },
  },
  Warrior: { kind: 'class', class: 'warrior', powers: { berserking: { perDiscard: 1, max: 3 }, winTies: true } },
  Wizard: { kind: 'class', class: 'wizard', powers: { flight: { perDiscard: 1, max: 3 }, charm: { minHand: 3 } } },
  Thief: {
    kind: 'class', class: 'thief',
    powers: { backstab: { cost: 1, penalty: 2 }, theft: { cost: 1, need: 4 } },
  },

  // ---------- other door cards ----------
  'Half-Breed': { kind: 'other', usable: 'ownTurn', effect: { op: 'custom', handler: 'halfBreed' } },
  'Super Munchkin': { kind: 'other', usable: 'ownTurn', effect: { op: 'custom', handler: 'superMunchkin' } },
  'Wandering Monster': { kind: 'other', usable: 'combat', effect: { op: 'custom', handler: 'wanderingMonster' } },
  'Cheat!': { kind: 'other', usable: 'ownTurn', effect: { op: 'custom', handler: 'cheat' } },
  'Divine Intervention': { kind: 'other', usable: 'anytime', effect: { op: 'custom', handler: 'divineIntervention' } },
  'Help Me Out Here!': { kind: 'other', usable: 'ownCombat', effect: { op: 'custom', handler: 'helpMeOutHere' } },
  Illusion: { kind: 'other', usable: 'combat', effect: { op: 'custom', handler: 'illusion' } },
  Mate: { kind: 'other', usable: 'combat', effect: { op: 'custom', handler: 'mate' } },
  'Out to Lunch': { kind: 'other', usable: 'combat', effect: { op: 'custom', handler: 'outToLunch' } },
};

// ---------- treasures ----------
const I = (slot, hands, bonus, gold, opts = {}) => ({
  kind: 'item',
  slot,
  hands,
  big: opts.big ?? false,
  bonus,
  gold,
  requires: opts.requires ?? null,
  forbids: opts.forbids ?? null,
  fire: opts.fire ?? false,
  ...(opts.runBonus ? { runBonus: opts.runBonus } : {}),
  ...(opts.bonusIf ? { bonusIf: opts.bonusIf } : {}),
  ...(opts.ability ? { ability: opts.ability } : {}),
  ...(opts.belowWaist ? { belowWaist: true } : {}),
});
const O = (bonus, gold, opts = {}) => ({
  kind: 'oneShot',
  bonus,
  side: opts.side ?? (bonus ? 'either' : null),
  usable: opts.usable ?? 'combat',
  fire: opts.fire ?? false,
  gold,
  effect: opts.effect ?? (bonus ? { op: 'bonus' } : { op: 'none' }),
});
const custom = (handler) => ({ op: 'custom', handler });
const GUAL = (extra = {}) => ({ kind: 'other', usable: 'anytime', gold: 0, effect: { op: 'goUpLevel', ...extra } });

Object.assign(STRUCT, {
  'Bad-Ass Bandana': I('head', 0, 3, 400, { requires: { race: 'human' } }),
  'Boots of Butt-Kicking': I('foot', 0, 2, 400),
  'Boots of Running Really Fast': I('foot', 0, 0, 400, { runBonus: 2 }),
  'Bow with Ribbons': I('hands', 2, 4, 800, { requires: { race: 'elf' } }),
  'Broad Sword': I('hands', 1, 3, 400, { forbids: { gender: 'female' } }),
  'Buckler of Swashing': I('hands', 1, 2, 400),
  'Chainsaw of Bloody Dismemberment': I('hands', 2, 3, 600, { big: true }),
  'Cheese Grater of Peace': I('hands', 1, 3, 400, { requires: { class: 'cleric' } }),
  'Cloak of Obscurity': I('none', 0, 4, 600, { requires: { class: 'thief' } }),
  'Dagger of Treachery': I('hands', 1, 3, 400, { requires: { class: 'thief' } }),
  'Eleven-Foot Pole': I('hands', 2, 1, 200),
  'Flaming Armor': I('armor', 0, 2, 400, { fire: true }),
  "Gentlemen's Club": I('hands', 1, 3, 400, { requires: { gender: 'male' } }),
  'Hammer of Kneecapping': I('hands', 1, 4, 600, { requires: { race: 'dwarf' } }),
  'Helm of Courage': I('head', 0, 1, 200),
  'Horny Helmet': I('head', 0, 1, 600, { bonusIf: { if: { race: 'elf' }, bonus: 3 } }),
  'Huge Rock': I('hands', 2, 3, 0, { big: true }),
  'Kneepads of Allure': I('none', 0, 0, 600, { forbids: { class: 'cleric' }, ability: 'kneepads', belowWaist: true }),
  'Leather Armor': I('armor', 0, 1, 200),
  'Limburger and Anchovy Sandwich': I('none', 0, 3, 400, { requires: { race: 'halfling' } }),
  'Mace of Sharpness': I('hands', 1, 4, 600, { requires: { class: 'cleric' } }),
  'Mithril Armor': I('armor', 0, 3, 600, { big: true, forbids: { class: 'wizard' } }),
  'Pantyhose of Giant Strength': I('none', 0, 3, 600, { forbids: { class: 'warrior' }, belowWaist: true }),
  'Pointy Hat of Power': I('head', 0, 3, 400, { requires: { class: 'wizard' } }),
  'Rapier of Unfairness': I('hands', 1, 3, 600, { requires: { race: 'elf' } }),
  'Rat on a Stick': I('hands', 1, 1, 0, { ability: 'ratOnAStick' }),
  'Really Impressive Title': I('none', 0, 3, 0),
  'Sandals of Protection': I('foot', 0, 0, 700, { ability: 'sandals' }),
  'Shield of Ubiquity': I('hands', 1, 4, 600, { big: true, requires: { class: 'warrior' } }),
  'Short Wide Armor': I('armor', 0, 3, 400, { requires: { race: 'dwarf' } }),
  'Singing & Dancing Sword': I('none', 0, 2, 400, { forbids: { class: 'thief' } }),
  'Slimy Armor': I('armor', 0, 1, 200),
  'Sneaky Bastard Sword': I('hands', 1, 2, 400),
  'Spiky Knees': I('none', 0, 1, 200, { belowWaist: true }),
  'Staff of Napalm': I('hands', 1, 5, 800, { requires: { class: 'wizard' }, fire: true }),
  Stepladder: I('none', 0, 3, 400, { big: true, requires: { race: 'halfling' } }),
  'Swiss Army Polearm': I('hands', 2, 4, 600, { big: true, requires: { race: 'human' } }),
  'Tuba of Charm': I('hands', 1, 0, 300, { big: true, ability: 'tuba' }),

  'Cotion of Ponfusion': O(3, 100),
  Doppleganger: O(0, 300, { usable: 'ownCombat', effect: custom('doppleganger') }),
  'Electric Radioactive Acid Potion': O(5, 200),
  'Flask of Glue': O(0, 100, { usable: 'afterEscape', effect: custom('flaskOfGlue') }),
  'Flaming Poison Potion': O(3, 100, { fire: true }),
  'Freezing Explosive Potion': O(3, 100),
  'Friendship Potion': O(0, 200, { effect: custom('friendshipPotion') }),
  'Instant Wall': O(0, 300, { effect: custom('instantWall') }),
  'Invisibility Potion': O(0, 200, { usable: 'afterFailedRun', effect: custom('invisibility') }),
  'Loaded Die': O(0, 300, { usable: 'afterRoll', effect: custom('loadedDie') }),
  'Magic Lamp': O(0, 500, { usable: 'ownTurnCombat', effect: custom('magicLamp') }),
  'Magic Missile': O(5, 300),
  'Nasty-Tasting Sports Drink': O(2, 200),
  'Pollymorph Potion': O(0, 1300, { effect: custom('pollymorph') }),
  'Potion of Halitosis': O(2, 100),
  'Potion of Idiotic Bravery': O(2, 100),
  'Pretty Balloons': O(5, 0, { side: 'own' }),
  'Sleep Potion': O(2, 100),
  'Transferral Potion': O(0, 300, { effect: custom('transferral') }),
  'Wishing Ring': O(0, 500, { usable: 'anytime', effect: custom('wishingRing') }),
  'Yuppie Water': O(0, 100, { effect: custom('yuppieWater') }),

  'Hoard!': { kind: 'other', usable: 'anytime', gold: 0, effect: custom('hoard') },
  '1,000 Gold Pieces': GUAL(),
  'Boil an Anthill': GUAL(),
  'Bribe GM With Food': GUAL(),
  'Convenient Addition Error': GUAL(),
  'Invoke Obscure Rules': GUAL(),
  'Mutilate the Bodies': GUAL(),
  'Potion of General Studliness': GUAL(),
  'Whine at the GM': GUAL({ notIfLeader: true }),
});

const cards = [];
for (const [deck, list] of [['door', parseList('DOORS')], ['treasure', parseList('TREASURES')]]) {
  for (const c of list) {
    const s = STRUCT[c.name];
    if (!s) throw new Error(`No structured data for ${c.name}`);
    const { kind, ...fields } = s;
    cards.push({ id: slug(c.name), name: c.name, deck, kind, copies: c.copies, text: c.text, ...fields });
  }
}
const unused = Object.keys(STRUCT).filter((n) => !cards.some((c) => c.name === n));
if (unused.length) throw new Error(`Unused structured entries: ${unused.join(', ')}`);

writeFileSync(join(root, 'data/cards.json'), JSON.stringify(cards, null, 1) + '\n');
console.log(`Wrote ${cards.length} cards (${cards.reduce((a, c) => a + c.copies, 0)} instances).`);
