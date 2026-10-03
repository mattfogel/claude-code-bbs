import { SELF, applyD1Migrations, env, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'

import { COMBAT, CLASS0, MARSHALS, SHIPS, holdsCost } from '../../plugin/shared/door/data'
import { plotCourse } from '../../plugin/shared/door/nav'
import type { DoorEvent, DoorMap, DoorNews, DoorReply, DoorStateReply } from '../../plugin/shared/door/protocol'
import { leadingZeroBits, powInput } from '../../plugin/shared/protocol'
import { marshalSectors } from '../src/door/engine/combat'
import { backRoomPassword } from '../src/door/engine/office'
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
    // Phase 2 commands are live: without a trader the answer is the same as for any command.
    expect(await door(secret, 'attack', { target: 'x', fighters: 1 }, 404)).toMatchObject({ error: { code: 'not_found', message: 'You have no trader in this Epoch yet.' } })
    expect(await door(secret, 'move', { path: [2], mode: 'alert' }, 404)).toMatchObject({ error: { code: 'not_found' } })
    expect((await api('/v1/door/photon', { secret, body: {} })).status).toBe(404)
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
    // Phase 2 items are on sale now; phase 3 and 4 items are not.
    const mine = await door(secret, 'outfit', { item: 'contact', qty: 1 })
    expect(mine.events[0]).toMatchObject({ kind: 'bought', what: 'Contact Mine', cost: 1000 })
    expect(mine.snapshot.ship.equipment.contactMines).toBe(1)
    expect(await door(secret, 'outfit', { item: 'cracker', qty: 1 }, 400)).toMatchObject({ error: { message: 'Not yet.' } })

    const scan = await door(secret, 'scan', { kind: 'density' })
    const rows = scan.events[0]
    expect(rows.kind === 'density' && rows.rows.map(r => r.sector)).toEqual(map.warps[drydock])
    await door(secret, 'scan', { kind: 'holo' }, 400)

    const bank = await door(secret, 'bank', { op: 'deposit', amount: 10_000 })
    expect(bank.snapshot).toMatchObject({ bank: 10_000, credits: 37_000 })
    await door(secret, 'bank', { op: 'withdraw', amount: 20_000 }, 400)

    const a = await door(secret, 'announce', { text: 'Buying |12Weights\u001b[2J cheap!' })
    expect(a.snapshot.credits).toBe(36_900)
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

describe('conflict', () => {
  type Mods = Partial<{
    fighters: number
    shields: number
    credits: number
    exp: number
    align: number
    type: number
    turns: number
    cargo: [number, number, number]
    equipment: Partial<PlayerRec['ship']['equipment']>
  }>
  type Pilot = { secret: string; id: number; name: string }

  const SEED = 2026
  let X = 0 // a quiet sector with nothing in it
  let Y = 0 // next door, both ways
  let W = 0 // another neighbor of X
  let lane = 0
  let port = 0 // an ordinary port that sells
  const pilots: Record<string, Pilot> = {}

  async function pilot(name: string): Promise<Pilot> {
    const secret = await user(name)
    const r = await door(secret, 'create', { shipName: `${name}'s Ship` })
    return (pilots[name] = { secret, id: r.snapshot.id, name })
  }

  /** Puts a pilot back to a known state: a fresh Freetrader, full turns, at `sector`. */
  async function reset(who: Pilot, sector: number, o: Mods = {}) {
    await runInDurableObject(stub(), async (_, state) => state.storage.sql.exec('DELETE FROM requests'))
    await patch(who.id, p => {
      p.sector = sector
      p.prevSector = sector
      p.turns = 250
      p.turnsAt = Date.now()
      p.credits = o.credits ?? 1000
      p.exp = o.exp ?? 100
      p.align = o.align ?? 0
      p.deadUntil = undefined
      p.paid = undefined
      p.limpet = undefined
      p.deaths = 0
      p.strikes = 0
      p.commissioned = false
      p.name = who.name
      const e = { contactMines: 0, limpets: 0, beacons: 0, seeds: 0, crackers: 0, deadman: 0, cloaks: 0, probes: 0, disruptors: 0, photons: 0, scanner: 'none' as const, planetScanner: false, lens: false, jump: 0 as const }
      p.ship = {
        type: o.type ?? 1, name: 'Test Ship', holds: 50, cargo: o.cargo ?? [0, 0, 0], colonists: 0, fighters: o.fighters ?? 100, shields: o.shields ?? 0,
        equipment: { ...e, ...o.equipment },
      }
    })
  }

  const stack = (sectorId: number, owner: Pilot, kind: string, count: number, mode = 'defensive', toll = 0) =>
    sql('INSERT INTO deploys (sector, owner_id, kind, count, mode, toll) VALUES (?, ?, ?, ?, ?, ?)', sectorId, owner.id, kind, count, mode, toll)
  const clear = async () => {
    await sql('DELETE FROM deploys')
    await sql('DELETE FROM bounties')
    await sql('DELETE FROM busts')
    await sql('DELETE FROM mail')
    await sql('DELETE FROM sectors WHERE id > 1')
    await runInDurableObject(stub(), async (_, state) => state.storage.sql.exec('DELETE FROM requests'))
  }
  const stateOf = async (who: Pilot) => (await (await api('/v1/door/state', { secret: who.secret })).json()) as DoorStateReply & { snapshot: NonNullable<DoorStateReply['snapshot']> }
  const find = <K extends DoorEvent['kind']>(events: DoorEvent[], kind: K) => events.find(e => e.kind === kind) as Extract<DoorEvent, { kind: K }>
  const core = (events: DoorEvent[]) => events.filter(e => e.kind !== 'message')
  const messages = (events: DoorEvent[]) => events.filter((e): e is Extract<DoorEvent, { kind: 'message' }> => e.kind === 'message')
  const texts = (events: DoorEvent[]) => events.filter((e): e is Extract<DoorEvent, { kind: 'text' }> => e.kind === 'text').map(e => e.text)
  const deploysAt = (sector: number) => sql<{ owner_id: number; kind: string; count: number; mode: string; toll: number }>('SELECT owner_id, kind, count, mode, toll FROM deploys WHERE sector = ? ORDER BY id', sector)
  const idOf = async (name: string) => (await sql<{ id: number }>('SELECT id FROM players WHERE name = ?', name))[0].id

  let drydock = 0

  beforeAll(async () => {
    drydock = map.concord[10]
    const busy = new Set((await sql<{ sector: number }>('SELECT sector FROM players')).map(r => r.sector))
    const noPort = new Set((await sql<{ sector: number }>('SELECT sector FROM ports UNION SELECT sector FROM planets')).map(r => r.sector))
    const plain = (s: number) => s > 10 && !map.concord.includes(s) && !map.lanes.includes(s) && !noPort.has(s) && !busy.has(s)
    for (let s = 11; s <= 150 && !X; s++) {
      if (!plain(s)) continue
      const both = map.warps[s].filter(t => plain(t) && map.warps[t].includes(s))
      if (both.length >= 2) [X, Y, W] = [s, both[0], both[1]]
    }
    expect(X).toBeGreaterThan(0)
    lane = map.lanes.find(s => !map.concord.includes(s)) ?? 0
    expect(lane).toBeGreaterThan(0)
    const sells = await sql<{ sector: number }>('SELECT sector FROM ports WHERE class BETWEEN 4 AND 6 ORDER BY sector')
    port = sells[0].sector
    for (const n of ['Ace', 'Bolt', 'Cole', 'Dove', 'Echo']) await pilot(n)
  })

  it('attacks a sleeping trader: shields, then fighters, salvage, pod, report in the mailbox and the log', async () => {
    const { Ace, Bolt } = pilots
    await clear()
    await reset(Ace, X, { fighters: 500, exp: 100 })
    await reset(Bolt, X, { fighters: 100, exp: 50, credits: 777, cargo: [10, 0, 0] })
    // Sleeping Bolt is on Ace's scope.
    const look = await door(Ace.secret, 'avoids', { set: [] })
    expect(look.here.traders.map(t => t.name)).toEqual(['Bolt'])

    await door(Ace.secret, 'attack', { target: 'Bolt', fighters: 0 }, 400)
    await door(Ace.secret, 'attack', { target: 'Bolt', fighters: 501 }, 400)
    await door(Ace.secret, 'attack', { target: 'Ace', fighters: 5 }, 400)
    await door(Ace.secret, 'attack', { target: 'Nobody', fighters: 5 }, 404)

    // 120 against 100 fighters: no flee (120 <= 125), certain kill (114+ > 100), no overkill (< 200).
    const r = await door(Ace.secret, 'attack', { target: 'bolt', fighters: 120 })
    const atk = find(r.events, 'attack')
    expect(atk).toMatchObject({ target: 'Bolt', sent: 120, lost: 100, killed: 100, shieldsLost: 0, destroyed: true, captured: false, fled: false, salvageCredits: 777 })
    expect(kinds(r.events)).toEqual(['attack', 'xp', 'text', 'xp'])
    expect(r.events[1]).toMatchObject({ kind: 'xp', exp: 4, reason: 'fighting' })
    expect(r.events[3]).toMatchObject({ kind: 'xp', exp: 5, reason: 'podding' })
    expect(texts(r.events)[0]).toContain('10')
    expect(r.snapshot).toMatchObject({ credits: 1777, experience: 109, blocked: false })
    expect(r.snapshot.ship.fighters).toBe(400)
    expect(r.snapshot.ship.cargo).toEqual([10, 0, 0])

    const b = await stateOf(Bolt)
    expect(messages(b.events)).toHaveLength(1)
    expect(messages(b.events)[0]).toMatchObject({ kind: 'message', from: 'Ace', type: 'report' })
    expect(messages(b.events)[0].text).toContain(`sector |14${X}`)
    expect(b.snapshot).toMatchObject({ credits: 0, experience: 45, timesBlownUp: 1 })
    expect(b.snapshot.ship).toMatchObject({ type: 0, fighters: 0, shields: 0, cargo: [0, 0, 0], holds: 5 })
    expect(b.snapshot.deadUntil).toBeUndefined()
    // The mailbox is emptied once delivered.
    expect(messages((await stateOf(Bolt)).events)).toHaveLength(0)

    const log = await sql<{ kind: string; text: string }>("SELECT kind, text FROM log WHERE kind IN ('podded', 'destroyed')")
    expect(log.at(-1)?.kind).toBe('podded')
    expect(log.at(-1)?.text).toContain('Bolt')
  })

  it('shields absorb before fighters, and an overwhelmed defender may slip away', async () => {
    const { Ace, Bolt } = pilots
    await clear()
    await reset(Ace, X, { fighters: 500 })
    await reset(Bolt, X, { fighters: 100, shields: 40 })
    // 100 into 40 shields + 100 fighters at 1:1: shields fall first, then 60 fighters.
    const r = await door(Ace.secret, 'attack', { target: 'Bolt', fighters: 100 })
    const atk = find(r.events, 'attack')
    expect(atk.fled).toBe(false)
    expect(atk.shieldsLost).toBeGreaterThanOrEqual(40)
    expect(atk.destroyed).toBe(false)
    expect(atk.shieldsLost + atk.killed).toBeGreaterThan(90)
    expect(r.snapshot.ship.fighters).toBe(500 - atk.lost)
    const b = await stateOf(Bolt)
    expect(b.snapshot.ship.shields).toBe(0)
    expect(b.snapshot.ship.fighters).toBe(100 - atk.killed)
    expect(messages(b.events)).toHaveLength(1)

    // Sending far more than 1.25 x (fighters + shields) draws a flee roll: gone, or dead.
    await reset(Bolt, X, { fighters: 10 })
    const big = await door(Ace.secret, 'attack', { target: 'Bolt', fighters: 100 })
    const ev = find(big.events, 'attack')
    if (ev.fled) {
      expect(ev).toMatchObject({ lost: 0, killed: 0, destroyed: false })
      const [row] = await sql<{ sector: number }>('SELECT sector FROM players WHERE id = ?', Bolt.id)
      expect(map.warps[X]).toContain(row.sector)
    } else expect(ev.destroyed).toBe(true)
  })

  it('gives no salvage for overkill', async () => {
    const { Ace, Bolt } = pilots
    await clear()
    await reset(Ace, X, { fighters: 5000, type: 4 })
    await reset(Bolt, X, { fighters: 100, credits: 900 })
    // A pod cannot flee, and 50 fighters at 1.6 odds is far more than the 0.6 it needs: nothing to salvage.
    await patch(Bolt.id, p => { p.ship.type = 0; p.ship.fighters = 0; p.ship.holds = 5 })
    const r = await door(Ace.secret, 'attack', { target: 'Bolt', fighters: 50 })
    const atk = find(r.events, 'attack')
    expect(atk).toMatchObject({ destroyed: true, killed: 0 })
    expect(atk.salvageCredits).toBeUndefined()
    expect(r.snapshot.credits).toBe(1000)
    // A pod that is killed is out until tomorrow.
    const b = await stateOf(Bolt)
    expect(b.snapshot.deadUntil).toBeTruthy()
  })

  it('kills a pod: dead until 00:00 UTC, every command but state refused, respawn at Haven', async () => {
    const { Ace, Bolt } = pilots
    await clear()
    await reset(Ace, X, { fighters: 500 })
    await reset(Bolt, X, { type: 0, fighters: 0, credits: 0, exp: 400, align: 20 })
    const r = await door(Ace.secret, 'attack', { target: 'Bolt', fighters: 10 })
    expect(find(r.events, 'attack')).toMatchObject({ destroyed: true })

    const dead = await stateOf(Bolt)
    expect(Date.parse(dead.snapshot.deadUntil!)).toBe((dayNumber(Date.now()) + 1) * 86_400_000)
    expect(dead.snapshot).toMatchObject({ experience: 200, alignment: 10 })
    expect(messages(dead.events)[0].text).toContain('Out until tomorrow')
    const refused = await door(Bolt.secret, 'move', { path: [Y], mode: 'alert' }, 400)
    expect(refused).toMatchObject({ error: { code: 'invalid' } })
    expect((refused as unknown as { error: { message: string } }).error.message).toContain('no shape to fly')
    await door(Bolt.secret, 'attack', { target: 'Ace', fighters: 1 }, 400)
    // She is off the scope while she is out.
    expect((await door(Ace.secret, 'avoids', { set: [] })).here.traders).toEqual([])
    expect((await sql('SELECT 1 FROM log WHERE kind = ?', 'destroyed')).length).toBeGreaterThan(0)

    // Tomorrow: the starting ship, starting credits, back at Haven; bank, experience and alignment stay.
    await patch(Bolt.id, p => { p.deadUntil = Date.now() - 1000; p.bank = 55 })
    const back = await stateOf(Bolt)
    expect(back.snapshot.deadUntil).toBeUndefined()
    expect(back.snapshot).toMatchObject({ sector: 1, credits: 300, bank: 55, experience: 200 })
    expect(back.snapshot.ship).toMatchObject({ type: 1, holds: 20, fighters: 30 })
    expect(back.events.some(e => e.kind === 'text')).toBe(true)
    await door(Bolt.secret, 'avoids', { set: [] })
  })

  it('makes a third death in a day fatal', async () => {
    const { Ace, Cole } = pilots
    await clear()
    await reset(Ace, X, { fighters: 3000, type: 4 })
    await reset(Cole, X, { fighters: 20 })
    await patch(Cole.id, p => { p.deaths = 2; p.deathDay = dayNumber(Date.now()) })
    const r = await door(Ace.secret, 'attack', { target: 'Cole', fighters: 24 })
    expect(find(r.events, 'attack')).toMatchObject({ destroyed: true })
    expect((await stateOf(Cole)).snapshot.deadUntil).toBeTruthy()
    await reset(Cole, 1)
  })

  it('protects good, new pilots in Concord Space and punishes the attacker', async () => {
    const { Ace, Bolt } = pilots
    await clear()
    await reset(Ace, 3, { fighters: 500, exp: 400, align: 100 })
    await reset(Bolt, 3, { fighters: 20, exp: 20 })
    await patch(Ace.id, p => { p.prevSector = 2 })
    const r = await door(Ace.secret, 'attack', { target: 'Bolt', fighters: 30 })
    expect(kinds(r.events)).toEqual(['text', 'text', 'text', 'xp', 'podded'])
    expect(r.events[3]).toEqual({ kind: 'xp', exp: -40, align: -10, reason: 'concord' })
    expect(r.events[4]).toMatchObject({ kind: 'podded', sector: 2, by: 'Marshal Ostrander' })
    expect(r.snapshot).toMatchObject({ sector: 2, experience: 360, alignment: 90 })
    expect(r.snapshot.ship.type).toBe(0)
    // Bolt was not touched.
    expect((await stateOf(Bolt)).snapshot.ship).toMatchObject({ type: 1, fighters: 20 })
    // Not protected once evil or experienced: the fight goes ahead.
    await reset(Ace, 3, { fighters: 500 })
    await patch(Bolt.id, p => { p.exp = 2000 })
    const ok = await door(Ace.secret, 'attack', { target: 'Bolt', fighters: 30 })
    expect(find(ok.events, 'attack')).toBeTruthy()
  })

  it('shows the Marshals in their sector and destroys whoever attacks one', async () => {
    const { Ace } = pilots
    await clear()
    let done = false
    for (let attempt = 0; attempt < 3 && !done; attempt++) {
      const where = marshalSectors(SEED, Date.now(), map.concord)
      await reset(Ace, where[0], { fighters: 500, exp: 100, align: 5 })
      await patch(Ace.id, p => { p.prevSector = 4 })
      const here = await stateOf(Ace)
      if (!here.here?.marshals.includes('Marshal Ostrander')) continue // the patrol moved on mid-test
      expect(map.concord).toContain(where[0])
      for (const m of MARSHALS) expect(m.density).toBeGreaterThan(400)
      const r = await door(Ace.secret, 'attack', { target: 'marshal ostrander', fighters: 100 })
      expect(r.events.some(e => e.kind === 'podded')).toBe(true)
      expect(r.snapshot).toMatchObject({ sector: 4, alignment: -5, experience: 90 })
      expect(r.snapshot.ship.type).toBe(0)
      done = true
    }
    expect(done).toBe(true)
  })

  it('reads Marshal density from a scan', async () => {
    const { Bolt } = pilots
    await clear()
    let ok = false
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      const where = marshalSectors(SEED, Date.now(), map.concord)
      const target = where[2]
      const from = map.warps.findIndex((w, s) => s > 0 && w.includes(target) && s !== target)
      await reset(Bolt, from, { equipment: { scanner: 'density' } })
      const r = await door(Bolt.secret, 'scan', { kind: 'density' })
      const row = (r.events[0] as Extract<DoorEvent, { kind: 'density' }>).rows.find(x => x.sector === target)!
      const sect = await sql<{ n: number }>('SELECT COUNT(*) AS n FROM ports WHERE sector = ?', target)
      const planets = await sql<{ n: number }>('SELECT COUNT(*) AS n FROM planets WHERE sector = ?', target)
      const others = marshalSectors(SEED, Date.now(), map.concord)
      const here = MARSHALS.reduce((a, m, i) => a + (others[i] === target ? m.density : 0), 0)
      if (here === 0) continue
      expect(row.density).toBeGreaterThanOrEqual(here + sect[0].n * 100 + planets[0].n * 500)
      ok = true
    }
    expect(ok).toBe(true)
  })

  it('refuses fighters, mines and beacons in Concord Space and on the lanes', async () => {
    const { Ace } = pilots
    await clear()
    await reset(Ace, 5, { equipment: { contactMines: 5, limpets: 5, beacons: 5 } })
    for (const where of [5, lane]) {
      await patch(Ace.id, p => { p.sector = where })
      await door(Ace.secret, 'deploy', { kind: 'fighters', count: 10, owner: 'personal', mode: 'defensive' }, 400)
      await door(Ace.secret, 'deploy', { kind: 'contact', count: 1, owner: 'personal' }, 400)
      await door(Ace.secret, 'deploy', { kind: 'limpet', count: 1, owner: 'personal' }, 400)
    }
    await patch(Ace.id, p => { p.sector = 5 })
    await door(Ace.secret, 'beacon', { text: 'hello' }, 400)
    expect(await sql('SELECT 1 FROM deploys')).toHaveLength(0)
  })

  it('deploys and collects fighters, one stack per sector, and not with a stranger in the room', async () => {
    const { Ace, Bolt } = pilots
    await clear()
    await reset(Ace, X, { fighters: 200 })
    await reset(Bolt, Y)
    await door(Ace.secret, 'deploy', { kind: 'fighters', count: 100, owner: 'corp', mode: 'defensive' }, 400)
    await door(Ace.secret, 'deploy', { kind: 'fighters', count: 100, owner: 'personal', mode: 'angry' }, 400)
    await door(Ace.secret, 'deploy', { kind: 'fighters', count: 201, owner: 'personal', mode: 'defensive' }, 400)
    const d = await door(Ace.secret, 'deploy', { kind: 'fighters', count: 100, owner: 'personal', mode: 'toll' })
    expect(d.events).toEqual([{ kind: 'deployed', what: 'fighters', count: 100, mode: 'toll' }])
    expect(d.snapshot.ship.fighters).toBe(100)
    expect(d.here.fighters).toEqual({ count: 100, owner: 'Ace', isYours: true, isCorp: false, mode: 'toll' })
    await door(Ace.secret, 'deploy', { kind: 'fighters', count: 20, owner: 'personal', mode: 'defensive' })
    expect(await deploysAt(X)).toEqual([{ owner_id: Ace.id, kind: 'fighters', count: 120, mode: 'defensive', toll: 0 }])

    // Density: 5 per fighter, read from next door.
    await patch(Bolt.id, p => { p.ship.equipment.scanner = 'density' })
    const scan = await door(Bolt.secret, 'scan', { kind: 'density' })
    const row = (scan.events[0] as Extract<DoorEvent, { kind: 'density' }>).rows.find(r => r.sector === X)!
    expect(row.density).toBe(600 + 40) // 120 fighters at 5 each, plus Ace's own ship at 40
    expect((await door(Bolt.secret, 'avoids', { set: [] })).here.fighters).toBeUndefined()

    // A stranger in the room blocks deployment; so does another's fighters.
    await patch(Bolt.id, p => { p.sector = X })
    await door(Ace.secret, 'deploy', { kind: 'fighters', count: 5, owner: 'personal', mode: 'defensive' }, 400)
    const theirs = await door(Bolt.secret, 'avoids', { set: [] })
    expect(theirs.here.fighters).toMatchObject({ count: 120, owner: 'Ace', isYours: false })
    await patch(Bolt.id, p => { p.sector = Y })
    await patch(Ace.id, p => { p.sector = X })

    const c = await door(Ace.secret, 'collect', { kind: 'fighters', count: 50 })
    expect(c.events).toEqual([{ kind: 'collected', what: 'fighters', count: 50 }])
    expect(c.snapshot.ship.fighters).toBe(130)
    const all = await door(Ace.secret, 'collect', { kind: 'fighters', count: 9999 })
    expect(all.events[0]).toMatchObject({ kind: 'collected', count: 70 })
    expect(await deploysAt(X)).toEqual([])
    await door(Ace.secret, 'collect', { kind: 'fighters', count: 1 }, 400)
  })

  it('stops a walk at hostile fighters, blocks moving, and lets you attack, retreat or surrender', async () => {
    const { Ace, Bolt } = pilots
    await clear()
    await reset(Ace, 1)
    await reset(Bolt, Y, { fighters: 500, credits: 800, cargo: [5, 5, 5] })
    await stack(X, Ace, 'fighters', 100, 'defensive')

    const r = await door(Bolt.secret, 'move', { path: [X, W], mode: 'express' })
    expect(kinds(r.events)).toEqual(['warp', 'fightersEncounter', 'stop'])
    expect(r.events[1]).toEqual({ kind: 'fightersEncounter', count: 100, owner: 'Ace', mode: 'defensive' })
    expect(r.events[2]).toEqual({ kind: 'stop', sector: X, reason: 'fighters' })
    expect(r.snapshot).toMatchObject({ sector: X, prevSector: Y, blocked: true })
    expect(r.here.fighters).toMatchObject({ count: 100, owner: 'Ace', isYours: false })
    await door(Bolt.secret, 'move', { path: [W], mode: 'express' }, 400)
    expect((await stateOf(Bolt)).snapshot.blocked).toBe(true)

    // Ace hears of it on her next request.
    const a = await stateOf(Ace)
    expect(messages(a.events).map(m => m.from)).toEqual(['Fighters'])
    expect(messages(a.events)[0].text).toContain('Bolt')

    // Attack: 50 fall, the stack holds, still blocked; then it is destroyed.
    const first = await door(Bolt.secret, 'attack', { target: '*fighters', fighters: 50 })
    const a1 = find(first.events, 'attack')
    // 50 sent at 1:1 with a 5% random factor: 47 to 52 fall, and the same number of ours.
    expect(a1).toMatchObject({ target: "Ace's fighters", sent: 50, destroyed: false })
    expect(a1.killed).toBeGreaterThanOrEqual(47)
    expect(a1.killed).toBeLessThanOrEqual(52)
    expect(a1.lost).toBe(a1.killed)
    expect(first.snapshot.blocked).toBe(true)
    const left = (await deploysAt(X))[0].count
    expect(left).toBe(100 - a1.killed)
    const second = await door(Bolt.secret, 'attack', { target: '*fighters', fighters: 60 })
    expect(find(second.events, 'attack')).toMatchObject({ lost: left, killed: left, destroyed: true })
    expect(second.snapshot).toMatchObject({ blocked: false })
    expect(second.snapshot.ship.fighters).toBe(500 - a1.lost - left)
    expect(second.here.fighters).toBeUndefined()
    await door(Bolt.secret, 'attack', { target: '*fighters', fighters: 5 }, 400)
    await door(Bolt.secret, 'move', { path: [W], mode: 'express' })
  })

  it('retreats to the previous sector for a turn, even at no turns, with no hazards', async () => {
    const { Ace, Bolt } = pilots
    await clear()
    await reset(Ace, 1)
    await reset(Bolt, Y)
    await stack(X, Ace, 'fighters', 100, 'defensive')
    await stack(Y, Ace, 'contact', 100)
    await door(Bolt.secret, 'retreat', {}, 400)
    await door(Bolt.secret, 'move', { path: [X], mode: 'express' })
    await patch(Bolt.id, p => { p.turns = 0 })
    const r = await door(Bolt.secret, 'retreat', {})
    expect(r.events).toEqual([{ kind: 'retreat', to: Y }])
    expect(r.snapshot).toMatchObject({ sector: Y, prevSector: X, turns: 0, blocked: false })
    // Mines in Y were already spent on the way in; the retreat did not touch them.
    expect((await deploysAt(Y))[0].count).toBe(100)

    await patch(Bolt.id, p => { p.sector = X; p.prevSector = Y; p.turns = 10 })
    const t = await door(Bolt.secret, 'retreat', {})
    expect(t.snapshot.turns).toBe(9)
  })

  it('surrenders: defensive fighters take the cargo, toll fighters the credits, and you may leave', async () => {
    const { Ace, Bolt } = pilots
    await clear()
    await reset(Ace, 1)
    await reset(Bolt, Y, { credits: 800, cargo: [5, 5, 5] })
    await stack(X, Ace, 'fighters', 100, 'defensive')
    await door(Bolt.secret, 'surrender', {}, 400)
    await door(Bolt.secret, 'move', { path: [X], mode: 'express' })
    const r = await door(Bolt.secret, 'surrender', {})
    expect(r.snapshot).toMatchObject({ blocked: false, credits: 800 })
    expect(r.snapshot.ship.cargo).toEqual([0, 0, 0])
    const out = await door(Bolt.secret, 'move', { path: [Y], mode: 'express' })
    expect(kinds(out.events)).toEqual(['warp', 'stop'])

    await sql("UPDATE deploys SET mode = 'toll' WHERE sector = ?", X)
    await patch(Bolt.id, p => { p.credits = 300 })
    const held = await door(Bolt.secret, 'move', { path: [X], mode: 'express' })
    expect(held.events[2]).toEqual({ kind: 'toll', amount: 500, paid: false })
    expect(held.snapshot.blocked).toBe(true)
    const paid = await door(Bolt.secret, 'surrender', {})
    expect(paid.events[0]).toEqual({ kind: 'toll', amount: 300, paid: true })
    expect(paid.snapshot).toMatchObject({ credits: 0, blocked: false })
    expect((await deploysAt(X))[0].toll).toBe(300)
  })

  it('collects a toll from passers-by', async () => {
    const { Ace, Bolt } = pilots
    await clear()
    await reset(Ace, X)
    await reset(Bolt, Y, { credits: 1000 })
    await stack(X, Ace, 'fighters', 100, 'toll')
    const r = await door(Bolt.secret, 'move', { path: [X, W], mode: 'express' })
    expect(kinds(r.events)).toEqual(['warp', 'fightersEncounter', 'toll', 'stop'])
    expect(r.events[2]).toEqual({ kind: 'toll', amount: 500, paid: true })
    expect(r.events[3]).toEqual({ kind: 'stop', sector: X, reason: 'toll' })
    expect(r.snapshot).toMatchObject({ credits: 500, blocked: false, sector: X })
    expect((await deploysAt(X))[0].toll).toBe(500)
    // Paid: carry on.
    const on = await door(Bolt.secret, 'move', { path: [W], mode: 'express' })
    expect(on.snapshot.sector).toBe(W)
    // The owner takes the toll with her fighters.
    const c = await door(Ace.secret, 'collect', { kind: 'fighters', count: 100 })
    expect(core(c.events)).toEqual([{ kind: 'collected', what: 'fighters', count: 100, credits: 500 }])
    expect(c.snapshot.credits).toBe(1500)
    // Her mailbox came with that reply: the toll report.
    expect(messages(c.events).map(m => m.text).join(' ')).toContain('paid')
  })

  it('has offensive fighters attack on entry; a weak ship is podded to the previous sector', async () => {
    const { Ace, Bolt } = pilots
    await clear()
    await reset(Ace, 1)
    await reset(Bolt, Y, { fighters: 100, shields: 50 })
    await stack(X, Ace, 'fighters', 10_000, 'offensive')
    const r = await door(Bolt.secret, 'move', { path: [X, W], mode: 'express' })
    expect(kinds(r.events)).toEqual(['warp', 'fightersEncounter', 'attacked', 'podded', 'stop'])
    expect(r.events[2]).toMatchObject({ kind: 'attacked', by: "Ace's fighters", damage: 150, lost: 100 })
    expect(r.events[3]).toEqual({ kind: 'podded', sector: Y, by: "Ace's fighters" })
    expect(r.events[4]).toEqual({ kind: 'stop', sector: Y, reason: 'fighters' })
    expect(r.snapshot).toMatchObject({ sector: Y, blocked: false })
    expect(r.snapshot.ship.type).toBe(0)
    const left = (await deploysAt(X))[0].count
    expect(left).toBeLessThan(10_000)
    expect(left).toBeGreaterThan(9_800)
    const a = await stateOf(Ace)
    expect(messages(a.events).length).toBeGreaterThanOrEqual(1)

    // A strong ship survives the same stack and is held.
    // An Ironclad with full fighters: 1.25 x its 10,750 at 1:1 cannot get through its 1.6 defense. It survives and is held.
    await reset(Bolt, Y, { type: 4, fighters: 10_000, shields: 750 })
    await sql('UPDATE deploys SET count = 100000 WHERE sector = ?', X)
    const s = await door(Bolt.secret, 'move', { path: [X], mode: 'express' })
    expect(kinds(s.events)).toEqual(['warp', 'fightersEncounter', 'attacked', 'stop'])
    expect(s.snapshot).toMatchObject({ blocked: true, sector: X })
    expect(s.snapshot.ship.type).toBe(4)
  })

  it('detonates half the contact mines on entry and spares their owner', async () => {
    const { Ace, Bolt } = pilots
    await clear()
    await reset(Ace, 1)
    await reset(Bolt, Y, { shields: 150 })
    await stack(X, Ace, 'contact', 10)
    const r = await door(Bolt.secret, 'move', { path: [X, W], mode: 'express' })
    expect(kinds(r.events)).toEqual(['warp', 'mines', 'stop'])
    expect(r.events[1]).toEqual({ kind: 'mines', detonated: 5, damage: 100 })
    expect(r.events[2]).toEqual({ kind: 'stop', sector: X, reason: 'mines' })
    expect(r.snapshot.ship).toMatchObject({ shields: 50, fighters: 100 })
    expect(r.here.mines).toEqual([{ kind: 'contact', count: 5, owner: 'Ace', isYours: false }])
    expect((await deploysAt(X))[0].count).toBe(5)
    expect(messages((await stateOf(Ace)).events)[0].text).toContain('5')

    // One mine is half rounded down: nothing happens.
    await sql('UPDATE deploys SET count = 1 WHERE sector = ?', X)
    await reset(Bolt, Y)
    expect(kinds((await door(Bolt.secret, 'move', { path: [X], mode: 'express' })).events)).toEqual(['warp', 'stop'])
    // The owner walks through her own.
    await sql('UPDATE deploys SET count = 40 WHERE sector = ?', X)
    await reset(Ace, Y)
    expect(kinds((await door(Ace.secret, 'move', { path: [X], mode: 'express' })).events)).toEqual(['warp', 'stop'])
    expect((await deploysAt(X))[0].count).toBe(40)
  })

  it('drops a pilot killed on the way: the rest of the path is dropped, fatal only for pods', async () => {
    const { Ace, Bolt } = pilots
    await clear()
    await reset(Ace, 1)
    await reset(Bolt, Y, { fighters: 10 })
    await stack(X, Ace, 'contact', 100)
    const r = await door(Bolt.secret, 'move', { path: [X, W], mode: 'express' })
    expect(kinds(r.events)).toEqual(['warp', 'mines', 'podded', 'stop'])
    expect(r.events[2]).toEqual({ kind: 'podded', sector: Y })
    expect(r.events[3]).toEqual({ kind: 'stop', sector: Y, reason: 'mines' })
    expect(r.snapshot).toMatchObject({ sector: Y, credits: 0 })
    expect(r.snapshot.ship.type).toBe(0)
    expect(r.snapshot.turns).toBe(250 - 3)

    // In the pod, the next try is the last.
    await sql('UPDATE deploys SET count = 100 WHERE sector = ?', X)
    const f = await door(Bolt.secret, 'move', { path: [X, W], mode: 'express' })
    expect(kinds(f.events)).toEqual(['warp', 'mines', 'dead', 'stop'])
    const dead = find(f.events, 'dead')
    expect(Date.parse(dead.until)).toBe((dayNumber(Date.now()) + 1) * 86_400_000)
    expect(f.events.at(-1)).toMatchObject({ kind: 'stop', reason: 'dead' })
    expect(f.snapshot.deadUntil).toBe(dead.until)
    expect(f.snapshot.sector).toBe(1)
  })

  it('takes NavHaz damage and stops, but never in Concord Space', async () => {
    const { Bolt } = pilots
    await clear()
    await reset(Bolt, Y, { type: 4, fighters: 500, shields: 750 })
    await sql('INSERT INTO sectors (id, navhaz) VALUES (?, 100)', X)
    const r = await door(Bolt.secret, 'move', { path: [X, W], mode: 'express' })
    expect(kinds(r.events)).toEqual(['warp', 'navhaz', 'stop'])
    expect(r.events[1]).toEqual({ kind: 'navhaz', damage: 1000 })
    expect(r.events[2]).toEqual({ kind: 'stop', sector: X, reason: 'navhaz' })
    expect(r.snapshot.ship).toMatchObject({ shields: 0, fighters: 250 })
    expect(r.here.navhaz).toBe(100)
  })

  it('deploys mines, collects them, and clamps limpets onto passing hulls', async () => {
    const { Ace, Bolt } = pilots
    await clear()
    await reset(Ace, X, { equipment: { contactMines: 20, limpets: 5 }, credits: 20_000 })
    await reset(Bolt, Y, { credits: 20_000 })
    await door(Ace.secret, 'deploy', { kind: 'contact', count: 21, owner: 'personal' }, 400)
    const m = await door(Ace.secret, 'deploy', { kind: 'contact', count: 10, owner: 'personal' })
    expect(m.events).toEqual([{ kind: 'deployed', what: 'contact mines', count: 10 }])
    expect(m.snapshot.ship.equipment.contactMines).toBe(10)
    expect(m.here.mines).toEqual([{ kind: 'contact', count: 10, owner: 'Ace', isYours: true }])
    await door(Ace.secret, 'deploy', { kind: 'limpet', count: 2, owner: 'personal' })
    const back = await door(Ace.secret, 'collect', { kind: 'contact', count: 4 })
    expect(back.events).toEqual([{ kind: 'collected', what: 'contact mines', count: 4 }])
    expect(back.snapshot.ship.equipment.contactMines).toBe(14)
    // Limpet scan needs a limpet on a hull.
    await door(Ace.secret, 'scan', { kind: 'limpet' }, 400)

    // Bolt enters: mines go off (3 of 6) and a limpet clamps on; the scan finds him anywhere.
    await patch(Bolt.id, p => { p.ship.shields = 500 })
    const r = await door(Bolt.secret, 'move', { path: [X], mode: 'express' })
    expect(kinds(r.events)).toEqual(['warp', 'limpet', 'mines', 'stop'])
    expect(r.snapshot.limpet).toBe(true)
    expect(r.here.mines.map(x => [x.kind, x.count])).toEqual([['contact', 3], ['limpet', 1]])
    await door(Bolt.secret, 'move', { path: [Y], mode: 'express' })
    const scan = await door(Ace.secret, 'scan', { kind: 'limpet' })
    expect(core(scan.events)).toEqual([{ kind: 'limpets', rows: [{ name: 'Bolt', sector: Y }] }])
    expect(scan.snapshot.turns).toBe(250)
    expect(messages(scan.events).some(x => x.text.includes('limpet'))).toBe(true)

    // A limpet shows as an anomaly on a density scan.
    await patch(Bolt.id, p => { p.ship.equipment.scanner = 'density' })
    const d = await door(Bolt.secret, 'scan', { kind: 'density' })
    const row = (d.events[0] as Extract<DoorEvent, { kind: 'density' }>).rows.find(x => x.sector === X)!
    expect(row.anomaly).toBe(true)
    expect(row.density).toBe(3 * 10 + 1 * 2 + 40) // mines, limpet, and Ace's own ship
  })

  it('removes a limpet at a Class 0 port or the Drydock for 5,000', async () => {
    const { Bolt } = pilots
    await clear()
    await reset(Bolt, 1, { credits: 12_000 })
    await door(Bolt.secret, 'class0', { removeLimpet: true }, 400)
    await patch(Bolt.id, p => { p.limpet = { id: 1, name: 'Ace' } })
    expect((await stateOf(Bolt)).snapshot.limpet).toBe(true)
    await patch(Bolt.id, p => { p.sector = X })
    await door(Bolt.secret, 'class0', { removeLimpet: true }, 400)
    await patch(Bolt.id, p => { p.sector = 1 })
    const r = await door(Bolt.secret, 'class0', { removeLimpet: true })
    expect(r.events).toEqual([{ kind: 'bought', what: 'limpet removal', qty: 1, cost: CLASS0.limpetRemoval }])
    expect(r.snapshot).toMatchObject({ limpet: false, credits: 7_000 })
    await patch(Bolt.id, p => { p.sector = drydock; p.limpet = { id: 1, name: 'Ace' }; p.credits = 4_999 })
    await door(Bolt.secret, 'class0', { removeLimpet: true }, 400)
    await patch(Bolt.id, p => { p.credits = 5_000 })
    expect((await door(Bolt.secret, 'class0', { removeLimpet: true })).snapshot).toMatchObject({ limpet: false, credits: 0 })
  })

  it('fires a mine disruptor next door: mines first, limpets last, at most 12', async () => {
    const { Ace, Bolt } = pilots
    await clear()
    await reset(Ace, 1)
    await reset(Bolt, X, { equipment: { disruptors: 2 } })
    await stack(Y, Ace, 'contact', 20)
    await stack(Y, Ace, 'limpet', 3)
    await door(Bolt.secret, 'disrupt', { sector: 99999 }, 400)
    const far = map.warps[X].includes(1) ? 150 : 1
    await door(Bolt.secret, 'disrupt', { sector: far }, 400)
    const r = await door(Bolt.secret, 'disrupt', { sector: Y })
    expect(r.events).toEqual([{ kind: 'disrupted', sector: Y, mines: 12, limpets: 0 }])
    expect(r.snapshot.ship.equipment.disruptors).toBe(1)
    expect((await deploysAt(Y)).map(d => [d.kind, d.count])).toEqual([['contact', 8], ['limpet', 3]])
    const again = await door(Bolt.secret, 'disrupt', { sector: Y })
    expect(again.events).toEqual([{ kind: 'disrupted', sector: Y, mines: 8, limpets: 3 }])
    expect(await deploysAt(Y)).toEqual([])
    await door(Bolt.secret, 'disrupt', { sector: Y }, 400)
    expect(messages((await stateOf(Ace)).events).length).toBeGreaterThanOrEqual(1)
  })

  it('leaves beacons: a second one cancels the first, none in Concord Space, text sanitized', async () => {
    const { Ace } = pilots
    await clear()
    await reset(Ace, X, { equipment: { beacons: 3 } })
    await door(Ace.secret, 'beacon', { text: '' }, 400)
    const long = '|12' + 'Mind the gap \u001b[2J '.repeat(6)
    const r = await door(Ace.secret, 'beacon', { text: long })
    expect(r.events[0]).toEqual({ kind: 'deployed', what: 'beacon', count: 1 })
    expect(r.here.beacon?.includes('\u001b')).toBe(false)
    expect(r.here.beacon!.replace(/\|\d\d/g, '').length).toBeLessThanOrEqual(41)
    expect(r.here.beacon!.startsWith('|12Mind the gap')).toBe(true)
    expect(r.snapshot.ship.equipment.beacons).toBe(2)
    const cancel = await door(Ace.secret, 'beacon', { text: 'second' })
    expect(cancel.here.beacon).toBeUndefined()
    expect(cancel.snapshot.ship.equipment.beacons).toBe(1)
    await door(Ace.secret, 'beacon', { text: 'third' })
    await patch(Ace.id, p => { p.ship.equipment.beacons = 0 })
    await door(Ace.secret, 'beacon', { text: 'fourth' }, 400)
  })

  it('sells the phase 2 items at the Drydock', async () => {
    const { Ace } = pilots
    await clear()
    await reset(Ace, drydock, { credits: 500_000 })
    const e = async (item: string, qty: number) => door(Ace.secret, 'outfit', { item, qty })
    expect((await e('beacon', 10)).snapshot.ship.equipment.beacons).toBe(10)
    expect((await e('deadman', 20)).snapshot.ship.equipment.deadman).toBe(20)
    expect((await e('contact', 5)).snapshot.ship.equipment.contactMines).toBe(5)
    expect((await e('limpet', 2)).snapshot.ship.equipment.limpets).toBe(2)
    const last = await e('disruptor', 3)
    expect(last.snapshot.ship.equipment.disruptors).toBe(3)
    expect(last.snapshot.credits).toBe(500_000 - 10 * 100 - 20 * 1_000 - 5 * 1_000 - 2 * 10_000 - 3 * 6_000)
    await door(Ace.secret, 'outfit', { item: 'beacon', qty: SHIPS[1].beacons }, 400)
  })

  describe('crime', () => {
    const setPort = (credits: number, amount?: number[]) =>
      sql('UPDATE ports SET credits = ?, amount = COALESCE(?, amount) WHERE sector = ?', credits, amount ? JSON.stringify(amount) : null, port)

    it('robs and steals only at ordinary ports, only when evil, for a turn each', async () => {
      const { Cole } = pilots
      await clear()
      await reset(Cole, port, { align: -99, exp: 300 })
      await door(Cole.secret, 'rob', { credits: 100 }, 400)
      await door(Cole.secret, 'steal', { commodity: 0, qty: 1 }, 400)
      await patch(Cole.id, p => { p.align = -100; p.sector = 1 })
      await door(Cole.secret, 'rob', { credits: 100 }, 400)
      await patch(Cole.id, p => { p.sector = port; p.turns = 0 })
      await door(Cole.secret, 'rob', { credits: 100 }, 400)
    })

    it('takes what the port holds when you ask for more, and busts nobody', async () => {
      const { Cole } = pilots
      await clear()
      await reset(Cole, port, { align: -300, exp: 0 })
      await setPort(1500)
      const r = await door(Cole.secret, 'rob', { credits: 99_999 })
      expect(r.events).toEqual([{ kind: 'robbed', credits: 1500 }])
      expect(r.snapshot).toMatchObject({ credits: 2500, turns: 249 })
      expect((await sql<{ credits: number }>('SELECT credits FROM ports WHERE sector = ?', port))[0].credits).toBe(0)
      expect(await sql('SELECT 1 FROM busts')).toHaveLength(0)
    })

    it('steals product the port is selling; more than is on dock takes what is there', async () => {
      const { Cole } = pilots
      await clear()
      await reset(Cole, port, { align: -300, exp: 0 })
      const [row] = await sql<{ mcic: string }>('SELECT mcic FROM ports WHERE sector = ?', port)
      const mcic = JSON.parse(row.mcic) as number[]
      const sells = [0, 1, 2].find(c => mcic[c] > 0)!
      const buys = [0, 1, 2].find(c => mcic[c] < 0)!
      await door(Cole.secret, 'steal', { commodity: buys, qty: 1 }, 400)
      const amount = [0, 0, 0]
      amount[sells] = 3
      await setPort(0, amount)
      const r = await door(Cole.secret, 'steal', { commodity: sells, qty: 5 })
      expect(r.events).toEqual([{ kind: 'stolen', commodity: sells, qty: 3 }])
      expect(r.snapshot.ship.cargo[sells]).toBe(3)
      await door(Cole.secret, 'steal', { commodity: sells, qty: 999 }, 400)
    })

    it('busts a greedy robber: 10% of experience and holds, remembered by the port; the next try always busts', async () => {
      const { Cole } = pilots
      await clear()
      await reset(Cole, port, { align: -300, exp: 3000, cargo: [10, 10, 10] })
      await setPort(900_000)
      // Over the safe 9,000 by 191,000 credits: the odds are a certainty.
      const r = await door(Cole.secret, 'rob', { credits: 200_000 })
      expect(r.events).toEqual([{ kind: 'busted', expLost: 300, holdsLost: 50 - 1 }])
      expect(r.snapshot).toMatchObject({ experience: 2700, credits: 1000 })
      expect(r.snapshot.ship.holds).toBe(1)
      expect(r.snapshot.ship.cargo.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(1)
      expect(await sql<{ player_id: number }>('SELECT player_id FROM busts WHERE sector = ?', port)).toEqual([{ player_id: Cole.id }])

      await patch(Cole.id, p => { p.ship.holds = 50 })
      const again = await door(Cole.secret, 'rob', { credits: 1 })
      expect(again.events).toEqual([{ kind: 'busted', expLost: 270, holdsLost: 10 }])
      expect(again.snapshot.alignment).toBe(-305)

      // A week later the port has forgotten.
      await sql('UPDATE busts SET ts = ts - ?', 8 * 86_400_000)
      await setPort(0)
      expect(kinds((await door(Cole.secret, 'rob', { credits: 50 })).events)).toEqual(['robbed'])
    })

    it('busts a greedy thief for 9% of the holds it tried to take', async () => {
      const { Cole } = pilots
      await clear()
      await reset(Cole, port, { align: -300, exp: 300 })
      const [row] = await sql<{ mcic: string }>('SELECT mcic FROM ports WHERE sector = ?', port)
      const sells = (JSON.parse(row.mcic) as number[]).findIndex(m => m > 0)
      await setPort(0, [500, 500, 500])
      // Safe is 10 holds; 40 is 30 over.
      const r = await door(Cole.secret, 'steal', { commodity: sells, qty: 40 })
      expect(r.events).toEqual([{ kind: 'busted', expLost: 30, holdsLost: 4 }])
      expect(r.snapshot.ship.holds).toBe(46)
    })
  })

  describe('the Marshal\'s Office, Old Sal and the Back Room', () => {
    it('keeps evil traders out of the Marshal\'s Office and requires the Drydock', async () => {
      const { Dove } = pilots
      await clear()
      await reset(Dove, X, { align: 600 })
      await door(Dove.secret, 'marshal', { op: 'wanted' }, 400)
      await patch(Dove.id, p => { p.sector = drydock; p.align = -51 })
      const r = await door(Dove.secret, 'marshal', { op: 'commission' })
      expect(kinds(r.events)).toEqual(['text', 'text'])
      expect(r.snapshot.commissioned).toBe(false)
    })

    it('commissions at +500 alignment (setting it to 1,000) and sells the Marshal\'s Cruiser', async () => {
      const { Dove } = pilots
      await clear()
      await reset(Dove, drydock, { align: 499, credits: 1_000_000 })
      const no = await door(Dove.secret, 'marshal', { op: 'commission' })
      expect(no.snapshot.commissioned).toBe(false)
      await door(Dove.secret, 'shipwright', { op: 'buy', ship: 9, name: 'Badge' }, 400)
      await patch(Dove.id, p => { p.align = 500 })
      const r = await door(Dove.secret, 'marshal', { op: 'commission' })
      expect(r.snapshot).toMatchObject({ commissioned: true, alignment: 1000 })
      const ship = await door(Dove.secret, 'shipwright', { op: 'buy', ship: 9, name: 'Badge' })
      expect(ship.snapshot.ship.type).toBe(9)
    })

    it('posts a reward, lists the most wanted, and pays the killer', async () => {
      const { Dove, Ace, Bolt } = pilots
      await clear()
      await reset(Dove, drydock, { align: 10, credits: 20_000 })
      await reset(Bolt, drydock, { align: -200, exp: 50, fighters: 10 })
      await reset(Ace, drydock, { align: 0, exp: 100, fighters: 600 })
      await door(Dove.secret, 'marshal', { op: 'reward', target: 'Ace', amount: 5_000 }, 400)
      await door(Dove.secret, 'marshal', { op: 'reward', target: 'Bolt', amount: 500 }, 400)
      await door(Dove.secret, 'marshal', { op: 'reward', target: 'Nobody', amount: 5_000 }, 404)
      const r = await door(Dove.secret, 'marshal', { op: 'reward', target: 'Bolt', amount: 5_500 })
      expect(r.snapshot).toMatchObject({ credits: 14_500, alignment: 15 })
      await door(Dove.secret, 'marshal', { op: 'reward', target: 'bolt', amount: 1_000 })
      const wanted = await door(Ace.secret, 'marshal', { op: 'wanted' })
      expect(wanted.events).toEqual([{ kind: 'wanted', rows: [{ name: 'Bolt', reward: 6_500 }] }])

      // Nothing to claim yet. Then Ace kills him (evil pilots are fair game even in Concord Space).
      expect(texts((await door(Ace.secret, 'marshal', { op: 'claim' })).events)).toHaveLength(1)
      const kill = await door(Ace.secret, 'attack', { target: 'Bolt', fighters: 12 })
      expect(find(kill.events, 'attack')).toMatchObject({ destroyed: true })
      expect(await sql('SELECT killer_id FROM bounties WHERE kind = ?', 'reward')).toEqual([{ killer_id: Ace.id }, { killer_id: Ace.id }])
      expect(find((await door(Dove.secret, 'marshal', { op: 'wanted' })).events, 'wanted').rows).toEqual([])
      const claim = await door(Ace.secret, 'marshal', { op: 'claim' })
      expect(texts(claim.events)[0]).toContain('6,500')
      expect(claim.snapshot.credits).toBeGreaterThanOrEqual(1000 + 6_500)
      expect(await sql('SELECT 1 FROM bounties')).toHaveLength(0)
      // The poster cannot claim her own reward by killing the mark herself.
      expect(texts((await door(Dove.secret, 'marshal', { op: 'claim' })).events)[0]).toContain('Nothing')
    })

    it('sells traces, the password and fortunes; takes a swear once a day', async () => {
      const { Dove, Echo } = pilots
      await clear()
      await reset(Echo, drydock, { credits: 20_000, exp: 40, align: 3 })
      await reset(Dove, 77, { align: 0 })
      const trace = await door(Echo.secret, 'sal', { op: 'trace', target: 'dove' })
      expect(trace.snapshot.credits).toBe(19_000)
      expect(texts(trace.events)[0]).toContain('sector |14' + 77)
      expect(texts((await door(Echo.secret, 'sal', { op: 'trace', target: 'Ghost' })).events)[0]).toContain('Never heard')
      const pw = await door(Echo.secret, 'sal', { op: 'password' })
      expect(texts(pw.events)[0]).toContain(backRoomPassword(SEED, Echo.id))
      expect(pw.snapshot.credits).toBe(19_000 - 1_000 - 5_000)
      expect(texts((await door(Echo.secret, 'sal', { op: 'fortune' })).events)).toHaveLength(1)
      const sw = await door(Echo.secret, 'sal', { op: 'swear' })
      expect(sw.snapshot).toMatchObject({ experience: 39, alignment: 2 })
      const again = await door(Echo.secret, 'sal', { op: 'swear' })
      expect(again.snapshot).toMatchObject({ experience: 39, alignment: 2 })
      await door(Echo.secret, 'sal', { op: 'dance' }, 400)
      await patch(Echo.id, p => { p.sector = X })
      await door(Echo.secret, 'sal', { op: 'fortune' }, 400)
    })

    it('guards the Back Room with the password: four wrong guesses a day cost you your ship', async () => {
      const { Echo } = pilots
      await clear()
      await reset(Echo, drydock, { credits: 900, exp: 1000, align: 0 })
      await patch(Echo.id, p => { p.prevSector = 12 })
      const bad = { password: 'wrong word', op: 'hit', target: 'Ace', amount: 1000 }
      const one = await door(Echo.secret, 'backroom', bad)
      expect(one.snapshot).toMatchObject({ credits: 900, experience: 1000 })
      const two = await door(Echo.secret, 'backroom', bad)
      expect(two.snapshot.credits).toBe(0)
      const three = await door(Echo.secret, 'backroom', bad)
      expect(three.snapshot.experience).toBe(500)
      const four = await door(Echo.secret, 'backroom', bad)
      expect(kinds(four.events)).toContain('podded')
      expect(four.snapshot).toMatchObject({ sector: 12 })
      expect(four.snapshot.ship.type).toBe(0)
      // Evil enough to be let in; good pilots are barred without a strike.
      await reset(Echo, drydock, { align: 101 })
      const barred = await door(Echo.secret, 'backroom', { password: backRoomPassword(SEED, Echo.id), op: 'collect' })
      expect(texts(barred.events).length).toBeGreaterThan(0)
      expect((await stateOf(Echo)).snapshot.ship.type).toBe(1)
    })

    it('posts hits, pays hits on kills, and sells aliases', async () => {
      const { Echo, Ace, Dove } = pilots
      await clear()
      await reset(Echo, drydock, { credits: 10_000, exp: 40, align: 0 })
      await reset(Ace, 40, {})
      const password = backRoomPassword(SEED, Echo.id)
      const hit = await door(Echo.secret, 'backroom', { password: password.toUpperCase(), op: 'hit', target: 'Ace', amount: 1_000 })
      expect(hit.snapshot).toMatchObject({ credits: 9_000, alignment: -4 })
      await door(Echo.secret, 'backroom', { password, op: 'hit', target: 'Ace', amount: 10 }, 400)
      await door(Echo.secret, 'backroom', { password, op: 'hit', target: 'Echo', amount: 1_000 }, 400)
      expect(await sql('SELECT kind, amount, killer_id FROM bounties')).toEqual([{ kind: 'hit', amount: 1_000, killer_id: null }])
      // Hits and rewards are separate pools.
      await sql('UPDATE bounties SET killer_id = ?', Dove.id)
      await reset(Dove, drydock, { align: 0 })
      const dp = backRoomPassword(SEED, Dove.id)
      const none = await door(Echo.secret, 'backroom', { password, op: 'collect' })
      expect(texts(none.events)[0]).toContain('No contracts')
      const paid = await door(Dove.secret, 'backroom', { password: dp, op: 'collect' })
      expect(texts(paid.events)[0]).toContain('1,000')
      expect(paid.snapshot.credits).toBe(2_000)
      expect((await door(Dove.secret, 'marshal', { op: 'claim' })).snapshot.credits).toBe(2_000)

      // An alias costs 1,000 + 10 per experience point, and pipe codes do not survive.
      await door(Echo.secret, 'backroom', { password, op: 'alias', alias: 'Ace' }, 409)
      await door(Echo.secret, 'backroom', { password, op: 'alias', alias: 'Commodore Vale' }, 409)
      await door(Echo.secret, 'backroom', { password, op: 'alias', alias: '|12  ' }, 400)
      const alias = await door(Echo.secret, 'backroom', { password, op: 'alias', alias: '|12Zed\u0007 One|03' })
      expect(alias.snapshot.name).toBe('Zed One')
      expect(alias.snapshot.credits).toBe(9_000 - 1_000 - 400)
      expect(alias.events[0]).toEqual({ kind: 'bought', what: 'new name', qty: 1, cost: 1_400 })
      await patch(Echo.id, p => { p.sector = 40 })
      expect((await door(Ace.secret, 'avoids', { set: [] })).here.traders.map(t => t.name)).toContain('Zed One')
      await door(Ace.secret, 'bank', { op: 'transfer', amount: 1, to: 'Zed One' }, 400)
      await patch(Echo.id, p => { p.name = 'Echo' })
    })
  })

  it('delivers the mailbox once, on the next reply, as report messages', async () => {
    const { Ace, Cole } = pilots
    await clear()
    await reset(Ace, X, { fighters: 500 })
    await reset(Cole, X, { fighters: 100 })
    await door(Ace.secret, 'attack', { target: 'Cole', fighters: 50 })
    const r = await door(Cole.secret, 'avoids', { set: [] })
    expect(messages(r.events)).toHaveLength(1)
    expect(r.events[0]).toMatchObject({ kind: 'message', from: 'Ace', type: 'report' })
    expect(messages((await door(Cole.secret, 'avoids', { set: [] })).events)).toHaveLength(0)
    // A failed command does not eat the mail.
    await door(Ace.secret, 'attack', { target: 'Cole', fighters: 50 })
    await door(Cole.secret, 'move', { path: [99999], mode: 'alert' }, 400)
    expect(messages((await stateOf(Cole)).events)).toHaveLength(1)
  })

  it('clears fighters, mines and beacons from the lanes and Concord Space at extern, and fades NavHaz', async () => {
    const { Ace } = pilots
    await clear()
    await reset(Ace, 1)
    await stack(lane, Ace, 'fighters', 10)
    await stack(lane, Ace, 'contact', 10)
    await stack(5, Ace, 'limpet', 4)
    await stack(X, Ace, 'fighters', 10)
    await sql('INSERT INTO sectors (id, beacon, navhaz) VALUES (?, ?, 10)', lane, 'Lane beacon')
    await sql('INSERT INTO sectors (id, beacon, navhaz) VALUES (?, ?, 10)', X, 'Quiet beacon')
    await sql("UPDATE meta SET value = value - 1 WHERE key = 'day'")
    await door(Ace.secret, 'avoids', { set: [] })
    expect(await deploysAt(lane)).toEqual([])
    expect(await deploysAt(5)).toEqual([])
    expect(await deploysAt(X)).toHaveLength(1)
    const rows = await sql<{ id: number; beacon: string | null; navhaz: number }>('SELECT id, beacon, navhaz FROM sectors WHERE id IN (?, ?) ORDER BY id', lane, X)
    const byId = Object.fromEntries(rows.map(r => [r.id, r]))
    expect(byId[lane]).toMatchObject({ beacon: null, navhaz: 10 - COMBAT.navhazDecay })
    expect(byId[X]).toMatchObject({ beacon: 'Quiet beacon', navhaz: 10 - COMBAT.navhazDecay })
    expect((await sql<{ beacon: string }>('SELECT beacon FROM sectors WHERE id = 1'))[0].beacon).toContain('Concord')
  })

  it('turns on an evil pilot in a Marshal\'s Cruiser who ends a move beside the wrong Marshal', async () => {
    const { Dove } = pilots
    await clear()
    let done = false
    for (let attempt = 0; attempt < 3 && !done; attempt++) {
      const target = marshalSectors(SEED, Date.now(), map.concord)[1]
      const from = map.warps.findIndex((w, s) => s > 0 && w.includes(target) && s !== target)
      await reset(Dove, from, { type: 9, align: -5, fighters: 10 })
      await patch(Dove.id, p => { p.prevSector = from })
      const r = await door(Dove.secret, 'move', { path: [target], mode: 'express' })
      if (!r.events.some(e => e.kind === 'podded')) {
        expect(r.snapshot.ship.type).toBe(9) // the patrol had already moved on
        continue
      }
      expect(kinds(r.events)).toEqual(['warp', 'text', 'text', 'podded', 'stop'])
      expect(r.snapshot.ship.type).toBe(0)
      expect(r.snapshot.sector).toBe(from)
      done = true
    }
    expect(done).toBe(true)
  })

  it('applies Deadman Charges to the killer', async () => {
    const { Ace, Cole } = pilots
    await clear()
    await reset(Ace, X, { fighters: 500, shields: 100 })
    await reset(Cole, X, { fighters: 100, equipment: { deadman: 5 } })
    const r = await door(Ace.secret, 'attack', { target: 'Cole', fighters: 120 })
    expect(find(r.events, 'attack').destroyed).toBe(true)
    expect(texts(r.events).some(t => t.includes('100'))).toBe(true)
    // 100 damage: shields first.
    expect(r.snapshot.ship.shields).toBe(0)
    expect(r.snapshot.ship.fighters).toBe(500 - 100)
    await reset(Cole, 1)
  })
})
