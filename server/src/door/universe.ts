// The Universe: one Durable Object per season ("s1", ...), holding the whole
// game in SQLite. It is single-threaded, so trades and moves never race. Each
// command loads the rows it needs, runs the pure engine, and writes back.
// The Big Bang runs in steps on the alarm; the same alarm publishes
// news.json (at most every 30 s) and, once, map.json.

import { DurableObject } from 'cloudflare:workers'

import {
  CLASS_DRYDOCK, CLASS_SPECIAL, DEFAULT_CONFIG, GAME, HAGGLE_TTL_MS, LAST_LIGHT, SHIPS, TERRA, TURN_COSTS, AWARDS,
  rankOf, rankTitle, type Commodity, type DoorConfig, type ItemId,
} from '../../../plugin/shared/door/data'
import {
  DOOR_LIMITS, doorMapKey, doorNewsKey,
  type DoorCommand, type DoorEvent, type DoorMap, type DoorNews, type DoorReply, type DoorStateReply, type KnownDelta,
  type PortReport, type SectorView, type TraderRanking,
} from '../../../plugin/shared/door/protocol'
import type { ApiError, ErrorCode } from '../../../plugin/shared/protocol'
import type { Env } from '../env'
import { bangResult, bangStep, startBang, type BangState, type Specials } from './engine/bigbang'
import { settleTurns, validPath, walk } from './engine/move'
import { gainXp, netWorth, newPlayer, toSnapshot } from './engine/player'
import { class0Prices, dayNumber, regenPort } from './engine/prices'
import { densityRow, portReport, sectorView, type SectorContents } from './engine/scan'
import { bankMove, buyClass0, buyItem, buyShip, renameShip, type Outcome } from './engine/shop'
import { activeEvent, offer, openDock, pendingOf, stepsOf, type TradeCtx } from './engine/trade'
import type { PlayerRec, PortRec, TradeSession } from './engine/types'

/** Never publish news.json more often than this. */
const NEWS_INTERVAL_MS = 30_000
/** Port rows written per alarm after the bang. */
const WRITE_CHUNK = 250
const JSON_META = { contentType: 'application/json; charset=utf-8' }
const MAP_CACHE = 'public, max-age=3600'
const NEWS_CACHE = 'public, max-age=30'
const CONCORD_BEACON = 'Concord Space. Concord Law is enforced.'

export type DoorUser = { id: number; handle: string }
export type BangRequest = { season: string; seed?: number; sectors?: number }

type Status = 'none' | 'banging' | 'ready'
type Fail = ApiError
type Done = { events: DoorEvent[]; known?: KnownDelta; session?: TradeSession | null }

const iso = (ms: number) => new Date(ms).toISOString()
const fail = (code: ErrorCode, message: string): Fail => ({ error: { code, message } })
const isFail = (x: unknown): x is Fail => !!x && typeof x === 'object' && 'error' in x
const isInt = (n: unknown): n is number => Number.isInteger(n)
const isCommodity = (n: unknown): n is Commodity => n === 0 || n === 1 || n === 2
const outcome = (o: Outcome): Done | Fail => (o.ok ? { events: o.events } : fail('invalid', o.message))

type PortRow = { sector: number; name: string; class: number; prod: string; mcic: string; amount: string; credits: number; updated_at: number }

const toPort = (r: PortRow): PortRec => ({
  sector: r.sector, name: r.name, class: r.class as PortRec['class'], prod: JSON.parse(r.prod), mcic: JSON.parse(r.mcic), amount: JSON.parse(r.amount), credits: r.credits, updatedAt: r.updated_at,
})

/** A game date: real UTC time, the year moved forward. */
function gameDate(ms: number): string {
  const d = new Date(ms)
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()]
  const mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]
  return `${wd} ${mo} ${String(d.getUTCDate()).padStart(2, '0')}, ${d.getUTCFullYear() + GAME.yearOffset}`
}

export class Universe extends DurableObject<Env> {
  private sql: SqlStorage
  private mapCache?: DoorMap
  private configCache?: DoorConfig

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.sql = ctx.storage.sql
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value);
      CREATE TABLE IF NOT EXISTS ports (sector INTEGER PRIMARY KEY, name TEXT NOT NULL, class INTEGER NOT NULL, prod TEXT NOT NULL, mcic TEXT NOT NULL,
        amount TEXT NOT NULL, credits INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sectors (id INTEGER PRIMARY KEY, beacon TEXT, navhaz INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS planets (id INTEGER PRIMARY KEY AUTOINCREMENT, sector INTEGER NOT NULL, name TEXT NOT NULL, class TEXT NOT NULL, owner TEXT, colonists INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS planets_sector ON planets (sector);
      CREATE TABLE IF NOT EXISTS players (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, sector INTEGER NOT NULL, exp INTEGER NOT NULL, align INTEGER NOT NULL,
        data TEXT NOT NULL, seen INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS players_sector ON players (sector);
      CREATE INDEX IF NOT EXISTS players_exp ON players (exp);
      CREATE TABLE IF NOT EXISTS explored (player_id INTEGER NOT NULL, sector INTEGER NOT NULL, PRIMARY KEY (player_id, sector)) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS reports (player_id INTEGER NOT NULL, sector INTEGER NOT NULL, report TEXT NOT NULL, PRIMARY KEY (player_id, sector)) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS trades (player_id INTEGER PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS requests (user_id INTEGER PRIMARY KEY, minute INTEGER NOT NULL, minute_count INTEGER NOT NULL, day INTEGER NOT NULL, day_count INTEGER NOT NULL);
    `)
  }

  // ---- meta ---------------------------------------------------------------

  private get<T extends string | number>(key: string, fallback: T): T {
    const row = this.sql.exec<{ value: T }>('SELECT value FROM meta WHERE key = ?', key).toArray()[0]
    return row ? row.value : fallback
  }

  private set(key: string, value: string | number) {
    this.sql.exec('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value)
  }

  private status = () => this.get<string>('status', 'none') as Status
  private season = () => this.get('season', '')
  private seed = () => this.get('seed', 0)

  private config(): DoorConfig {
    return (this.configCache ??= { ...DEFAULT_CONFIG, ...JSON.parse(this.get('config', '{}')) })
  }

  private map(): DoorMap {
    return (this.mapCache ??= JSON.parse(this.get('map', '{}')) as DoorMap)
  }

  private specials(): Specials {
    return JSON.parse(this.get('specials', '{}'))
  }

  // ---- the Big Bang -------------------------------------------------------

  /** Starts a Big Bang; it runs in steps on the alarm. Refuses if this season already exists. */
  async bigBang(req: BangRequest): Promise<{ ok: true; season: string; seed: number; sectors: number } | Fail> {
    if (this.status() !== 'none') return fail('taken', `Epoch ${req.season} already exists.`)
    const now = Date.now()
    const seed = isInt(req.seed) ? req.seed >>> 0 : crypto.getRandomValues(new Uint32Array(1))[0]
    const config: DoorConfig = { ...DEFAULT_CONFIG, sectors: Math.min(5000, Math.max(100, isInt(req.sectors) ? req.sectors : DEFAULT_CONFIG.sectors)) }
    this.set('season', req.season)
    this.set('seed', seed)
    this.set('config', JSON.stringify(config))
    this.configCache = undefined
    this.set('startedAt', now)
    this.set('bang', JSON.stringify(startBang(seed, config, now)))
    this.set('status', 'banging')
    await this.ctx.storage.setAlarm(now)
    return { ok: true, season: req.season, seed, sectors: config.sectors }
  }

  /** One step of the bang, then the writes, then going live. */
  private async bangAlarm() {
    const raw = this.get('bang', '')
    if (raw) {
      const s = JSON.parse(raw) as BangState
      if (s.phase !== 'done') {
        this.set('bang', JSON.stringify(bangStep(s)))
        return
      }
      // Done: write the ports in chunks; the rest goes in meta.
      const r = bangResult(s)
      const cursor = this.get('writeCursor', 0)
      for (const p of r.ports.slice(cursor, cursor + WRITE_CHUNK)) this.savePort(p)
      if (cursor + WRITE_CHUNK < r.ports.length) {
        this.set('writeCursor', cursor + WRITE_CHUNK)
        return
      }
      const map: DoorMap = { v: 1, season: this.season(), sectors: s.config.sectors, warps: r.warps, concord: r.concord, lanes: r.lanes, generatedAt: iso(Date.now()) }
      this.set('map', JSON.stringify(map))
      this.mapCache = map
      this.set('specials', JSON.stringify(r.specials))
      this.sql.exec('INSERT OR REPLACE INTO sectors (id, beacon, navhaz) VALUES (1, ?, 0)', CONCORD_BEACON)
      this.sql.exec('INSERT INTO planets (sector, name, class, owner, colonists) VALUES (1, ?, ?, NULL, ?)', 'Terra', 'T', TERRA.start)
      this.sql.exec("DELETE FROM meta WHERE key IN ('bang', 'writeCursor')")
      return
    }
    // Live: publish the map, open the doors.
    await this.env.FEED.put(doorMapKey(this.season()), this.get('map', '{}'), { httpMetadata: { ...JSON_META, cacheControl: MAP_CACHE } })
    this.set('status', 'ready')
    this.set('day', dayNumber(Date.now()))
    this.log('bang', `|11The Big Bang! |07Epoch ${this.season().slice(1)} begins: ${this.config().sectors} sectors.`)
    this.markDirtySync()
  }

  async alarm(): Promise<void> {
    if (this.status() === 'banging') {
      await this.bangAlarm()
      if (this.status() === 'banging') await this.ctx.storage.setAlarm(Date.now())
      else await this.schedule(Date.now())
      return
    }
    if (this.get('dirty', 0)) await this.publishNews()
  }

  // ---- publishing ---------------------------------------------------------

  private markDirtySync() {
    this.set('dirty', 1)
    this.set('seq', this.get('seq', 0) + 1)
  }

  private async markDirty() {
    this.markDirtySync()
    await this.schedule(Math.max(Date.now(), this.get('lastPublish', 0) + NEWS_INTERVAL_MS))
  }

  private async schedule(at: number) {
    const current = await this.ctx.storage.getAlarm()
    if (current === null || current > at) await this.ctx.storage.setAlarm(at)
  }

  private log(kind: string, text: string) {
    this.sql.exec('INSERT INTO log (ts, kind, text) VALUES (?, ?, ?)', Date.now(), kind, text)
    this.sql.exec('DELETE FROM log WHERE id <= (SELECT MAX(id) FROM log) - ?', DOOR_LIMITS.log)
  }

  /** news.json as it stands. */
  async news(): Promise<DoorNews> {
    const now = Date.now()
    const cfg = this.config()
    const startedAt = this.get('startedAt', now)
    const count = (q: string) => this.sql.exec<{ n: number }>(q).one().n
    const traders = count('SELECT COUNT(*) AS n FROM players')
    const good = count('SELECT COUNT(*) AS n FROM players WHERE align >= 0')
    const status: DoorNews['status'] = {
      title: GAME.title,
      season: this.season(),
      startedAt: iso(startedAt),
      ageDays: Math.floor((now - startedAt) / 86_400_000),
      sectors: cfg.sectors,
      ports: count('SELECT COUNT(*) AS n FROM ports'),
      planets: count('SELECT COUNT(*) AS n FROM planets'),
      traders,
      goodPct: traders ? Math.round((100 * good) / traders) : 100,
      hallucinations: 0,
      drifters: 0,
      turnsPerDay: cfg.turnsPerDay,
    }
    if (cfg.showDrydock && this.status() === 'ready') status.drydock = this.specials().drydock
    const top = this.sql.exec<{ data: string }>('SELECT data FROM players ORDER BY exp DESC, id LIMIT ?', DOOR_LIMITS.rankings).toArray()
    const rankings: TraderRanking[] = top.map(r => {
      const p = JSON.parse(r.data) as PlayerRec
      return { name: p.name, rank: rankOf(p.exp), title: rankTitle(p.exp, p.align), experience: p.exp, alignment: p.align, netWorth: netWorth(p) }
    })
    return {
      v: 1,
      season: this.season(),
      seq: this.get('seq', 0),
      generatedAt: iso(now),
      status,
      log: this.sql
        .exec<{ id: number; ts: number; kind: string; text: string }>('SELECT id, ts, kind, text FROM log ORDER BY id DESC LIMIT ?', DOOR_LIMITS.log)
        .toArray()
        .reverse()
        .map(r => ({ id: r.id, ts: iso(r.ts), kind: r.kind, text: r.text })),
      comm: [],
      rankings: { traders: rankings, corps: [] },
    }
  }

  private async publishNews() {
    const news = await this.news()
    await this.env.FEED.put(doorNewsKey(this.season()), JSON.stringify(news), { httpMetadata: { ...JSON_META, cacheControl: NEWS_CACHE } })
    this.set('dirty', 0)
    this.set('lastPublish', Date.now())
  }

  // ---- rows ---------------------------------------------------------------

  private port(sector: number): PortRec | undefined {
    const r = this.sql.exec<PortRow>('SELECT * FROM ports WHERE sector = ?', sector).toArray()[0]
    return r && toPort(r)
  }

  private savePort(p: PortRec) {
    this.sql.exec(
      'INSERT OR REPLACE INTO ports (sector, name, class, prod, mcic, amount, credits, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      p.sector, p.name, p.class, JSON.stringify(p.prod), JSON.stringify(p.mcic), JSON.stringify(p.amount), p.credits, p.updatedAt,
    )
  }

  private player(id: number): PlayerRec | undefined {
    const r = this.sql.exec<{ data: string }>('SELECT data FROM players WHERE id = ?', id).toArray()[0]
    return r && JSON.parse(r.data)
  }

  private savePlayer(p: PlayerRec, now: number) {
    this.sql.exec(
      `INSERT INTO players (id, name, sector, exp, align, data, seen) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, sector = excluded.sector, exp = excluded.exp, align = excluded.align, data = excluded.data, seen = excluded.seen`,
      p.id, p.name, p.sector, p.exp, p.align, JSON.stringify(p), now,
    )
  }

  private session(playerId: number, now: number): TradeSession | undefined {
    const r = this.sql.exec<{ data: string }>('SELECT data FROM trades WHERE player_id = ?', playerId).toArray()[0]
    if (!r) return undefined
    const s = JSON.parse(r.data) as TradeSession
    return now - s.at > HAGGLE_TTL_MS ? undefined : s
  }

  private saveSession(playerId: number, s: TradeSession | null) {
    if (s) this.sql.exec('INSERT OR REPLACE INTO trades (player_id, data) VALUES (?, ?)', playerId, JSON.stringify(s))
    else this.sql.exec('DELETE FROM trades WHERE player_id = ?', playerId)
  }

  /** What is in a sector, as `me` sees it. Ports are shown with regeneration settled (not saved). */
  private contents(id: number, meId: number, now: number): SectorContents {
    const map = this.map()
    const row = this.sql.exec<{ beacon: string | null; navhaz: number }>('SELECT beacon, navhaz FROM sectors WHERE id = ?', id).toArray()[0]
    const port = this.port(id)
    if (port) regenPort(port, now, this.config().portRegenPct)
    const c: SectorContents = {
      id,
      warps: map.warps[id] ?? [],
      concord: map.concord.includes(id),
      navhaz: row?.navhaz ?? 0,
      port,
      planets: this.sql
        .exec<{ id: number; name: string; class: string; owner: string | null }>('SELECT id, name, class, owner FROM planets WHERE sector = ? ORDER BY id', id)
        .toArray()
        .map(p => (p.owner ? { id: p.id, name: p.name, class: p.class, owner: p.owner } : { id: p.id, name: p.name, class: p.class })),
      traders: this.sql
        .exec<{ data: string }>('SELECT data FROM players WHERE sector = ? AND id != ? ORDER BY name', id, meId)
        .toArray()
        .map(r => {
          const p = JSON.parse(r.data) as PlayerRec
          return { name: p.name, ship: p.ship.name, shipType: p.ship.type, fighters: p.ship.fighters }
        }),
    }
    if (row?.beacon) c.beacon = row.beacon
    return c
  }

  /** Marks sectors explored and records port reports seen there. */
  private learn(playerId: number, sectors: SectorContents[], now: number): KnownDelta {
    const known: KnownDelta = { explored: [], ports: [] }
    const seenAt = iso(now)
    for (const c of sectors) {
      this.sql.exec('INSERT OR IGNORE INTO explored (player_id, sector) VALUES (?, ?)', playerId, c.id)
      if (!known.explored.includes(c.id)) known.explored.push(c.id)
      const report = c.port && portReport(c.port, seenAt)
      if (report) {
        this.sql.exec('INSERT OR REPLACE INTO reports (player_id, sector, report) VALUES (?, ?, ?)', playerId, c.id, JSON.stringify(report))
        known.ports.push(report)
      }
    }
    return known
  }

  private fullKnown(playerId: number): KnownDelta {
    return {
      explored: this.sql.exec<{ sector: number }>('SELECT sector FROM explored WHERE player_id = ? ORDER BY sector', playerId).toArray().map(r => r.sector),
      ports: this.sql.exec<{ report: string }>('SELECT report FROM reports WHERE player_id = ? ORDER BY sector', playerId).toArray().map(r => JSON.parse(r.report) as PortReport),
    }
  }

  // ---- gates: status, maintenance, rate limits -----------------------------

  private gate(): Fail | undefined {
    const s = this.status()
    if (s === 'banging') return fail('busy', 'The Big Bang is under way. Try again in a minute.')
    if (s !== 'ready') return fail('closed', 'No Epoch is running yet.')
    return undefined
  }

  /** Lazy daily maintenance: the first request after 00:00 UTC. */
  private maintain(now: number) {
    const today = dayNumber(now)
    if (this.get('day', today) >= today) return
    this.set('day', today)
    this.log('day', `|08-=-=- ${gameDate(now)} -=-=-`)
    this.sql.exec('DELETE FROM requests WHERE day < ?', today)
    this.markDirtySync()
  }

  /** Counts a request; refuses over the per-minute or daily cap. Returns today's count. */
  private takeRequest(userId: number, now: number): number | Fail {
    const minute = Math.floor(now / 60_000)
    const day = dayNumber(now)
    const r = this.sql.exec<{ minute: number; minute_count: number; day: number; day_count: number }>('SELECT minute, minute_count, day, day_count FROM requests WHERE user_id = ?', userId).toArray()[0]
    const mCount = r && r.minute === minute ? r.minute_count : 0
    const dCount = r && r.day === day ? r.day_count : 0
    if (mCount >= DOOR_LIMITS.perMinute) return fail('rate_limited', 'Slow down, pilot. Too many requests this minute.')
    if (dCount >= this.config().dailyRequestCap) return fail('rate_limited', 'That\'s all the flying for today. Come back tomorrow.')
    this.sql.exec('INSERT OR REPLACE INTO requests (user_id, minute, minute_count, day, day_count) VALUES (?, ?, ?, ?, ?)', userId, minute, mCount + 1, day, dCount + 1)
    return dCount + 1
  }

  /** Settles turns and the once-a-day login award. */
  private settle(p: PlayerRec, now: number, events: DoorEvent[]) {
    const t = settleTurns(p.turns, p.turnsAt, now, this.config())
    p.turns = t.turns
    p.turnsAt = t.turnsAt
    const today = dayNumber(now)
    if (p.lastDay < today) {
      p.lastDay = today
      gainXp(p, AWARDS.dailyLogin.exp, AWARDS.dailyLogin.align, 'daily', events)
    }
  }

  private reply(p: PlayerRec, now: number, requests: number, events: DoorEvent[], known: KnownDelta, session?: TradeSession): DoorReply {
    const r: DoorReply = { ok: true, snapshot: toSnapshot(p, this.season(), this.config(), requests), here: sectorView(this.contents(p.sector, p.id, now)), events, known }
    if (session && session.sector === p.sector) {
      const port = this.port(session.sector)
      const pending = port && pendingOf(session, this.tradeCtx(port, p, now))
      if (pending) r.pending = pending
    }
    return r
  }

  private tradeCtx(port: PortRec, player: PlayerRec, now: number): TradeCtx {
    return { port, player, seed: this.seed(), day: dayNumber(now), now }
  }

  // ---- public RPC -----------------------------------------------------------

  /** GET /v1/door/state. */
  async state(user: DoorUser): Promise<DoorStateReply | Fail> {
    const blocked = this.gate()
    if (blocked) return blocked
    const now = Date.now()
    this.maintain(now)
    const requests = this.takeRequest(user.id, now)
    if (isFail(requests)) return requests
    const p = this.player(user.id)
    if (!p) return { ok: true, created: false, events: [], known: { explored: [], ports: [] } }
    const events: DoorEvent[] = []
    this.settle(p, now, events)
    const session = this.session(p.id, now)
    const active = activeEvent(session)
    if (active) events.push(active)
    const reply = this.reply(p, now, requests, events, this.fullKnown(p.id), session)
    // The snapshot carries the last log entry seen before this visit; from now on it's the newest.
    p.lastSeenLog = this.sql.exec<{ id: number | null }>('SELECT MAX(id) AS id FROM log').one().id ?? 0
    this.savePlayer(p, now)
    if (this.get('dirty', 0)) await this.schedule(Math.max(now, this.get('lastPublish', 0) + NEWS_INTERVAL_MS))
    return { ...reply, created: true }
  }

  /** POST /v1/door/<command>. `req` is the parsed body; user text is already sanitized by the Worker. */
  async command(user: DoorUser, cmd: DoorCommand, req: Record<string, unknown>): Promise<DoorReply | Fail> {
    const blocked = this.gate()
    if (blocked) return blocked
    const now = Date.now()
    this.maintain(now)
    const requests = this.takeRequest(user.id, now)
    if (isFail(requests)) return requests

    if (cmd === 'create') {
      const r = this.create(user, req, now, requests)
      if (!isFail(r)) await this.schedule(Math.max(now, this.get('lastPublish', 0) + NEWS_INTERVAL_MS))
      return r
    }
    const p = this.player(user.id)
    if (!p) return fail('not_found', 'You have no trader in this Epoch yet.')
    const events: DoorEvent[] = []
    this.settle(p, now, events)
    let session = this.session(p.id, now)

    const r = this.run(cmd, p, req, now, session)
    if (isFail(r)) return r
    events.push(...r.events)
    if (r.session !== undefined) {
      session = r.session ?? undefined
      this.saveSession(p.id, r.session)
    }
    p.actions++
    this.savePlayer(p, now)
    if (this.get('dirty', 0)) await this.schedule(Math.max(now, this.get('lastPublish', 0) + NEWS_INTERVAL_MS))
    return this.reply(p, now, requests, events, r.known ?? { explored: [], ports: [] }, session)
  }

  private run(cmd: DoorCommand, p: PlayerRec, req: Record<string, unknown>, now: number, session: TradeSession | undefined): Done | Fail {
    switch (cmd) {
      case 'move': return this.move(p, req, now)
      case 'dock': return this.dock(p, now)
      case 'offer': return this.offer(p, req, now, session)
      case 'skip': return { events: [], session: null }
      case 'class0': return this.class0(p, req, now)
      case 'outfit': return this.atDrydock(p) ?? outcome(buyItem(p, req.item as ItemId, req.qty as number))
      case 'shipwright': return this.shipwright(p, req, now)
      case 'bank': return this.bank(p, req)
      case 'announce': return this.announce(p, req)
      case 'scan': return this.scan(p, req, now)
      case 'probe': return this.probe(p, req, now)
      case 'avoids': return this.avoids(p, req)
      default: return fail('invalid', 'Not yet.')
    }
  }

  // ---- commands -----------------------------------------------------------

  private create(user: DoorUser, req: Record<string, unknown>, now: number, requests: number): DoorReply | Fail {
    if (this.player(user.id)) return fail('taken', 'You already fly in this Epoch.')
    const shipName = typeof req.shipName === 'string' ? req.shipName : ''
    if (!shipName) return fail('invalid', 'Name your ship.')
    const p = newPlayer(user.id, user.handle, shipName, this.config(), now)
    p.lastSeenLog = this.sql.exec<{ id: number | null }>('SELECT MAX(id) AS id FROM log').one().id ?? 0
    const known = this.learn(p.id, [this.contents(1, p.id, now)], now)
    this.log('join', `|10${p.name} |07takes the helm of the |11${shipName}|07.`)
    this.savePlayer(p, now)
    this.markDirtySync()
    return this.reply(p, now, requests, [], known)
  }

  private move(p: PlayerRec, req: Record<string, unknown>, now: number): Done | Fail {
    const map = this.map()
    const cfg = this.config()
    const path = req.path
    const mode = req.mode === 'express' ? 'express' : req.mode === 'alert' ? 'alert' : undefined
    if (!mode || !Array.isArray(path) || !path.length || path.length > cfg.maxCourse || !path.every(isInt)) return fail('invalid', 'Expected {path: sector[], mode: alert|express}.')
    if (!validPath(map.warps, p.sector, path as number[])) return fail('invalid', 'That course does not follow the warps.')
    const hops = path as number[]
    // One query per kind for the whole path: what could stop an alert-mode autopilot.
    const marks = hops.map(() => '?').join(',')
    const ports = new Set(this.sql.exec<{ sector: number }>(`SELECT sector FROM ports WHERE sector IN (${marks})`, ...hops).toArray().map(r => r.sector))
    const planets = new Set(this.sql.exec<{ sector: number }>(`SELECT sector FROM planets WHERE sector IN (${marks})`, ...hops).toArray().map(r => r.sector))
    const traders = new Set(this.sql.exec<{ sector: number }>(`SELECT sector FROM players WHERE id != ? AND sector IN (${marks})`, p.id, ...hops).toArray().map(r => r.sector))
    const w = walk({
      warps: map.warps,
      from: p.sector,
      path: hops,
      mode,
      turns: p.turns,
      turnsPerWarp: SHIPS[p.ship.type].turnsPerWarp,
      flags: s => ({ port: ports.has(s), planet: planets.has(s), trader: traders.has(s) }),
    })
    p.turns -= w.turnsUsed
    if (w.visited.length) {
      p.prevSector = w.prev
      p.sector = w.sector
    }
    const seen = w.visited.map(s => (s === w.sector || ports.has(s) ? this.contents(s, p.id, now) : { id: s, warps: [], concord: false, navhaz: 0, planets: [], traders: [] }))
    return { events: w.events, known: this.learn(p.id, seen, now), session: null }
  }

  private dock(p: PlayerRec, now: number): Done | Fail {
    const port = this.port(p.sector)
    if (!port) return fail('invalid', 'There is no port in this sector.')
    if (p.turns < TURN_COSTS.dock) return fail('invalid', 'You don\'t have any turns left.')
    p.turns -= TURN_COSTS.dock
    if (port.class === CLASS_SPECIAL) {
      const prices = class0Prices(dayNumber(now))
      return { events: [{ kind: 'class0', holdPrice: prices.holdBase + 20 * p.ship.holds, fighterPrice: prices.fighter, shieldPrice: prices.shield }], session: null }
    }
    if (port.class === CLASS_DRYDOCK) return { events: [{ kind: 'text', text: `You dock at ${port.name}.` }], session: null }
    regenPort(port, now, this.config().portRegenPct)
    this.savePort(port)
    const session = openDock(port, p, p.actions, now)
    const report = portReport(port, iso(now))!
    this.sql.exec('INSERT OR REPLACE INTO reports (player_id, sector, report) VALUES (?, ?, ?)', p.id, p.sector, JSON.stringify(report))
    const steps = stepsOf(session, this.tradeCtx(port, p, now))
    return {
      events: [{ kind: 'dock', report, turnsLeft: p.turns, steps }],
      known: { explored: [], ports: [report] },
      session: steps.length ? session : null,
    }
  }

  private offer(p: PlayerRec, req: Record<string, unknown>, now: number, session: TradeSession | undefined): Done | Fail {
    if (!isCommodity(req.commodity) || !isInt(req.qty) || !isInt(req.price)) return fail('invalid', 'Expected {commodity, qty, price}.')
    if (!session || session.sector !== p.sector) return fail('invalid', 'You are not docked at a port.')
    const port = this.port(p.sector)
    if (!port) return fail('invalid', 'There is no port in this sector.')
    const r = offer(session, this.tradeCtx(port, p, now), { commodity: req.commodity, qty: req.qty, price: req.price })
    if (!r.ok) return fail('invalid', r.message)
    this.savePort(port)
    return { events: r.events, session: r.done ? null : session }
  }

  private class0(p: PlayerRec, req: Record<string, unknown>, now: number): Done | Fail {
    if (this.port(p.sector)?.class !== CLASS_SPECIAL) return fail('invalid', 'Holds, fighters and shields are sold at Haven, Meridian and Tycho Reach.')
    if (req.removeLimpet) return fail('invalid', 'There is no limpet on your hull.')
    const n = (k: string) => (req[k] === undefined ? undefined : (req[k] as number))
    return outcome(buyClass0(p, { holds: n('holds'), fighters: n('fighters'), shields: n('shields') }, dayNumber(now)))
  }

  private atDrydock(p: PlayerRec): Fail | undefined {
    return this.specials().drydock === p.sector ? undefined : fail('invalid', 'You need to be at the Drydock for that.')
  }

  private shipwright(p: PlayerRec, req: Record<string, unknown>, now: number): Done | Fail {
    const away = this.atDrydock(p)
    if (away) return away
    const name = typeof req.name === 'string' ? req.name : ''
    if (req.op === 'buy') {
      if (!isInt(req.ship) || !name) return fail('invalid', 'Expected {op: buy, ship, name}.')
      const r = outcome(buyShip(p, req.ship, name, dayNumber(now)))
      if (!isFail(r)) this.log('ship', `|10${p.name} |07commissions the |11${name}|07, a new ${SHIPS[req.ship].name}.`)
      return r
    }
    if (req.op === 'rename') return name ? outcome(renameShip(p, name)) : fail('invalid', 'Expected {op: rename, name}.')
    if (req.op === 'sell') return fail('invalid', 'You have no other ships docked here.')
    return fail('invalid', 'Expected op buy, sell or rename.')
  }

  private bank(p: PlayerRec, req: Record<string, unknown>): Done | Fail {
    const away = this.atDrydock(p)
    if (away) return away
    const amount = req.amount as number
    if (req.op === 'deposit' || req.op === 'withdraw') return outcome(bankMove(p, req.op, amount, this.config()))
    if (req.op !== 'transfer') return fail('invalid', 'Expected op deposit, withdraw or transfer.')
    if (!isInt(amount) || amount < 1) return fail('invalid', 'How much?')
    if (amount > p.bank) return fail('invalid', 'You don\'t have that much on deposit.')
    const row = typeof req.to === 'string' ? this.sql.exec<{ id: number }>('SELECT id FROM players WHERE name = ?', req.to).toArray()[0] : undefined
    const to = row && this.player(row.id)
    if (!to || to.id === p.id) return fail('not_found', 'No such trader in this Epoch.')
    if (to.bank + amount > this.config().maxBank) return fail('invalid', `That would put ${to.name} over the deposit limit.`)
    p.bank -= amount
    to.bank += amount
    this.savePlayer(to, Date.now())
    return { events: [{ kind: 'text', text: `${amount.toLocaleString('en-US')} credits sent to ${to.name}. Your balance is ${p.bank.toLocaleString('en-US')}.` }] }
  }

  private announce(p: PlayerRec, req: Record<string, unknown>): Done | Fail {
    const away = this.atDrydock(p)
    if (away) return away
    const text = typeof req.text === 'string' ? req.text : ''
    if (!text) return fail('invalid', 'Announce what?')
    if (p.credits < LAST_LIGHT.announceCost) return fail('invalid', `An announcement costs ${LAST_LIGHT.announceCost} credits.`)
    p.credits -= LAST_LIGHT.announceCost
    this.log('announce', `|14${p.name}|07: ${text}`)
    this.markDirtySync()
    return { events: [{ kind: 'bought', what: 'announcement', qty: 1, cost: LAST_LIGHT.announceCost }] }
  }

  private scan(p: PlayerRec, req: Record<string, unknown>, now: number): Done | Fail {
    const scanner = p.ship.equipment.scanner
    const neighbors = this.map().warps[p.sector] ?? []
    if (req.kind === 'density') {
      if (scanner === 'none') return fail('invalid', 'You have no long range scanner.')
      return { events: [{ kind: 'density', rows: neighbors.map(s => densityRow(this.contents(s, p.id, now))) }] }
    }
    if (req.kind === 'holo') {
      if (scanner !== 'holo') return fail('invalid', 'You have no holo scanner.')
      if (p.turns < TURN_COSTS.holo) return fail('invalid', 'You don\'t have any turns left.')
      p.turns -= TURN_COSTS.holo
      const seen = neighbors.map(s => this.contents(s, p.id, now))
      return { events: [{ kind: 'holo', sectors: seen.map(sectorView) }], known: this.learn(p.id, seen, now) }
    }
    return fail('invalid', 'Expected {kind: density|holo}.')
  }

  private probe(p: PlayerRec, req: Record<string, unknown>, now: number): Done | Fail {
    const path = req.path
    if (!Array.isArray(path) || !path.length || path.length > this.config().maxCourse || !path.every(isInt)) return fail('invalid', 'Expected {path: sector[]}.')
    if (p.ship.equipment.probes < 1) return fail('invalid', 'You have no Ghost Probes.')
    if (!validPath(this.map().warps, p.sector, path as number[])) return fail('invalid', 'That course does not follow the warps.')
    p.ship.equipment.probes--
    const seen = (path as number[]).map(s => this.contents(s, p.id, now))
    return { events: [{ kind: 'probe', path: path as number[], sectors: seen.map(sectorView) }], known: this.learn(p.id, seen, now) }
  }

  private avoids(p: PlayerRec, req: Record<string, unknown>): Done | Fail {
    const set = req.set
    const n = this.config().sectors
    if (!Array.isArray(set) || !set.every(s => isInt(s) && s >= 1 && s <= n)) return fail('invalid', 'Expected {set: sector[]}.')
    const unique = [...new Set(set as number[])].sort((a, b) => a - b)
    if (unique.length > DOOR_LIMITS.avoids) return fail('invalid', `At most ${DOOR_LIMITS.avoids} avoids.`)
    p.avoids = unique
    return { events: [] }
  }
}
