import { describe, expect, it } from 'vitest'

import { DEFAULT_CONFIG, ITEM_BY_ID, SHIPS, START_SHIP, holdsCost, shipCost } from '../../plugin/shared/door/data'
import type { DoorEvent } from '../../plugin/shared/door/protocol'
import { settleTurns, validPath, walk } from '../../server/src/door/engine/move'
import { gainXp, netWorth, newPlayer, toSnapshot } from '../../server/src/door/engine/player'
import { DAY_MS, class0Prices } from '../../server/src/door/engine/prices'
import { densityRow, portReport, sectorView, type SectorContents } from '../../server/src/door/engine/scan'
import { bankMove, buyClass0, buyItem, buyShip, renameShip, tradeInValue } from '../../server/src/door/engine/shop'
import { activeEvent, offer, openDock, pendingOf, stepsOf, type TradeCtx } from '../../server/src/door/engine/trade'
import type { PortRec } from '../../server/src/door/engine/types'

// 1 → 2 → 3 → 4 → 5, 5 → 1.
const warps = [[], [2], [3], [4], [5], [1]]

describe('movement', () => {
  it('validates paths against the warps', () => {
    expect(validPath(warps, 1, [2, 3])).toBe(true)
    expect(validPath(warps, 1, [3])).toBe(false)
    expect(validPath(warps, 1, [])).toBe(true)
  })

  it('walks to the end in express mode, spending turns per warp', () => {
    const r = walk({ warps, from: 1, path: [2, 3, 4], mode: 'express', turns: 20, turnsPerWarp: 3, flags: () => ({ port: true }) })
    expect(r.sector).toBe(4)
    expect(r.prev).toBe(3)
    expect(r.turnsUsed).toBe(9)
    expect(r.visited).toEqual([2, 3, 4])
    expect(r.events.map(e => e.kind)).toEqual(['warp', 'warp', 'warp', 'stop'])
    expect(r.events.at(-1)).toEqual({ kind: 'stop', sector: 4, reason: 'arrived' })
  })

  it('stops in alert mode at a port, planet or trader before the end', () => {
    const r = walk({ warps, from: 1, path: [2, 3, 4], mode: 'alert', turns: 20, turnsPerWarp: 3, flags: s => (s === 3 ? { trader: true } : undefined) })
    expect(r.sector).toBe(3)
    expect(r.events.at(-1)).toEqual({ kind: 'stop', sector: 3, reason: 'trader' })
    const last = walk({ warps, from: 1, path: [2], mode: 'alert', turns: 20, turnsPerWarp: 3, flags: () => ({ port: true }) })
    expect(last.events.at(-1)).toEqual({ kind: 'stop', sector: 2, reason: 'arrived' })
  })

  it('stops when out of turns', () => {
    const r = walk({ warps, from: 1, path: [2, 3, 4], mode: 'express', turns: 7, turnsPerWarp: 3 })
    expect(r.sector).toBe(3)
    expect(r.turnsUsed).toBe(6)
    expect(r.events.at(-1)).toEqual({ kind: 'stop', sector: 3, reason: 'turns' })
    const none = walk({ warps, from: 1, path: [2], mode: 'express', turns: 2, turnsPerWarp: 3 })
    expect(none.sector).toBe(1)
    expect(none.events).toEqual([{ kind: 'stop', sector: 1, reason: 'turns' }])
  })

  it('lets hazards stop the walk', () => {
    const r = walk({ warps, from: 1, path: [2, 3], mode: 'express', turns: 20, turnsPerWarp: 1, onEnter: s => (s === 2 ? { events: [{ kind: 'limpet' }], stop: 'mines' } : undefined) })
    expect(r.sector).toBe(2)
    expect(r.events.map(e => e.kind)).toEqual(['warp', 'limpet', 'stop'])
  })
})

describe('turns', () => {
  const cfg = { turnsPerDay: 240, turnModel: 'continuous' as const }

  it('regenerates turnsPerDay/24 an hour, keeping fractions', () => {
    expect(settleTurns(100, 0, 3_600_000, cfg)).toEqual({ turns: 110, turnsAt: 3_600_000 })
    // 5.5 minutes is 0.9 of a turn: nothing yet, and the clock does not move.
    expect(settleTurns(100, 0, 330_000, cfg)).toEqual({ turns: 100, turnsAt: 0 })
    const half = settleTurns(100, 0, 540_000, cfg)
    expect(half.turns).toBe(101)
    expect(half.turnsAt).toBe(360_000)
  })

  it('caps at turnsPerDay', () => {
    expect(settleTurns(230, 0, DAY_MS, cfg).turns).toBe(240)
    expect(settleTurns(240, 0, 5, cfg)).toEqual({ turns: 240, turnsAt: 5 })
  })

  it('resets at midnight under the daily model', () => {
    const daily = { turnsPerDay: 240, turnModel: 'daily' as const }
    expect(settleTurns(3, DAY_MS + 10, DAY_MS + 20_000_000, daily).turns).toBe(3)
    expect(settleTurns(3, DAY_MS + 10, 2 * DAY_MS + 1, daily).turns).toBe(240)
  })
})

describe('characters', () => {
  it('start in sector 1 in a Freetrader with the configured kit', () => {
    const p = newPlayer(7, 'Case', 'Wintermute', DEFAULT_CONFIG, 1000)
    expect(p).toMatchObject({ sector: 1, credits: 300, turns: 250, exp: 0, align: 0 })
    expect(p.ship).toMatchObject({ type: START_SHIP, name: 'Wintermute', holds: 20, fighters: 30, shields: 0, cargo: [0, 0, 0] })
    const snap = toSnapshot(p, 's1', DEFAULT_CONFIG, 3)
    expect(snap).toMatchObject({ v: 1, season: 's1', id: 7, turnsMax: 250, requestsToday: 3 })
    expect(netWorth(p)).toBe(300 + shipCost(SHIPS[START_SHIP]))
  })

  it('reports rank changes with experience', () => {
    const p = newPlayer(1, 'A', 'B', DEFAULT_CONFIG, 0)
    const events: DoorEvent[] = []
    gainXp(p, 1, 0, 'trade', events)
    expect(events.map(e => e.kind)).toEqual(['xp'])
    gainXp(p, 2, 0, 'trade', events)
    expect(events.map(e => e.kind)).toEqual(['xp', 'xp', 'rank'])
    expect(p.exp).toBe(3)
  })
})

const contents = (over: Partial<SectorContents> = {}): SectorContents => ({ id: 9, warps: [1, 2, 3], concord: false, navhaz: 0, planets: [], traders: [], ...over })
const stdPort = (over: Partial<PortRec> = {}): PortRec => ({ sector: 9, name: 'Lumora', class: 1, prod: [100, 100, 100], mcic: [-60, -50, 40], amount: [1000, 1000, 1000], credits: 0, updatedAt: 0, ...over })

describe('scans', () => {
  it('draws sector views', () => {
    const v = sectorView(contents({ concord: true, port: stdPort(), beacon: 'hi' }))
    expect(v).toMatchObject({ id: 9, region: 'concord', beacon: 'hi', port: { name: 'Lumora', class: 1 }, warps: [1, 2, 3] })
  })

  it('adds up density', () => {
    const row = densityRow(contents({ port: stdPort(), planets: [{ id: 1, name: 'P', class: 'T' }], traders: [{ name: 'x', ship: 'y', shipType: 1, fighters: 1 }], navhaz: 2 }))
    expect(row).toEqual({ sector: 9, density: 100 + 500 + 40 + 42, warps: 3, navhaz: 2, anomaly: false })
  })

  it('reports standard ports only', () => {
    const r = portReport(stdPort({ amount: [500, 1000, 250] }), 't')!
    expect(r.items.map(i => [i.status, i.trading, i.pct])).toEqual([['buying', 500, 50], ['buying', 1000, 100], ['selling', 250, 25]])
    expect(portReport(stdPort({ class: 0 }), 't')).toBeUndefined()
  })
})

describe('trading at a dock', () => {
  function setup() {
    const player = newPlayer(1, 'Case', 'Ship', DEFAULT_CONFIG, 0)
    player.exp = 2000
    player.credits = 100_000
    player.ship.cargo = [10, 0, 0]
    const port = stdPort()
    const ctx: TradeCtx = { port, player, seed: 1, day: 0, now: 0 }
    return { player, port, ctx, s: openDock(port, player, 1, 0) }
  }

  it('offers to buy what you carry first, then sells', () => {
    const { s, ctx } = setup()
    const steps = stepsOf(s, ctx)
    expect(steps.map(t => [t.commodity, t.side, t.max])).toEqual([[0, 'sell', 10], [2, 'buy', 10]])
  })

  it('trades at the port\'s figure and updates cargo, credits and stock', () => {
    const { s, ctx, player, port } = setup()
    const step = stepsOf(s, ctx)[0]
    const price = Math.round(step.unitOffer * 10)
    const r = offer(s, ctx, { commodity: 0, qty: 10, price })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.events[0]).toMatchObject({ kind: 'trade', commodity: 0, side: 'sell', qty: 10, price })
    expect(player.ship.cargo[0]).toBe(0)
    expect(player.credits).toBe(100_000 + price)
    expect(port.amount[0]).toBe(990)
    expect(r.done).toBe(false)
    // Buying next: 10 Weights at the port's figure.
    const buy = stepsOf(s, ctx)[0]
    expect(buy).toMatchObject({ commodity: 2, side: 'buy', max: 20 })
    const r2 = offer(s, ctx, { commodity: 2, qty: 20, price: Math.round(buy.unitOffer * 20) })
    expect(r2.ok && r2.done).toBe(true)
    expect(player.ship.cargo[2]).toBe(20)
    expect(pendingOf(s, ctx)).toBeUndefined()
  })

  it('haggles: a counter keeps the haggle open with the quantity fixed', () => {
    const { s, ctx } = setup()
    const step = stepsOf(s, ctx)[0]
    const open = Math.round(step.unitOffer * 10)
    const r = offer(s, ctx, { commodity: 0, qty: 10, price: Math.round(open * 1.25) })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.events[0]).toMatchObject({ kind: 'counter', commodity: 0 })
    expect(activeEvent(s)).toMatchObject({ kind: 'counter', commodity: 0 })
    const p = pendingOf(s, ctx)!
    expect(p.round).toBe(1)
    expect(p.steps[0]).toMatchObject({ commodity: 0, max: 10, defaultQty: 10 })
    expect(offer(s, ctx, { commodity: 0, qty: 5, price: open }).ok).toBe(false)
    expect(offer(s, ctx, { commodity: 2, qty: 5, price: 100 }).ok).toBe(false)
  })

  it('ends the commodity on a refusal, and passes on qty 0', () => {
    const { s, ctx, player } = setup()
    const open = Math.round(stepsOf(s, ctx)[0].unitOffer * 10)
    const r = offer(s, ctx, { commodity: 0, qty: 10, price: open * 3 })
    expect(r.ok && r.events[0].kind).toBe('refused')
    expect(player.ship.cargo[0]).toBe(10)
    expect(stepsOf(s, ctx).map(t => t.commodity)).toEqual([2])
    const pass = offer(s, ctx, { commodity: 2, qty: 0, price: 0 })
    expect(pass.ok && pass.done).toBe(true)
  })

  it('awards trade experience and shows the Haggle Lens figure', () => {
    const { s, ctx, player } = setup()
    player.ship.equipment.lens = true
    const r = offer(s, ctx, { commodity: 0, qty: 10, price: Math.round(stepsOf(s, ctx)[0].unitOffer * 10) })
    expect(r.ok && r.events[0]).toMatchObject({ kind: 'trade', xp: 0 })
    if (r.ok && r.events[0].kind === 'trade') expect(r.events[0].pctOfBest).toBeLessThan(100)
  })

  it('refuses a purchase you cannot pay for', () => {
    const { s, ctx, player } = setup()
    offer(s, ctx, { commodity: 0, qty: 0, price: 0 })
    const step = stepsOf(s, ctx)[0]
    player.credits = 10
    expect(step.side).toBe('buy')
    expect(offer(s, ctx, { commodity: 2, qty: 10, price: Math.round(step.unitOffer * 10) }).ok).toBe(false)
  })
})

describe('shops', () => {
  it('sells holds at Class 0 with the 20-per-hold step, all or nothing', () => {
    const p = newPlayer(1, 'A', 'B', DEFAULT_CONFIG, 0)
    p.credits = 1_000_000
    const day = 0
    const r = buyClass0(p, { holds: 55, fighters: 10, shields: 5 }, day)
    expect(r.ok).toBe(true)
    const pr = class0Prices(day)
    expect(p.credits).toBe(1_000_000 - holdsCost(pr.holdBase, 20, 55) - 10 * pr.fighter - 5 * pr.shield)
    expect(p.ship).toMatchObject({ holds: 75, fighters: 40, shields: 5 })
    expect(buyClass0(p, { holds: 1 }, day).ok).toBe(false)
    p.credits = 0
    expect(buyClass0(p, { fighters: 1 }, day).ok).toBe(false)
    expect(p.ship.fighters).toBe(40)
  })

  it('outfits phase 1 items within hull limits', () => {
    const p = newPlayer(1, 'A', 'B', DEFAULT_CONFIG, 0)
    p.credits = 200_000
    expect(buyItem(p, 'density', 1).ok).toBe(true)
    expect(p.ship.equipment.scanner).toBe('density')
    expect(buyItem(p, 'holo', 1).ok).toBe(true)
    expect(buyItem(p, 'density', 1).ok).toBe(false)
    expect(buyItem(p, 'probe', 26).ok).toBe(false)
    expect(buyItem(p, 'probe', 5).ok).toBe(true)
    expect(p.ship.equipment.probes).toBe(5)
    expect(buyItem(p, 'lens', 1).ok).toBe(true)
    expect(buyItem(p, 'contact', 1)).toEqual({ ok: false, message: 'Not yet.' })
    expect(p.credits).toBe(200_000 - 2_000 - 25_000 - 5 * ITEM_BY_ID.probe.price - 10_000)
  })

  it('trades a ship in at 65% of its parts plus 35% of its kit', () => {
    const p = newPlayer(1, 'A', 'B', DEFAULT_CONFIG, 0)
    p.ship.fighters = 0
    expect(tradeInValue(p.ship, 0)).toBe(Math.round(0.65 * 41_300))
    p.credits = 100_000
    p.ship.cargo = [5, 5, 5]
    const r = buyShip(p, 8, 'Swift', 0)
    expect(r.ok).toBe(true)
    expect(p.credits).toBe(100_000 - (33_400 - Math.round(0.65 * 41_300)))
    expect(p.ship).toMatchObject({ type: 8, name: 'Swift', holds: 30, fighters: 0, cargo: [5, 5, 5] })
    expect(buyShip(p, 9, 'X', 0).ok).toBe(false)
    expect(buyShip(p, 5, 'X', 0).ok).toBe(false)
    expect(buyShip(p, 0, 'X', 0).ok).toBe(false)
    expect(renameShip(p, 'New').ok).toBe(true)
    expect(p.ship.name).toBe('New')
  })

  it('banks up to the cap', () => {
    const p = newPlayer(1, 'A', 'B', DEFAULT_CONFIG, 0)
    p.credits = 600_000
    expect(bankMove(p, 'deposit', 500_001, DEFAULT_CONFIG).ok).toBe(false)
    expect(bankMove(p, 'deposit', 500_000, DEFAULT_CONFIG).ok).toBe(true)
    expect(bankMove(p, 'deposit', 1, DEFAULT_CONFIG).ok).toBe(false)
    expect(bankMove(p, 'withdraw', 1000, DEFAULT_CONFIG).ok).toBe(true)
    expect(p).toMatchObject({ credits: 101_000, bank: 499_000 })
    expect(bankMove(p, 'withdraw', 0, DEFAULT_CONFIG).ok).toBe(false)
  })
})
