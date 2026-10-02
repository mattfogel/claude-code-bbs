// The Big Bang (research 01 §1.2): a deterministic universe from a seed and
// a config. It runs as a state machine so the DO can spread it over alarm
// invocations, each step a few ms of CPU even at 5000 sectors.

import {
  CAPACITY_PER_PRODUCTIVITY, CLASS_DRYDOCK, CLASS_SPECIAL, CONCORD_CORE, COMMODITY_IDS, MCIC_RANGE, PORT_CLASSES, PRODUCTIVITY_RANGE,
  SPECIAL_PORTS, STANDARD_CLASSES, portSells, type DoorConfig, type PortClass,
} from '../../../../plugin/shared/door/data'
import { hashSeed, plotCourse, randInt, rng } from '../../../../plugin/shared/door/nav'
import { portNamePool } from './portnames'
import type { PortRec, Triple } from './types'

export type BangPhase = 'tree' | 'links' | 'repair' | 'specials' | 'plan' | 'ports' | 'done'

export type Specials = { drydock: number; meridian: number; tycho: number }

/** Everything between steps; plain JSON so the DO can store it. */
export type BangState = {
  seed: number
  config: DoorConfig
  /** ms; ports' regeneration clock starts here. */
  at: number
  phase: BangPhase
  cursor: number
  /** Outgoing warps; index = sector, warps[0] = []. */
  warps: number[][]
  /** Sectors 11..N in the order the spanning tree places them. */
  order: number[]
  repairs: number
  specials?: Specials
  lanes: number[]
  portSectors: number[]
  portClasses: PortClass[]
  names: string[]
  ports: PortRec[]
}

export type BangResult = {
  warps: number[][]
  concord: number[]
  lanes: number[]
  specials: Specials
  ports: PortRec[]
}

/** Sectors the spanning tree places per step. */
const TREE_CHUNK = 1000
/** Ports generated per step. */
const PORT_CHUNK = 500
/** Repair iterations (two BFS each) per step. */
const REPAIR_ITERS = 4
/** Chance the tree extends the last sector placed, which makes tunnels. */
const CHAIN = 0.45

const near = 3

function link(w: number[][], a: number, b: number, max: number): boolean {
  if (a === b || w[a].length >= max || w[a].includes(b)) return false
  w[a].push(b)
  return true
}

function link2(w: number[][], a: number, b: number, max: number): boolean {
  if (a === b || w[a].length >= max || w[b].length >= max || w[a].includes(b) || w[b].includes(a)) return false
  w[a].push(b)
  w[b].push(a)
  return true
}

function shuffle<T>(xs: T[], next: () => number): T[] {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1))
    ;[xs[i], xs[j]] = [xs[j], xs[i]]
  }
  return xs
}

/** BFS hop counts from `start` (−1 = unreachable) and each sector's BFS parent. */
export function bfs(adj: number[][], start: number): { dist: Int32Array; parent: Int32Array } {
  const n = adj.length
  const dist = new Int32Array(n).fill(-1)
  const parent = new Int32Array(n).fill(-1)
  dist[start] = 0
  const queue = new Int32Array(n)
  let head = 0
  let tail = 0
  queue[tail++] = start
  while (head < tail) {
    const s = queue[head++]
    for (const t of adj[s]) {
      if (dist[t] !== -1) continue
      dist[t] = dist[s] + 1
      parent[t] = s
      queue[tail++] = t
    }
  }
  return { dist, parent }
}

export function reverseOf(w: number[][]): number[][] {
  const r: number[][] = w.map(() => [])
  for (let s = 1; s < w.length; s++) for (const t of w[s]) r[t].push(s)
  return r
}

/** Sectors 1..10 plus the Drydock's. */
export function concordOf(drydock: number): number[] {
  const c = Array.from({ length: CONCORD_CORE }, (_, i) => i + 1)
  if (drydock > CONCORD_CORE) c.push(drydock)
  return c
}

/** Exact counts per class from the shares, by largest remainder. */
export function classCounts(total: number): Record<PortClass, number> {
  const raw = STANDARD_CLASSES.map(c => (total * PORT_CLASSES[c].share) / 100)
  const counts = raw.map(Math.floor)
  let left = total - counts.reduce((a, b) => a + b, 0)
  const byRemainder = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0])
  for (let k = 0; left > 0; k++, left--) counts[byRemainder[k % byRemainder.length][1]]++
  return Object.fromEntries(STANDARD_CLASSES.map((c, i) => [c, counts[i]])) as Record<PortClass, number>
}

/** Starts a bang: the Concord cluster and the tree's placement order. */
export function startBang(seed: number, config: DoorConfig, at: number): BangState {
  const n = config.sectors
  const max = config.maxWarps
  const next = rng(hashSeed(seed, 'cluster'))
  const warps: number[][] = Array.from({ length: n + 1 }, () => [])
  // Concord Space: 1 ↔ 2..7, a ring through 2..10, and a chord each.
  for (let s = 2; s <= 7; s++) link2(warps, 1, s, max)
  for (let s = 2; s <= CONCORD_CORE; s++) link2(warps, s, s === CONCORD_CORE ? 2 : s + 1, max)
  for (let s = 2; s <= CONCORD_CORE; s++) {
    for (let tries = 0; tries < 4; tries++) if (link2(warps, s, randInt(next, 2, CONCORD_CORE), max - 1)) break
  }
  const order = shuffle(Array.from({ length: n - CONCORD_CORE }, (_, i) => i + CONCORD_CORE + 1), next)
  return { seed, config, at, phase: 'tree', cursor: 0, warps, order, repairs: 0, lanes: [], portSectors: [], portClasses: [], names: [], ports: [] }
}

/** Runs one step; returns the same (mutated) state. */
export function bangStep(s: BangState): BangState {
  switch (s.phase) {
    case 'tree': return treeStep(s)
    case 'links': return linksStep(s)
    case 'repair': return repairStep(s)
    case 'specials': return specialsStep(s)
    case 'plan': return planStep(s)
    case 'ports': return portsStep(s)
    case 'done': return s
  }
}

/** The whole bang in one go (tests and tools). */
export function runBang(seed: number, config: DoorConfig, at = 0): BangResult {
  const s = startBang(seed, config, at)
  for (let i = 0; s.phase !== 'done' && i < 100_000; i++) bangStep(s)
  return bangResult(s)
}

export function bangResult(s: BangState): BangResult {
  if (s.phase !== 'done' || !s.specials) throw new Error('bang not finished')
  return { warps: s.warps, concord: concordOf(s.specials.drydock), lanes: s.lanes, specials: s.specials, ports: s.ports }
}

// A random spanning tree of two-way warps hanging off the cluster (never off
// sector 1), with a bias to extend the last sector placed. Two-way edges make
// it strongly connected from the start.
function treeStep(s: BangState): BangState {
  const { warps, order } = s
  const max = s.config.maxWarps
  const next = rng(hashSeed(s.seed, 'tree', s.cursor))
  const placedAt = (i: number) => (i < CONCORD_CORE - 1 ? i + 2 : order[i - (CONCORD_CORE - 1)])
  const end = Math.min(order.length, s.cursor + TREE_CHUNK)
  for (let k = s.cursor; k < end; k++) {
    const sector = order[k]
    const placed = CONCORD_CORE - 1 + k
    let parent = -1
    if (k > 0 && next() < CHAIN && warps[order[k - 1]].length < max) parent = order[k - 1]
    for (let tries = 0; parent < 0 && tries < 20; tries++) {
      const p = placedAt(randInt(next, 0, placed - 1))
      if (warps[p].length < max) parent = p
    }
    for (let i = 0; parent < 0 && i < placed; i++) {
      const p = placedAt((k + i) % placed)
      if (warps[p].length < max) parent = p
    }
    if (parent > 0) link2(warps, sector, parent, max)
  }
  s.cursor = end
  if (end >= order.length) {
    s.phase = 'links'
    s.cursor = 0
  }
  return s
}

// Random two-way links, then one-way links, never into sector 1's list.
function linksStep(s: BangState): BangState {
  const { warps, config } = s
  const n = config.sectors
  const max = config.maxWarps
  const next = rng(hashSeed(s.seed, 'links'))
  const two = Math.round((n * config.twoWayPct) / 100)
  for (let made = 0, tries = 0; made < two && tries < two * 20; tries++) {
    if (link2(warps, randInt(next, 2, n), randInt(next, 2, n), max)) made++
  }
  const one = Math.round((n * config.oneWayPct) / 100)
  for (let made = 0, tries = 0; made < one && tries < one * 20; tries++) {
    const a = randInt(next, 2, n)
    const b = randInt(next, 2, n)
    if (!warps[b].includes(a) && link(warps, a, b, max)) made++
  }
  s.phase = 'repair'
  return s
}

/** Sectors farther than `limit` (or unreachable). */
function violators(dist: Int32Array, limit: number): number[] {
  const out: number[] = []
  for (let i = 1; i < dist.length; i++) if (dist[i] < 0 || dist[i] > limit) out.push(i)
  return out
}

// Every sector within maxCourse hops of sector 1, and sector 1 within
// maxCourse hops of every sector. Each fix adds a one-way shortcut halfway up
// a long branch.
function repairStep(s: BangState): BangState {
  const { warps, config } = s
  const max = config.maxWarps
  const limit = config.maxCourse
  const half = Math.max(1, Math.min(Math.floor(limit / 2), limit - near - 1))
  const next = rng(hashSeed(s.seed, 'repair', s.repairs))
  const pick = (cands: number[]) => cands[Math.floor(next() * cands.length)]
  for (let iter = 0; iter < REPAIR_ITERS; iter++) {
    if (s.repairs > config.sectors * 2) break
    const fwd = bfs(warps, 1)
    const out = violators(fwd.dist, limit)
    if (out.length) {
      s.repairs++
      // Shortcut into the branch `half` hops above the violator, so it lands within near + 1 + half.
      const v = pick(out)
      let a = v
      if (fwd.dist[v] > 0) while (fwd.dist[a] > Math.max(near + 2, fwd.dist[v] - half) && fwd.parent[a] > 0) a = fwd.parent[a]
      const sources: number[] = []
      for (let u = 2; u < warps.length; u++) if (fwd.dist[u] >= 0 && fwd.dist[u] <= near && warps[u].length < max && !warps[u].includes(a) && u !== a) sources.push(u)
      if (!sources.length) for (let u = 2; u < warps.length; u++) if (fwd.dist[u] >= 0 && fwd.dist[u] < half && warps[u].length < max && u !== a && !warps[u].includes(a)) sources.push(u)
      if (sources.length) link(warps, pick(sources), a, max)
      continue
    }
    const rev = bfs(reverseOf(warps), 1)
    const back = violators(rev.dist, limit)
    if (!back.length) {
      s.phase = 'specials'
      return s
    }
    s.repairs++
    // Walk from the violator toward sector 1; shortcut home from the first node with room within `half` hops.
    const v = pick(back)
    let from = -1
    for (let p = v; p > 0 && rev.dist[v] - rev.dist[p] <= half && rev.dist[p] > near + 1; p = rev.parent[p]) {
      if (warps[p].length < max) {
        from = p
        break
      }
    }
    if (from < 0 && rev.dist[v] < 0 && warps[v].length < max) from = v
    if (from < 0) continue
    const targets: number[] = []
    for (let u = 1; u < warps.length; u++) if (rev.dist[u] >= 0 && rev.dist[u] <= near && u !== from && !warps[from].includes(u)) targets.push(u)
    if (targets.length) link(warps, from, pick(targets), max)
  }
  if (s.repairs > config.sectors * 2) s.phase = 'specials'
  return s
}

// The Drydock, Meridian and Tycho Reach in random full (6-warp) sectors
// outside the cluster, sorted warp lists, and the space lanes between them.
function specialsStep(s: BangState): BangState {
  const { warps, config } = s
  const n = config.sectors
  const max = config.maxWarps
  const next = rng(hashSeed(s.seed, 'specials'))
  const full: number[] = []
  for (let i = CONCORD_CORE + 1; i <= n; i++) if (warps[i].length >= max) full.push(i)
  shuffle(full, next)
  const chosen = full.slice(0, 3)
  // Too few full sectors: top random ones up with one-way warps out, which never lengthens a course.
  while (chosen.length < 3) {
    const c = randInt(next, CONCORD_CORE + 1, n)
    if (chosen.includes(c)) continue
    for (let tries = 0; warps[c].length < max && tries < 200; tries++) link(warps, c, randInt(next, CONCORD_CORE + 1, n), max)
    if (warps[c].length >= max) chosen.push(c)
  }
  const [drydock, meridian, tycho] = chosen
  s.specials = { drydock, meridian, tycho }
  for (const w of warps) w.sort((a, b) => a - b)

  const lanes = new Set<number>()
  for (const [a, b] of [[1, drydock], [drydock, 1], [drydock, meridian], [meridian, drydock], [drydock, tycho], [tycho, drydock], [meridian, tycho], [tycho, meridian]]) {
    for (const x of plotCourse(warps, a, b, undefined, n) ?? []) lanes.add(x)
  }
  s.lanes = [...lanes].sort((a, b) => a - b)
  s.phase = 'plan'
  return s
}

// Which sectors get ports, their classes and names, and the four specials.
function planStep(s: BangState): BangState {
  const { config } = s
  const n = config.sectors
  const next = rng(hashSeed(s.seed, 'plan'))
  const { drydock, meridian, tycho } = s.specials!
  const chosen = [drydock, meridian, tycho]
  const maxPorts = Math.round((n * config.portPct) / 100)
  const built = Math.round((maxPorts * config.portBuiltPct) / 100)
  const candidates: number[] = []
  for (let i = 2; i <= n; i++) if (!chosen.includes(i)) candidates.push(i)
  s.portSectors = shuffle(candidates, next).slice(0, built)
  const counts = classCounts(s.portSectors.length)
  const classes: PortClass[] = []
  for (const c of STANDARD_CLASSES) for (let k = 0; k < counts[c]; k++) classes.push(c)
  s.portClasses = shuffle(classes, next)
  s.names = shuffle(portNamePool(s.portSectors.length, hashSeed(s.seed, 'names')), next)

  const special = (sector: number, name: string, cls: number): PortRec => ({ sector, name, class: cls as 0 | 9, prod: [0, 0, 0], mcic: [0, 0, 0], amount: [0, 0, 0], credits: 0, updatedAt: s.at })
  s.ports = [
    special(1, SPECIAL_PORTS.haven.name, CLASS_SPECIAL),
    special(meridian, SPECIAL_PORTS.meridian.name, CLASS_SPECIAL),
    special(tycho, SPECIAL_PORTS.tycho.name, CLASS_SPECIAL),
    special(drydock, SPECIAL_PORTS.drydock.name, CLASS_DRYDOCK),
  ]
  s.phase = 'ports'
  s.cursor = 0
  return s
}

/** A fresh standard port: productivity, signed MCIC by class, full stock. */
export function makePort(sector: number, cls: PortClass, name: string, next: () => number, at: number): PortRec {
  const prod = [0, 0, 0] as Triple
  const mcic = [0, 0, 0] as Triple
  const amount = [0, 0, 0] as Triple
  for (const c of COMMODITY_IDS) {
    prod[c] = randInt(next, PRODUCTIVITY_RANGE[0], PRODUCTIVITY_RANGE[1])
    const mag = randInt(next, MCIC_RANGE[c][0], MCIC_RANGE[c][1])
    mcic[c] = portSells(cls, c) ? mag : -mag
    amount[c] = prod[c] * CAPACITY_PER_PRODUCTIVITY
  }
  return { sector, name, class: cls, prod, mcic, amount, credits: 0, updatedAt: at }
}

function portsStep(s: BangState): BangState {
  const next = rng(hashSeed(s.seed, 'ports', s.cursor))
  const end = Math.min(s.portSectors.length, s.cursor + PORT_CHUNK)
  for (let i = s.cursor; i < end; i++) s.ports.push(makePort(s.portSectors[i], s.portClasses[i], s.names[i], next, s.at))
  s.cursor = end
  if (end >= s.portSectors.length) {
    s.phase = 'done'
    // The plan is spent; drop it so the stored state stays small.
    s.order = []
    s.portSectors = []
    s.portClasses = []
    s.names = []
  }
  return s
}
