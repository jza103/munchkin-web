// Core engine types. Everything here is plain JSON so state can be saved and replayed.

export type Deck = 'door' | 'treasure';
export type Gender = 'male' | 'female';
export type Race = 'elf' | 'dwarf' | 'halfling' | 'human';
export type ClassName = 'cleric' | 'warrior' | 'wizard' | 'thief';
export type Slot = 'head' | 'armor' | 'foot' | 'hands' | 'none';

/** A condition on a combatant, e.g. {race:'elf'} or {race:['dwarf','halfling']}. */
export interface Cond {
  race?: Race | Race[];
  notRace?: Race;
  class?: ClassName | ClassName[];
  gender?: Gender;
}

export type Op =
  | { op: 'none' }
  | { op: 'bonus' }
  | { op: 'loseLevels'; n: number | 'roll' }
  | { op: 'gainLevels'; n: number }
  | { op: 'goUpLevel'; notIfLeader?: boolean }
  | { op: 'setLevel'; to: number | 'lowest' }
  | { op: 'loseSlot'; slot: Slot; orElse?: Op[] }
  | { op: 'loseBelowWaist' }
  | { op: 'loseRace'; orElse?: Op[] }
  | { op: 'loseClass'; which?: ClassName; orElse?: Op[] }
  | { op: 'changeRace' }
  | { op: 'changeClass' }
  | { op: 'loseBigItems' }
  | { op: 'discardHand' }
  | { op: 'die' }
  | { op: 'loseAllItems' }
  | { op: 'othersTakeItem'; who: 'each' | 'higherLevel' | 'leftRight' }
  | { op: 'rollThen'; table: { min: number; max: number; then: Op[] }[] }
  | { op: 'loseItems'; n: number | 'roll' }
  | { op: 'loseGold'; amount: number }
  | { op: 'giveCards'; n: number }
  | { op: 'choice'; options: { label: string; then: Op[] }[] }
  | { op: 'if'; cond: Cond; then: Op[]; else: Op[] }
  | { op: 'loseItem'; size: 'big' | 'small' }
  | { op: 'loseBestItem' }
  | { op: 'discardItem' }
  | { op: 'custom'; handler: string };

interface CardBase {
  id: string;
  name: string;
  deck: Deck;
  copies: number;
  text: string;
}

export interface MonsterRules {
  cantRun?: boolean;
  noHelp?: boolean;
  levelOnly?: boolean;
  fireImmune?: boolean;
  fireBonusLevels?: number;
  autoEscape?: boolean;
  elfBonusTreasures?: number;
  onEscape?: Op[];
  onEnter?: Op[];
  avoid?: { if: Cond; optional: boolean; treasures: number };
}

export interface MonsterCard extends CardBase {
  kind: 'monster';
  level: number;
  treasures: number;
  levelsGained: number;
  undead: boolean;
  bonusVs: { if: Cond; bonus: number }[];
  runMod: number;
  noPursueAtOrBelow: number | null;
  noPursueExcept?: Cond;
  badStuff: Op[];
  rules: MonsterRules;
}

export interface EnhancerCard extends CardBase {
  kind: 'enhancer';
  monsterBonus: number;
  treasureDelta: number;
}

export interface CurseCard extends CardBase {
  kind: 'curse';
  persistent: boolean;
  duration?: 'untilRemoved' | 'nextCombat';
  effect: Op;
  rules?: { dieRollMod?: number; levelOnly?: boolean };
}

export interface RaceCard extends CardBase {
  kind: 'race';
  race: Race;
  powers: Powers;
}
export interface ClassCard extends CardBase {
  kind: 'class';
  class: ClassName;
  powers: Powers;
}

export interface Powers {
  runBonus?: number;
  onHelpKill?: { levels: number };
  bigItemsUnlimited?: boolean;
  handLimit?: number;
  sellDouble?: boolean;
  rerollFailedRun?: { cost: number; perCombat: number };
  resurrection?: boolean;
  turning?: { perDiscard: number; max: number; vs: 'undead' };
  berserking?: { perDiscard: number; max: number };
  winTies?: boolean;
  flight?: { perDiscard: number; max: number };
  charm?: { minHand: number };
  backstab?: { cost: number; penalty: number };
  theft?: { cost: number; need: number };
}

export type Usable =
  | 'combat'
  | 'anytime'
  | 'ownTurn'
  | 'ownCombat'
  | 'ownTurnCombat'
  | 'afterEscape'
  | 'afterFailedRun'
  | 'afterRoll';

export interface ItemCard extends CardBase {
  kind: 'item';
  slot: Slot;
  hands: number;
  big: boolean;
  bonus: number;
  gold: number;
  requires: Cond | null;
  forbids: Cond | null;
  fire: boolean;
  runBonus?: number;
  bonusIf?: { if: Cond; bonus: number };
  ability?: 'kneepads' | 'ratOnAStick' | 'sandals' | 'tuba';
  belowWaist?: boolean;
}

export interface OneShotCard extends CardBase {
  kind: 'oneShot';
  bonus: number;
  side: 'either' | 'own' | null;
  usable: Usable;
  fire: boolean;
  gold: number;
  effect: Op;
}

export interface OtherCard extends CardBase {
  kind: 'other';
  usable: Usable;
  gold?: number;
  effect: Op;
}

export type Card = MonsterCard | EnhancerCard | CurseCard | RaceCard | ClassCard | ItemCard | OneShotCard | OtherCard;
export type Kind = Card['kind'];

/** Card instance id, e.g. "enraged#2". */
export type CardId = string;
export type PlayerId = string;

export interface PlayerState {
  id: PlayerId;
  name: string;
  gender: Gender;
  bot: boolean;
  level: number;
  dead: boolean;
  /** race/class/Half-Breed/Super Munchkin/Cheat! cards and equipped items */
  equipped: CardId[];
  carried: CardId[];
  curses: CardId[];
  hand: CardId[];
  /** item that Cheat! is attached to */
  cheat: { card: CardId; item: CardId } | null;
}

export interface CombatMonster {
  card: CardId;
  enhancers: CardId[];
  mate: CardId | null;
}

export interface CombatBonus {
  card: CardId;
  by: PlayerId;
  side: 'player' | 'monster';
  value: number;
  fire: boolean;
}

export interface Combat {
  fighter: PlayerId;
  helper: PlayerId | null;
  /** treasures promised to the helper */
  deal: number;
  monsters: CombatMonster[];
  bonuses: CombatBonus[];
  /** cards discarded for class powers, by player */
  berserk: Record<PlayerId, number>;
  turning: Record<PlayerId, number>;
  flight: Record<PlayerId, number>;
  backstabs: { thief: PlayerId; victim: PlayerId }[];
  yuppie: number;
  doppleganger: boolean;
  borrowed: { card: CardId; owner: PlayerId; zone: 'equipped' | 'carried' } | null;
  /** players who declined to help */
  declined: PlayerId[];
  halflingRerolls: Record<PlayerId, number>;
  /** runners who auto-escape every monster (Instant Wall) */
  autoEscape: PlayerId[];
  /** set when the fighter has committed to running */
  running: boolean;
  /** fighter has asked to resolve; others are being given a chance to respond */
  resolving: boolean;
  /** Malign Mirror curses in force for this combat */
  mirrored: PlayerId[];
}

/** A queued step. Tasks run until one needs a decision (pending). */
export type Task =
  | { t: 'ops'; victim: PlayerId; ops: Op[]; source: CardId; roll?: number }
  | { t: 'curse'; card: CardId; target: PlayerId; fromDoor: boolean; by: PlayerId | null }
  | { t: 'run'; runner: PlayerId; monster: number; copy: number }
  | { t: 'endCombat'; won: boolean }
  | { t: 'winCombat' }
  | { t: 'enter'; card: CardId }
  | { t: 'giveTo'; from: PlayerId; card: CardId }
  | { t: 'checkBig'; player: PlayerId }
  | { t: 'takeItem'; taker: PlayerId; victim: PlayerId; source: CardId }
  | { t: 'incomeTaxOther'; player: PlayerId; value: number }
  | { t: 'loot'; dead: PlayerId; looters: PlayerId[] }
  | { t: 'finishDeath'; player: PlayerId }
  | { t: 'drawTreasure'; player: PlayerId; n: number; faceUp: boolean; split?: { helper: PlayerId; deal: number } }
  | { t: 'splitTreasure'; fighter: PlayerId; helper: PlayerId; deal: number; cards: CardId[] }
  | { t: 'theftResult'; thief: PlayerId; victim: PlayerId; item: CardId; roll: number };

export type RollPurpose =
  | { kind: 'run'; runner: PlayerId; monster: number; copy: number }
  | { kind: 'ops'; victim: PlayerId; ops: Op[]; source: CardId }
  | { kind: 'theft'; thief: PlayerId; victim: PlayerId; item: CardId }
  | { kind: 'free'; player: PlayerId };

export type Pending =
  /** others may respond to a fighter who wants to resolve a winning combat */
  | { type: 'combatWindow'; queue: PlayerId[] }
  /** a curse is about to take effect; holders of Wishing Ring may cancel it */
  | { type: 'curseWindow'; queue: PlayerId[]; task: Extract<Task, { t: 'curse' }> }
  /** a die has been rolled; Loaded Die / Flask of Glue / Invisibility / Halfling reroll */
  | { type: 'rollWindow'; queue: PlayerId[]; roller: PlayerId; natural: number; purpose: RollPurpose }
  | { type: 'helpRequest'; player: PlayerId; fighter: PlayerId; offer: number; forced: boolean }
  | { type: 'trade'; player: PlayerId; from: PlayerId; give: CardId[]; get: CardId[] }
  /** a player must choose cards from `options` (min..max) */
  | {
      type: 'chooseCards';
      player: PlayerId;
      reason: ChooseReason;
      options: CardId[];
      min: number;
      max: number;
      /** for gold-based choices, the minimum total value to reach (or all options) */
      minGold?: number;
      ctx: ChooseCtx;
      prompt: string;
    }
  /** a player must pick one of several labelled options */
  | { type: 'chooseOption'; player: PlayerId; prompt: string; options: string[]; ctx: OptionCtx }
  /** a Cleric drawing face-up may take the top discard instead (Resurrection) */
  | { type: 'resurrect'; player: PlayerId; deck: Deck; remaining: number; drawn: CardId[]; ctx: ResurrectCtx }
  /** before rolling to run, a runner holding Rat on a Stick may use it */
  | { type: 'preRun'; player: PlayerId; monster: number; copy: number }
  | { type: 'charity'; player: PlayerId; excess: number };

export type ChooseReason =
  | 'discardItem'
  | 'loseItem'
  | 'loseItems'
  | 'loseGold'
  | 'giveCards'
  | 'takeItem'
  | 'loot'
  | 'incomeTax'
  | 'incomeTaxPay'
  | 'keepBig'
  | 'loseBest'
  | 'splitTreasure'
  | 'loseRaceWhich'
  | 'loseClassWhich';

export type ChooseCtx = Record<string, unknown> & { victim?: PlayerId; source?: CardId };
export type OptionCtx =
  | { kind: 'opsChoice'; victim: PlayerId; source: CardId; options: Op[][] }
  | { kind: 'giveTo'; from: PlayerId; card: CardId; recipients: PlayerId[] };
export type ResurrectCtx =
  | { kind: 'kick' }
  | { kind: 'reward'; split: { helper: PlayerId; deal: number } | null };

export type Phase = 'setup' | 'afterDoor' | 'combat' | 'charity' | 'gameOver';

export interface GameEvent {
  seq: number;
  turn: number;
  type: string;
  player?: PlayerId;
  text: string;
  data?: Record<string, unknown>;
}

export interface GameState {
  version: 1;
  seed: number;
  rngState: number;
  human: PlayerId;
  order: PlayerId[];
  players: Record<PlayerId, PlayerState>;
  deck_door: CardId[];
  deck_treasure: CardId[];
  discard_door: CardId[];
  discard_treasure: CardId[];
  /** cards currently on the table in a combat or resolving */
  play: CardId[];
  turn: PlayerId;
  turnNumber: number;
  phase: Phase;
  combat: Combat | null;
  pending: Pending | null;
  queue: Task[];
  /** per-turn flags */
  flags: { kicked: boolean; halflingDoubleUsed: boolean; acted: boolean };
  winners: PlayerId[];
  log: string[];
  events: GameEvent[];
  eventSeq: number;
  lastRoll: number | null;
}

export type Target = {
  player?: PlayerId;
  monster?: number;
  side?: 'player' | 'monster';
  card?: CardId;
  value?: number;
};

export type Action =
  // ---- skill parity (GM/debug) commands; they bypass turn rules ----
  | { type: 'draw'; deck: Deck; n: number; dest: string }
  | { type: 'move'; card: CardId; from: string; to: string }
  | { type: 'level'; player: PlayerId; change: string }
  | { type: 'die'; player: PlayerId }
  | { type: 'revive'; player: PlayerId }
  | { type: 'roll'; player: PlayerId; n?: number }
  | { type: 'check'; player: PlayerId }
  | { type: 'log'; text: string }
  // ---- game actions ----
  | { type: 'equip'; player: PlayerId; card: CardId; cheat?: CardId }
  | { type: 'carry'; player: PlayerId; card: CardId }
  | { type: 'playRaceClass'; player: PlayerId; card: CardId; replace?: CardId }
  | { type: 'discardRaceClass'; player: PlayerId; card: CardId }
  | { type: 'sell'; player: PlayerId; cards: CardId[]; double?: CardId }
  | { type: 'trade'; player: PlayerId; to: PlayerId; give: CardId[]; get: CardId[] }
  | { type: 'kickDoor'; player: PlayerId; resurrect?: CardId }
  | { type: 'lookForTrouble'; player: PlayerId; card: CardId }
  | { type: 'lootRoom'; player: PlayerId }
  | { type: 'askHelp'; player: PlayerId; target: PlayerId; offer: number }
  | { type: 'respondHelp'; player: PlayerId; accept: boolean }
  | { type: 'respondTrade'; player: PlayerId; accept: boolean }
  | { type: 'playCard'; player: PlayerId; card: CardId; target?: Target }
  | { type: 'power'; player: PlayerId; power: PowerName; discard: CardId[]; target?: Target }
  | { type: 'avoidMonster'; player: PlayerId; monster: number }
  | { type: 'fight'; player: PlayerId }
  | { type: 'runAway'; player: PlayerId }
  | { type: 'useRat'; player: PlayerId; use: boolean }
  | { type: 'pass'; player: PlayerId }
  | { type: 'chooseCards'; player: PlayerId; cards: CardId[] }
  | { type: 'chooseOption'; player: PlayerId; option: number }
  | { type: 'resurrect'; player: PlayerId; discard: CardId | null }
  | { type: 'charity'; player: PlayerId; cards: CardId[] }
  | { type: 'endTurn'; player: PlayerId };

export type PowerName = 'berserk' | 'turn' | 'flight' | 'charm' | 'backstab' | 'theft' | 'halflingReroll';

export type ApplyResult = { ok: true; state: GameState } | { ok: false; error: string };
