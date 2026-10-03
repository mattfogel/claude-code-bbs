import { describe, expect, it } from 'vitest'

import { CONCORD_CORE, DEFAULT_CONFIG, MCIC_RANGE, PORT_CLASSES, STANDARD_CLASSES, portSells, type PortClass } from '../../plugin/shared/door/data'
import { plotCourse } from '../../plugin/shared/door/nav'
import { bangStep, bfs, classCounts, reverseOf, runBang, startBang } from '../../server/src/door/engine/bigbang'

const cfg = { ...DEFAULT_CONFIG, sectors: 1000 }
const u = runBang(1234, cfg)
const N = cfg.sectors

describe('big bang (1000 sectors)', () => {
  it('caps out-degree, avoids self-loops and duplicates, and sorts warps', () => {
    expect(u.warps).toHaveLength(N + 1)
    expect(u.warps[0]).toEqual([])
    for (let s = 1; s <= N; s++) {
      const w = u.warps[s]
      expect(w.length).toBeGreaterThanOrEqual(1)
      expect(w.length).toBeLessThanOrEqual(cfg.maxWarps)
      expect(new Set(w).size).toBe(w.length)
      expect(w).not.toContain(s)
      expect(w.every(t => t >= 1 && t <= N)).toBe(true)
      expect([...w].sort((a, b) => a - b)).toEqual(w)
    }
  })

  it('is strongly connected within the max course length of sector 1', () => {
    const fwd = bfs(u.warps, 1).dist
    const rev = bfs(reverseOf(u.warps), 1).dist
    for (let s = 1; s <= N; s++) {
      expect(fwd[s]).toBeGreaterThanOrEqual(0)
      expect(fwd[s]).toBeLessThanOrEqual(cfg.maxCourse)
      expect(rev[s]).toBeGreaterThanOrEqual(0)
      expect(rev[s]).toBeLessThanOrEqual(cfg.maxCourse)
    }
  })

  it('makes sectors 1-10 a two-way Concord cluster with sector 1 at its heart', () => {
    expect(u.warps[1]).toEqual([2, 3, 4, 5, 6, 7])
    for (let s = 1; s <= CONCORD_CORE; s++) {
      expect(plotCourse(u.warps.map((w, i) => (i <= CONCORD_CORE ? w.filter(t => t <= CONCORD_CORE) : [])), 1, s)).not.toBeNull()
      for (const t of u.warps[s]) if (t <= CONCORD_CORE) expect(u.warps[t]).toContain(s)
    }
    expect(u.concord).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, u.specials.drydock])
  })

  it('has two-way and one-way links in roughly the configured mix', () => {
    let oneWay = 0
    for (let s = 1; s <= N; s++) for (const t of u.warps[s]) if (!u.warps[t].includes(s)) oneWay++
    expect(oneWay).toBeGreaterThan(0)
    expect(oneWay).toBeLessThan(N * 0.1)
    const edges = u.warps.reduce((a, w) => a + w.length, 0)
    // Tree (2 per sector) + 30% two-way (×2) + 3% one-way.
    expect(edges / N).toBeGreaterThan(2.2)
    expect(edges / N).toBeLessThan(3.2)
  })

  it('places the specials in distinct full sectors outside the cluster', () => {
    const { drydock, meridian, tycho } = u.specials
    expect(new Set([drydock, meridian, tycho]).size).toBe(3)
    for (const s of [drydock, meridian, tycho]) {
      expect(s).toBeGreaterThan(CONCORD_CORE)
      expect(u.warps[s]).toHaveLength(6)
    }
    const byClass = (cls: number) => u.ports.filter(p => p.class === cls).map(p => p.sector).sort((a, b) => a - b)
    expect(byClass(0)).toEqual([1, meridian, tycho].sort((a, b) => a - b))
    expect(byClass(9)).toEqual([drydock])
  })

  it('lays the space lanes along shortest paths between the specials', () => {
    const { drydock, meridian, tycho } = u.specials
    for (const s of [1, drydock, meridian, tycho]) expect(u.lanes).toContain(s)
    for (const s of plotCourse(u.warps, 1, drydock, undefined, N)!) expect(u.lanes).toContain(s)
    expect([...u.lanes].sort((a, b) => a - b)).toEqual(u.lanes)
  })

  it('builds 40% × 95% ports with the class shares, one per sector, uniquely named', () => {
    const standard = u.ports.filter(p => p.class >= 1 && p.class <= 8)
    expect(standard).toHaveLength(Math.round(Math.round(N * 0.4) * 0.95))
    expect(new Set(u.ports.map(p => p.sector)).size).toBe(u.ports.length)
    expect(new Set(standard.map(p => p.name)).size).toBe(standard.length)
    for (const c of STANDARD_CLASSES) {
      const share = (100 * standard.filter(p => p.class === c).length) / standard.length
      expect(Math.abs(share - PORT_CLASSES[c].share)).toBeLessThan(1)
    }
  })

  it('gives ports productivity 30-300, full stock, and signed MCICs in range', () => {
    for (const p of u.ports.filter(p => p.class >= 1 && p.class <= 8)) {
      for (const c of [0, 1, 2] as const) {
        expect(p.prod[c]).toBeGreaterThanOrEqual(30)
        expect(p.prod[c]).toBeLessThanOrEqual(300)
        expect(p.amount[c]).toBe(p.prod[c] * 10)
        const sells = portSells(p.class as PortClass, c)
        expect(p.mcic[c] > 0).toBe(sells)
        expect(Math.abs(p.mcic[c])).toBeGreaterThanOrEqual(MCIC_RANGE[c][0])
        expect(Math.abs(p.mcic[c])).toBeLessThanOrEqual(MCIC_RANGE[c][1])
      }
    }
  })

  it('is deterministic by seed and differs between seeds', () => {
    const again = runBang(1234, cfg)
    expect(again.warps).toEqual(u.warps)
    expect(again.ports).toEqual(u.ports)
    expect(runBang(4321, cfg).warps).not.toEqual(u.warps)
  })

  it('runs in many small steps that survive a JSON round trip', () => {
    let s = startBang(99, { ...cfg, sectors: 3000 }, 0)
    let steps = 0
    while (s.phase !== 'done') {
      s = JSON.parse(JSON.stringify(bangStep(s)))
      steps++
    }
    expect(steps).toBeGreaterThan(6)
    expect(s.ports.length).toBeGreaterThan(1000)
  })
})

describe('big bang repair', () => {
  it('pulls every sector within a short max course', () => {
    const small = { ...DEFAULT_CONFIG, sectors: 600, maxCourse: 9, twoWayPct: 10, oneWayPct: 1 }
    const r = runBang(7, small)
    const fwd = bfs(r.warps, 1).dist
    const rev = bfs(reverseOf(r.warps), 1).dist
    for (let s = 1; s <= small.sectors; s++) {
      expect(fwd[s]).toBeLessThanOrEqual(small.maxCourse)
      expect(rev[s]).toBeLessThanOrEqual(small.maxCourse)
      expect(r.warps[s].length).toBeLessThanOrEqual(6)
    }
  })

  it('works for small universes', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const r = runBang(seed, { ...DEFAULT_CONFIG, sectors: 100 })
      expect(r.ports.filter(p => p.class === 9)).toHaveLength(1)
      expect(bfs(r.warps, 1).dist.slice(1).every(d => d >= 0 && d <= 45)).toBe(true)
    }
  })
})

describe('classCounts', () => {
  it('splits exactly by share', () => {
    const c = classCounts(380)
    expect(Object.values(c).reduce((a, b) => a + b, 0)).toBe(380)
    expect(c[1]).toBe(76)
    expect(c[7]).toBe(19)
    expect(Object.values(classCounts(57)).reduce((a, b) => a + b, 0)).toBe(57)
  })
})
