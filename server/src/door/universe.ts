// The Universe: one Durable Object per season ("s1", ...), holding the whole
// game in SQLite. It is single-threaded, so trades and moves never race. Each
// command loads the rows it needs, runs the pure engine, and writes back.
// The Big Bang runs in steps on the alarm; the same alarm publishes
// news.json (at most every 30 s) and, once, map.json.

import { DurableObject } from 'cloudflare:workers'

import {
  AWARDS, CLASS0, CLASS_DRYDOCK, CLASS_SPECIAL, COMBAT, DEFAULT_CONFIG, GAME, HAGGLE_TTL_MS, LAST_LIGHT, MARSHALS, POD, ROB, SHIPS, TERRA, TURN_COSTS,
  rankOf, rankTitle, type Commodity, type DoorConfig, type ItemId,
} from '../../../plugin/shared/door/data'
import { hashSeed, isAdjacent, rng } from '../../../plugin/shared/door/nav'
import { PROSE } from '../../../plugin/shared/door/prose'
import {
  DOOR_LIMITS, doorMapKey, doorNewsKey,
  type DoorCommand, type DoorEvent, type DoorMap, type DoorNews, type DoorReply, type DoorStateReply, type FighterMode, type KnownDelta,
  type PortReport, type SectorView, type TraderRanking,
} from '../../../plugin/shared/door/protocol'
import { DEATH, OLD_SAL, fill, LOG_TEMPLATES } from '../../../plugin/shared/door/text'
import { stripPipe } from '../../../plugin/shared/pipe'
import type { ApiError, ErrorCode } from '../../../plugin/shared/protocol'
import type { Env } from '../env'
import { bangResult, bangStep, startBang, type BangState, type Specials } from './engine/bigbang'
import {
  applyDamage, destroyShip, fightAwards, fleeTo, isProtected, marshalPunish, marshalsAt, podAwards, resolveAttack, safePodPath, turncoatMarshal, wouldFlee,
  type DeathResult,
} from './engine/combat'
import { bustRemembered, rob, steal } from './engine/crime'
import { deathEvents, enterSector, fightersOf, heldBy, surrender } from './engine/hazards'
import { settleTurns, validPath, walk } from './engine/move'
import {
  aliasCost, applyCommission, backRoomOpen, backRoomPassword, buyPassword, officeOpen, passwordMatches, postHit, postReward, strike, swear, trace,
} from './engine/office'
import { gainXp, netWorth, newPlayer, startingShip, toSnapshot } from './engine/player'
import { class0Prices, dayNumber, regenPort } from './engine/prices'
import { densityRow, portReport, sectorView, type SectorContents } from './engine/scan'
import { bankMove, buyClass0, buyItem, buyShip, renameShip, type Outcome } from './engine/shop'
import { activeEvent, offer, openDock, pendingOf, stepsOf, type TradeCtx } from './engine/trade'
import type { Deploy, DeployKind, MailDraft, PlayerRec, PortRec, TradeSession } from './engine/types'

/** Never publish news.json more often than this. */
const NEWS_INTERVAL_MS = 30_000
/** Reports kept per absent pilot. */
const MAIL_KEEP = 40
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
      CREATE TABLE IF NOT EXISTS deploys (id INTEGER PRIMARY KEY AUTOINCREMENT, sector INTEGER NOT NULL, owner_id INTEGER NOT NULL, kind TEXT NOT NULL,
        count INTEGER NOT NULL, mode TEXT NOT NULL DEFAULT 'defensive', toll INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS deploys_sector ON deploys (sector);
      CREATE TABLE IF NOT EXISTS bounties (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, target_id INTEGER NOT NULL, poster_id INTEGER NOT NULL,
        amount INTEGER NOT NULL, killer_id INTEGER, ts INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS bounties_target ON bounties (target_id);
      CREATE INDEX IF NOT EXISTS bounties_killer ON bounties (killer_id);
      CREATE TABLE IF NOT EXISTS busts (sector INTEGER PRIMARY KEY, player_id INTEGER NOT NULL, ts INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS mail (id INTEGER PRIMARY KEY AUTOINCREMENT, player_id INTEGER NOT NULL, ts INTEGER NOT NULL, type TEXT NOT NULL, from_name TEXT NOT NULL, text TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS mail_player ON mail (player_id);
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
    this.log('bang', fill(LOG_TEMPLATES.epoch, { n: this.season().slice(1), sectors: this.config().sectors }))
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

  /** The players table's sector column is 0 for a pilot who is out for the day, so they are on nobody's scope. */
  private sectorCol = (p: PlayerRec) => (p.deadUntil ? 0 : p.sector)

  /** Saves the player whose request this is (and stamps when they were last seen). */
  private savePlayer(p: PlayerRec, now: number) {
    this.sql.exec(
      `INSERT INTO players (id, name, sector, exp, align, data, seen) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, sector = excluded.sector, exp = excluded.exp, align = excluded.align, data = excluded.data, seen = excluded.seen`,
      p.id, p.name, this.sectorCol(p), p.exp, p.align, JSON.stringify(p), now,
    )
  }

  /** Saves another player a command changed (a victim, a bank transfer's receiver) without touching when they were last seen. */
  private saveOther(p: PlayerRec) {
    this.sql.exec('UPDATE players SET name = ?, sector = ?, exp = ?, align = ?, data = ? WHERE id = ?', p.name, this.sectorCol(p), p.exp, p.align, JSON.stringify(p), p.id)
  }

  private playerByName(name: string): PlayerRec | undefined {
    const r = this.sql.exec<{ id: number }>('SELECT id FROM players WHERE name = ?', name).toArray()[0]
    return r && this.player(r.id)
  }

  // ---- deployables, mail, wrecks -------------------------------------------

  /** Deploy rows in the given sectors, by sector, with their owners' current names. */
  private deploysAt(sectors: number[]): Map<number, Deploy[]> {
    const out = new Map<number, Deploy[]>()
    if (!sectors.length) return out
    const marks = sectors.map(() => '?').join(',')
    const rows = this.sql
      .exec<{ id: number; sector: number; owner_id: number; kind: string; count: number; mode: string; toll: number; name: string | null }>(
        `SELECT d.id, d.sector, d.owner_id, d.kind, d.count, d.mode, d.toll, p.name FROM deploys d LEFT JOIN players p ON p.id = d.owner_id WHERE d.sector IN (${marks}) ORDER BY d.id`,
        ...sectors,
      )
      .toArray()
    for (const r of rows) {
      const d: Deploy = { id: r.id, sector: r.sector, ownerId: r.owner_id, ownerName: r.name ?? 'Someone', kind: r.kind as DeployKind, count: r.count, mode: r.mode as FighterMode, toll: r.toll }
      const list = out.get(r.sector)
      if (list) list.push(d)
      else out.set(r.sector, [d])
    }
    return out
  }

  private saveDeploys(list: Deploy[]) {
    for (const d of list) {
      if (d.count <= 0) this.sql.exec('DELETE FROM deploys WHERE id = ?', d.id)
      else this.sql.exec('UPDATE deploys SET count = ?, mode = ?, toll = ? WHERE id = ?', d.count, d.mode, d.toll, d.id)
    }
  }

  /** Files reports for pilots who were not there; each keeps at most MAIL_KEEP, newest last. */
  private addMail(list: MailDraft[], now: number) {
    for (const m of list) {
      this.sql.exec("INSERT INTO mail (player_id, ts, type, from_name, text) VALUES (?, ?, 'report', ?, ?)", m.playerId, now, m.from, m.text)
      this.sql.exec('DELETE FROM mail WHERE player_id = ? AND id <= (SELECT MAX(id) FROM mail WHERE player_id = ?) - ?', m.playerId, m.playerId, MAIL_KEEP)
    }
  }

  /** A player's waiting reports as events; they are deleted once the reply is sent. */
  private mailFor(playerId: number): { events: DoorEvent[]; ids: number[] } {
    const rows = this.sql.exec<{ id: number; from_name: string; text: string }>('SELECT id, from_name, text FROM mail WHERE player_id = ? ORDER BY id', playerId).toArray()
    return { events: rows.map(r => ({ kind: 'message' as const, from: r.from_name, text: r.text, type: 'report' as const })), ids: rows.map(r => r.id) }
  }

  private clearMail(ids: number[]) {
    for (const id of ids) this.sql.exec('DELETE FROM mail WHERE id = ?', id)
  }

  /** NavHaz added to a sector (never in Concord Space, never above 100%). */
  private addNavhaz(sector: number, n: number) {
    if (this.map().concord.includes(sector)) return
    this.sql.exec('INSERT INTO sectors (id, navhaz) VALUES (?, MIN(100, ?)) ON CONFLICT(id) DO UPDATE SET navhaz = MIN(100, navhaz + ?)', sector, n, n)
  }

  /** Daily-log line and wreckage for a ship that was destroyed in `sector`. */
  private wreck(name: string, shipName: string, sector: number, d: DeathResult) {
    this.log(d.fatal ? 'destroyed' : 'podded', fill(d.fatal ? LOG_TEMPLATES.destroyed : LOG_TEMPLATES.podded, { name, ship: shipName, sector }))
    this.addNavhaz(sector, COMBAT.navhazPerWreck)
    this.markDirtySync()
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
      // Pilots are listed even when offline; pilots out for the day are filed under sector 0.
      traders: this.sql
        .exec<{ data: string }>('SELECT data FROM players WHERE sector = ? AND id != ? ORDER BY name', id, meId)
        .toArray()
        .map(r => {
          const p = JSON.parse(r.data) as PlayerRec
          return { name: p.name, ship: p.ship.name, shipType: p.ship.type, fighters: p.ship.fighters }
        }),
    }
    if (row?.beacon) c.beacon = row.beacon
    const deploys = this.deploysAt([id]).get(id) ?? []
    const stack = fightersOf(deploys)
    if (stack) c.fighters = { count: stack.count, owner: stack.ownerName, isYours: stack.ownerId === meId, isCorp: false, mode: stack.mode }
    const mines = deploys.filter(d => d.kind !== 'fighters' && d.count > 0)
    if (mines.length) c.mines = mines.map(d => ({ kind: d.kind as 'contact' | 'limpet', count: d.count, owner: d.ownerName, isYours: d.ownerId === meId }))
    if (c.concord) {
      const here = marshalsAt(this.seed(), now, map.concord, id)
      if (here.length) c.marshals = here.map(i => MARSHALS[i].name)
    }
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
    this.log('day', fill(LOG_TEMPLATES.newDay, { date: gameDate(now) }))
    this.sql.exec('DELETE FROM requests WHERE day < ?', today)
    this.extern(now)
    this.markDirtySync()
  }

  /** The overnight sweep so far: the space lanes and Concord Space are cleared, NavHaz fades, old busts are forgotten. */
  private extern(now: number) {
    const map = this.map()
    const cleared = [...new Set([...map.lanes, ...map.concord])]
    for (let i = 0; i < cleared.length; i += 50) {
      const chunk = cleared.slice(i, i + 50)
      const marks = chunk.map(() => '?').join(',')
      this.sql.exec(`DELETE FROM deploys WHERE sector IN (${marks})`, ...chunk)
      this.sql.exec('UPDATE sectors SET beacon = NULL WHERE beacon IS NOT NULL AND beacon != ? AND id IN (' + marks + ')', CONCORD_BEACON, ...chunk)
    }
    this.sql.exec('UPDATE sectors SET navhaz = MAX(0, navhaz - ?) WHERE navhaz > 0', COMBAT.navhazDecay)
    this.sql.exec('DELETE FROM busts WHERE ts < ?', now - ROB.bustClearDays * 86_400_000)
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
    if (p.deadUntil) {
      if (now < p.deadUntil) return
      // A day later: a fresh Freetrader at Haven. The bank, experience and alignment stay.
      p.deadUntil = undefined
      p.sector = 1
      p.prevSector = 1
      p.credits = this.config().startCredits
      p.ship = startingShip('Second Wind', this.config())
      p.turnsAt = Math.max(p.turnsAt, now)
      for (const line of PROSE.respawn) events.push({ kind: 'text', text: line })
    }
    const t = settleTurns(p.turns, p.turnsAt, now, this.config())
    p.turns = t.turns
    p.turnsAt = t.turnsAt
    const today = dayNumber(now)
    if (p.lastDay < today) {
      p.lastDay = today
      gainXp(p, AWARDS.dailyLogin.exp, AWARDS.dailyLogin.align, 'daily', events)
    }
  }

  /** True while hostile fighters hold the pilot's sector. */
  private blocked(p: PlayerRec): boolean {
    if (p.deadUntil) return false
    return heldBy(p, fightersOf(this.deploysAt([p.sector]).get(p.sector) ?? []), p.sector)
  }

  private reply(p: PlayerRec, now: number, requests: number, events: DoorEvent[], known: KnownDelta, session?: TradeSession): DoorReply {
    const r: DoorReply = { ok: true, snapshot: toSnapshot(p, this.season(), this.config(), requests, this.blocked(p)), here: sectorView(this.contents(p.sector, p.id, now)), events, known }
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
    const mail = this.mailFor(p.id)
    events.push(...mail.events)
    this.clearMail(mail.ids)
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
    const mail = this.mailFor(p.id)
    events.push(...mail.events)
    this.settle(p, now, events)
    if (p.deadUntil) return fail('invalid', DEATH.outForTheDay.slice(0, 2).map(stripPipe).join(' '))
    let session = this.session(p.id, now)

    const r = this.run(cmd, p, req, now, session)
    if (isFail(r)) return r
    this.clearMail(mail.ids)
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
      case 'outfit': return this.atDrydock(p) ?? outcome(buyItem(p, req.item as ItemId, req.qty as number, 2))
      case 'shipwright': return this.shipwright(p, req, now)
      case 'bank': return this.bank(p, req)
      case 'announce': return this.announce(p, req)
      case 'scan': return this.scan(p, req, now)
      case 'probe': return this.probe(p, req, now)
      case 'avoids': return this.avoids(p, req)
      case 'attack': return this.attack(p, req, now)
      case 'retreat': return this.retreat(p, now)
      case 'surrender': return this.surrender(p, now)
      case 'deploy': return this.deploy(p, req, now)
      case 'collect': return this.collect(p, req)
      case 'rob': case 'steal': return this.crime(p, req, now, cmd)
      case 'marshal': return this.marshal(p, req, now)
      case 'backroom': return this.backroom(p, req, now)
      case 'beacon': return this.beacon(p, req)
      case 'disrupt': return this.disrupt(p, req, now)
      case 'sal': return this.sal(p, req, now)
      default: return fail('invalid', 'Not yet.')
    }
  }

  // ---- commands -----------------------------------------------------------

  private create(user: DoorUser, req: Record<string, unknown>, now: number, requests: number): DoorReply | Fail {
    if (this.player(user.id)) return fail('taken', 'You already fly in this Epoch.')
    const shipName = typeof req.shipName === 'string' ? req.shipName : ''
    if (!shipName) return fail('invalid', 'Name your ship.')
    if (this.sql.exec('SELECT 1 FROM players WHERE name = ?', user.handle).toArray().length) return fail('taken', 'That name is in use in this Epoch.')
    const p = newPlayer(user.id, user.handle, shipName, this.config(), now)
    p.lastSeenLog = this.sql.exec<{ id: number | null }>('SELECT MAX(id) AS id FROM log').one().id ?? 0
    const known = this.learn(p.id, [this.contents(1, p.id, now)], now)
    this.log('join', fill(LOG_TEMPLATES.join, { name: p.name, ship: shipName }))
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
    if (this.blocked(p)) return fail('invalid', 'Hostile fighters hold your ship here. Attack them, retreat or surrender.')
    if (!validPath(map.warps, p.sector, path as number[])) return fail('invalid', 'That course does not follow the warps.')
    const hops = path as number[]
    // One query per kind for the whole path: what could stop an alert-mode autopilot, and what hurts on entry.
    const marks = hops.map(() => '?').join(',')
    const ports = new Set(this.sql.exec<{ sector: number }>(`SELECT sector FROM ports WHERE sector IN (${marks})`, ...hops).toArray().map(r => r.sector))
    const planets = new Set(this.sql.exec<{ sector: number }>(`SELECT sector FROM planets WHERE sector IN (${marks})`, ...hops).toArray().map(r => r.sector))
    const traders = new Set(this.sql.exec<{ sector: number }>(`SELECT sector FROM players WHERE id != ? AND sector IN (${marks})`, p.id, ...hops).toArray().map(r => r.sector))
    const navhaz = new Map(this.sql.exec<{ id: number; navhaz: number }>(`SELECT id, navhaz FROM sectors WHERE id IN (${marks})`, ...hops).toArray().map(r => [r.id, r.navhaz]))
    const deploys = this.deploysAt([...new Set(hops)])
    const rand = rng(hashSeed(this.seed(), p.id, p.actions, 'move'))
    const mail: MailDraft[] = []
    const changed: Deploy[] = []
    let died: DeathResult | undefined
    let diedAt = 0
    let from = p.sector
    const w = walk({
      warps: map.warps,
      from: p.sector,
      path: hops,
      mode,
      turns: p.turns,
      turnsPerWarp: SHIPS[p.ship.type].turnsPerWarp,
      flags: s => ({ port: ports.has(s), planet: planets.has(s), trader: traders.has(s) }),
      onEnter: s => {
        p.prevSector = from
        p.sector = s
        from = s
        const r = enterSector(p, { sector: s, concord: map.concord.includes(s), navhaz: navhaz.get(s) ?? 0, deploys: deploys.get(s) ?? [] }, rand, now)
        mail.push(...r.mail)
        for (const d of r.changed) if (!changed.includes(d)) changed.push(d)
        if (r.death) {
          died = r.death
          diedAt = s
        }
        return r.events.length || r.stop ? { events: r.events, stop: r.death?.fatal ? 'dead' : r.stop } : undefined
      },
    })
    p.turns -= w.turnsUsed
    const events = w.events
    if (!died && w.visited.length) {
      p.prevSector = w.prev
      p.sector = w.sector
    }
    this.saveDeploys(changed)
    this.addMail(mail, now)
    if (died) {
      // The ship was lost on the way: the walk's last stop is where the pilot is now.
      const stop = events[events.length - 1]
      if (stop.kind === 'stop') stop.sector = p.sector
      this.wreck(p.name, (died as DeathResult).shipName, diedAt, died)
    } else {
      // Turncoats against the Concord are not tolerated.
      const here = map.concord.includes(p.sector) ? marshalsAt(this.seed(), now, map.concord, p.sector) : []
      const turncoat = turncoatMarshal(p, here)
      if (turncoat) {
        for (const line of PROSE.turncoat) events.splice(events.length - 1, 0, { kind: 'text', text: fill(line, { marshal: turncoat }) })
        const shipName = p.ship.name
        const sector = p.sector
        const death = destroyShip(p, { now, podTo: p.prevSector })
        events.splice(events.length - 1, 0, ...deathEvents(p, death, p.deadUntil, turncoat))
        const stop = events[events.length - 1]
        if (stop.kind === 'stop') {
          stop.sector = p.sector
          if (death.fatal) stop.reason = 'dead'
        }
        this.wreck(p.name, shipName, sector, death)
      }
    }
    const seen = w.visited.map(s => (s === w.sector || ports.has(s) ? this.contents(s, p.id, now) : { id: s, warps: [], concord: false, navhaz: 0, planets: [], traders: [] }))
    return { events, known: this.learn(p.id, seen, now), session: null }
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
    const cls = this.port(p.sector)?.class
    if (req.removeLimpet) {
      if (cls !== CLASS_SPECIAL && cls !== CLASS_DRYDOCK) return fail('invalid', 'Limpets come off at Haven, Meridian, Tycho Reach or the Drydock.')
      if (!p.limpet) return fail('invalid', 'There is no limpet on your hull.')
      if (p.credits < CLASS0.limpetRemoval) return fail('invalid', `Taking it off costs ${CLASS0.limpetRemoval.toLocaleString('en-US')} credits.`)
      p.credits -= CLASS0.limpetRemoval
      p.limpet = undefined
      return { events: [{ kind: 'bought', what: 'limpet removal', qty: 1, cost: CLASS0.limpetRemoval }] }
    }
    if (cls !== CLASS_SPECIAL) return fail('invalid', 'Holds, fighters and shields are sold at Haven, Meridian and Tycho Reach.')
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
      if (!isFail(r)) this.log('ship', fill(LOG_TEMPLATES.commission, { name: p.name, ship: name, class: SHIPS[req.ship].name }))
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
    this.saveOther(to)
    return { events: [{ kind: 'text', text: `${amount.toLocaleString('en-US')} credits sent to ${to.name}. Your balance is ${p.bank.toLocaleString('en-US')}.` }] }
  }

  private announce(p: PlayerRec, req: Record<string, unknown>): Done | Fail {
    const away = this.atDrydock(p)
    if (away) return away
    const text = typeof req.text === 'string' ? req.text : ''
    if (!text) return fail('invalid', 'Announce what?')
    if (p.credits < LAST_LIGHT.announceCost) return fail('invalid', `An announcement costs ${LAST_LIGHT.announceCost} credits.`)
    p.credits -= LAST_LIGHT.announceCost
    this.log('announce', fill(LOG_TEMPLATES.announce, { name: p.name, text }))
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
    if (req.kind === 'limpet') {
      const rows = this.sql
        .exec<{ name: string; sector: number; data: string }>("SELECT name, sector, data FROM players WHERE json_extract(data, '$.limpet.id') = ? ORDER BY name", p.id)
        .toArray()
        .map(r => ({ name: r.name, sector: (JSON.parse(r.data) as PlayerRec).sector }))
      if (!rows.length) return fail('invalid', 'None of your limpets are clamped to a ship.')
      return { events: [{ kind: 'limpets', rows }] }
    }
    return fail('invalid', 'Expected {kind: density|holo|limpet}.')
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

  // ---- phase 2: conflict ---------------------------------------------------

  private isConcord = (sector: number) => this.map().concord.includes(sector)
  private isLane = (sector: number) => this.map().lanes.includes(sector)

  /** Where an escape pod lands after `victim` was killed: a random safe walk. */
  private podDestination(victim: PlayerRec, rand: () => number): number {
    const cache = new Map<number, boolean>()
    const unsafe = (s: number) => {
      let hit = cache.get(s)
      if (hit === undefined) {
        const stack = fightersOf(this.deploysAt([s]).get(s) ?? [])
        hit = !!stack && stack.ownerId !== victim.id
        cache.set(s, hit)
      }
      return hit
    }
    return safePodPath(this.map().warps, victim.sector, unsafe, rand)
  }

  /** Death of a ship the attacker destroyed: awards, salvage, pod, bounties, log, report for the victim. */
  private kill(p: PlayerRec, victim: PlayerRec, res: { overkill: boolean }, events: DoorEvent[], attackEvent: Extract<DoorEvent, { kind: 'attack' }>, rand: () => number, now: number) {
    const sector = victim.sector
    const wasShip = victim.ship
    const award = podAwards(victim.exp, victim.align)
    // Salvage: credits and cargo, nothing on overkill.
    if (!res.overkill) {
      if (victim.credits > 0) attackEvent.salvageCredits = victim.credits
      p.credits += victim.credits
      let room = p.ship.holds - p.ship.cargo[0] - p.ship.cargo[1] - p.ship.cargo[2] - p.ship.colonists
      const got: [number, number, number] = [0, 0, 0]
      for (const i of [0, 1, 2] as const) {
        got[i] = Math.max(0, Math.min(room, wasShip.cargo[i]))
        room -= got[i]
        p.ship.cargo[i] += got[i]
      }
      if (got[0] + got[1] + got[2] > 0) events.push({ kind: 'text', text: fill(PROSE.salvage, { c: got[0], d: got[1], w: got[2] }) })
    } else events.push({ kind: 'text', text: PROSE.overkill })
    if (award.exp || award.align) gainXp(p, award.exp, award.align, 'podding', events)
    const deadman = wasShip.equipment.deadman
    const podTo = this.podDestination(victim, rand)
    const death = destroyShip(victim, { now, podTo })
    this.sql.exec('UPDATE bounties SET killer_id = ? WHERE target_id = ? AND killer_id IS NULL AND poster_id != ?', p.id, victim.id, p.id)
    this.wreck(victim.name, death.shipName, sector, death)
    this.addMail(
      [{ playerId: victim.id, from: p.name, text: fill(death.fatal ? PROSE.mail.killed : PROSE.mail.podded, { by: p.name, sector, to: victim.sector }) }],
      now,
    )
    // Deadman Charges make the killer pay.
    if (deadman > 0) {
      const dmg = deadman * COMBAT.deadmanDamage
      events.push({ kind: 'text', text: fill(PROSE.deadman, { n: dmg }) })
      if (applyDamage(p.ship, dmg).destroyed) {
        const mine = destroyShip(p, { now, podTo: p.prevSector })
        events.push(...deathEvents(p, mine, p.deadUntil, victim.name))
        this.wreck(p.name, mine.shipName, sector, mine)
      }
    }
  }

  private attack(p: PlayerRec, req: Record<string, unknown>, now: number): Done | Fail {
    const target = typeof req.target === 'string' ? req.target.trim() : ''
    const sent = req.fighters
    if (!target) return fail('invalid', 'Attack whom?')
    if (!isInt(sent) || sent < 1) return fail('invalid', 'Send how many fighters?')
    const spec = SHIPS[p.ship.type]
    if (p.ship.fighters < 1) return fail('invalid', 'You have no fighters to send.')
    if (sent > p.ship.fighters) return fail('invalid', `You only have ${p.ship.fighters} fighters.`)
    if (sent > spec.fightersPerAttack) return fail('invalid', `Your computer can control ${spec.fightersPerAttack} fighters at once.`)
    const map = this.map()
    const rand = rng(hashSeed(this.seed(), p.id, p.actions, 'attack'))
    const events: DoorEvent[] = []
    const lower = target.toLowerCase()

    // A Marshal: attacking one anywhere is the last thing you do in that ship.
    const patrol = map.concord.includes(p.sector) ? marshalsAt(this.seed(), now, map.concord, p.sector) : []
    const marshal = patrol.find(i => MARSHALS[i].name.toLowerCase() === lower)
    if (marshal !== undefined) return this.punish(p, MARSHALS[marshal].name, now, events)

    // Sector fighters.
    if (lower === '*fighters') {
      const stack = fightersOf(this.deploysAt([p.sector]).get(p.sector) ?? [])
      if (!stack || stack.ownerId === p.id) return fail('invalid', 'There are no hostile fighters here.')
      const res = resolveAttack(sent, spec.offense, { fighters: stack.count, shields: 0, odds: COMBAT.sectorFighterOdds }, rand)
      p.ship.fighters -= res.lost
      stack.count -= res.killed
      const owner = this.player(stack.ownerId)
      const award = owner ? fightAwards(p.align, owner.align, owner.exp, res.lost) : { exp: 0, align: 0 }
      const ev: Extract<DoorEvent, { kind: 'attack' }> = {
        kind: 'attack', target: `${stack.ownerName}'s fighters`, sent, lost: res.lost, killed: res.killed, shieldsLost: 0, destroyed: stack.count <= 0, captured: false, fled: false,
      }
      events.push(ev)
      if (stack.count <= 0 && stack.toll > 0) {
        p.credits += stack.toll
        ev.salvageCredits = stack.toll
        events.push({ kind: 'text', text: fill(PROSE.tollTaken, { n: stack.toll }) })
        stack.toll = 0
      }
      if (award.exp || award.align) gainXp(p, award.exp, award.align, 'fighting', events)
      this.saveDeploys([stack])
      this.addMail([{ playerId: stack.ownerId, from: PROSE.mail.fightersFrom, text: fill(PROSE.mail.fightersHit, { by: p.name, sector: p.sector, n: res.killed }) }], now)
      return { events }
    }

    // Another trader in this sector, asleep or not.
    const row = this.sql.exec<{ id: number }>('SELECT id FROM players WHERE name = ? AND sector = ?', target, p.sector).toArray()[0]
    if (!row) return fail('not_found', 'No such ship is here.')
    if (row.id === p.id) return fail('invalid', 'You can\'t attack yourself.')
    const d = this.player(row.id)!
    if (map.concord.includes(p.sector) && isProtected(d, this.config())) return this.punish(p, MARSHALS[0].name, now, events)

    const ds = SHIPS[d.ship.type]
    const fleeRoll = rand()
    const ev: Extract<DoorEvent, { kind: 'attack' }> = { kind: 'attack', target: d.name, sent, lost: 0, killed: 0, shieldsLost: 0, destroyed: false, captured: false, fled: false }
    events.push(ev)
    if (d.ship.type !== POD && wouldFlee(sent, d.ship) && fleeRoll < COMBAT.fleeChance) {
      const to = fleeTo(map.warps, d.sector, rand)
      if (to !== d.sector) {
        ev.fled = true
        d.prevSector = d.sector
        d.sector = to
        this.saveOther(d)
        this.addMail([{ playerId: d.id, from: p.name, text: fill(PROSE.mail.fled, { by: p.name, sector: p.sector, to }) }], now)
        return { events }
      }
    }
    const res = resolveAttack(sent, spec.offense, { fighters: d.ship.fighters, shields: d.ship.shields, odds: ds.defense }, rand)
    p.ship.fighters -= res.lost
    d.ship.shields -= res.shieldsLost
    d.ship.fighters -= res.killed
    Object.assign(ev, { lost: res.lost, killed: res.killed, shieldsLost: res.shieldsLost, destroyed: res.destroyed })
    const award = fightAwards(p.align, d.align, d.exp, res.lost)
    if (award.exp || award.align) gainXp(p, award.exp, award.align, 'fighting', events)
    if (res.destroyed) this.kill(p, d, res, events, ev, rand, now)
    else this.addMail([{ playerId: d.id, from: p.name, text: fill(PROSE.mail.attacked, { by: p.name, sector: p.sector, n: res.killed }) }], now)
    this.saveOther(d)
    return { events }
  }

  /** A Marshal answers: the attacker's ship is gone. */
  private punish(p: PlayerRec, marshalName: string, now: number, events: DoorEvent[]): Done {
    const sector = p.sector
    const death = marshalPunish(p, marshalName, now, events)
    events.push(...deathEvents(p, death, p.deadUntil, marshalName))
    this.wreck(p.name, death.shipName, sector, death)
    return { events }
  }

  private retreat(p: PlayerRec, now: number): Done | Fail {
    if (!this.blocked(p)) return fail('invalid', 'Nothing is holding you here.')
    if (p.prevSector === p.sector) return fail('invalid', 'There is nowhere to fall back to.')
    if (p.turns >= TURN_COSTS.retreat) p.turns -= TURN_COSTS.retreat
    const to = p.prevSector
    p.prevSector = p.sector
    p.sector = to
    p.paid = undefined
    return { events: [{ kind: 'retreat', to }], known: this.learn(p.id, [this.contents(to, p.id, now)], now), session: null }
  }

  private surrender(p: PlayerRec, now: number): Done | Fail {
    const stack = fightersOf(this.deploysAt([p.sector]).get(p.sector) ?? [])
    if (!this.blocked(p) || !stack) return fail('invalid', 'Nothing is holding you here.')
    const r = surrender(p, stack)
    this.saveDeploys([stack])
    this.addMail([r.mail], now)
    return { events: r.events, session: null }
  }

  private deploy(p: PlayerRec, req: Record<string, unknown>, now: number): Done | Fail {
    const kind = req.kind
    const count = req.count
    if (kind !== 'fighters' && kind !== 'contact' && kind !== 'limpet') return fail('invalid', 'Expected {kind: fighters|contact|limpet, count, owner, mode}.')
    if (!isInt(count) || count < 1) return fail('invalid', 'Deploy how many?')
    if (req.owner === 'corp') return fail('invalid', 'You have no corporation to deploy for.')
    if (this.isConcord(p.sector) || this.isLane(p.sector)) return fail('invalid', PROSE.noDeployInConcord)
    const here = this.deploysAt([p.sector]).get(p.sector) ?? []
    const e = p.ship.equipment
    if (kind === 'fighters') {
      const mode = req.mode
      if (mode !== 'defensive' && mode !== 'offensive' && mode !== 'toll') return fail('invalid', 'Choose defensive, offensive or toll.')
      if (count > p.ship.fighters) return fail('invalid', `You only have ${p.ship.fighters} fighters.`)
      const stack = fightersOf(here)
      if (stack && stack.ownerId !== p.id) return fail('invalid', `${stack.ownerName}'s fighters already hold this sector.`)
      if (this.sql.exec('SELECT 1 FROM players WHERE sector = ? AND id != ? LIMIT 1', p.sector, p.id).toArray().length) return fail('invalid', 'Another trader is here. Deploy when you have the sector to yourself.')
      const planet = this.sql.exec('SELECT 1 FROM planets WHERE sector = ? LIMIT 1', p.sector).toArray().length > 0
      if (planet && (stack?.count ?? 0) + count > COMBAT.maxFightersWithPlanet) return fail('invalid', `A sector with a planet holds at most ${COMBAT.maxFightersWithPlanet.toLocaleString('en-US')} fighters.`)
      p.ship.fighters -= count
      if (stack) {
        stack.count += count
        stack.mode = mode
        this.saveDeploys([stack])
      } else this.sql.exec("INSERT INTO deploys (sector, owner_id, kind, count, mode, toll) VALUES (?, ?, 'fighters', ?, ?, 0)", p.sector, p.id, count, mode)
      return { events: [{ kind: 'deployed', what: 'fighters', count, mode }] }
    }
    const have = kind === 'contact' ? e.contactMines : e.limpets
    if (count > have) return fail('invalid', `You only have ${have} ${kind === 'contact' ? 'contact mines' : 'limpets'}.`)
    const mine = here.find(d => d.kind === kind && d.ownerId === p.id)
    const total = here.filter(d => d.kind === kind).reduce((a, d) => a + d.count, 0)
    if (total + count > COMBAT.maxMinesPerSector) return fail('invalid', `A sector holds at most ${COMBAT.maxMinesPerSector} of those.`)
    if (kind === 'contact') e.contactMines -= count
    else e.limpets -= count
    if (mine) {
      mine.count += count
      this.saveDeploys([mine])
    } else this.sql.exec("INSERT INTO deploys (sector, owner_id, kind, count, mode, toll) VALUES (?, ?, ?, ?, 'defensive', 0)", p.sector, p.id, kind, count)
    return { events: [{ kind: 'deployed', what: kind === 'contact' ? 'contact mines' : 'limpets', count }] }
  }

  private collect(p: PlayerRec, req: Record<string, unknown>): Done | Fail {
    const kind = req.kind
    if (kind !== 'fighters' && kind !== 'contact' && kind !== 'limpet') return fail('invalid', 'Expected {kind: fighters|contact|limpet, count}.')
    if (!isInt(req.count) || req.count < 1) return fail('invalid', 'Collect how many?')
    const stack = (this.deploysAt([p.sector]).get(p.sector) ?? []).find(d => d.kind === kind && d.ownerId === p.id && d.count > 0)
    if (!stack) return fail('invalid', `You have no ${kind === 'fighters' ? 'fighters' : kind === 'contact' ? 'contact mines' : 'limpets'} here.`)
    const spec = SHIPS[p.ship.type]
    const e = p.ship.equipment
    const room = kind === 'fighters' ? spec.maxFighters - p.ship.fighters : spec.mines - (kind === 'contact' ? e.contactMines : e.limpets)
    const n = Math.min(req.count, stack.count, room)
    if (n < 1) return fail('invalid', 'Your ship has no room for them.')
    stack.count -= n
    if (kind === 'fighters') p.ship.fighters += n
    else if (kind === 'contact') e.contactMines += n
    else e.limpets += n
    const ev: Extract<DoorEvent, { kind: 'collected' }> = { kind: 'collected', what: kind === 'fighters' ? 'fighters' : kind === 'contact' ? 'contact mines' : 'limpets', count: n }
    if (kind === 'fighters' && stack.toll > 0) {
      p.credits += stack.toll
      ev.credits = stack.toll
      stack.toll = 0
    }
    this.saveDeploys([stack])
    return { events: [ev] }
  }

  private crime(p: PlayerRec, req: Record<string, unknown>, now: number, cmd: 'rob' | 'steal'): Done | Fail {
    const port = this.port(p.sector)
    if (port) regenPort(port, now, this.config().portRegenPct)
    const last = this.sql.exec<{ player_id: number; ts: number }>('SELECT player_id, ts FROM busts WHERE sector = ?', p.sector).toArray()[0]
    const repeat = !!last && last.player_id === p.id && bustRemembered(last.ts, now)
    const rand = rng(hashSeed(this.seed(), p.id, p.actions, 'crime'))
    const r = cmd === 'steal'
      ? steal(p, port, req.commodity as Commodity, req.qty as number, repeat, rand)
      : rob(p, port, req.credits as number, repeat, rand)
    if (!r.ok) return fail('invalid', r.message)
    if (r.busted) this.sql.exec('INSERT OR REPLACE INTO busts (sector, player_id, ts) VALUES (?, ?, ?)', p.sector, p.id, now)
    this.savePort(port!)
    return { events: r.events }
  }

  private marshal(p: PlayerRec, req: Record<string, unknown>, now: number): Done | Fail {
    const away = this.atDrydock(p)
    if (away) return away
    if (!officeOpen(p)) return { events: PROSE.office.tooRisky.map(text => ({ kind: 'text' as const, text })) }
    if (req.op === 'commission') {
      const r = applyCommission(p)
      if (r.ok && p.commissioned) this.log('commission', fill(LOG_TEMPLATES.commission, { name: p.name, ship: 'commission', class: 'Marshal\'s Cruiser' }))
      return outcome(r)
    }
    if (req.op === 'wanted') {
      const rows = this.sql
        .exec<{ name: string; total: number }>(
          "SELECT t.name AS name, SUM(b.amount) AS total FROM bounties b JOIN players t ON t.id = b.target_id WHERE b.kind = 'reward' AND b.killer_id IS NULL GROUP BY b.target_id ORDER BY total DESC, t.name LIMIT 10",
        )
        .toArray()
        .map(r => ({ name: r.name, reward: r.total }))
      return { events: [{ kind: 'wanted', rows }] }
    }
    if (req.op === 'claim') return this.claim(p, 'reward', PROSE.office.claimPaid, PROSE.office.claimNone)
    if (req.op === 'reward') {
      const target = typeof req.target === 'string' ? this.playerByName(req.target) : undefined
      if (!target) return fail('not_found', 'No such trader in this Epoch.')
      const r = postReward(p, target, req.amount as number)
      if (r.ok) this.sql.exec("INSERT INTO bounties (kind, target_id, poster_id, amount, killer_id, ts) VALUES ('reward', ?, ?, ?, NULL, ?)", target.id, p.id, req.amount as number, now)
      return outcome(r)
    }
    return fail('invalid', 'Expected op commission, reward, claim or wanted.')
  }

  /** Pays the bounties of one pool on traders `p` has killed. */
  private claim(p: PlayerRec, kind: 'reward' | 'hit', paid: string, none: string): Done {
    const row = this.sql.exec<{ total: number | null; n: number }>('SELECT SUM(amount) AS total, COUNT(*) AS n FROM bounties WHERE kind = ? AND killer_id = ?', kind, p.id).one()
    if (!row.n) return { events: [{ kind: 'text', text: none }] }
    const total = row.total ?? 0
    p.credits += total
    this.sql.exec('DELETE FROM bounties WHERE kind = ? AND killer_id = ?', kind, p.id)
    return { events: [{ kind: 'text', text: fill(paid, { amount: total.toLocaleString('en-US'), n: row.n }) }] }
  }

  private backroom(p: PlayerRec, req: Record<string, unknown>, now: number): Done | Fail {
    const away = this.atDrydock(p)
    if (away) return away
    if (!backRoomOpen(p)) return { events: PROSE.backRoom.barred.map(text => ({ kind: 'text' as const, text })) }
    if (!passwordMatches(req.password, this.seed(), p.id)) return { events: strike(p, dayNumber(now), now) }
    if (req.op === 'hit') {
      const target = typeof req.target === 'string' ? this.playerByName(req.target) : undefined
      if (!target) return fail('not_found', 'No such trader in this Epoch.')
      const r = postHit(p, target, req.amount as number)
      if (r.ok) this.sql.exec("INSERT INTO bounties (kind, target_id, poster_id, amount, killer_id, ts) VALUES ('hit', ?, ?, ?, NULL, ?)", target.id, p.id, req.amount as number, now)
      return outcome(r)
    }
    if (req.op === 'collect') return this.claim(p, 'hit', PROSE.backRoom.hitCollected, PROSE.backRoom.hitNone)
    if (req.op === 'alias') {
      const alias = typeof req.alias === 'string' ? stripPipe(req.alias).trim() : ''
      if (!alias) return fail('invalid', 'Pick a name.')
      const lower = alias.toLowerCase()
      const taken = alias.startsWith('*') || MARSHALS.some(m => m.name.toLowerCase() === lower) || this.sql.exec('SELECT 1 FROM players WHERE name = ? AND id != ?', alias, p.id).toArray().length > 0
      if (taken) return fail('taken', PROSE.backRoom.aliasTaken)
      const cost = aliasCost(p.exp)
      if (cost > p.credits) return fail('invalid', `A new name costs ${cost.toLocaleString('en-US')} credits; you have ${p.credits.toLocaleString('en-US')}.`)
      p.credits -= cost
      p.name = alias
      return { events: [{ kind: 'bought', what: 'new name', qty: 1, cost }, { kind: 'text', text: fill(PROSE.backRoom.aliasDone, { name: alias }) }] }
    }
    return fail('invalid', 'Expected op hit, collect or alias.')
  }

  private beacon(p: PlayerRec, req: Record<string, unknown>): Done | Fail {
    const text = typeof req.text === 'string' ? req.text : ''
    if (!text) return fail('invalid', 'What should it say?')
    if (p.ship.equipment.beacons < 1) return fail('invalid', 'You have no beacons.')
    if (this.isConcord(p.sector)) return fail('invalid', PROSE.noBeaconInConcord)
    const row = this.sql.exec<{ beacon: string | null }>('SELECT beacon FROM sectors WHERE id = ?', p.sector).toArray()[0]
    p.ship.equipment.beacons--
    if (row?.beacon) {
      this.sql.exec('UPDATE sectors SET beacon = NULL WHERE id = ?', p.sector)
      return { events: [{ kind: 'text', text: PROSE.beaconCancel }] }
    }
    this.sql.exec('INSERT INTO sectors (id, beacon, navhaz) VALUES (?, ?, 0) ON CONFLICT(id) DO UPDATE SET beacon = excluded.beacon', p.sector, text)
    return { events: [{ kind: 'deployed', what: 'beacon', count: 1 }, { kind: 'text', text: fill(PROSE.beaconSet, { sector: p.sector }) }] }
  }

  private disrupt(p: PlayerRec, req: Record<string, unknown>, now: number): Done | Fail {
    const sector = req.sector
    if (!isInt(sector) || !isAdjacent(this.map().warps, p.sector, sector)) return fail('invalid', 'Fire it into a sector next door.')
    if (p.ship.equipment.disruptors < 1) return fail('invalid', 'You have no mine disruptors.')
    p.ship.equipment.disruptors--
    const here = (this.deploysAt([sector]).get(sector) ?? []).filter(d => d.kind !== 'fighters' && d.count > 0)
    let budget = COMBAT.disruptorMines
    let mines = 0
    let limpets = 0
    const mail: MailDraft[] = []
    // Contact mines first, limpets last.
    for (const d of [...here.filter(d => d.kind === 'contact'), ...here.filter(d => d.kind === 'limpet')]) {
      const n = Math.min(budget, d.count)
      if (!n) continue
      budget -= n
      d.count -= n
      if (d.kind === 'contact') mines += n
      else limpets += n
      mail.push({ playerId: d.ownerId, from: PROSE.mail.fightersFrom, text: fill(PROSE.mail.disrupted, { by: p.name, n, sector }) })
    }
    this.saveDeploys(here)
    this.addMail(mail, now)
    return { events: [{ kind: 'disrupted', sector, mines, limpets }] }
  }

  private sal(p: PlayerRec, req: Record<string, unknown>, now: number): Done | Fail {
    const away = this.atDrydock(p)
    if (away) return away
    const rand = rng(hashSeed(this.seed(), p.id, p.actions, 'sal'))
    if (req.op === 'trace') {
      const name = typeof req.target === 'string' ? req.target : ''
      if (!name) return fail('invalid', 'Trace whom?')
      return outcome(trace(p, this.playerByName(name), name))
    }
    if (req.op === 'password') return outcome(buyPassword(p, this.seed()))
    if (req.op === 'swear') return { events: swear(p, dayNumber(now), rand) }
    if (req.op === 'fortune') return { events: [{ kind: 'text', text: OLD_SAL.fortunes[Math.floor(rand() * OLD_SAL.fortunes.length)] }] }
    return fail('invalid', 'Expected op trace, password, swear or fortune.')
  }
}
