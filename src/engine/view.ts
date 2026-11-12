// What one player is allowed to see: their own hand, plus public information.
// Other hands become "?door#n" / "?treasure#n" (hand counts by card back are public),
// and the draw piles are hidden too.
import { deckOf } from './cards';
import { cloneState } from './state';
import type { GameState, PlayerId } from './types';

export function viewFor(s: GameState, viewer: PlayerId): GameState {
  const v = cloneState(s);
  let n = 0;
  for (const id of v.order) {
    if (id === viewer) continue;
    const p = v.players[id];
    p.hand = p.hand.map((c) => `?${deckOf(c)}#${++n}`);
  }
  v.deck_door = v.deck_door.map(() => `?door#${++n}`);
  v.deck_treasure = v.deck_treasure.map(() => `?treasure#${++n}`);
  v.rngState = 0;
  return v;
}
