import { describe, expect, it } from 'vitest'

import { COMBAT, DEFAULT_CONFIG, MARSHALS, POD, SHIPS } from '../../plugin/shared/door/data'
import { hashSeed, rng } from '../../plugin/shared/door/nav'
import type { DoorEvent } from '../../plugin/shared/door/protocol'
import {
  applyDamage, destroyShip, fightAwards, fleeTo, isFatal, isProtected, marshalPunish, marshalSectors, marshalsAt, nextMidnight, offensiveSend, podAwards,
  resolveAttack, safePodPath, safetyRating, turncoatMarshal, wouldFlee,
} from '../../server/src/door/engine/combat'
import { newPlayer } from '../../server/src/door/engine/player'

const NOW = Date.UTC(2026, 9, 3, 12, 0, 0)
const player = (id = 1, name = 'Case') => newPlayer(id, name, 'Ship', DEFAULT_CONFIG, NOW)
const freetrader = SHIPS[1]

describe('resolution against the safety ratings', () => {
  it('rates a Freetrader at 2,900 and an Interdictor at 104,000 × 1.2', () => {
    expect(safetyRating(1)).toBe(2900)
    expect(safetyRating(16)).toBeCloseTo((100_000 + 4_000) * 1.2)
  })

  it('a Freetrader sending more than its rating always kills a full Freetrader; sending less never does', () => {
    const def = { fighters: freetrader.maxFighters, shields: freetrader.maxShields, odds: freetrader.defense }
    for (let seed = 0; seed < 300; seed++) {
      const win = resolveAttack(3100, freetrader.offense, def, rng(seed))
      expect(win.destroyed).toBe(true)
      expect(win.shieldsLost).toBe(400)
      expect(win.killed).toBe(2500)
      const lose = resolveAttack(2700, freetrader.offense, def, rng(seed))
      expect(lose.destroyed).toBe(false)
    }
  })

  it('shields absorb first, then fighters fall at the defender\'s odds', () => {
    const r = resolveAttack(100, 1, { fighters: 500, shields: 60, odds: 1 }, () => 0.5)
    expect(r.power).toBe(100)
    expect(r.shieldsLost).toBe(60)
    expect(r.killed).toBe(40)
    expect(r.destroyed).toBe(false)
    // A higher defensive odds ratio halves what a blow achieves.
    const tough = resolveAttack(100, 1, { fighters: 500, shields: 0, odds: 2 }, () => 0.5)
    expect(tough.killed).toBe(50)
  })

  it('costs the attacker (shields + fighters destroyed) × defOdds / attOdds, never more than it sent', () => {
    const r = resolveAttack(100, 2, { fighters: 1000, shields: 0, odds: 1 }, () => 0.5)
    expect(r.killed).toBe(200)
    expect(r.lost).toBe(100)
    const small = resolveAttack(1000, 2, { fighters: 100, shields: 0, odds: 1 }, () => 0.5)
    expect(small.killed).toBe(100)
    expect(small.lost).toBe(50)
    const strongDefense = resolveAttack(100, 1, { fighters: 1000, shields: 0, odds: 2 }, () => 0.5)
    expect(strongDefense.lost).toBe(100)
  })

  it('keeps the random factor within 5%', () => {
    for (let i = 0; i < 100; i++) {
      const r = resolveAttack(1000, 1, { fighters: 5000, shields: 0, odds: 1 }, rng(i))
      expect(r.power).toBeGreaterThanOrEqual(950)
      expect(r.power).toBeLessThanOrEqual(1050)
    }
  })

  it('destroys a ship only when nothing is left and power remains', () => {
    expect(resolveAttack(100, 1, { fighters: 100, shields: 0, odds: 1 }, () => 0.5).destroyed).toBe(false)
    expect(resolveAttack(101, 1, { fighters: 100, shields: 0, odds: 1 }, () => 0.5).destroyed).toBe(true)
    expect(resolveAttack(1, 1, { fighters: 0, shields: 0, odds: 1 }, () => 0.5).destroyed).toBe(true)
  })

  it('gives no salvage when the blow is more than twice what was needed', () => {
    const def = { fighters: 100, shields: 0, odds: 1 }
    expect(resolveAttack(150, 1, def, () => 0.5).overkill).toBe(false)
    expect(resolveAttack(200, 1, def, () => 0.5).overkill).toBe(false)
    expect(resolveAttack(201, 1, def, () => 0.5).overkill).toBe(true)
    expect(resolveAttack(1000, 1, def, () => 0.5).overkill).toBe(true)
    expect(resolveAttack(1, 1, { fighters: 0, shields: 0, odds: 1 }, () => 0.5).overkill).toBe(false)
    expect(resolveAttack(100, 1, { fighters: 0, shields: 0, odds: 1 }, () => 0.5).overkill).toBe(true)
  })

  it('flees only when sent is strictly more than 1.25 × (fighters + shields)', () => {
    const def = { fighters: 80, shields: 20 }
    expect(wouldFlee(125, def)).toBe(false)
    expect(wouldFlee(126, def)).toBe(true)
    expect(wouldFlee(1, { fighters: 0, shields: 0 })).toBe(true)
    expect(COMBAT.fleeRatio).toBe(1.25)
  })

  it('an offensive stack sends 1.25 × (max fighters + max shields) at a ship, at least one, at most the stack', () => {
    expect(offensiveSend(1_000_000, 1)).toBe(3625)
    expect(offensiveSend(100, 1)).toBe(100)
    expect(offensiveSend(0, 1)).toBe(1)
  })
})

describe('damage', () => {
  it('goes to shields, then fighters, then the ship', () => {
    const ship = { shields: 30, fighters: 50 }
    expect(applyDamage(ship, 20)).toEqual({ shieldsLost: 20, fightersLost: 0, destroyed: false })
    expect(ship).toEqual({ shields: 10, fighters: 50 })
    expect(applyDamage(ship, 40)).toEqual({ shieldsLost: 10, fightersLost: 30, destroyed: false })
    expect(ship).toEqual({ shields: 0, fighters: 20 })
    expect(applyDamage(ship, 20)).toEqual({ shieldsLost: 0, fightersLost: 20, destroyed: false })
    expect(applyDamage(ship, 1).destroyed).toBe(true)
  })
})

describe('death and the pod', () => {
  it('turns a ship into a pod at the destination, losing everything but the bank and 10% experience', () => {
    const p = player()
    p.exp = 1000
    p.credits = 5000
    p.bank = 777
    p.ship.cargo = [5, 5, 5]
    p.ship.equipment.deadman = 3
    p.limpet = { id: 9, name: 'X' }
    p.sector = 40
    const d = destroyShip(p, { now: NOW, podTo: 38 })
    expect(d).toMatchObject({ fatal: false, creditsLost: 5000, expLost: 100, shipName: 'Ship' })
    expect(p.ship).toMatchObject({ type: POD, holds: 5, cargo: [0, 0, 0], fighters: 0, shields: 0 })
    expect(p.ship.equipment.deadman).toBe(0)
    expect(p).toMatchObject({ sector: 38, prevSector: 40, credits: 0, bank: 777, exp: 900, timesBlownUp: 1, deaths: 1 })
    expect(p.limpet).toBeUndefined()
    expect(p.deadUntil).toBeUndefined()
  })

  it('a pod that is hit again, a Skiff, or a third death in a UTC day keeps you out until midnight and costs half', () => {
    const pod = player()
    pod.exp = 1000
    pod.align = -400
    destroyShip(pod, { now: NOW, podTo: 5 })
    expect(pod.deadUntil).toBeUndefined()
    expect(isFatal(pod, Math.floor(NOW / 86_400_000))).toBe(true)
    const d = destroyShip(pod, { now: NOW, podTo: 5 })
    expect(d.fatal).toBe(true)
    expect(pod.deadUntil).toBe(nextMidnight(NOW))
    expect(pod.deadUntil).toBe(Date.UTC(2026, 9, 4))
    expect(pod.exp).toBe(900 - 450)
    expect(pod.align).toBe(-200)
    expect(pod.sector).toBe(1)

    const skiff = player()
    skiff.ship.type = 2
    expect(destroyShip(skiff, { now: NOW, podTo: 5 }).fatal).toBe(true)

    const third = player()
    third.ship.type = 4
    expect(destroyShip(third, { now: NOW, podTo: 5 }).fatal).toBe(false)
    third.ship.type = 4
    expect(destroyShip(third, { now: NOW, podTo: 5 }).fatal).toBe(false)
    third.ship.type = 4
    expect(destroyShip(third, { now: NOW, podTo: 5 }).fatal).toBe(true)
    expect(COMBAT.maxDeathsPerDay).toBe(2)
  })

  it('counts deaths per UTC day', () => {
    const p = player()
    p.deaths = 2
    p.deathDay = Math.floor(NOW / 86_400_000) - 1
    expect(isFatal(p, Math.floor(NOW / 86_400_000))).toBe(false)
  })

  // 1 - 2 - 3 - ... - 30 in a line, with extra branches.
  const warps: number[][] = [[]]
  for (let i = 1; i <= 40; i++) warps.push([i - 1 >= 1 ? i - 1 : i + 1, i + 1 <= 40 ? i + 1 : i - 1, ((i * 7) % 40) + 1].filter((s, j, a) => s !== i && a.indexOf(s) === j))

  it('a safe pod path never enters a sector with hostile fighters and goes 3 to 20 hops when it can', () => {
    const unsafe = (s: number) => s % 5 === 0
    const ends = new Set<number>()
    for (let seed = 0; seed < 500; seed++) {
      const path: number[] = []
      const rand = rng(seed)
      const wrapped = (s: number) => {
        path.push(s)
        return unsafe(s)
      }
      const end = safePodPath(warps, 1, wrapped, rand)
      ends.add(end)
      expect(unsafe(end)).toBe(false)
    }
    expect(ends.size).toBeGreaterThan(5)
    // Everything around it is unsafe: the pod stays put.
    expect(safePodPath(warps, 1, () => true, rng(1))).toBe(1)
  })

  it('walks the whole distance over safe ground', () => {
    const line: number[][] = [[], [2], [3], [4], [5], [6], [7], [8], [9], [10], [11], [12], [13], [14], [15], [16], [17], [18], [19], [20], [21], [22], [23], [24], [25]]
    for (let seed = 0; seed < 100; seed++) {
      const end = safePodPath(line, 1, () => false, rng(seed))
      expect(end).toBeGreaterThanOrEqual(1 + COMBAT.podHops[0])
      expect(end).toBeLessThanOrEqual(1 + COMBAT.podHops[1])
    }
  })

  it('flees to a random adjacent sector', () => {
    expect(warps[10]).toContain(fleeTo(warps, 10, rng(3)))
    expect(fleeTo([[], []], 1, rng(1))).toBe(1)
  })
})

describe('experience and alignment', () => {
  it('good vs evil: exp lost/15 and alignment toward good killing evil', () => {
    expect(fightAwards(500, -500, 100, 150)).toEqual({ exp: 10, align: 15 })
    // Evil attacking good gets more evil.
    expect(fightAwards(-500, 500, 100, 150)).toEqual({ exp: 10, align: -15 })
  })

  it('same alignment: exp lost/35 and a penalty', () => {
    expect(fightAwards(500, 500, 100, 350)).toEqual({ exp: 10, align: -17 })
  })

  it('neutral attackers: exp lost/25', () => {
    expect(fightAwards(0, -500, 100, 250)).toEqual({ exp: 10, align: 25 })
  })

  it('pays nothing for victims under 10 experience, or no losses', () => {
    expect(fightAwards(500, -500, 9, 150)).toEqual({ exp: 0, align: 0 })
    expect(fightAwards(500, -500, 100, 0)).toEqual({ exp: 0, align: 0 })
    expect(podAwards(9, -500)).toEqual({ exp: 0, align: 0 })
  })

  it('podding gives 10% of the victim\'s experience and half its alignment with the sign flipped', () => {
    expect(podAwards(1000, -400)).toEqual({ exp: 100, align: 200 })
    expect(podAwards(1000, 400)).toEqual({ exp: 100, align: -200 })
  })
})

describe('Concord Space and the Marshals', () => {
  const concord = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 77]

  it('protects good, inexperienced, lightly armed pilots', () => {
    const p = player()
    expect(isProtected(p, DEFAULT_CONFIG)).toBe(true)
    p.exp = 1000
    expect(isProtected(p, DEFAULT_CONFIG)).toBe(false)
    p.exp = 999
    p.align = -1
    expect(isProtected(p, DEFAULT_CONFIG)).toBe(false)
    p.align = 0
    p.ship.fighters = 50
    expect(isProtected(p, DEFAULT_CONFIG)).toBe(false)
    p.ship.fighters = 49
    expect(isProtected(p, DEFAULT_CONFIG)).toBe(true)
  })

  it('patrols deterministically, inside Concord Space, moving on every patrol slot', () => {
    const seed = 2026
    const a = marshalSectors(seed, NOW, concord)
    expect(marshalSectors(seed, NOW + 1000, concord)).toEqual(a)
    expect(a).toHaveLength(MARSHALS.length)
    const seen = new Set<string>()
    for (let i = 0; i < 200; i++) {
      const w = marshalSectors(seed, NOW + i * 600_000, concord)
      for (const s of w) expect(concord).toContain(s)
      seen.add(w.join(','))
    }
    expect(seen.size).toBeGreaterThan(20)
        for (const [i, s] of a.entries()) expect(marshalsAt(seed, NOW, concord, s)).toContain(i)
  })

  it('destroys whoever attacks one: a pod to the previous sector, -10 alignment, -10% experience', () => {
    const p = player()
    p.exp = 500
    p.align = 100
    p.sector = 3
    p.prevSector = 2
    const events: DoorEvent[] = []
    const d = marshalPunish(p, 'Marshal Ostrander', NOW, events)
    expect(d.fatal).toBe(false)
    expect(p).toMatchObject({ sector: 2, align: 90, exp: 450 })
    expect(p.ship.type).toBe(POD)
    expect(events.some(e => e.kind === 'text')).toBe(true)
    expect(events).toContainEqual({ kind: 'xp', exp: -50, align: -10, reason: 'concord' })
  })

  it('turns on an evil pilot in a Marshal\'s Cruiser, but only Vale and Teague', () => {
    const p = player()
    p.ship.type = 9
    p.align = -5
    expect(turncoatMarshal(p, [0])).toBeUndefined()
    expect(turncoatMarshal(p, [1])).toBe('Commodore Vale')
    expect(turncoatMarshal(p, [0, 2])).toBe('High Marshal Teague')
    p.align = 0
    expect(turncoatMarshal(p, [1])).toBeUndefined()
    p.align = -5
    p.ship.type = 1
    expect(turncoatMarshal(p, [1])).toBeUndefined()
  })
})

describe('seeding', () => {
  it('hashSeed makes distinct draws per action', () => {
    expect(rng(hashSeed(1, 2, 3, 'attack'))()).not.toBe(rng(hashSeed(1, 2, 4, 'attack'))())
  })
})
