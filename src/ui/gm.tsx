// Optional Claude GM mode. Reads engine events and the human's view; never changes game state.
import { useEffect, useRef, useState } from 'preact/hooks';
import type Anthropic from '@anthropic-ai/sdk';
import type { GameEvent, GameState } from '../engine/types';
import { actor } from '../bots/bot';
import { DEFAULT_GM_MODEL, GM_MODELS, type GmModel } from '../gm/models';
import { eventsWithTurnPlayer, narrationPrompt, questionPrompt, systemPrompt } from '../gm/prompt';

const KEY = 'munchkin-web:gm:v1';
const API_KEY = 'munchkin-web:gm-key:v1';

export interface GmSettings {
  enabled: boolean;
  model: GmModel;
  onlyMyTurns: boolean;
}

export interface GmEntry {
  id: number;
  kind: 'narration' | 'answer' | 'error' | 'question';
  text: string;
  streaming?: boolean;
}

interface GmMemory {
  seed: number;
  lastSeq: number;
  recapped: boolean;
  entries: GmEntry[];
}

function read<T>(k: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(k);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}
function write(k: string, v: unknown) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}

export function loadApiKey(): string {
  try {
    return localStorage.getItem(API_KEY) ?? '';
  } catch {
    return '';
  }
}
export function saveApiKey(k: string) {
  try {
    if (k) localStorage.setItem(API_KEY, k);
    else localStorage.removeItem(API_KEY);
  } catch {
    /* ignore */
  }
}

export const DEFAULT_GM: GmSettings = { enabled: false, model: DEFAULT_GM_MODEL, onlyMyTurns: false };
export function loadGmSettings(): GmSettings {
  return read(`${KEY}:settings`, DEFAULT_GM);
}
export function saveGmSettings(s: GmSettings) {
  write(`${KEY}:settings`, s);
}

/** Events to narrate now, or null if it's not a good moment (bots mid-flow, nothing new). */
export function pickEvents(s: GameState, lastSeq: number, onlyMyTurns: boolean): GameEvent[] | null {
  const waitingOnHuman = actor(s) === s.human || s.phase === 'gameOver';
  if (!waitingOnHuman) return null;
  let fresh = s.events.filter((e) => e.seq > lastSeq);
  if (onlyMyTurns && s.phase !== 'gameOver')
    fresh = eventsWithTurnPlayer(s.events, s.order[0])
      .filter(({ e, turnPlayer }) => e.seq > lastSeq && turnPlayer === s.human)
      .map(({ e }) => e);
  return fresh.length ? fresh : null;
}

export function useGm(s: GameState, settings: GmSettings) {
  const [apiKey, setApiKey] = useState(loadApiKey);
  const [mem, setMem] = useState<GmMemory>(() => {
    const m = read<GmMemory>(`${KEY}:memory`, { seed: s.seed, lastSeq: 0, recapped: false, entries: [] });
    return m.seed === s.seed ? m : { seed: s.seed, lastSeq: Math.max(0, s.eventSeq - 12), recapped: false, entries: [] };
  });
  const [busy, setBusy] = useState(false);
  const rejected = useRef<string[]>([]);
  const [rejectTick, setRejectTick] = useState(0);
  const client = useRef<{ key: string; c: Anthropic } | null>(null);
  const nextId = useRef(Date.now());

  useEffect(() => write(`${KEY}:memory`, { ...mem, entries: mem.entries.filter((e) => !e.streaming).slice(-40) }), [mem]);
  // a new game resets the GM's memory
  useEffect(() => {
    if (mem.seed !== s.seed) setMem({ seed: s.seed, lastSeq: Math.max(0, s.eventSeq - 12), recapped: false, entries: [] });
  }, [s.seed]);
  // when GM mode is switched on mid-game, don't narrate the whole backlog
  const wasEnabled = useRef(settings.enabled);
  useEffect(() => {
    if (settings.enabled && !wasEnabled.current) setMem((m) => ({ ...m, lastSeq: Math.max(m.lastSeq, s.eventSeq - 12) }));
    wasEnabled.current = settings.enabled;
  }, [settings.enabled]);

  // the SDK is only downloaded once GM mode is actually used
  const sdk = () => import('../gm/client');
  const getClient = async () => {
    const { makeClient } = await sdk();
    if (!client.current || client.current.key !== apiKey) client.current = { key: apiKey, c: makeClient(apiKey) };
    return client.current.c;
  };

  const run = async (kind: GmEntry['kind'], user: string, after: (m: GmMemory) => GmMemory) => {
    const id = ++nextId.current;
    setBusy(true);
    setMem((m) => after({ ...m, entries: [...m.entries, { id, kind, text: '', streaming: true }] }));
    const update = (text: string, done = false, errKind?: GmEntry['kind']) =>
      setMem((m) => ({ ...m, entries: m.entries.map((e) => (e.id === id ? { ...e, text, streaming: !done, kind: errKind ?? e.kind } : e)) }));
    try {
      const { streamGm } = await sdk();
      const r = await streamGm(await getClient(), { model: settings.model, system: systemPrompt(), user }, (t) => update(t));
      update(r.refused && !r.text ? '(The GM declined to narrate this one.)' : r.text, true);
    } catch (e) {
      const { explainError } = await sdk();
      update(`⚠️ ${explainError(e)}`, true, 'error');
    } finally {
      setBusy(false);
    }
  };

  const recent = () => mem.entries.filter((e) => e.kind === 'narration' && e.text).slice(-1).map((e) => e.text);

  // Narrate when the game is waiting on you (or is over) and there's something new.
  useEffect(() => {
    if (!settings.enabled || !apiKey || busy) return;
    if (s.phase === 'gameOver') {
      if (mem.recapped) return;
      void run('narration', narrationPrompt({ state: s, events: s.events.slice(-250), rejected: [], recent: recent() }), (m) => ({
        ...m,
        recapped: true,
        lastSeq: s.eventSeq,
      }));
      return;
    }
    const events = pickEvents(s, mem.lastSeq, settings.onlyMyTurns);
    const rej = rejected.current;
    if (!events && !rej.length) return;
    rejected.current = [];
    void run('narration', narrationPrompt({ state: s, events: events ?? [], rejected: rej, recent: recent() }), (m) => ({
      ...m,
      lastSeq: s.eventSeq,
    }));
  }, [s, settings.enabled, apiKey, busy, rejectTick]);

  return {
    apiKey,
    setApiKey: (k: string) => {
      saveApiKey(k);
      setApiKey(k);
    },
    entries: mem.entries,
    busy,
    /** Report a move the engine rejected, for a ⚖️ ruling. */
    reportRejected: (text: string) => {
      if (!settings.enabled) return;
      rejected.current.push(text);
      setRejectTick((t) => t + 1);
    },
    ask: (question: string) => {
      if (!apiKey || busy || !question.trim()) return;
      const qid = ++nextId.current;
      setMem((m) => ({ ...m, entries: [...m.entries, { id: qid, kind: 'question', text: question }] }));
      void run('answer', questionPrompt(s, question, s.events.slice(-15)), (m) => m);
    },
    clear: () => setMem((m) => ({ ...m, entries: [] })),
  };
}

export type Gm = ReturnType<typeof useGm>;

export function GmPanel({ gm, settings, onSettings }: { gm: Gm; settings: GmSettings; onSettings: () => void }) {
  const [q, setQ] = useState('');
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [gm.entries]);
  if (!settings.enabled) return null;
  return (
    <section class="panel gm" aria-label="Game master">
      <header class="row">
        <span>🎙️ Game master {gm.busy && <span class="muted small">· narrating…</span>}</span>
        <button class="ghost small" onClick={onSettings}>
          Settings
        </button>
      </header>
      {!gm.apiKey ? (
        <p class="muted small">
          Add your Anthropic API key in <button class="linkish" onClick={onSettings}>GM settings</button> to hear the GM.
        </p>
      ) : (
        <>
          <ol ref={list}>
            {gm.entries.map((e) => (
              <li key={e.id} class={`gm-${e.kind}`}>
                {e.kind === 'question' ? <b>You: {e.text}</b> : e.text || (e.streaming ? '…' : '')}
              </li>
            ))}
            {!gm.entries.length && <li class="muted small">The GM speaks when it's your move.</li>}
          </ol>
          <form
            class="ask"
            onSubmit={(ev) => {
              ev.preventDefault();
              gm.ask(q);
              setQ('');
            }}
          >
            <input aria-label="Ask the GM" placeholder="Ask the GM a rules question…" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
            <button disabled={gm.busy || !q.trim()}>Ask</button>
          </form>
        </>
      )}
    </section>
  );
}

export function GmSettingsSheet(props: {
  gm: Gm;
  settings: GmSettings;
  setSettings: (s: GmSettings) => void;
  close: () => void;
}) {
  const { gm, settings, setSettings } = props;
  const [key, setKey] = useState(gm.apiKey);
  return (
    <div class="overlay" onClick={props.close}>
      <div class="sheet" role="dialog" aria-label="GM settings" onClick={(e) => e.stopPropagation()}>
        <header>
          <b>🎙️ Claude GM settings</b>
          <button class="ghost" onClick={props.close} aria-label="Close">
            ✕
          </button>
        </header>
        <p class="small muted">
          The GM narrates, rules on moves and teaches. It never changes the game. Your key is stored only in this browser and sent
          straight to the Claude API; it only sees your view (rival hands are counts).
        </p>
        <label class="chip">
          <input type="checkbox" checked={settings.enabled} onChange={() => setSettings({ ...settings, enabled: !settings.enabled })} /> GM mode on
        </label>
        <label>
          Anthropic API key
          <input type="password" autocomplete="off" placeholder="sk-ant-…" value={key} onInput={(e) => setKey((e.target as HTMLInputElement).value.trim())} />
        </label>
        <label>
          Model
          <select value={settings.model} onChange={(e) => setSettings({ ...settings, model: (e.target as HTMLSelectElement).value as GmModel })}>
            {GM_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label class="chip">
          <input type="checkbox" checked={settings.onlyMyTurns} onChange={() => setSettings({ ...settings, onlyMyTurns: !settings.onlyMyTurns })} /> Narrate only
          my turns (cheaper)
        </label>
        <div class="buttons">
          <button
            class="primary"
            onClick={() => {
              gm.setApiKey(key);
              props.close();
            }}
          >
            Save
          </button>
          {gm.apiKey && (
            <button
              onClick={() => {
                gm.setApiKey('');
                setKey('');
              }}
            >
              Forget key
            </button>
          )}
          <button class="ghost" onClick={gm.clear}>
            Clear GM log
          </button>
        </div>
      </div>
    </div>
  );
}
