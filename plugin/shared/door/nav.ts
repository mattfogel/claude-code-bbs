// Pure navigation and the seeded PRNG, shared by the mod (the local course
// plotter) and the server (the engine).

import type { DoorMap } from './protocol'

function warpsOf(map: DoorMap | number[][]): number[][] {
  return Array.isArray(map) ? map : map.warps
}

/**
 * The shortest course (fewest hops) over directed warps, including `from` and
 * `to`; null if `to` is unreachable within `maxHops`. Avoided sectors are
 * never entered, except `to` itself. If avoids are what block the route, this
 * still returns null; the caller decides whether to clear them.
 */
export function plotCourse(map: DoorMap | number[][], from: number, to: number, avoids?: Iterable<number>, maxHops = 45): number[] | null {
  const warps = warpsOf(map)
  const n = warps.length
  const valid = (s: number) => Number.isInteger(s) && s >= 1 && s < n
  if (!valid(from) || !valid(to)) return null
  if (from === to) return [from]
  const prev = new Int32Array(n).fill(-1)
  const blocked = new Uint8Array(n)
  if (avoids) for (const a of avoids) if (valid(a)) blocked[a] = 1
  blocked[to] = 0
  prev[from] = from
  let frontier = [from]
  for (let depth = 0; depth < maxHops && frontier.length; depth++) {
    const next: number[] = []
    for (const s of frontier) {
      for (const w of warps[s] ?? []) {
        if (!valid(w) || prev[w] !== -1 || blocked[w]) continue
        prev[w] = s
        if (w === to) {
          const path = [to]
          for (let c = to; c !== from; c = prev[c]) path.push(prev[c])
          return path.reverse()
        }
        next.push(w)
      }
    }
    frontier = next
  }
  return null
}

/** Turns a course costs: hops × the ship's turns per warp. */
export function courseTurns(path: readonly number[], turnsPerWarp: number): number {
  return Math.max(0, path.length - 1) * turnsPerWarp
}

/** True if there is a warp from a to b (warps are directed). */
export function isAdjacent(map: DoorMap | number[][], a: number, b: number): boolean {
  return warpsOf(map)[a]?.includes(b) ?? false
}

// ---------------------------------------------------------------------------
// Seeded randomness. The engine seeds from (season seed, player id, action
// counter) so every result is reproducible.

/** mulberry32: a fast 32-bit PRNG. Returns a function giving floats in [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A 32-bit seed from any parts (FNV-1a over their text, then mixed). */
export function hashSeed(...parts: (string | number)[]): number {
  let h = 0x811c9dc5
  const s = parts.join('\u0001')
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

/** An integer in lo..hi inclusive. */
export function randInt(next: () => number, lo: number, hi: number): number {
  return lo + Math.floor(next() * (hi - lo + 1))
}
