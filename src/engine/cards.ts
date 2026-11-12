// Card registry: loads data/cards.json and expands copies into instance ids ("enraged#2").
import raw from '../../data/cards.json';
import type { Card, CardId, Deck, ItemCard, MonsterCard } from './types';

export const CARDS: Card[] = raw as unknown as Card[];
export const CARD_BY_ID: Record<string, Card> = Object.fromEntries(CARDS.map((c) => [c.id, c]));

function expand(deck: Deck): CardId[] {
  const out: CardId[] = [];
  for (const c of CARDS) if (c.deck === deck) for (let i = 1; i <= c.copies; i++) out.push(`${c.id}#${i}`);
  return out;
}

export const DOOR_IDS: CardId[] = expand('door');
export const TREASURE_IDS: CardId[] = expand('treasure');
export const ALL_IDS: CardId[] = [...DOOR_IDS, ...TREASURE_IDS];

export function baseId(card: CardId): string {
  const i = card.indexOf('#');
  return i < 0 ? card : card.slice(0, i);
}

const HIDDEN: Record<string, Card> = {
  '?door': { id: '?door', name: 'Door card', deck: 'door', kind: 'other', copies: 0, text: '(hidden)', usable: 'anytime', effect: { op: 'none' } },
  '?treasure': { id: '?treasure', name: 'Treasure card', deck: 'treasure', kind: 'other', copies: 0, text: '(hidden)', usable: 'anytime', effect: { op: 'none' } },
};

/** Hidden card ids used in player views: "?door#3", "?treasure#1". */
export function isHidden(card: CardId) {
  return card.startsWith('?');
}

export function cardOf(card: CardId): Card {
  if (card.startsWith('?')) return HIDDEN[baseId(card)];
  const c = CARD_BY_ID[baseId(card)];
  if (!c) throw new Error(`Unknown card ${card}`);
  return c;
}

export function isCard(card: string): boolean {
  return !!CARD_BY_ID[baseId(card)] && ALL_IDS.includes(card);
}

export function nameOf(card: CardId): string {
  const c = cardOf(card);
  const n = Number(card.split('#')[1] ?? 1);
  return n > 1 ? `${c.name} (${n})` : c.name;
}

export function deckOf(card: CardId): Deck {
  return cardOf(card).deck;
}

export function monsterOf(card: CardId): MonsterCard {
  const c = cardOf(card);
  if (c.kind !== 'monster') throw new Error(`${card} is not a monster`);
  return c;
}

export function itemOf(card: CardId): ItemCard | null {
  const c = cardOf(card);
  return c.kind === 'item' ? c : null;
}

/** Gold value of any treasure card (0 for "No value" and door cards). */
export function goldOf(card: CardId): number {
  const c = cardOf(card) as { gold?: number };
  return c.gold ?? 0;
}

export function isRaceClassCard(card: CardId): boolean {
  const c = cardOf(card);
  return c.kind === 'race' || c.kind === 'class' || c.id === 'half-breed' || c.id === 'super-munchkin';
}

/** Find a card instance by its display name (e.g. "Enraged (2)") or id. */
export function findCard(nameOrId: string): CardId | null {
  if (ALL_IDS.includes(nameOrId)) return nameOrId;
  for (const id of ALL_IDS) if (nameOf(id) === nameOrId) return id;
  return null;
}
