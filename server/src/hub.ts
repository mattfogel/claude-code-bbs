// The Hub: one global Durable Object holding the logon-screen content
// (one-liners, rumors, last callers, who's online) and publishing it to R2 as
// hub.json. Clients read that file through the cache; this object only ever
// sees writes.

import { DurableObject } from 'cloudflare:workers'

import { LIMITS, PROTOCOL_VERSION, decodeStatus, type HubFeed } from '../../plugin/shared/protocol'
import type { Caller, Env } from './env'

/** Never publish more often than this. */
const PUBLISH_INTERVAL_MS = 5_000
/** While anyone is online, wake this often to expire stale presence. */
const PRESENCE_SWEEP_MS = 60_000
export const FEED_KEY = 'hub.json'

export type PostKind = 'oneliner' | 'rumor'
export type HubResult<T> = { ok: true; value: T } | { ok: false; code: 'cooldown' | 'rate_limited' | 'not_found'; message: string }

const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const iso = (ms: number) => new Date(ms).toISOString()

export class Hub extends DurableObject<Env> {
  private sql: SqlStorage

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.sql = ctx.storage.sql
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value);
      CREATE TABLE IF NOT EXISTS oneliners (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, handle TEXT NOT NULL, text TEXT NOT NULL, ts INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS rumors (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, text TEXT NOT NULL, ts INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS callers (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, handle TEXT NOT NULL, location TEXT NOT NULL, node INTEGER NOT NULL, ts INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS presence (user_id INTEGER PRIMARY KEY, handle TEXT NOT NULL, status TEXT NOT NULL, node INTEGER NOT NULL, since INTEGER NOT NULL, updated INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS quota (user_id INTEGER NOT NULL, kind TEXT NOT NULL, last_ts INTEGER NOT NULL, day TEXT NOT NULL, day_count INTEGER NOT NULL, PRIMARY KEY (user_id, kind));
      CREATE TABLE IF NOT EXISTS ip_quota (ip_hash TEXT PRIMARY KEY, day TEXT NOT NULL, count INTEGER NOT NULL);
    `)
  }

  // ---- meta helpers -------------------------------------------------------

  private get<T extends string | number>(key: string, fallback: T): T {
    const row = this.sql.exec<{ value: T }>('SELECT value FROM meta WHERE key = ?', key).toArray()[0]
    return row ? row.value : fallback
  }

  private set(key: string, value: string | number) {
    this.sql.exec('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value)
  }

  /** Runs a write and answers how many rows it touched. */
  private run(query: string, ...args: SqlStorageValue[]): number {
    const cursor = this.sql.exec(query, ...args)
    cursor.toArray()
    return cursor.rowsWritten
  }

  private bump(key: string, by = 1): number {
    const next = this.get<number>(key, 0) + by
    this.set(key, next)
    return next
  }

  // ---- registration gate --------------------------------------------------

  /** Whether this IP (hashed) may register another account today. */
  async canRegister(ipHash: string): Promise<boolean> {
    const row = this.sql.exec<{ day: string; count: number }>('SELECT day, count FROM ip_quota WHERE ip_hash = ?', ipHash).toArray()[0]
    return !row || row.day !== utcDay(Date.now()) || row.count < LIMITS.registrationsPerIpPerDay
  }

  async registered(ipHash: string): Promise<void> {
    const day = utcDay(Date.now())
    this.sql.exec(
      `INSERT INTO ip_quota (ip_hash, day, count) VALUES (?, ?, 1)
       ON CONFLICT(ip_hash) DO UPDATE SET count = CASE WHEN day = excluded.day THEN count + 1 ELSE 1 END, day = excluded.day`,
      ipHash,
      day,
    )
    this.sql.exec('DELETE FROM ip_quota WHERE day < ?', day)
    this.bump('users')
    await this.markDirty()
  }

  // ---- logon and presence -------------------------------------------------

  private nodeFor(userId: number): number {
    const mine = this.sql.exec<{ node: number }>('SELECT node FROM presence WHERE user_id = ?', userId).toArray()[0]
    if (mine) return mine.node
    const taken = new Set(this.sql.exec<{ node: number }>('SELECT node FROM presence').toArray().map(r => r.node))
    let node = 1
    while (taken.has(node)) node++
    return node
  }

  /** A logon: last callers, call counters, and a node in who's online. */
  async call(user: Caller): Promise<{ node: number }> {
    const now = Date.now()
    const node = this.nodeFor(user.id)
    this.sql.exec('INSERT INTO callers (user_id, handle, location, node, ts) VALUES (?, ?, ?, ?, ?)', user.id, user.handle, user.location, node, now)
    this.sql.exec('DELETE FROM callers WHERE id <= (SELECT MAX(id) FROM callers) - ?', LIMITS.feedLastCallers)
    this.upsertPresence(user, 'idle', node, now)
    const day = utcDay(now)
    if (this.get('callsDay', '') !== day) {
      this.set('callsDay', day)
      this.set('callsToday', 0)
    }
    this.bump('callsToday')
    this.bump('callsTotal')
    await this.markDirty()
    return { node }
  }

  async presence(user: Caller, status: string): Promise<{ node: number }> {
    if (!decodeStatus(status)) status = 'idle'
    const now = Date.now()
    const prev = this.sql.exec<{ status: string; node: number }>('SELECT status, node FROM presence WHERE user_id = ?', user.id).toArray()[0]
    const node = prev?.node ?? this.nodeFor(user.id)
    this.upsertPresence(user, status, node, now)
    if (!prev || prev.status !== status) await this.markDirty()
    else await this.ensureSweep()
    return { node }
  }

  private upsertPresence(user: Caller, status: string, node: number, now: number) {
    this.sql.exec(
      `INSERT INTO presence (user_id, handle, status, node, since, updated) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET handle = excluded.handle, status = excluded.status, updated = excluded.updated,
         since = CASE WHEN presence.status = excluded.status THEN presence.since ELSE excluded.since END`,
      user.id,
      user.handle,
      status,
      node,
      now,
      now,
    )
  }

  async logoff(userId: number): Promise<void> {
    if (this.run('DELETE FROM presence WHERE user_id = ?', userId) > 0) await this.markDirty()
  }

  // ---- posting ------------------------------------------------------------

  private takeQuota(userId: number, kind: PostKind, now: number): HubResult<null> {
    const day = utcDay(now)
    const row = this.sql.exec<{ last_ts: number; day: string; day_count: number }>('SELECT last_ts, day, day_count FROM quota WHERE user_id = ? AND kind = ?', userId, kind).toArray()[0]
    if (row) {
      const wait = Math.ceil((row.last_ts + LIMITS.postCooldownSec * 1000 - now) / 1000)
      if (wait > 0) return { ok: false, code: 'cooldown', message: `Wait ${wait}s before posting again.` }
      if (row.day === day && row.day_count >= LIMITS.postsPerDay) return { ok: false, code: 'rate_limited', message: 'Daily limit reached. Call back tomorrow.' }
    }
    const count = row && row.day === day ? row.day_count + 1 : 1
    this.sql.exec(
      'INSERT INTO quota (user_id, kind, last_ts, day, day_count) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, kind) DO UPDATE SET last_ts = excluded.last_ts, day = excluded.day, day_count = excluded.day_count',
      userId,
      kind,
      now,
      day,
      count,
    )
    return { ok: true, value: null }
  }

  /** `text` must already be sanitized by the Worker. */
  async post(user: Caller, kind: PostKind, text: string): Promise<HubResult<{ id: number }>> {
    const now = Date.now()
    const quota = this.takeQuota(user.id, kind, now)
    if (!quota.ok) return quota
    const id =
      kind === 'oneliner'
        ? this.sql.exec<{ id: number }>('INSERT INTO oneliners (user_id, handle, text, ts) VALUES (?, ?, ?, ?) RETURNING id', user.id, user.handle, text, now).one().id
        : this.sql.exec<{ id: number }>('INSERT INTO rumors (user_id, text, ts) VALUES (?, ?, ?) RETURNING id', user.id, text, now).one().id
    if (kind === 'oneliner') this.bump('onelinersTotal')
    await this.markDirty()
    return { ok: true, value: { id } }
  }

  /** Who wrote an item, for reports and moderation. */
  async author(kind: PostKind, id: number): Promise<number | undefined> {
    const table = kind === 'oneliner' ? 'oneliners' : 'rumors'
    return this.sql.exec<{ user_id: number }>(`SELECT user_id FROM ${table} WHERE id = ?`, id).toArray()[0]?.user_id
  }

  // ---- moderation ---------------------------------------------------------

  async remove(kind: PostKind, id: number): Promise<HubResult<null>> {
    const table = kind === 'oneliner' ? 'oneliners' : 'rumors'
    const changed = this.run(`UPDATE ${table} SET deleted = 1 WHERE id = ? AND deleted = 0`, id)
    if (!changed) return { ok: false, code: 'not_found', message: 'No such item.' }
    await this.markDirty()
    return { ok: true, value: null }
  }

  /** Hides everything a user wrote (on ban). */
  async purge(userId: number): Promise<void> {
    this.sql.exec('UPDATE oneliners SET deleted = 1 WHERE user_id = ?', userId)
    this.sql.exec('UPDATE rumors SET deleted = 1 WHERE user_id = ?', userId)
    this.sql.exec('DELETE FROM presence WHERE user_id = ?', userId)
    await this.markDirty()
  }

  async setMotd(text: string): Promise<void> {
    this.set('motd', text)
    await this.markDirty()
  }

  // ---- publishing ---------------------------------------------------------

  private async markDirty() {
    this.set('dirty', 1)
    this.set('seq', this.get('seq', 0) + 1)
    await this.schedule(Math.max(Date.now(), this.get('lastPublish', 0) + PUBLISH_INTERVAL_MS))
  }

  private async ensureSweep() {
    await this.schedule(Date.now() + PRESENCE_SWEEP_MS)
  }

  private async schedule(at: number) {
    const current = await this.ctx.storage.getAlarm()
    if (current === null || current > at) await this.ctx.storage.setAlarm(at)
  }

  async alarm(): Promise<void> {
    const now = Date.now()
    const expired = this.run('DELETE FROM presence WHERE updated < ?', now - LIMITS.presenceTtlSec * 1000)
    if (expired) this.set('seq', this.get('seq', 0) + 1)
    if (expired || this.get('dirty', 0)) {
      await this.publish()
    }
    const online = this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM presence').one().n
    if (online > 0) await this.schedule(now + PRESENCE_SWEEP_MS)
  }

  /** The feed as it stands; what publish() writes. */
  async snapshot(): Promise<HubFeed> {
    const now = Date.now()
    const today = utcDay(now)
    return {
      v: PROTOCOL_VERSION,
      seq: this.get('seq', 0),
      generatedAt: iso(now),
      motd: this.get('motd', ''),
      oneliners: this.sql
        .exec<{ id: number; handle: string; text: string; ts: number }>('SELECT id, handle, text, ts FROM oneliners WHERE deleted = 0 ORDER BY id DESC LIMIT ?', LIMITS.feedOneliners)
        .toArray()
        .reverse()
        .map(r => ({ id: r.id, handle: r.handle, text: r.text, ts: iso(r.ts) })),
      rumors: this.sql
        .exec<{ id: number; text: string; ts: number }>('SELECT id, text, ts FROM rumors WHERE deleted = 0 ORDER BY id DESC LIMIT ?', LIMITS.feedRumors)
        .toArray()
        .map(r => ({ id: r.id, text: r.text, ts: iso(r.ts) })),
      lastCallers: this.sql
        .exec<{ handle: string; location: string; node: number; ts: number }>('SELECT handle, location, node, ts FROM callers ORDER BY id DESC LIMIT ?', LIMITS.feedLastCallers)
        .toArray()
        .map(r => ({ handle: r.handle, location: r.location, node: r.node, ts: iso(r.ts) })),
      nodes: this.sql
        .exec<{ handle: string; status: string; node: number; since: number }>('SELECT handle, status, node, since FROM presence ORDER BY node')
        .toArray()
        .map(r => ({ node: r.node, handle: r.handle, status: r.status, since: iso(r.since) })),
      stats: {
        users: this.get('users', 0),
        callsToday: this.get('callsDay', '') === today ? this.get('callsToday', 0) : 0,
        callsTotal: this.get('callsTotal', 0),
        onelinersTotal: this.get('onelinersTotal', 0),
      },
    }
  }

  async publish(): Promise<void> {
    const feed = await this.snapshot()
    await this.env.FEED.put(FEED_KEY, JSON.stringify(feed), {
      httpMetadata: { contentType: 'application/json; charset=utf-8', cacheControl: 'public, max-age=10' },
    })
    this.set('dirty', 0)
    this.set('lastPublish', Date.now())
  }
}
