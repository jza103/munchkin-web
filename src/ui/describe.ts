// Human-readable labels for actions and cards.
import { cardOf, nameOf } from '../engine/cards';
import { handlerFor } from '../engine/actions';
import type { Action, CardId, GameState } from '../engine/types';

export function kindLabel(card: CardId): string {
  const c = cardOf(card);
  switch (c.kind) {
    case 'monster':
      return `Monster L${c.level}`;
    case 'enhancer':
      return 'Monster enhancer';
    case 'curse':
      return 'Curse';
    case 'race':
      return 'Race';
    case 'class':
      return 'Class';
    case 'item':
      return [c.slot === 'none' ? 'Item' : c.slot === 'hands' ? `${c.hands} Hand${c.hands > 1 ? 's' : ''}` : c.slot === 'foot' ? 'Footgear' : c.slot === 'head' ? 'Headgear' : 'Armor', c.big ? 'Big' : '', c.bonus ? `+${c.bonus}` : '']
        .filter(Boolean)
        .join(' · ');
    case 'oneShot':
      return c.bonus ? `One-shot +${c.bonus}` : 'One-shot';
    case 'other':
      return c.effect.op === 'goUpLevel' ? 'Go Up a Level' : c.deck === 'door' ? 'Door card' : 'Treasure';
  }
}

export function emoji(card: CardId): string {
  const c = cardOf(card);
  switch (c.kind) {
    case 'monster':
      return c.undead ? '💀' : c.level >= 14 ? '🐉' : '👹';
    case 'enhancer':
      return '💪';
    case 'curse':
      return '🪄';
    case 'race':
      return { elf: '🧝', dwarf: '⛏️', halfling: '🦶', human: '🧑' }[c.race];
    case 'class':
      return { cleric: '✝️', warrior: '⚔️', wizard: '🧙', thief: '🗡️' }[c.class];
    case 'item':
      return c.slot === 'head' ? '⛑️' : c.slot === 'armor' ? '🛡️' : c.slot === 'foot' ? '👢' : c.slot === 'hands' ? '🗡️' : '🎒';
    case 'oneShot':
      return '🧪';
    case 'other':
      return c.effect.op === 'goUpLevel' ? '⬆️' : '✨';
  }
}

export function describeAction(s: GameState, a: Action): string {
  switch (a.type) {
    case 'kickDoor':
      return a.resurrect ? `Resurrection: take ${s.discard_door.at(-1) ? nameOf(s.discard_door.at(-1)!) : 'top discard'} (pay ${nameOf(a.resurrect)})` : '🚪 Kick open the door';
    case 'lootRoom':
      return '🔍 Loot the room';
    case 'lookForTrouble':
      return `😈 Look for Trouble: ${nameOf(a.card)}`;
    case 'endTurn':
      return '✅ End turn';
    case 'equip':
      return a.cheat ? `Equip ${nameOf(a.card)} with Cheat!` : `Equip ${nameOf(a.card)}`;
    case 'carry':
      return s.players[a.player].equipped.includes(a.card) ? `Unequip ${nameOf(a.card)} (carry)` : `Put ${nameOf(a.card)} on the table (carried)`;
    case 'playRaceClass':
      return a.replace ? `Play ${nameOf(a.card)} (replacing ${nameOf(a.replace)})` : `Play ${nameOf(a.card)}`;
    case 'discardRaceClass':
      return `Discard ${nameOf(a.card)}`;
    case 'sell':
      return `💰 Sell ${a.cards.map(nameOf).join(', ')}`;
    case 'trade':
      return `Offer ${a.to} a trade`;
    case 'fight':
      return '⚔️ Fight!';
    case 'runAway':
      return '🏃 Run away';
    case 'avoidMonster':
      return `Let ${nameOf(s.combat!.monsters[a.monster].card)} go`;
    case 'askHelp':
      return `🙋 Ask ${a.target} for help (offer ${a.offer} Treasure)`;
    case 'respondHelp':
      return a.accept ? '🤝 Help' : '🙅 Refuse';
    case 'respondTrade':
      return a.accept ? 'Accept trade' : 'Decline trade';
    case 'pass':
      return s.pending?.type === 'combatWindow' ? '👍 Let it resolve' : '👍 Pass';
    case 'useRat':
      return a.use ? '🐀 Discard Rat on a Stick to escape' : '🎲 Roll to run';
    case 'resurrect':
      return a.discard ? `✝️ Take ${nameOf(s.discard_treasure.at(-1)!)} from the discards (pay ${nameOf(a.discard)})` : 'Draw normally';
    case 'chooseOption':
      return s.pending?.type === 'chooseOption' ? s.pending.options[a.option] : `Option ${a.option + 1}`;
    case 'chooseCards':
      return a.cards.length ? `Choose ${a.cards.map(nameOf).join(', ')}` : 'Choose none';
    case 'charity':
      return `Give away ${a.cards.map(nameOf).join(', ')}`;
    case 'power':
      return powerLabel(s, a);
    case 'playCard':
      return playLabel(s, a);
    default:
      return a.type;
  }
}

function powerLabel(s: GameState, a: Extract<Action, { type: 'power' }>): string {
  switch (a.power) {
    case 'berserk':
      return '⚔️ Berserk (+1 per card)';
    case 'turn':
      return '✝️ Turn Undead (+3 per card)';
    case 'flight':
      return '🧙 Flight (+1 to run per card)';
    case 'charm':
      return `🧙 Charm ${nameOf(s.combat!.monsters[a.target!.monster!].card)} (discard your hand)`;
    case 'backstab':
      return `🗡️ Backstab ${a.target!.player} (-2)`;
    case 'theft':
      return `🗡️ Steal ${nameOf(a.target!.card!)} from ${a.target!.player}`;
    case 'halflingReroll':
      return '🦶 Discard a card to roll again';
  }
}

function playLabel(s: GameState, a: Extract<Action, { type: 'playCard' }>): string {
  const n = nameOf(a.card);
  const h = handlerFor(a.card)?.name;
  const t = a.target ?? {};
  const mon = (i?: number) => (i !== undefined && s.combat?.monsters[i] ? nameOf(s.combat.monsters[i].card) : 'the monster');
  switch (h) {
    case 'bonus': {
      const c = cardOf(a.card) as { bonus: number; side: string };
      return c.side === 'own' ? `${n}: +${c.bonus} to your side` : `${n}: +${c.bonus} to the ${t.side === 'player' ? 'munchkins' : 'monsters'}`;
    }
    case 'enhancer':
    case 'mate':
    case 'outToLunch':
    case 'magicLamp':
    case 'pollymorph':
      return `${n} on ${mon(t.monster)}`;
    case 'curse':
      return `🪄 ${n} on ${t.player === s.human ? 'yourself' : t.player}`;
    case 'transferral':
      return `${n}: ${t.player} fights instead`;
    case 'wanderingMonster':
      return `${n}: add ${nameOf(t.card!)}`;
    case 'illusion':
      return `${n}: ${mon(t.monster)} → ${nameOf(t.card!)}`;
    case 'helpMeOutHere':
      return `${n}: borrow ${nameOf(t.card!)}`;
    case 'loadedDie':
      return `🎲 Loaded Die: make it a ${t.value}`;
    case 'wishingRing':
      return t.card ? `💍 Remove ${nameOf(t.card)} from ${t.player}` : '💍 Cancel the curse';
    case 'cheat':
      return `Cheat!: equip ${nameOf(t.card!)}`;
    default:
      return `Play ${n}`;
  }
}

export function cardsOfAction(a: Action): CardId[] {
  const out: CardId[] = [];
  if ('card' in a && typeof a.card === 'string') out.push(a.card);
  if (a.type === 'playCard' && a.target?.card) out.push(a.target.card);
  if (a.type === 'kickDoor' && a.resurrect) out.push(a.resurrect);
  if (a.type === 'resurrect' && a.discard) out.push(a.discard);
  return out;
}
