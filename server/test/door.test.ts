import { SELF, applyD1Migrations, env, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'

import { holdsCost } from '../../plugin/shared/door/data'
import { plotCourse } from '../../plugin/shared/door/nav'
import type { DoorEvent, DoorMap, DoorNews, DoorReply, DoorStateReply } from '../../plugin/shared/door/protocol'
import { leadingZeroBits, powInput } from '../../plugin/shared/protocol'
import { class0Prices, dayNumber } from '../src/door/engine/prices'
import type { PlayerRec } from '../src/door/engine/types'

const BITS = Number(env.POW_BITS)
const BASE = 'https://bbs.test'
let ipCounter = 0
const stub = () => env.UNIVERSE.get(env.UNIVERSE.idFromName('s1'))

async function solve(handle: string): Promise<string> {
  for (let n = 0; ; n++) {
    const nonce = n.toString(36)
    if (leadingZeroBits(new Uint8Array(await crypto.subtle.digest('SHA-256', powInput(handle, nonce)))) >= BITS) return nonce
  }
}

function api(path: string, init: { secret?: string; body?: unknown; ip?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (init.secret) headers.authorization = `Bearer ${init.secret}`
  if (init.ip) headers['cf-connecting-ip'] = init.ip
  return SELF.fetch(`${BASE}${path}`, { method: init.body === undefined ? 'GET' : 'POST', headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) })
}

async function user(handle: string, role = 'user') {
  const res = await api('/v1/register', { body: { handle, location: 'Sprawl', nonce: await solve(handle) }, ip: `10.9.0.${++ipCounter}` })
  expect(res.status).toBe(201)
  const { secret } = (await res.json()) as { secret: string }
  await env.DB.prepare('UPDATE users SET created_at = created_at - 3600, role = ? WHERE handle = ?').bind(role, handle).run()
  return secret
}

async function door<T = DoorReply>(secret: string, cmd: string, body: unknown, status = 200): Promise<T> {
  const res = await api(`/v1/door/${cmd}`, { secret, body })
  const json = await res.json()
  expect(res.status, JSON.stringify(json)).toBe(status)
  return json as T
}

/** Edits a player's stored record directly (test setup only). */
async function patch(id: number, fn: (p: PlayerRec) => void) {
  await runInDurableObject(stub(), async (_, state) => {
    const row = state.storage.sql.exec<{ data: string }>('SELECT data FROM players WHERE id = ?', id).one()
    const p = JSON.parse(row.data) as PlayerRec
    fn(p)
    state.storage.sql.exec('UPDATE players SET data = ?, sector = ? WHERE id = ?', JSON.stringify(p), p.sector, id)
  })
}

async function sql<T extends Record<string, SqlStorageValue>>(q: string, ...args: SqlStorageValue[]): Promise<T[]> {
  return runInDurableObject(stub(), async (_, state) => state.storage.sql.exec<T>(q, ...args).toArray())
}

async function feed<T>(key: string): Promise<T> {
  const res = await SELF.fetch(`${BASE}/feed/door/s1/${key}`)
  expect(res.status).toBe(200)
  return res.json()
}

const kinds = (events: DoorEvent[]) => events.map(e => e.kind)

let sysop = ''
let map: DoorMap

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
  sysop = await user('Wintermute', 'sysop')
})

describe('big bang', () => {
  it('is sysop only, answers busy while it runs, then publishes the map and news', async () => {
    const pleb = await user('Pleb')
    expect((await api('/v1/mod/door/bigbang', { secret: pleb, body: { season: 's1' } })).status).toBe(403)
    expect((await api('/v1/door/state', { secret: pleb })).status).toBe(409)
    expect((await api('/v1/mod/door/bigbang', { secret: sysop, body: { season: 'nope' } })).status).toBe(400)

    const res = await api('/v1/mod/door/bigbang', { secret: sysop, body: { season: 's1', seed: 2026, sectors: 150 } })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, season: 's1', seed: 2026, sectors: 150 })
    expect((await api('/v1/mod/door/bigbang', { secret: sysop, body: { season: 's1' } })).status).toBe(409)
    const busy = await api('/v1/door/state', { secret: pleb })
    expect(busy.status).toBe(503)
    expect(((await busy.json()) as { error: { code: string } }).error.code).toBe('busy')

    for (let i = 0; i < 100; i++) {
      const ran = await runDurableObjectAlarm(stub())
      const [row] = await sql<{ value: string }>("SELECT value FROM meta WHERE key = 'status'")
      if (!ran && row.value === 'ready') break
    }
    map = await feed<DoorMap>('map.json')
    expect(map).toMatchObject({ v: 1, season: 's1', sectors: 150 })
    expect(map.warps).toHaveLength(151)
    expect(map.warps[1]).toEqual([2, 3, 4, 5, 6, 7])
    expect(map.concord.slice(0, 10)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])

    const news = await feed<DoorNews>('news.json')
    expect(news.status).toMatchObject({ title: 'HYPERPLANE', season: 's1', sectors: 150, traders: 0 })
    expect(news.status.drydock).toBe(map.concord[10])
    expect(news.log.at(-1)?.kind).toBe('bang')
    expect((await SELF.fetch(`${BASE}/feed/door/s1/map.json`)).headers.get('cache-control')).toBe('public, max-age=3600')
  })
})

describe('playing', () => {
  let secret = ''
  let id = 0

  it('needs an account and refuses unknown or later-phase commands', async () => {
    expect((await api('/v1/door/state')).status).toBe(401)
    secret = await user('Case')
    expect((await api('/v1/door/warp', { secret, body: {} })).status).toBe(404)
    expect(await door(secret, 'attack', { target: 'x', fighters: 1 }, 400)).toMatchObject({ error: { code: 'invalid', message: 'Not yet.' } })
    expect(await door(secret, 'move', { path: [2], mode: 'alert' }, 404)).toMatchObject({ error: { code: 'not_found' } })
  })

  it('creates a character with a sanitized ship name', async () => {
    const before = await (await api('/v1/door/state', { secret })).json() as DoorStateReply
    expect(before).toMatchObject({ ok: true, created: false })

    const r = await door(secret, 'create', { shipName: '|04Neuro\u0007mancer|99' })
    id = r.snapshot.id
    expect(r.snapshot).toMatchObject({ name: 'Case', sector: 1, credits: 300, turns: 250, turnsMax: 250 })
    expect(r.snapshot.ship).toMatchObject({ name: 'Neuro mancer', type: 1, holds: 20, fighters: 30 })
    expect(r.here).toMatchObject({ id: 1, region: 'concord', port: { name: 'Haven', class: 0 }, warps: [2, 3, 4, 5, 6, 7] })
    expect(r.here.planets.map(p => p.name)).toEqual(['Terra'])
    expect(r.known.explored).toEqual([1])
    await door(secret, 'create', { shipName: 'Again' }, 409)

    const state = await (await api('/v1/door/state', { secret })).json() as DoorStateReply
    expect(state.created).toBe(true)
    expect(state.known.explored).toEqual([1])
    expect(state.snapshot?.requestsToday).toBeGreaterThan(1)
  })

  let portSector = 0
  let cls = 0

  it('moves along a plotted path, refusing courses off the warps', async () => {
    await door(secret, 'move', { path: [99999], mode: 'alert' }, 400)
    const notAdjacent = map.warps[1].includes(150) ? 149 : 150
    await door(secret, 'move', { path: [notAdjacent], mode: 'alert' }, 400)

    // A port selling two goods and buying one (classes 4-6), for the trading tests.
    const ports = await sql<{ sector: number; class: number }>('SELECT sector, class FROM ports WHERE class BETWEEN 4 AND 6 ORDER BY sector')
    const best = ports.map(p => ({ ...p, path: plotCourse(map, 1, p.sector)! })).sort((a, b) => a.path.length - b.path.length)[0]
    portSector = best.sector
    cls = best.class
    const path = best.path.slice(1)
    const r = await door(secret, 'move', { path, mode: 'express' })
    expect(r.snapshot.sector).toBe(portSector)
    expect(r.snapshot.turns).toBe(250 - 3 * path.length)
    expect(kinds(r.events)).toEqual([...path.map(() => 'warp'), 'stop'])
    expect(r.events.at(-1)).toEqual({ kind: 'stop', sector: portSector, reason: 'arrived' })
    expect(r.here.port?.class).toBe(cls)
    expect(r.known.explored).toEqual(path)
    expect(r.known.ports.map(p => p.sector)).toContain(portSector)
  })

  it('docks and trades: accept at the figure, haggle a counter, get refused', async () => {
    const [port] = await sql<{ mcic: string }>('SELECT mcic FROM ports WHERE sector = ?', portSector)
    const mcic = JSON.parse(port.mcic) as number[]
    const buys = mcic.findIndex(m => m < 0)
    const sells = [0, 1, 2].filter(c => mcic[c] > 0)
    expect(sells).toHaveLength(2)
    await patch(id, p => {
      p.credits = 100_000
      p.ship.cargo = [0, 0, 0]
      p.ship.cargo[buys] = 10
    })

    const d = await door(secret, 'dock', {})
    const dock = d.events.find(e => e.kind === 'dock')!
    if (dock.kind !== 'dock') throw new Error()
    expect(dock.report.sector).toBe(portSector)
    expect(dock.steps.map(s => [s.commodity, s.side])).toEqual([[buys, 'sell'], ...sells.map(c => [c, 'buy'])])
    expect(d.pending?.steps).toHaveLength(3)
    expect(d.snapshot.turns).toBe(dock.turnsLeft)

    // Selling at three times the port's figure is refused; the cargo stays aboard.
    const sellStep = dock.steps[0]
    const no = await door(secret, 'offer', { commodity: buys, qty: 10, price: Math.round(sellStep.unitOffer * 10) * 3 })
    expect(no.events[0]).toMatchObject({ kind: 'refused', commodity: buys })
    expect(no.snapshot.ship.cargo[buys]).toBe(10)

    // Buying the first good at the port's figure.
    const [a, b] = sells
    const stepA = no.pending!.steps.find(s => s.commodity === a)!
    const priceA = Math.round(stepA.unitOffer * 5)
    const yes = await door(secret, 'offer', { commodity: a, qty: 5, price: priceA })
    expect(yes.events[0]).toMatchObject({ kind: 'trade', commodity: a, side: 'buy', qty: 5, price: priceA })
    expect(yes.snapshot.ship.cargo[a]).toBe(5)
    expect(yes.snapshot.credits).toBe(100_000 - priceA)

    // Haggling the second: a bid between the port's tolerance and its true price draws a counter.
    const stepB = yes.pending!.steps.find(s => s.commodity === b)!
    const open = Math.round(stepB.unitOffer * 5)
    const basis = open / (1 + mcic[b] / 1000)
    const counter = await door(secret, 'offer', { commodity: b, qty: 5, price: Math.round(basis * (1 - mcic[b] / 500)) })
    const ev = counter.events[0]
    expect(ev.kind).toBe('counter')
    if (ev.kind !== 'counter') return
    expect(ev.price).toBeLessThan(open)
    expect(counter.pending?.round).toBe(1)
    // The state reply resumes the haggle at the port's current figure.
    const state = await (await api('/v1/door/state', { secret })).json() as DoorStateReply
    expect(state.events.at(-1)).toMatchObject({ kind: 'counter', commodity: b, price: ev.price })
    expect(state.pending?.steps.find(s => s.commodity === b)).toMatchObject({ max: 5, defaultQty: 5 })

    const deal = await door(secret, 'offer', { commodity: b, qty: 5, price: ev.price })
    expect(deal.events[0]).toMatchObject({ kind: 'trade', commodity: b, price: ev.price })
    expect(deal.pending).toBeUndefined()
    await door(secret, 'offer', { commodity: b, qty: 5, price: ev.price }, 400)
  })

  it('sells holds at Haven at the day\'s cycling price', async () => {
    await door(secret, 'class0', { holds: 1 }, 400)
    await patch(id, p => {
      p.sector = 1
      p.credits = 50_000
    })
    const d = await door(secret, 'dock', {})
    const b = class0Prices(dayNumber(Date.now())).holdBase
    expect(d.events[0]).toMatchObject({ kind: 'class0', holdPrice: b + 20 * 20 })
    const r = await door(secret, 'class0', { holds: 5 })
    expect(r.events[0]).toMatchObject({ kind: 'bought', what: 'holds', qty: 5, cost: holdsCost(b, 20, 5) })
    expect(r.snapshot.ship.holds).toBe(25)
    expect(r.snapshot.credits).toBe(50_000 - holdsCost(b, 20, 5))
    await door(secret, 'class0', { holds: 500 }, 400)
  })

  it('outfits, banks and announces at the Drydock', async () => {
    await door(secret, 'outfit', { item: 'density', qty: 1 }, 400)
    const drydock = map.concord[10]
    await patch(id, p => {
      p.sector = drydock
      p.credits = 50_000
    })
    const o = await door(secret, 'outfit', { item: 'density', qty: 1 })
    expect(o.events[0]).toMatchObject({ kind: 'bought', what: 'Density Scanner', qty: 1, cost: 2000 })
    expect(o.snapshot.ship.equipment.scanner).toBe('density')
    expect(o.here.port).toMatchObject({ name: 'Drydock Anchorage', class: 9 })
    await door(secret, 'outfit', { item: 'contact', qty: 1 }, 400)

    const scan = await door(secret, 'scan', { kind: 'density' })
    const rows = scan.events[0]
    expect(rows.kind === 'density' && rows.rows.map(r => r.sector)).toEqual(map.warps[drydock])
    await door(secret, 'scan', { kind: 'holo' }, 400)

    const bank = await door(secret, 'bank', { op: 'deposit', amount: 10_000 })
    expect(bank.snapshot).toMatchObject({ bank: 10_000, credits: 38_000 })
    await door(secret, 'bank', { op: 'withdraw', amount: 20_000 }, 400)

    const a = await door(secret, 'announce', { text: 'Buying |12Weights\u001b[2J cheap!' })
    expect(a.snapshot.credits).toBe(37_900)
    await runDurableObjectAlarm(stub())
    const news = await feed<DoorNews>('news.json')
    expect(news.log.map(l => l.text)).toContain('|14Case|07: Buying |12Weights cheap!')
    expect(news.status.traders).toBe(1)
    expect(news.rankings.traders[0]).toMatchObject({ name: 'Case' })
  })

  it('keeps avoids and fires Ghost Probes', async () => {
    const r = await door(secret, 'avoids', { set: [9, 5, 5] })
    expect(r.snapshot.avoids).toEqual([5, 9])
    await door(secret, 'avoids', { set: [0] }, 400)
    await door(secret, 'probe', { path: [map.warps[map.concord[10]][0]] }, 400)
  })

  it('fires probes, buys ships and transfers credits', async () => {
    const drydock = map.concord[10]
    await patch(id, p => {
      p.sector = drydock
      p.credits = 200_000
    })
    await door(secret, 'outfit', { item: 'probe', qty: 2 })
    const path = plotCourse(map, drydock, 1)!.slice(1)
    const probe = await door(secret, 'probe', { path })
    const ev = probe.events[0]
    expect(ev.kind === 'probe' && ev.sectors.map(v => v.id)).toEqual(path)
    expect(probe.snapshot.ship.equipment.probes).toBe(1)
    expect(probe.known.explored).toEqual(path)
    expect(probe.snapshot.sector).toBe(drydock)

    const ship = await door(secret, 'shipwright', { op: 'buy', ship: 8, name: '|09Swift\u0000' })
    expect(ship.snapshot.ship).toMatchObject({ type: 8, name: 'Swift', holds: 30, fighters: 0 })
    expect(kinds(ship.events)).toEqual(['text', 'bought'])
    await door(secret, 'shipwright', { op: 'buy', ship: 9, name: 'Badge' }, 400)

    const other = await user('Armitage')
    await door(other, 'create', { shipName: 'Screaming Fist' })
    await door(secret, 'bank', { op: 'transfer', amount: 2_500, to: 'armitage' })
    const theirs = await (await api('/v1/door/state', { secret: other })).json() as DoorStateReply
    expect(theirs.snapshot?.bank).toBe(2_500)
    await door(secret, 'bank', { op: 'transfer', amount: 1, to: 'Nobody' }, 404)
  })

  it('stops an alert-mode autopilot at a sector with a trader in it', async () => {
    // Armitage waits on the first hop out of sector 1; Case flies through in alert mode.
    const far = Array.from({ length: 150 }, (_, i) => plotCourse(map, 1, i + 1)!).sort((a, b) => b.length - a.length)[0]
    const path = far.slice(1)
    expect(path.length).toBeGreaterThan(2)
    const [them] = await sql<{ id: number }>("SELECT id FROM players WHERE name = 'Armitage'")
    await patch(them.id, p => { p.sector = path[0] })
    await patch(id, p => { p.sector = 1; p.turns = 250 })
    const hasPort = (await sql('SELECT 1 FROM ports WHERE sector = ?', path[0])).length > 0
    const r = await door(secret, 'move', { path, mode: 'alert' })
    expect(r.snapshot.sector).toBe(path[0])
    expect(r.events.at(-1)).toEqual({ kind: 'stop', sector: path[0], reason: hasPort ? 'port' : 'trader' })
    expect(r.here.traders.map(t => t.name)).toEqual(['Armitage'])
    // Express flies straight through.
    await patch(id, p => { p.sector = 1 })
    const x = await door(secret, 'move', { path, mode: 'express' })
    expect(x.snapshot.sector).toBe(path.at(-1))
  })

  it('rate limits requests per minute', async () => {
    const s = await user('Molly')
    await door(s, 'create', { shipName: 'Razorgirl' })
    const [me] = await sql<{ id: number }>("SELECT id FROM players WHERE name = 'Molly'")
    await runInDurableObject(stub(), async (_, state) => {
      state.storage.sql.exec('UPDATE requests SET minute_count = 60 WHERE user_id = ?', me.id)
    })
    const res = await api('/v1/door/state', { secret: s })
    expect(res.status).toBe(429)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('rate_limited')
  })
})
