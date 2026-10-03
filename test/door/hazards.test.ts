import { describe, expect, it } from 'vitest'

import { COMBAT, DEFAULT_CONFIG, POD } from '../../plugin/shared/door/data'
import { rng } from '../../plugin/shared/door/nav'
import { enterSector, fightersOf, heldBy, surrender, tollOf } from '../../server/src/door/engine/hazards'
import { walk } from '../../server/src/door/engine/move'
import { newPlayer } from '../../server/src/door/engine/player'
import type { Deploy } from '../../server/src/door/engine/types'

const NOW = Date.UTC(2026, 9, 3, 12)
const me = () => {
  const p = newPlayer(1, 'Case', 'Ship', DEFAULT_CONFIG, NOW)
  p.sector = 20
  p.prevSector = 19
  p.ship.shields = 100
  p.ship.fighters = 100
  p.credits = 10_000
  return p
}
let nextId = 1
const dep = (kind: Deploy['kind'], count: number, o: Partial<Deploy> = {}): Deploy => ({
  id: nextId++, sector: 20, ownerId: 2, ownerName: 'Molly', kind, count, mode: 'defensive', toll: 0, ...o,
})
const hz = (deploys: Deploy[], navhaz = 0, concord = false) => ({ sector: 20, concord, navhaz, deploys })
const never = () => 0.999
const always = () => 0

describe('entering a sector', () => {
  it('does nothing in an empty sector', () => {
    const r = enterSector(me(), hz([]), never, NOW)
    expect(r.events).toEqual([])
    expect(r.stop).toBeUndefined()
  })

  it('hits with NavHaz at the haz% chance for 10 × haz% damage, then stops the walk', () => {
    const p = me()
    const r = enterSector(p, hz([], 5), always, NOW)
    expect(r.events).toEqual([{ kind: 'navhaz', damage: 50 }])
    expect(r.stop).toBe('navhaz')
    expect(p.ship.shields).toBe(50)
    const q = me()
    expect(enterSector(q, hz([], 5), () => 0.06, NOW).events).toEqual([])
    expect(q.ship.shields).toBe(100)
    expect(enterSector(me(), hz([], 50, true), always, NOW).events).toEqual([])
  })

  it('NavHaz can kill: the pod goes to the previous sector', () => {
    const p = me()
    p.ship.shields = 0
    p.ship.fighters = 10
    const r = enterSector(p, hz([], 5), always, NOW)
    expect(r.death?.fatal).toBe(false)
    expect(r.events.map(e => e.kind)).toEqual(['navhaz', 'podded'])
    expect(p.sector).toBe(19)
    expect(p.ship.type).toBe(POD)
  })

  it('attaches one limpet, replacing any earlier, and tells its owner', () => {
    const p = me()
    p.limpet = { id: 9, name: 'Old' }
    const l = dep('limpet', 3)
    const r = enterSector(p, hz([l]), never, NOW)
    expect(r.events).toEqual([{ kind: 'limpet' }])
    expect(p.limpet).toEqual({ id: 2, name: 'Molly' })
    expect(l.count).toBe(2)
    expect(r.changed).toEqual([l])
    expect(r.mail[0]).toMatchObject({ playerId: 2 })
    expect(r.stop).toBe('mines')
    // Your own limpets spare you.
    const own = dep('limpet', 3, { ownerId: 1 })
    const q = me()
    expect(enterSector(q, hz([own]), never, NOW).events).toEqual([])
    expect(q.limpet).toBeUndefined()
  })

  it('detonates half the mines, rounded down, 20 damage each, shields first', () => {
    const p = me()
    const m = dep('contact', 7)
    const r = enterSector(p, hz([m]), never, NOW)
    expect(r.events).toEqual([{ kind: 'mines', detonated: 3, damage: 60 }])
    expect(m.count).toBe(4)
    expect(p.ship.shields).toBe(40)
    expect(p.ship.fighters).toBe(100)
    expect(r.stop).toBe('mines')
    // One mine floors to zero: nothing happens.
    const one = dep('contact', 1)
    expect(enterSector(me(), hz([one]), never, NOW).events).toEqual([])
    expect(one.count).toBe(1)
    expect(COMBAT.mineDetonate).toBe(0.5)
  })

  it('mines spare their owner and kill a ship that cannot absorb them', () => {
    const own = dep('contact', 100, { ownerId: 1 })
    expect(enterSector(me(), hz([own]), never, NOW).events).toEqual([])
    const p = me()
    const r = enterSector(p, hz([dep('contact', 100)]), never, NOW)
    // 50 mines x 20 = 1000 damage against 200 points of defense.
    expect(r.death).toBeTruthy()
    expect(r.events.map(e => e.kind)).toEqual(['mines', 'podded'])
    expect(p.sector).toBe(19)
  })

  it('applies the entry order NavHaz, limpet, mines, fighters', () => {
    const p = me()
    p.ship.shields = 1000
    const r = enterSector(p, hz([dep('limpet', 1), dep('contact', 10), dep('fighters', 5, { mode: 'defensive' })], 5), always, NOW)
    expect(r.events.map(e => e.kind)).toEqual(['navhaz', 'limpet', 'mines', 'fightersEncounter'])
    expect(r.stop).toBe('fighters')
  })

  it('defensive fighters hold the ship and report to their owner', () => {
    const p = me()
    const f = dep('fighters', 50)
    const r = enterSector(p, hz([f]), never, NOW)
    expect(r.events).toEqual([{ kind: 'fightersEncounter', count: 50, owner: 'Molly', mode: 'defensive' }])
    expect(r.stop).toBe('fighters')
    expect(heldBy(p, fightersOf([f]), 20)).toBe(true)
    expect(r.mail[0].playerId).toBe(2)
  })

  it('toll fighters take 5 credits each when you can pay, and let you stay unblocked', () => {
    const p = me()
    const f = dep('fighters', 100, { mode: 'toll' })
    const r = enterSector(p, hz([f]), never, NOW)
    expect(tollOf(f)).toBe(500)
    expect(r.events).toEqual([
      { kind: 'fightersEncounter', count: 100, owner: 'Molly', mode: 'toll' },
      { kind: 'toll', amount: 500, paid: true },
    ])
    expect(p.credits).toBe(9500)
    expect(f.toll).toBe(500)
    expect(p.paid).toBe(20)
    expect(r.stop).toBe('toll')
    expect(heldBy(p, f, 20)).toBe(false)
  })

  it('toll fighters hold a ship that cannot pay', () => {
    const p = me()
    p.credits = 499
    const f = dep('fighters', 100, { mode: 'toll' })
    const r = enterSector(p, hz([f]), never, NOW)
    expect(r.events[1]).toEqual({ kind: 'toll', amount: 500, paid: false })
    expect(p.credits).toBe(499)
    expect(r.stop).toBe('fighters')
    expect(heldBy(p, f, 20)).toBe(true)
  })

  it('offensive fighters attack on entry with 1.25 x (max fighters + max shields) and survivors hold', () => {
    const p = me()
    const f = dep('fighters', 10_000, { mode: 'offensive' })
    const r = enterSector(p, hz([f]), never, NOW)
    // Sent 3,625 against 200 points of defense: the ship is lost, the stack pays 200ish.
    expect(r.events.map(e => e.kind)).toEqual(['fightersEncounter', 'attacked', 'podded'])
    expect(r.death).toBeTruthy()
    expect(f.count).toBeLessThan(10_000)
    expect(f.count).toBeGreaterThan(9_000)

    const big = me()
    big.ship.type = 4
    big.ship.fighters = 5000
    big.ship.shields = 500
    const f2 = dep('fighters', 100, { mode: 'offensive' })
    const r2 = enterSector(big, hz([f2]), never, NOW)
    expect(r2.death).toBeUndefined()
    expect(r2.events.map(e => e.kind)).toEqual(['fightersEncounter', 'attacked'])
    expect(f2.count).toBeLessThan(100)
    expect(r2.stop).toBe('fighters')
  })

  it('never touches its own fighters', () => {
    expect(enterSector(me(), hz([dep('fighters', 99, { ownerId: 1, mode: 'offensive' })]), never, NOW).events).toEqual([])
  })

  it('clears a paid toll when the ship enters another sector', () => {
    const p = me()
    p.paid = 20
    enterSector(p, { sector: 21, concord: false, navhaz: 0, deploys: [] }, never, NOW)
    expect(p.paid).toBeUndefined()
  })
})

describe('walking into hazards', () => {
  const warps = [[], [2], [3], [4], [5], [1]]

  it('stops at the first sector that hurts, with the hazard events before the stop', () => {
    const p = newPlayer(1, 'Case', 'Ship', DEFAULT_CONFIG, NOW)
    p.sector = 1
    p.ship.shields = 500
    const mines = dep('contact', 10, { sector: 3 })
    const r = walk({
      warps, from: 1, path: [2, 3, 4], mode: 'express', turns: 50, turnsPerWarp: 3,
      onEnter: s => {
        const e = enterSector(p, { sector: s, concord: false, navhaz: 0, deploys: s === 3 ? [mines] : [] }, never, NOW)
        return e.events.length ? { events: e.events, stop: e.stop } : undefined
      },
    })
    expect(r.events.map(e => e.kind)).toEqual(['warp', 'warp', 'mines', 'stop'])
    expect(r.events.at(-1)).toEqual({ kind: 'stop', sector: 3, reason: 'mines' })
    expect(r.turnsUsed).toBe(6)
  })
})

describe('surrender', () => {
  it('toll fighters take the credits you have up to the toll', () => {
    const p = me()
    p.credits = 300
    const f = dep('fighters', 100, { mode: 'toll' })
    const r = surrender(p, f)
    expect(p.credits).toBe(0)
    expect(f.toll).toBe(300)
    expect(r.events[0]).toEqual({ kind: 'toll', amount: 300, paid: true })
    expect(p.paid).toBe(20)
    expect(heldBy(p, f, 20)).toBe(false)
    const rich = me()
    surrender(rich, f)
    expect(rich.credits).toBe(9_500)
  })

  it('defensive fighters take the whole cargo', () => {
    const p = me()
    p.ship.cargo = [5, 6, 7]
    p.credits = 123
    const r = surrender(p, dep('fighters', 10))
    expect(p.ship.cargo).toEqual([0, 0, 0])
    expect(p.credits).toBe(123)
    expect(r.events[0].kind).toBe('text')
    expect(p.paid).toBe(20)
  })
})
