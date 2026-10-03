import { describe, expect, it } from 'vitest'

import { DEFAULT_CONFIG, ROB } from '../../plugin/shared/door/data'
import { bustHolds, bustOdds, bustRemembered, rob, safeRob, safeSteal, steal } from '../../server/src/door/engine/crime'
import { newPlayer } from '../../server/src/door/engine/player'
import type { PortRec } from '../../server/src/door/engine/types'

const NOW = Date.UTC(2026, 9, 3)
const crook = (exp = 3000) => {
  const p = newPlayer(1, 'Case', 'Ship', DEFAULT_CONFIG, NOW)
  p.align = -300
  p.exp = exp
  p.ship.holds = 60
  return p
}
// Class 4 (SSB): sells Compute and Data, buys Weights.
const port = (): PortRec => ({ sector: 9, name: 'Dock', class: 4, prod: [100, 100, 100], mcic: [60, 50, -40], amount: [800, 700, 300], credits: 50_000, updatedAt: NOW })
const never = () => 0.999
const always = () => 0

describe('bust odds', () => {
  it('has safe amounts of 3 x experience credits and experience / 30 holds', () => {
    expect(safeRob(1000)).toBe(3000)
    expect(safeSteal(1000)).toBe(33)
  })

  it('is 1 in 50 at or under the safe amount, however little you take', () => {
    expect(bustOdds('rob', 3000, 1000)).toBe(0.02)
    expect(bustOdds('rob', 1, 1000)).toBe(0.02)
    expect(bustOdds('steal', 33, 1000)).toBe(0.02)
    expect(bustOdds('steal', 1, 1000)).toBe(0.02)
  })

  it('rises steeply for each hold or 1,000 credits over', () => {
    expect(bustOdds('steal', 34, 1000)).toBeCloseTo(0.12)
    expect(bustOdds('steal', 38, 1000)).toBeCloseTo(0.52)
    expect(bustOdds('steal', 100, 1000)).toBe(1)
    expect(bustOdds('rob', 4000, 1000)).toBeCloseTo(0.12)
    expect(bustOdds('rob', 3500, 1000)).toBeCloseTo(0.07)
    expect(bustOdds('rob', 100_000, 1000)).toBe(1)
    expect(bustOdds('steal', 1, 0)).toBeCloseTo(0.12)
  })

  it('costs 9% of the holds you tried to steal, 1 per 1,000 credits robbed, 20% on a repeat', () => {
    expect(bustHolds('steal', 50, 60, false)).toBe(5)
    expect(bustHolds('steal', 1, 60, false)).toBe(1)
    expect(bustHolds('rob', 5500, 60, false)).toBe(5)
    expect(bustHolds('rob', 999, 60, false)).toBe(0)
    expect(bustHolds('rob', 1, 60, true)).toBe(12)
  })

  it('forgets a buster after 7 days', () => {
    expect(bustRemembered(NOW - 6 * 86_400_000, NOW)).toBe(true)
    expect(bustRemembered(NOW - 7 * 86_400_000, NOW)).toBe(false)
  })
})

describe('robbing', () => {
  it('takes credits from the port for a turn when the roll is safe', () => {
    const p = crook()
    const pt = port()
    const r = rob(p, pt, 2000, false, never)
    expect(r).toEqual({ ok: true, events: [{ kind: 'robbed', credits: 2000 }], busted: false })
    expect(p.credits).toBe(300 + 2000)
    expect(pt.credits).toBe(48_000)
    expect(p.turns).toBe(249)
  })

  it('busts on a bad roll: 10% experience and holds, never below one hold', () => {
    const p = crook()
    p.ship.cargo = [10, 20, 30]
    const r = rob(p, port(), 5000, false, always)
    expect(r).toMatchObject({ ok: true, busted: true })
    expect(r.ok && r.events).toEqual([{ kind: 'busted', expLost: 300, holdsLost: 5 }])
    expect(p.exp).toBe(2700)
    expect(p.ship.holds).toBe(55)
    expect(p.ship.cargo.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(55)
    expect(p.credits).toBe(300)
    const tiny = crook()
    tiny.ship.holds = 2
    rob(tiny, port(), 40_000, false, always)
    expect(tiny.ship.holds).toBe(ROB.minHolds)
  })

  it('asking for more than the port holds takes what is there and busts nobody', () => {
    const p = crook(0)
    const pt = port()
    pt.credits = 1200
    const r = rob(p, pt, 99_999, false, always)
    expect(r).toEqual({ ok: true, events: [{ kind: 'robbed', credits: 1200 }], busted: false })
    expect(pt.credits).toBe(0)
    expect(p.exp).toBe(0)
  })

  it('always busts a repeat offender at the same port: 20% of holds, 10% experience, -5 alignment', () => {
    const p = crook()
    const r = rob(p, port(), 1, true, never)
    expect(r).toMatchObject({ busted: true })
    expect(p.ship.holds).toBe(48)
    expect(p.exp).toBe(2700)
    expect(p.align).toBe(-305)
  })

  it('needs alignment -100 or worse, an ordinary port and a turn', () => {
    const p = crook()
    p.align = -99
    expect(rob(p, port(), 10, false, never)).toMatchObject({ ok: false })
    p.align = -100
    expect(rob(p, port(), 10, false, never)).toMatchObject({ ok: true })
    expect(rob(p, undefined, 10, false, never)).toMatchObject({ ok: false })
    expect(rob(p, { ...port(), class: 0 }, 10, false, never)).toMatchObject({ ok: false })
    p.turns = 0
    expect(rob(p, port(), 10, false, never)).toMatchObject({ ok: false })
    expect(rob(crook(), port(), 0, false, never)).toMatchObject({ ok: false })
  })
})

describe('stealing', () => {
  it('takes product the port sells, into free holds', () => {
    const p = crook()
    const pt = port()
    const r = steal(p, pt, 0, 20, false, never)
    expect(r).toEqual({ ok: true, events: [{ kind: 'stolen', commodity: 0, qty: 20 }], busted: false })
    expect(p.ship.cargo).toEqual([20, 0, 0])
    expect(pt.amount[0]).toBe(780)
  })

  it('refuses what the port buys, more than fits, and when full', () => {
    const p = crook()
    expect(steal(p, port(), 2, 5, false, never)).toMatchObject({ ok: false })
    expect(steal(p, port(), 0, 61, false, never)).toMatchObject({ ok: false })
    p.ship.cargo = [60, 0, 0]
    expect(steal(p, port(), 1, 1, false, never)).toMatchObject({ ok: false })
  })

  it('busts a greedy thief for 9% of the holds it tried to take', () => {
    const p = crook(300)
    const r = steal(p, port(), 1, 50, false, always)
    expect(r.ok && r.events).toEqual([{ kind: 'busted', expLost: 30, holdsLost: 5 }])
    expect(p.ship.holds).toBe(55)
  })
})
