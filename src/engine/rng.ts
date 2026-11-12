// Seeded RNG (mulberry32). The whole generator state is one uint32 kept in GameState.rngState,
// so every shuffle and die roll is replayable from the seed.

export function nextRandom(state: number): [number, number] {
  let t = (state + 0x6d2b79f5) >>> 0;
  const next = t;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [value, next];
}

/** Minimal mutable view over a state object holding `rngState`. */
export interface RngHolder {
  rngState: number;
}

export function random(h: RngHolder): number {
  const [v, next] = nextRandom(h.rngState);
  h.rngState = next;
  return v;
}

export function rollDie(h: RngHolder): number {
  return 1 + Math.floor(random(h) * 6);
}

export function randInt(h: RngHolder, n: number): number {
  return Math.floor(random(h) * n);
}

/** Fisher-Yates in place. */
export function shuffle<T>(h: RngHolder, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(h, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function seedFrom(input: number | string): number {
  if (typeof input === 'number') return input >>> 0;
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
