import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { apply, check } from '../engine/actions';
import { cardOf, goldOf, nameOf } from '../engine/cards';
import { combatTotals, monsterStrength, monsterTreasure } from '../engine/combat';
import { legalActions } from '../engine/legal';
import { classes, equippedItems, handLimit, hasPower, races, strength } from '../engine/rules';
import { newGame } from '../engine/state';
import type { Action, CardId, GameState, Gender, Pending, PlayerId, PowerName } from '../engine/types';
import { actor } from '../bots/bot';
import { botStep } from '../bots/driver';
import { PERSONALITIES, personalityFor } from '../bots/personalities';
import { cardsOfAction, describeAction, emoji, kindLabel } from './describe';
import { SPEED_MS, type Settings, loadGame, loadSettings, saveGame, saveSettings } from './storage';
import { type GmSettings, GmPanel, GmSettingsSheet, loadApiKey, loadGmSettings, saveApiKey, saveGmSettings, useGm } from './gm';
import { recap } from './recap';
import { play, soundFor } from './sound';
import { artStyle } from './art';

// ---------------------------------------------------------------------------
// App shell
// ---------------------------------------------------------------------------

export function App() {
  const [state, setState] = useState<GameState | null>(() => loadGame());
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [screen, setScreen] = useState<'new' | 'game'>(() => (loadGame() ? 'game' : 'new'));
  const [gmSettings, setGmSettings] = useState<GmSettings>(() => loadGmSettings());

  useEffect(() => saveSettings(settings), [settings]);
  useEffect(() => saveGmSettings(gmSettings), [gmSettings]);
  useEffect(() => saveGame(state), [state]);

  if (screen === 'new' || !state)
    return (
      <NewGame
        canContinue={!!state && state.phase !== 'gameOver'}
        onContinue={() => setScreen('game')}
        gmOn={gmSettings.enabled}
        onStart={(s, gm) => {
          setGmSettings({ ...gmSettings, enabled: gm });
          setState(s);
          setScreen('game');
        }}
      />
    );
  return (
    <Game
      state={state}
      setState={setState}
      settings={settings}
      setSettings={setSettings}
      gmSettings={gmSettings}
      setGmSettings={setGmSettings}
      onNew={() => setScreen('new')}
    />
  );
}

// ---------------------------------------------------------------------------
// New game
// ---------------------------------------------------------------------------

function NewGame(props: { canContinue: boolean; onContinue: () => void; onStart: (s: GameState, gm: boolean) => void; gmOn: boolean }) {
  const [name, setName] = useState('Jason');
  const [gender, setGender] = useState<Gender>('male');
  const [rivals, setRivals] = useState(2);
  const [gm, setGm] = useState(props.gmOn);
  const [key, setKey] = useState(loadApiKey);
  const [error, setError] = useState('');
  const start = () => {
    try {
      if (gm && key) saveApiKey(key);
      const picks = PERSONALITIES.slice(0, rivals).map((p) => ({ name: p.name === name ? `${p.name} 2` : p.name, gender: p.gender }));
      props.onStart(newGame({ seed: `${Date.now()}-${Math.random()}`, human: { name: name.trim() || 'You', gender }, rivals: picks }), gm);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <main class="newgame">
      <h1>🐉 Munchkin</h1>
      <p class="muted">You against 1 to 5 rival bots. Kick down the door, kill the monster, grab the treasure.</p>
      {props.canContinue && (
        <button class="primary wide" onClick={props.onContinue}>
          ▶️ Continue saved game
        </button>
      )}
      <section class="panel form">
        <label>
          Your name
          <input value={name} maxLength={20} onInput={(e) => setName((e.target as HTMLInputElement).value.replace(/\./g, ''))} />
        </label>
        <fieldset>
          <legend>Your character</legend>
          {(['male', 'female'] as const).map((g) => (
            <label class="chip" key={g}>
              <input type="radio" name="gender" checked={gender === g} onChange={() => setGender(g)} /> {g === 'male' ? 'Male' : 'Female'}
            </label>
          ))}
        </fieldset>
        <label>
          Rivals: <b>{rivals}</b>
          <input type="range" min={1} max={5} value={rivals} onInput={(e) => setRivals(Number((e.target as HTMLInputElement).value))} />
        </label>
        <ul class="rival-list">
          {PERSONALITIES.slice(0, rivals).map((p) => (
            <li key={p.name}>
              <b>{p.name}</b> <span class="muted">— {p.blurb}</span>
            </li>
          ))}
        </ul>
        <label class="chip">
          <input type="checkbox" checked={gm} onChange={() => setGm(!gm)} /> 🎙️ Claude GM narration <span class="muted small">(optional, needs your API key)</span>
        </label>
        {gm && (
          <label>
            Anthropic API key <span class="muted small">(stored only in this browser)</span>
            <input type="password" autocomplete="off" placeholder="sk-ant-…" value={key} onInput={(e) => setKey((e.target as HTMLInputElement).value.trim())} />
          </label>
        )}
        {error && <p class="error">{error}</p>}
        <button class="primary wide" onClick={start}>
          🚪 Start a new game
        </button>
      </section>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Game screen
// ---------------------------------------------------------------------------

type Modal =
  | { kind: 'card'; card: CardId }
  | { kind: 'help' }
  | { kind: 'sell' }
  | { kind: 'trade' }
  | { kind: 'power'; power: PowerName; target?: { player?: PlayerId; card?: CardId; monster?: number } }
  | { kind: 'gm' }
  | null;

const GLOBAL = new Set<Action['type']>(['kickDoor', 'lootRoom', 'endTurn', 'fight', 'runAway', 'pass', 'respondHelp', 'respondTrade', 'useRat', 'chooseOption', 'avoidMonster', 'resurrect']);

function Game(props: {
  state: GameState;
  setState: (s: GameState) => void;
  settings: Settings;
  setSettings: (s: Settings) => void;
  gmSettings: GmSettings;
  setGmSettings: (s: GmSettings) => void;
  onNew: () => void;
}) {
  const { state: s, setState, settings } = props;
  const gm = useGm(s, props.gmSettings);
  // sound effects for whatever just happened
  const heard = useRef(s.eventSeq);
  useEffect(() => {
    const fresh = s.events.filter((e) => e.seq > heard.current);
    heard.current = s.eventSeq;
    if (settings.sound && fresh.length) play(soundFor(fresh));
  }, [s.eventSeq]);
  const me = s.human;
  const [modal, setModal] = useState<Modal>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const legal = useMemo(() => legalActions(s, me), [s, me]);
  const who = actor(s);

  // Rival bots act step by step, at the chosen speed. The app waits whenever it's your decision.
  useEffect(() => {
    if (!who || who === me || paused) return;
    const t = setTimeout(() => {
      const r = botStep(s, (id) => personalityFor(id, s.order.indexOf(id)), (id) => id !== me);
      if (r) setState(r.state);
    }, SPEED_MS[settings.speed]);
    return () => clearTimeout(t);
  }, [s, who, me, paused, settings.speed]);

  const act = (a: Action) => {
    const r = apply(s, a);
    if (!r.ok) {
      setNotice(`⚖️ Not valid: ${r.error}`);
      gm.reportRejected(`${describeAction(s, a)} — engine says: ${r.error}`);
      return false;
    }
    setNotice(null);
    setModal(null);
    setState(r.state);
    return true;
  };

  return (
    <div class="app">
      <header class="topbar">
        <b>🐉 Munchkin</b>
        <span class="muted">Turn {s.turnNumber}</span>
        <span class="spacer" />
        <select
          aria-label="Rival speed"
          value={settings.speed}
          onChange={(e) => props.setSettings({ ...settings, speed: (e.target as HTMLSelectElement).value as Settings['speed'] })}
        >
          <option value="slow">Slow rivals</option>
          <option value="normal">Normal</option>
          <option value="fast">Fast</option>
          <option value="instant">Instant</option>
        </select>
        <button class="ghost" onClick={() => props.setSettings({ ...settings, sound: !settings.sound })} title="Sound" aria-label="Toggle sound">
          {settings.sound ? '🔊' : '🔇'}
        </button>
        <button class="ghost" onClick={() => setModal({ kind: 'gm' })} title="Claude GM settings" aria-label="GM settings">
          🎙️
        </button>
        <button class="ghost" onClick={() => setPaused(!paused)} title="Pause rival bots">
          {paused ? '▶️' : '⏸️'}
        </button>
        <button class="ghost" onClick={props.onNew}>
          New
        </button>
      </header>

      <RivalStrip s={s} onCard={(card) => setModal({ kind: 'card', card })} />

      <div class="layout">
        <div class="col main">
          <Center s={s} who={who} onCard={(card) => setModal({ kind: 'card', card })} />
          <Prompt s={s} me={me} legal={legal} act={act} />
          {notice && <p class="notice">{notice}</p>}
          <ActionBar s={s} me={me} legal={legal} act={act} open={setModal} />
          <MyTable s={s} me={me} onCard={(card) => setModal({ kind: 'card', card })} />
          <Hand s={s} me={me} legal={legal} onCard={(card) => setModal({ kind: 'card', card })} />
        </div>
        <div class="col side">
          <GmPanel gm={gm} settings={props.gmSettings} onSettings={() => setModal({ kind: 'gm' })} />
          <Log s={s} />
        </div>
      </div>

      {modal?.kind === 'card' && <CardSheet s={s} card={modal.card} legal={legal} act={act} close={() => setModal(null)} />}
      {modal?.kind === 'help' && <HelpModal s={s} me={me} act={act} close={() => setModal(null)} />}
      {modal?.kind === 'sell' && <SellModal s={s} me={me} act={act} close={() => setModal(null)} />}
      {modal?.kind === 'trade' && <TradeModal s={s} me={me} act={act} close={() => setModal(null)} />}
      {modal?.kind === 'gm' && <GmSettingsSheet gm={gm} settings={props.gmSettings} setSettings={props.setGmSettings} close={() => setModal(null)} />}
      {modal?.kind === 'power' && <PowerModal s={s} me={me} power={modal.power} target={modal.target} act={act} close={() => setModal(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rivals at a glance
// ---------------------------------------------------------------------------

function raceClassText(s: GameState, id: PlayerId) {
  const p = s.players[id];
  const r = races(p).map((x) => x[0].toUpperCase() + x.slice(1)).join('/');
  const c = classes(p).map((x) => x[0].toUpperCase() + x.slice(1)).join('/');
  return c ? `${r} ${c}` : r;
}

function handText(s: GameState, id: PlayerId) {
  const h = s.players[id].hand;
  const d = h.filter((c) => cardOf(c).deck === 'door').length;
  return `${h.length} (${d}D ${h.length - d}T)`;
}

function RivalStrip({ s, onCard }: { s: GameState; onCard: (c: CardId) => void }) {
  return (
    <section class="rivals" aria-label="Rivals at a glance">
      {s.order
        .filter((id) => id !== s.human)
        .map((id) => {
          const p = s.players[id];
          const items = equippedItems(p);
          return (
            <article class={`rival ${s.turn === id ? 'active' : ''} ${p.dead ? 'dead' : ''}`} key={id}>
              <header>
                <b>{id}</b> {s.turn === id && <span title="Their turn">⏳</span>}
                {p.dead && <span title="Dead">💀</span>}
              </header>
              <div class="stats">
                <span title="Level">L{p.level}</span>
                <span title="Strength">💪{strength(s, id)}</span>
                <span title="Hand: Door / Treasure">🂠 {handText(s, id)}</span>
              </div>
              <div class="muted small">{raceClassText(s, id)}</div>
              {items.length > 0 && (
                <div class="gear">
                  {items.map((c) => (
                    <button class="tag" key={c} onClick={() => onCard(c)}>
                      {emoji(c)} {nameOf(c)}
                    </button>
                  ))}
                </div>
              )}
              {p.carried.length > 0 && <div class="muted small">Carried: {p.carried.map(nameOf).join(', ')}</div>}
              {p.curses.length > 0 && (
                <div class="gear">
                  {p.curses.map((c) => (
                    <button class="tag curse" key={c} onClick={() => onCard(c)}>
                      🪄 {nameOf(c).replace('Curse! ', '')}
                    </button>
                  ))}
                </div>
              )}
            </article>
          );
        })}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Center: the door / the combat
// ---------------------------------------------------------------------------

function phaseText(s: GameState): string {
  if (s.phase === 'gameOver') return `🏆 ${s.winners.join(' and ')} win${s.winners.length > 1 ? '' : 's'}!`;
  const mine = s.turn === s.human;
  switch (s.phase) {
    case 'setup':
      return mine ? 'Your turn. Set up (equip, sell, play race/class), then kick open the door.' : `${s.turn} is getting ready…`;
    case 'afterDoor':
      return mine ? 'No fight. Look for Trouble with a monster from your hand, or Loot the Room.' : `${s.turn} decides what to do next…`;
    case 'charity':
      return mine ? 'Play or equip anything else you want, then end your turn (charity: hand limit 5, Dwarves 6).' : `${s.turn} wraps up their turn…`;
    default:
      return '';
  }
}

function Center({ s, who, onCard }: { s: GameState; who: PlayerId | null; onCard: (c: CardId) => void }) {
  const c = s.combat;
  if (!c) {
    const last = [...s.events].reverse().find((e) => e.type === 'door');
    return (
      <section class="panel center">
        <p>{phaseText(s)}</p>
        {last && <p class="muted small">Last door: {last.text}</p>}
        {who && who !== s.human && s.phase !== 'gameOver' && <p class="muted small">Waiting for {who}…</p>}
      </section>
    );
  }
  const t = combatTotals(s);
  const total = c.monsters.reduce((a, m) => a + monsterTreasure(m), 0);
  return (
    <section class="panel center combat">
      <div class="sides">
        <div class="side-box">
          <div class="muted small">Munchkins</div>
          <div class="big">{t.player}</div>
          <div>
            {c.fighter}
            {c.helper && ` + ${c.helper}`}
          </div>
          {c.helper && <div class="muted small">Helper gets {c.deal} Treasure</div>}
          {c.bonuses.filter((b) => b.side === 'player').map((b) => (
            <button class="tag" key={b.card} onClick={() => onCard(b.card)}>
              +{b.value} {nameOf(b.card)}
            </button>
          ))}
          {c.backstabs.length > 0 && <div class="small">🗡️ Backstabbed ×{c.backstabs.length}</div>}
        </div>
        <div class={`vs ${t.playerWins ? 'win' : 'lose'}`}>{t.playerWins ? 'winning' : 'losing'}</div>
        <div class="side-box">
          <div class="muted small">Monsters</div>
          <div class="big">{t.monster}</div>
          {c.monsters.map((m, i) => (
            <div key={m.card}>
              <button class="tag monster" onClick={() => onCard(m.card)}>
                {emoji(m.card)} {nameOf(m.card)} {m.mate ? '×2' : ''} = {monsterStrength(s, m)}
              </button>
              {m.enhancers.map((e) => (
                <button class="tag" key={e} onClick={() => onCard(e)}>
                  {nameOf(e)}
                </button>
              ))}
              <span class="muted small"> #{i + 1}</span>
            </div>
          ))}
          {c.bonuses.filter((b) => b.side === 'monster').map((b) => (
            <button class="tag" key={b.card} onClick={() => onCard(b.card)}>
              +{b.value} {nameOf(b.card)}
            </button>
          ))}
          <div class="muted small">Treasure: {total}</div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Prompt: decisions that are yours right now
// ---------------------------------------------------------------------------

function pendingText(s: GameState, p: Pending): string {
  switch (p.type) {
    case 'combatWindow':
      return `${s.combat?.fighter} is about to win. Your chance to respond (play a card) or let it resolve.`;
    case 'curseWindow':
      return `${nameOf(p.task.card)} is about to hit ${p.task.target}. Cancel it with a Wishing Ring?`;
    case 'rollWindow':
      return `${p.roller} rolled a ${p.natural}. Respond?`;
    case 'helpRequest':
      return p.forced
        ? `${p.fighter} wears the Kneepads of Allure: you must help, for nothing.`
        : `${p.fighter} asks for your help, offering ${p.offer} Treasure.`;
    case 'trade':
      return `${p.from} offers ${p.give.map(nameOf).join(', ') || 'nothing'} for your ${p.get.map(nameOf).join(', ') || 'nothing'}.`;
    case 'chooseCards':
      return p.prompt;
    case 'chooseOption':
      return p.prompt;
    case 'resurrect':
      return `Resurrection: take ${nameOf(s.discard_treasure.at(-1)!)} from the Treasure discards instead of drawing (${p.remaining} left)?`;
    case 'preRun':
      return 'Discard Rat on a Stick to escape automatically?';
    case 'charity':
      return `You are over your hand limit: choose ${p.excess} card(s) for charity.`;
  }
}

function Prompt({ s, me, legal, act }: { s: GameState; me: PlayerId; legal: Action[]; act: (a: Action) => boolean }) {
  const p = s.pending;
  if (s.phase === 'gameOver')
    return (
      <section class="panel prompt gameover">
        <h2>🏆 {s.winners.join(' and ')} reach{s.winners.length > 1 ? '' : 'es'} Level 10!</h2>
        <h3>The moments that decided it</h3>
        <ol class="recap">
          {recap(s).map((m, i) => (
            <li key={i}>
              <b>Turn {m.turn}:</b> {m.text}
              <div class="small">🎓 {m.lesson}</div>
            </li>
          ))}
        </ol>
        <p class="muted small">All hands are revealed in the log.</p>
      </section>
    );
  if (!p) return null;
  const mineNow = ('queue' in p ? p.queue[0] : p.player) === me;
  if (!mineNow) return <section class="panel prompt muted">Waiting for {'queue' in p ? p.queue[0] : p.player}…</section>;
  if (p.type === 'chooseCards')
    return (
      <section class="panel prompt">
        <CardPicker
          s={s}
          title={p.prompt}
          options={p.options}
          min={p.min}
          max={p.max}
          showGold={p.minGold !== undefined}
          validate={(cards) => check(s, { type: 'chooseCards', player: me, cards })}
          confirm={(cards) => act({ type: 'chooseCards', player: me, cards })}
          confirmLabel={p.reason === 'incomeTaxPay' ? 'Pay (or choose none to lose a level)' : 'Confirm'}
        />
      </section>
    );
  if (p.type === 'charity')
    return (
      <section class="panel prompt">
        <CardPicker
          s={s}
          title={pendingText(s, p)}
          options={s.players[me].hand}
          min={p.excess}
          max={p.excess}
          validate={(cards) => check(s, { type: 'charity', player: me, cards })}
          confirm={(cards) => act({ type: 'charity', player: me, cards })}
          confirmLabel="Give away"
        />
      </section>
    );
  return (
    <section class="panel prompt">
      <p>
        <b>Your call:</b> {pendingText(s, p)}
      </p>
      {p.type === 'resurrect' && (
        <div class="buttons">
          {legal
            .filter((a) => a.type === 'resurrect')
            .map((a, i) => (
              <button key={i} onClick={() => act(a)}>
                {describeAction(s, a)}
              </button>
            ))}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Action bar: only legal actions
// ---------------------------------------------------------------------------

function ActionBar({ s, me, legal, act, open }: { s: GameState; me: PlayerId; legal: Action[]; act: (a: Action) => boolean; open: (m: Modal) => void }) {
  const global = legal.filter((a) => GLOBAL.has(a.type) && !(a.type === 'kickDoor' && a.resurrect) && a.type !== 'resurrect');
  const canAskHelp = legal.some((a) => a.type === 'askHelp');
  const canSell = s.turn === me && !s.pending && !s.combat && s.players[me].hand.concat(s.players[me].equipped, s.players[me].carried).some((c) => goldOf(c) > 0);
  const canTrade = s.turn === me && !s.pending && !s.combat && s.phase !== 'gameOver';
  const powers = new Map<string, Action>();
  for (const a of legal) {
    if (a.type !== 'power') continue;
    if (a.power === 'charm' || a.power === 'backstab' || a.power === 'theft') continue;
    powers.set(a.power, a);
  }
  const charm = legal.filter((a) => a.type === 'power' && a.power === 'charm');
  const backstab = legal.filter((a) => a.type === 'power' && a.power === 'backstab');
  const hasTheft = legal.some((a) => a.type === 'power' && a.power === 'theft');
  const sorted = [...global].sort((a, b) => order(a) - order(b));
  if (!sorted.length && !canAskHelp && !powers.size && !charm.length && !backstab.length && !canSell && !hasTheft) return null;
  return (
    <section class="actionbar">
      {sorted.map((a, i) => (
        <button key={i} class={a.type === 'fight' || a.type === 'kickDoor' || a.type === 'endTurn' ? 'primary' : ''} onClick={() => act(a)}>
          {describeAction(s, a)}
        </button>
      ))}
      {canAskHelp && <button onClick={() => open({ kind: 'help' })}>🙋 Ask for help…</button>}
      {[...powers.values()].map((a) => (
        <button key={(a as { power: string }).power} onClick={() => open({ kind: 'power', power: (a as { power: PowerName }).power })}>
          {describeAction(s, a)}
        </button>
      ))}
      {charm.map((a, i) => (
        <button key={`c${i}`} onClick={() => act({ ...(a as Extract<Action, { type: 'power' }>), discard: [...s.players[me].hand] })}>
          {describeAction(s, a)}
        </button>
      ))}
      {backstab.map((a, i) => (
        <button key={`b${i}`} onClick={() => open({ kind: 'power', power: 'backstab', target: (a as { target: { player: string } }).target })}>
          {describeAction(s, a)}
        </button>
      ))}
      {hasTheft && <button onClick={() => open({ kind: 'power', power: 'theft' })}>🗡️ Steal…</button>}
      {canSell && <button onClick={() => open({ kind: 'sell' })}>💰 Sell…</button>}
      {canTrade && <button class="ghost" onClick={() => open({ kind: 'trade' })}>🤝 Trade…</button>}
    </section>
  );
}

function order(a: Action): number {
  return ['fight', 'kickDoor', 'pass', 'respondHelp', 'useRat', 'chooseOption', 'lootRoom', 'avoidMonster', 'runAway', 'respondTrade', 'endTurn'].indexOf(a.type);
}

// ---------------------------------------------------------------------------
// Your table and hand
// ---------------------------------------------------------------------------

const SLOT_NAMES: Record<string, string> = { head: 'Headgear', armor: 'Armor', foot: 'Footgear', hands: 'Hands', none: 'Other' };

function MyTable({ s, me, onCard }: { s: GameState; me: PlayerId; onCard: (c: CardId) => void }) {
  const p = s.players[me];
  const rc = p.equipped.filter((c) => !equippedItems(p).includes(c));
  const bySlot = new Map<string, CardId[]>();
  for (const c of equippedItems(p)) {
    const it = cardOf(c) as { slot: string };
    bySlot.set(it.slot, [...(bySlot.get(it.slot) ?? []), c]);
  }
  return (
    <section class="panel mytable">
      <header>
        <b>{me}</b> <span class="muted">({p.gender})</span> — Level <b>{p.level}</b> · Strength <b>{strength(s, me)}</b> · {raceClassText(s, me)}
        {p.dead && ' · 💀 dead (you revive next turn)'}
        {hasPower(p, 'sellDouble') && s.turn === me && !s.flags.halflingDoubleUsed && <span class="muted small"> · Halfling double-sell available</span>}
      </header>
      <div class="tiles">
        {rc.map((c) => (
          <Tile key={c} card={c} onClick={() => onCard(c)} />
        ))}
        {['head', 'armor', 'foot', 'hands', 'none'].map((slot) =>
          (bySlot.get(slot) ?? []).map((c) => <Tile key={c} card={c} label={SLOT_NAMES[slot]} onClick={() => onCard(c)} />),
        )}
      </div>
      {p.carried.length > 0 && (
        <>
          <div class="muted small">Carried (no bonus):</div>
          <div class="tiles">
            {p.carried.map((c) => (
              <Tile key={c} card={c} onClick={() => onCard(c)} />
            ))}
          </div>
        </>
      )}
      {p.curses.length > 0 && (
        <div class="tiles">
          {p.curses.map((c) => (
            <Tile key={c} card={c} onClick={() => onCard(c)} />
          ))}
        </div>
      )}
    </section>
  );
}

function Hand({ s, me, legal, onCard }: { s: GameState; me: PlayerId; legal: Action[]; onCard: (c: CardId) => void }) {
  const p = s.players[me];
  const playable = new Set(legal.flatMap((a) => (GLOBAL.has(a.type) ? [] : cardsOfAction(a))));
  return (
    <section class="panel hand">
      <header>
        Your hand <b>[{p.hand.length}/{handLimit(p)}]</b>
      </header>
      <div class="tiles">
        {p.hand.map((c) => (
          <Tile key={c} card={c} hot={playable.has(c)} onClick={() => onCard(c)} />
        ))}
        {!p.hand.length && <span class="muted">No cards.</span>}
      </div>
    </section>
  );
}

function Tile({ card, label, hot, onClick, selected }: { card: CardId; label?: string; hot?: boolean; onClick?: () => void; selected?: boolean }) {
  const c = cardOf(card);
  return (
    <button class={`tile ${c.deck} ${hot ? 'hot' : ''} ${selected ? 'selected' : ''}`} onClick={onClick}>
      <span class="art" style={artStyle(card)} aria-hidden="true">
        {emoji(card)}
      </span>
      <span class="tile-top">
        <span class="muted small">{label ?? kindLabel(card)}</span>
      </span>
      <span class="tile-name">{nameOf(card)}</span>
      <span class="tile-text">{c.text}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Log
// ---------------------------------------------------------------------------

function Log({ s }: { s: GameState }) {
  const lines = s.log.slice(-80);
  return (
    <section class="panel log" aria-label="Game log">
      <header>📜 Log</header>
      <ol>
        {[...lines].reverse().map((l, i) => (
          <li key={s.log.length - i}>{l}</li>
        ))}
      </ol>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Modals
// ---------------------------------------------------------------------------

function Sheet(props: { title: string; close: () => void; children: preact.ComponentChildren }) {
  return (
    <div class="overlay" onClick={props.close}>
      <div class="sheet" role="dialog" aria-label={props.title} onClick={(e) => e.stopPropagation()}>
        <header>
          <b>{props.title}</b>
          <button class="ghost" onClick={props.close} aria-label="Close">
            ✕
          </button>
        </header>
        {props.children}
      </div>
    </div>
  );
}

function CardSheet({ s, card, legal, act, close }: { s: GameState; card: CardId; legal: Action[]; act: (a: Action) => boolean; close: () => void }) {
  const c = cardOf(card);
  const acts = legal.filter((a) => !GLOBAL.has(a.type) && a.type !== 'power' && cardsOfAction(a)[0] === card);
  const seen = new Set<string>();
  const unique = acts.filter((a) => {
    const k = describeAction(s, a);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return (
    <Sheet title={`${emoji(card)} ${nameOf(card)}`} close={close}>
      <div class="art big-art" style={artStyle(card)} aria-hidden="true">
        {emoji(card)}
      </div>
      <p class="muted small">
        {kindLabel(card)} · {c.deck === 'door' ? 'Door' : 'Treasure'} card{goldOf(card) ? ` · ${goldOf(card)} Gold` : ''}
      </p>
      <p class="fulltext">{c.text}</p>
      {unique.length > 0 ? (
        <div class="buttons column">
          {unique.map((a, i) => (
            <button key={i} onClick={() => act(a)}>
              {describeAction(s, a)}
            </button>
          ))}
        </div>
      ) : (
        <p class="muted small">Nothing you can do with this card right now.</p>
      )}
    </Sheet>
  );
}

function CardPicker(props: {
  s: GameState;
  title: string;
  options: CardId[];
  min: number;
  max: number;
  showGold?: boolean;
  validate: (cards: CardId[]) => string | null;
  confirm: (cards: CardId[]) => void;
  confirmLabel: string;
  extra?: (sel: CardId[]) => preact.ComponentChildren;
}) {
  const [sel, setSel] = useState<CardId[]>([]);
  const err = props.validate(sel);
  const toggle = (c: CardId) =>
    setSel(sel.includes(c) ? sel.filter((x) => x !== c) : props.max === 1 ? [c] : sel.length < props.max ? [...sel, c] : sel);
  const gold = sel.reduce((a, c) => a + goldOf(c), 0);
  return (
    <div class="picker">
      <p>
        <b>{props.title}</b>{' '}
        <span class="muted small">
          ({props.min === props.max ? `choose ${props.min}` : `choose ${props.min}–${props.max}`}
          {props.showGold ? ` · selected ${gold} Gold` : ''})
        </span>
      </p>
      <div class="tiles">
        {props.options.map((c) => (
          <Tile key={c} card={c} selected={sel.includes(c)} label={props.showGold ? `${goldOf(c)}g` : undefined} onClick={() => toggle(c)} />
        ))}
      </div>
      {props.extra?.(sel)}
      {err && sel.length > 0 && <p class="error small">⚖️ {err}</p>}
      <button class="primary" disabled={!!err} onClick={() => props.confirm(sel)}>
        {props.confirmLabel}
      </button>
    </div>
  );
}

function HelpModal({ s, me, act, close }: { s: GameState; me: PlayerId; act: (a: Action) => boolean; close: () => void }) {
  const c = s.combat!;
  const total = c.monsters.reduce((a, m) => a + monsterTreasure(m), 0);
  const [offer, setOffer] = useState(Math.min(1, total));
  const targets = s.order.filter((o) => o !== me && check(s, { type: 'askHelp', player: me, target: o, offer }) === null);
  return (
    <Sheet title="Ask for help" close={close}>
      <p class="muted small">One helper only. Their strength adds to yours; Treasure is drawn face-up and they take what you offer.</p>
      <label>
        Offer <b>{offer}</b> of {total} Treasure
        <input type="range" min={0} max={total} value={offer} onInput={(e) => setOffer(Number((e.target as HTMLInputElement).value))} />
      </label>
      <div class="buttons column">
        {targets.map((o) => (
          <button key={o} onClick={() => act({ type: 'askHelp', player: me, target: o, offer })}>
            {o} — L{s.players[o].level}, strength {strength(s, o)} ({raceClassText(s, o)})
          </button>
        ))}
        {!targets.length && <p class="muted">Nobody can be asked.</p>}
      </div>
    </Sheet>
  );
}

function SellModal({ s, me, act, close }: { s: GameState; me: PlayerId; act: (a: Action) => boolean; close: () => void }) {
  const p = s.players[me];
  const options = [...p.hand, ...p.carried, ...p.equipped].filter((c) => cardOf(c).deck === 'treasure' && goldOf(c) > 0);
  const [dbl, setDbl] = useState<CardId | undefined>(undefined);
  const halfling = !!hasPower(p, 'sellDouble') && !s.flags.halflingDoubleUsed;
  const mk = (cards: CardId[]): Action => ({ type: 'sell', player: me, cards, ...(dbl && cards.includes(dbl) ? { double: dbl } : {}) });
  return (
    <Sheet title="Sell items (1,000 Gold = 1 level)" close={close}>
      <CardPicker
        s={s}
        title="Pick what to sell (no change given; never to Level 10)"
        options={options}
        min={1}
        max={options.length}
        showGold
        validate={(cards) => check(s, mk(cards))}
        confirm={(cards) => act(mk(cards))}
        confirmLabel="Sell"
        extra={(sel) =>
          halfling && sel.length > 0 ? (
            <label>
              Halfling: sell one for double{' '}
              <select value={dbl ?? ''} onChange={(e) => setDbl((e.target as HTMLSelectElement).value || undefined)}>
                <option value="">(none)</option>
                {sel.map((c) => (
                  <option key={c} value={c}>
                    {nameOf(c)} ({goldOf(c)}g → {goldOf(c) * 2}g)
                  </option>
                ))}
              </select>
            </label>
          ) : null
        }
      />
    </Sheet>
  );
}

function TradeModal({ s, me, act, close }: { s: GameState; me: PlayerId; act: (a: Action) => boolean; close: () => void }) {
  const others = s.order.filter((o) => o !== me && !s.players[o].dead);
  const [to, setTo] = useState(others[0]);
  const [give, setGive] = useState<CardId[]>([]);
  const [get, setGet] = useState<CardId[]>([]);
  const mine = [...s.players[me].equipped, ...s.players[me].carried].filter((c) => ['item', 'oneShot'].includes(cardOf(c).kind));
  const theirs = [...s.players[to].equipped, ...s.players[to].carried].filter((c) => ['item', 'oneShot'].includes(cardOf(c).kind));
  const a: Action = { type: 'trade', player: me, to, give, get };
  const err = check(s, a);
  const tog = (arr: CardId[], set: (x: CardId[]) => void, c: CardId) => set(arr.includes(c) ? arr.filter((x) => x !== c) : [...arr, c]);
  return (
    <Sheet title="Trade items on the table" close={close}>
      <label>
        With{' '}
        <select value={to} onChange={(e) => (setTo((e.target as HTMLSelectElement).value), setGet([]))}>
          {others.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      </label>
      <p class="small">You give:</p>
      <div class="tiles">{mine.map((c) => <Tile key={c} card={c} selected={give.includes(c)} onClick={() => tog(give, setGive, c)} />)}</div>
      <p class="small">You get:</p>
      <div class="tiles">{theirs.map((c) => <Tile key={c} card={c} selected={get.includes(c)} onClick={() => tog(get, setGet, c)} />)}</div>
      {err && (give.length || get.length) ? <p class="error small">⚖️ {err}</p> : null}
      <button class="primary" disabled={!!err} onClick={() => act(a)}>
        Offer trade
      </button>
    </Sheet>
  );
}

function PowerModal(props: {
  s: GameState;
  me: PlayerId;
  power: PowerName;
  target?: { player?: PlayerId; card?: CardId; monster?: number };
  act: (a: Action) => boolean;
  close: () => void;
}) {
  const { s, me, power } = props;
  const [target, setTarget] = useState(props.target);
  const c = s.combat;
  const used = power === 'berserk' ? c?.berserk[me] : power === 'turn' ? c?.turning[me] : power === 'flight' ? c?.flight[me] : 0;
  const max = ['berserk', 'turn', 'flight'].includes(power) ? 3 - (used ?? 0) : 1;
  if (power === 'theft' && !target?.card) {
    const opts = s.order.filter((o) => o !== me).flatMap((o) => [...s.players[o].equipped, ...s.players[o].carried].map((card) => ({ o, card })));
    const ok = opts.filter(({ o, card }) => check(s, { type: 'power', player: me, power, discard: [s.players[me].hand[0]], target: { player: o, card } }) === null);
    return (
      <Sheet title="Steal a small item (roll 4+, else lose a level)" close={props.close}>
        <div class="buttons column">
          {ok.map(({ o, card }) => (
            <button key={card} onClick={() => setTarget({ player: o, card })}>
              {nameOf(card)} from {o}
            </button>
          ))}
        </div>
      </Sheet>
    );
  }
  const mk = (discard: CardId[]): Action => ({ type: 'power', player: me, power, discard, ...(target ? { target } : {}) });
  return (
    <Sheet title={describeAction(s, mk([s.players[me].hand[0]]))} close={props.close}>
      <CardPicker
        s={s}
        title="Choose the card(s) to discard"
        options={s.players[me].hand}
        min={1}
        max={Math.max(1, max)}
        validate={(cards) => check(s, mk(cards))}
        confirm={(cards) => props.act(mk(cards))}
        confirmLabel="Discard and use power"
      />
    </Sheet>
  );
}
