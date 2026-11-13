// Tiny synthesized sound effects (no audio files). Off until the player has interacted with the page.
import type { GameEvent } from '../engine/types';

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freqs: number[], step = 0.09, type: OscillatorType = 'triangle', vol = 0.08) {
  const a = audio();
  if (!a) return;
  freqs.forEach((f, i) => {
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type;
    o.frequency.value = f;
    const t = a.currentTime + i * step;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + step * 1.6);
    o.connect(g).connect(a.destination);
    o.start(t);
    o.stop(t + step * 1.8);
  });
}

export const SOUNDS: Record<string, () => void> = {
  door: () => tone([110, 82], 0.08, 'square', 0.06),
  roll: () => tone([660, 880, 740], 0.04, 'square', 0.03),
  win: () => tone([523, 659, 784], 0.08),
  levelUp: () => tone([660, 990], 0.07),
  levelDown: () => tone([392, 262], 0.1, 'sawtooth', 0.04),
  death: () => tone([330, 262, 196, 131], 0.14, 'sawtooth', 0.05),
  curse: () => tone([494, 466, 440], 0.08, 'sine', 0.06),
  gameOver: () => tone([523, 659, 784, 1047], 0.13),
};

/** Which sound (if any) an event makes. One sound per batch: the most dramatic wins. */
export function soundFor(events: GameEvent[]): string | null {
  const rank = ['gameOver', 'death', 'win', 'levelUp', 'levelDown', 'curse', 'door', 'roll'];
  let best: string | null = null;
  for (const e of events) {
    let k: string | null = null;
    if (e.type === 'gameOver') k = 'gameOver';
    else if (e.type === 'death' && /DEAD/.test(e.text)) k = 'death';
    else if (e.type === 'win') k = 'win';
    else if (e.type === 'level') {
      const d = e.data as { from: number; to: number } | undefined;
      k = d && d.to > d.from ? 'levelUp' : 'levelDown';
    } else if (e.type === 'curse') k = 'curse';
    else if (e.type === 'door') k = 'door';
    else if (e.type === 'roll') k = 'roll';
    if (k && (!best || rank.indexOf(k) < rank.indexOf(best))) best = k;
  }
  return best;
}

export function play(name: string | null) {
  if (name) SOUNDS[name]?.();
}
