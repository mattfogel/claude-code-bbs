import { describe, expect, it } from 'vitest'

import { BACKROOM, DEFAULT_CONFIG, LAST_LIGHT } from '../../plugin/shared/door/data'
import {
  aliasCost, applyCommission, backRoomOpen, backRoomPassword, buyPassword, hitAlign, officeOpen, passwordMatches, postHit, postReward, rewardAlign, strike, swear, trace,
} from '../../server/src/door/engine/office'
import { newPlayer } from '../../server/src/door/engine/player'
import type { PlayerRec } from '../../server/src/door/engine/types'

const NOW = Date.UTC(2026, 9, 3, 12)
const DAY = Math.floor(NOW / 86_400_000)
const make = (id = 1, name = 'Case') => newPlayer(id, name, 'Ship', DEFAULT_CONFIG, NOW)
const text = (events: { kind: string }[]) => events.filter(e => e.kind === 'text').length

describe('the Marshal\'s Office', () => {
  it('admits alignment -50 and up', () => {
    const p = make()
    p.align = -50
    expect(officeOpen(p)).toBe(true)
    p.align = -51
    expect(officeOpen(p)).toBe(false)
  })

  it('commissions at alignment 500 and sets it to 1,000', () => {
    const p = make()
    p.align = 499
    const no = applyCommission(p)
    expect(p.commissioned).toBe(false)
    expect(no.ok && text(no.events)).toBe(1)
    p.align = 500
    applyCommission(p)
    expect(p).toMatchObject({ commissioned: true, align: 1000 })
    const again = applyCommission(p)
    expect(again.ok && again.events).toHaveLength(1)
    expect(p.align).toBe(1000)
  })

  it('posts a reward on an evil trader for +1 alignment per 1,000 credits', () => {
    const p = make()
    p.credits = 10_500
    const target = { id: 2, name: 'Molly', align: -200 }
    expect(postReward(p, target, 5_500)).toMatchObject({ ok: true })
    expect(p.credits).toBe(5_000)
    expect(p.align).toBe(5)
    expect(rewardAlign(999)).toBe(0)
    expect(postReward(p, { ...target, align: 0 }, 1_000)).toMatchObject({ ok: false })
    expect(postReward(p, target, 999)).toMatchObject({ ok: false })
    expect(postReward(p, target, 50_000)).toMatchObject({ ok: false })
    expect(postReward(p, { ...target, id: 1 }, 1_000)).toMatchObject({ ok: false })
  })
})

describe('Old Sal and the Back Room', () => {
  it('admits alignment +100 and under', () => {
    const p = make()
    p.align = 100
    expect(backRoomOpen(p)).toBe(true)
    p.align = 101
    expect(backRoomOpen(p)).toBe(false)
  })

  it('makes the password a pure function of seed and player, in the word lists', () => {
    expect(backRoomPassword(2026, 7)).toBe(backRoomPassword(2026, 7))
    const seen = new Set<string>()
    for (let id = 1; id <= 200; id++) {
      const pw = backRoomPassword(2026, id)
      seen.add(pw)
      const [adj, noun] = pw.split(' ')
      expect(BACKROOM.adjectives).toContain(adj)
      expect(BACKROOM.nouns).toContain(noun)
    }
    expect(seen.size).toBeGreaterThan(50)
    expect(backRoomPassword(2026, 7)).not.toBe(backRoomPassword(2027, 7) + 'x')
  })

  it('matches the password regardless of case and spacing, and nothing else', () => {
    const pw = backRoomPassword(5, 3)
    expect(passwordMatches(pw, 5, 3)).toBe(true)
    expect(passwordMatches(`  ${pw.toUpperCase().replace(' ', '   ')} `, 5, 3)).toBe(true)
    expect(passwordMatches(pw, 5, 4)).toBe(pw === backRoomPassword(5, 4))
    expect(passwordMatches('', 5, 3)).toBe(false)
    expect(passwordMatches(undefined, 5, 3)).toBe(false)
  })

  it('sells a trace and the password for credits', () => {
    const p = make()
    p.credits = 7_000
    const t = trace(p, { name: 'Molly', sector: 44 }, 'molly')
    expect(t).toMatchObject({ ok: true })
    expect(p.credits).toBe(7_000 - LAST_LIGHT.traceCost)
    expect(JSON.stringify(t)).toContain('44')
    expect(trace(make(), { name: 'x', sector: 1 }, 'x')).toMatchObject({ ok: false })
    const pw = buyPassword(p, 99)
    expect(JSON.stringify(pw)).toContain(backRoomPassword(99, p.id))
    expect(p.credits).toBe(7_000 - LAST_LIGHT.traceCost - LAST_LIGHT.passwordCost)
    expect(buyPassword(p, 99)).toMatchObject({ ok: false })
  })

  it('prices an alias at 1,000 + 10 per experience, capped', () => {
    expect(aliasCost(0)).toBe(1_000)
    expect(aliasCost(250)).toBe(3_500)
    expect(aliasCost(1e12)).toBe(BACKROOM.aliasMax)
  })

  it('posts a hit for -1 alignment per 250 credits', () => {
    const p = make()
    p.credits = 3_000
    expect(postHit(p, { id: 2, name: 'Molly' }, 1_000)).toMatchObject({ ok: true })
    expect(p).toMatchObject({ credits: 2_000, align: -4 })
    expect(hitAlign(249)).toBe(0)
    expect(postHit(p, { id: 2, name: 'Molly' }, 100)).toMatchObject({ ok: false })
    expect(postHit(p, { id: 1, name: 'Case' }, 1_000)).toMatchObject({ ok: false })
  })

  it('escalates wrong passwords: thrown out, beaten, halved, shipless; the count resets daily', () => {
    const p: PlayerRec = make()
    p.credits = 900
    p.exp = 1000
    p.prevSector = 12
    strike(p, DAY, NOW)
    expect(p).toMatchObject({ credits: 900, exp: 1000, strikes: 1 })
    strike(p, DAY, NOW)
    expect(p.credits).toBe(0)
    p.credits = 50
    strike(p, DAY, NOW)
    expect(p.exp).toBe(500)
    expect(p.credits).toBe(50)
    expect(p.ship.type).toBe(1)
    const ev = strike(p, DAY, NOW)
    expect(ev.map(e => e.kind)).toContain('podded')
    expect(p.ship.type).toBe(0)
    expect(p.sector).toBe(12)
    // A new UTC day starts the count again.
    const q = make()
    q.strikes = 3
    q.strikeDay = DAY - 1
    strike(q, DAY, NOW)
    expect(q.strikes).toBe(1)
    expect(q.ship.type).toBe(1)
  })

  it('takes a swear once a day: -1 experience, -1 alignment', () => {
    const p = make()
    p.exp = 10
    p.align = 5
    swear(p, DAY, () => 0)
    expect(p).toMatchObject({ exp: 9, align: 4, swearDay: DAY })
    swear(p, DAY, () => 0.9)
    expect(p).toMatchObject({ exp: 9, align: 4 })
    swear(p, DAY + 1, () => 0)
    expect(p).toMatchObject({ exp: 8, align: 3 })
  })
})
