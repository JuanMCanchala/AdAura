/**
 * Deterministic randomness. Every run of the simulation with the same seed produces the
 * same history, which is what makes a live demo safe to give twice.
 */

export type Rng = () => number;

/** mulberry32 — small, fast, good enough for a market simulator. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a. Used to derive stable per-combination constants from strings. */
export function hash32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A stable number in [0,1) for a given key — the same key always yields the same value. */
export function hashUnit(key: string): number {
  return hash32(key) / 4294967296;
}

/** Box-Muller, mean 0 stddev 1. */
export function gaussian(rng: Rng): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Multiplicative noise centred on 1, clamped so a single unlucky draw cannot zero a result. */
export function noise(rng: Rng, sigma: number): number {
  return clamp(1 + gaussian(rng) * sigma, 0.25, 2.2);
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length) % items.length];
}
