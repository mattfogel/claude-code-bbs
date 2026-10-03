import { describe, expect, it } from 'vitest'

import { CLASS0, DAY_VAR_MAX, HAGGLE_MAX_MIDDLE, holdsCost, type Commodity } from '../../plugin/shared/door/data'
import { bid, class0Prices, dayVar, nextHoldPrice, openNegotiation, openingUnit, regenPort, unitPrice, DAY_MS } from '../../server/src/door/engine/prices'
import type { PortRec } from '../../server/src/door/engine/types'

const offer = (c: Commodity, mcic: number, exp: number, dv: number, qty = 250, fill = 1) => Math.round(openingUnit({ c, mcic, fill, exp, dayVar: dv }) * qty)
const near = (actual: number, expected: number, pct = 2) => expect(Math.abs(actual - expected) / expected * 100).toBeLessThan(pct)

describe('price model (research 01 §3.1)', () => {
  it('matches the validation table (250 Weights, port full, dayVar 11)', () => {
    near(offer(2, -50, 0, 11), 32_405)
    near(offer(2, -50, 1000, 11), 34_646)
    near(offer(2, 50, 0, 11), 11_760)
    near(offer(2, 50, 1000, 11), 9_097)
  })

  it('matches the reference opening offers (250 holds, 0 XP, port full)', () => {
    const dv = 9
    // Buying ports.
    near(offer(0, -90, 0, dv), 10_678)
    near(offer(1, -75, 0, dv), 20_144)
    near(offer(2, -65, 0, dv), 34_647)
    near(offer(0, -50, 0, dv), 8_791)
    near(offer(1, -50, 0, dv), 17_712)
    near(offer(2, -50, 0, dv), 31_910)
    near(offer(1, -30, 0, dv), 15_634)
    near(offer(2, -20, 0, dv), 26_380)
    // Selling ports.
    near(offer(0, 90, 0, dv), 1_092)
    near(offer(1, 75, 0, dv), 3_768)
    near(offer(2, 65, 0, dv), 8_787)
    near(offer(0, 50, 0, dv), 3_675)
    near(offer(1, 50, 0, dv), 6_964)
    near(offer(2, 50, 0, dv), 12_190)
    near(offer(1, 30, 0, dv), 9_414)
    near(offer(2, 20, 0, dv), 18_725)
  })

  it('makes selling ports dearer as stock runs down, buying ports cheaper as they fill', () => {
    expect(unitPrice({ c: 2, mcic: 50, fill: 0.2, exp: 1000, dayVar: 9 })).toBeGreaterThan(unitPrice({ c: 2, mcic: 50, fill: 1, exp: 1000, dayVar: 9 }))
    expect(unitPrice({ c: 2, mcic: -50, fill: 0.2, exp: 1000, dayVar: 9 })).toBeLessThan(unitPrice({ c: 2, mcic: -50, fill: 1, exp: 1000, dayVar: 9 }))
  })

  it('never goes under the minimum unit price', () => {
    expect(unitPrice({ c: 0, mcic: 90, fill: 1, exp: 0, dayVar: 18 })).toBeGreaterThanOrEqual(4)
  })

  it('draws dayVar per day in 0..18, deterministically', () => {
    const seen = new Set<number>()
    for (let d = 0; d < 400; d++) {
      const v = dayVar(5, d, 1)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(DAY_VAR_MAX)
      seen.add(v)
    }
    expect(seen.size).toBe(DAY_VAR_MAX + 1)
    expect(dayVar(5, 10, 1)).toBe(dayVar(5, 10, 1))
  })
})

describe('haggle (research 01 §4.2)', () => {
  // Largest first counter that is not refused, as a ratio of the opening offer.
  function maxFirstCounter(c: Commodity, mcic: number): number {
    const p = { c, mcic, fill: 1, exp: 1000, dayVar: 9 }
    const open = openNegotiation(p, 1000, 1).offer
    let lo = open
    let hi = open * 2
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2)
      if (bid(openNegotiation(p, 1000, 1), mcic, mid).kind === 'refused') hi = mid
      else lo = mid
    }
    return (100 * lo) / open
  }

  it('tolerates the measured first-counter limits', () => {
    expect(maxFirstCounter(2, -65)).toBeCloseTo(134.8, 0)
    expect(Math.abs(maxFirstCounter(2, -65) - 134.7)).toBeLessThan(0.2)
    expect(Math.abs(maxFirstCounter(2, -20) - 110.2)).toBeLessThan(0.2)
    expect(Math.abs(maxFirstCounter(0, -90) - 149.4)).toBeLessThan(0.2)
  })

  it('accepts the port\'s own figure, and better-for-the-port bids, at once', () => {
    const p = { c: 2 as Commodity, mcic: -50, fill: 1, exp: 1000, dayVar: 9 }
    const neg = openNegotiation(p, 100, 1)
    const r = bid(neg, -50, neg.offer)
    expect(r.kind).toBe('accept')
    if (r.kind === 'accept') {
      expect(r.price).toBe(neg.offer)
      expect(r.xp).toBe(0)
    }
    expect(bid(openNegotiation(p, 100, 1), -50, neg.offer - 10).kind).toBe('accept')
  })

  it('pays a bid at the port\'s true price, with the top trade experience', () => {
    const p = { c: 2 as Commodity, mcic: -50, fill: 1, exp: 1000, dayVar: 9 }
    const neg = openNegotiation(p, 100, 1)
    const r = bid(neg, -50, Math.floor(neg.basis))
    expect(r).toMatchObject({ kind: 'accept', price: Math.floor(neg.basis) })
    if (r.kind === 'accept') expect(r.xp).toBeGreaterThanOrEqual(2)
  })

  it('counters, drifting toward the bid, then makes a final offer and refuses after it', () => {
    const p = { c: 2 as Commodity, mcic: -65, fill: 1, exp: 1000, dayVar: 9 }
    // Find a seed with no middle rounds and one with the most.
    let seed0 = 0
    while (openNegotiation(p, 100, seed0).middle !== 0) seed0++
    let seed2 = 0
    while (openNegotiation(p, 100, seed2).middle !== HAGGLE_MAX_MIDDLE) seed2++

    const neg = openNegotiation(p, 100, seed0)
    const basis0 = neg.basis
    const high = Math.round(neg.basis * 1.2)
    const r1 = bid(neg, -65, high)
    expect(r1).toMatchObject({ kind: 'counter', final: true })
    expect(neg.basis).toBeCloseTo(0.7 * basis0 + 0.3 * high, 6)
    if (r1.kind === 'counter') expect(r1.price).toBeGreaterThan(Math.round((1 - 0.065) * basis0))
    // After the final offer, asking above the port's price ends it.
    expect(bid(neg, -65, high).kind).toBe('refused')

    const long = openNegotiation(p, 100, seed2)
    expect(bid(long, -65, Math.round(long.basis * 1.2))).toMatchObject({ kind: 'counter', final: false })
    expect(bid(long, -65, Math.round(long.basis * 1.1))).toMatchObject({ kind: 'counter', final: false })
    expect(bid(long, -65, Math.round(long.basis * 1.03))).toMatchObject({ kind: 'counter', final: true })
  })

  it('narrows the tolerance each round', () => {
    const p = { c: 0 as Commodity, mcic: -90, fill: 1, exp: 1000, dayVar: 9 }
    let seed = 0
    while (openNegotiation(p, 100, seed).middle !== HAGGLE_MAX_MIDDLE) seed++
    const neg = openNegotiation(p, 100, seed)
    expect(bid(neg, -90, Math.round(neg.basis * 1.3)).kind).toBe('counter')
    // Round 2 allows 1 + 90/250/2 = 1.18 of the (drifted) basis.
    expect(bid(neg, -90, Math.round(neg.basis * 1.25)).kind).toBe('refused')
  })

  it('insults a frivolous first bid on a selling port without ending the haggle', () => {
    const p = { c: 1 as Commodity, mcic: 50, fill: 1, exp: 1000, dayVar: 9 }
    const neg = openNegotiation(p, 100, 1)
    expect(bid(neg, 50, Math.round(neg.basis / 2)).kind).toBe('insult')
    expect(neg.n).toBe(0)
    // A modest lowball gets a counter (port selling: its figure comes down).
    const r = bid(neg, 50, Math.round(neg.basis * 0.9))
    expect(r.kind).toBe('counter')
    if (r.kind === 'counter') expect(r.price).toBeLessThan(Math.round(openingUnit(p) * 100))
    // Way under the tolerance is refused.
    expect(bid(openNegotiation(p, 100, 1), 50, Math.round(neg.basis * 0.7)).kind).toBe('refused')
  })
})

describe('port regeneration', () => {
  const port = (): PortRec => ({ sector: 5, name: 'X', class: 1, prod: [100, 100, 100], mcic: [-50, -50, 50], amount: [0, 500, 1000], credits: 0, updatedAt: 0 })

  it('adds 5% of capacity a day and caps at capacity', () => {
    const p = regenPort(port(), DAY_MS * 2, 5)
    expect(p.amount).toEqual([100, 600, 1000])
    expect(p.updatedAt).toBe(DAY_MS * 2)
    expect(regenPort(port(), DAY_MS * 100, 5).amount).toEqual([1000, 1000, 1000])
  })

  it('caps one visit\'s regeneration', () => {
    expect(regenPort(port(), DAY_MS * 10, 50).amount[0]).toBe(1000)
  })
})

describe('Class 0 goods', () => {
  it('prices holds at B + 20 per hold already aboard', () => {
    expect(holdsCost(173, 20, 55)).toBe(61_215)
    expect(holdsCost(173, 50, 100)).toBe(216_300)
    expect(nextHoldPrice(0, 20)).toBe(CLASS0.holdBase[0] + 400)
  })

  it('cycles fighter and shield prices in range', () => {
    for (let d = 0; d < 40; d++) {
      const p = class0Prices(d)
      expect(p.holdBase).toBeGreaterThanOrEqual(151)
      expect(p.holdBase).toBeLessThanOrEqual(249)
      expect(p.fighter).toBeGreaterThanOrEqual(160)
      expect(p.fighter).toBeLessThanOrEqual(239)
      expect(p.shield).toBeGreaterThanOrEqual(110)
      expect(p.shield).toBeLessThanOrEqual(189)
    }
  })
})
