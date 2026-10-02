// The Hub: one global Durable Object holding the logon-screen content
// (one-liners, rumors, last callers, who's online) and publishing it to R2 as
// hub.json. Clients read that file through the cache; this object only ever
// sees writes.

import { DurableObject } from 'cloudflare:workers'

import { LIMITS, PROTOCOL_VERSION, decodeStatus, type FeedConference, type FeedPoll, type HubFeed, type TopEntry } from '../../plugin/shared/protocol'
import type { Caller, Env } from './env'

/** Never publish more often than this. */
const PUBLISH_INTERVAL_MS = 5_000
/** While anyone is online, wake this often to expire stale presence. */
const PRESENCE_SWEEP_MS = 60_000
export const FEED_KEY = 'hub.json'

export type PostKind = 'oneliner' | 'rumor'
export type HubResult<T> = { ok: true; value: T } | { ok: false; code: 'cooldown' | 'rate_limited' | 'not_found' | 'invalid' | 'closed'; message: string }

/** The message bases a fresh board starts with; the sysop edits them with /v1/mod/conference. */
export const DEFAULT_CONFERENCES = [
  { n: 1, slug: 'general', name: 'General', description: 'Anything goes. Mostly.' },
  { n: 2, slug: 'claude', name: 'Claude Talk', description: 'Prompts, skills, hooks, mods and war stories.' },
  { n: 3, slug: 'showoff', name: 'Show Off', description: 'What you built while waiting.' },
  { n: 4, slug: 'sysop', name: 'Sysop & Feedback', description: 'Bugs, ideas, complaints to the management.' },
]

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
      CREATE TABLE IF NOT EXISTS conferences (slug TEXT PRIMARY KEY, n INTEGER NOT NULL UNIQUE, name TEXT NOT NULL, sponsor TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
        posts INTEGER NOT NULL DEFAULT 0, last_post_id INTEGER NOT NULL DEFAULT 0, last_post_at INTEGER);
      CREATE TABLE IF NOT EXISTS user_stats (user_id INTEGER PRIMARY KEY, handle TEXT NOT NULL, posts INTEGER NOT NULL DEFAULT 0, calls INTEGER NOT NULL DEFAULT 0, oneliners INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS polls (id INTEGER PRIMARY KEY AUTOINCREMENT, question TEXT NOT NULL, options TEXT NOT NULL, created INTEGER NOT NULL, closed INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS votes (poll_id INTEGER NOT NULL, user_id INTEGER NOT NULL, option INTEGER NOT NULL, PRIMARY KEY (poll_id, user_id));
    `)
    if (!this.get('conferencesSeeded', 0)) {
      for (const c of DEFAULT_CONFERENCES) {
        this.sql.exec('INSERT OR IGNORE INTO conferences (slug, n, name, sponsor, description) VALUES (?, ?, ?, ?, ?)', c.slug, c.n, c.name, 'SysOp', c.description)
      }
      this.set('conferencesSeeded', 1)
    }
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

  private bumpUser(user: Caller, column: 'posts' | 'calls' | 'oneliners', by = 1) {
    this.sql.exec(
      `INSERT INTO user_stats (user_id, handle, ${column}) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET handle = excluded.handle, ${column} = ${column} + excluded.${column}`,
      user.id,
      user.handle,
      by,
    )
  }

  // ---- registration gate --------------------------------------------------

  /** Whether this IP (hashed) may register another account today. */
  async canRegister(ipHash: string): Promise<boolean> {
    if (this.get('regDay', '') === utcDay(Date.now()) && this.get('regToday', 0) >= LIMITS.registrationsPerDay) return false
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
    if (this.get('regDay', '') !== day) {
      this.set('regDay', day)
      this.set('regToday', 0)
    }
    this.bump('regToday')
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
    // A logon counts once per cooldown; repeats only keep the node alive, so a loop of calls cannot fill the list or churn the feed.
    const last = this.sql.exec<{ ts: number }>('SELECT MAX(ts) AS ts FROM callers WHERE user_id = ?', user.id).toArray()[0]?.ts
    if (last && now - last < LIMITS.callCooldownSec * 1000) {
      this.sql.exec('UPDATE presence SET updated = ? WHERE user_id = ?', now, user.id)
      return { node }
    }
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
    this.bumpUser(user, 'calls')
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

  private takeQuota(userId: number, kind: string, now: number, cooldownSec: number = LIMITS.postCooldownSec, perDay: number = LIMITS.postsPerDay): HubResult<null> {
    const day = utcDay(now)
    const row = this.sql.exec<{ last_ts: number; day: string; day_count: number }>('SELECT last_ts, day, day_count FROM quota WHERE user_id = ? AND kind = ?', userId, kind).toArray()[0]
    if (row) {
      const wait = Math.ceil((row.last_ts + cooldownSec * 1000 - now) / 1000)
      if (wait > 0) return { ok: false, code: 'cooldown', message: `Wait ${wait}s before posting again.` }
      if (row.day === day && row.day_count >= perDay) return { ok: false, code: 'rate_limited', message: 'Daily limit reached. Call back tomorrow.' }
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
    if (kind === 'oneliner') {
      this.bump('onelinersTotal')
      this.bumpUser(user, 'oneliners')
    }
    await this.markDirty()
    return { ok: true, value: { id } }
  }

  /** Who wrote an item, for reports and moderation. */
  async author(kind: PostKind, id: number): Promise<number | undefined> {
    const table = kind === 'oneliner' ? 'oneliners' : 'rumors'
    return this.sql.exec<{ user_id: number }>(`SELECT user_id FROM ${table} WHERE id = ?`, id).toArray()[0]?.user_id
  }

  // ---- message bases ------------------------------------------------------

  async conferenceSlugs(): Promise<string[]> {
    return this.sql.exec<{ slug: string }>('SELECT slug FROM conferences ORDER BY n').toArray().map(r => r.slug)
  }

  async hasConference(slug: string): Promise<boolean> {
    return this.sql.exec('SELECT 1 FROM conferences WHERE slug = ?', slug).toArray().length > 0
  }

  /** Reports are cheap to send and cost a D1 write each, so they get a daily cap. */
  async takeReportQuota(userId: number): Promise<HubResult<null>> {
    return this.takeQuota(userId, 'report', Date.now(), 0, LIMITS.reportsPerDay)
  }

  /** The cooldown and daily limit for messages, across all conferences. */
  async takeMessageQuota(userId: number): Promise<HubResult<null>> {
    return this.takeQuota(userId, 'message', Date.now(), LIMITS.messageCooldownSec, LIMITS.messagesPerDay)
  }

  /** A Board stored a post: conference counters, Top Ten, and the feed. */
  async messagePosted(user: Caller, slug: string, postId: number, ts: number): Promise<void> {
    this.sql.exec('UPDATE conferences SET posts = posts + 1, last_post_id = MAX(last_post_id, ?), last_post_at = ? WHERE slug = ?', postId, ts, slug)
    this.bump('postsTotal')
    this.bumpUser(user, 'posts')
    await this.markDirty()
  }

  /** A Board hid posts (moderation): the counters follow. */
  async messagesRemoved(slug: string, count: number, userId?: number): Promise<void> {
    if (count <= 0) return
    this.sql.exec('UPDATE conferences SET posts = MAX(0, posts - ?) WHERE slug = ?', count, slug)
    this.bump('postsTotal', -count)
    if (userId !== undefined) this.sql.exec('UPDATE user_stats SET posts = MAX(0, posts - ?) WHERE user_id = ?', count, userId)
    await this.markDirty()
  }

  /** Adds or edits a conference; `remove` drops it from the list (its Board keeps the posts). */
  async setConference(c: { slug: string; name: string; sponsor: string; description: string; n?: number; remove?: boolean }): Promise<HubResult<null>> {
    if (c.remove) {
      if (!this.run('DELETE FROM conferences WHERE slug = ?', c.slug)) return { ok: false, code: 'not_found', message: 'No such conference.' }
    } else {
      const n = c.n ?? this.sql.exec<{ n: number }>('SELECT COALESCE(MAX(n), 0) + 1 AS n FROM conferences').one().n
      const clash = this.sql.exec<{ slug: string }>('SELECT slug FROM conferences WHERE n = ? AND slug != ?', n, c.slug).toArray()[0]
      if (clash) return { ok: false, code: 'invalid', message: `Number ${n} belongs to ${clash.slug}.` }
      this.sql.exec(
        `INSERT INTO conferences (slug, n, name, sponsor, description) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(slug) DO UPDATE SET n = excluded.n, name = excluded.name, sponsor = excluded.sponsor, description = excluded.description`,
        c.slug,
        n,
        c.name,
        c.sponsor,
        c.description,
      )
    }
    await this.markDirty()
    return { ok: true, value: null }
  }

  // ---- voting booth -------------------------------------------------------

  async createPoll(question: string, options: string[]): Promise<{ id: number }> {
    const id = this.sql.exec<{ id: number }>('INSERT INTO polls (question, options, created) VALUES (?, ?, ?) RETURNING id', question, JSON.stringify(options), Date.now()).one().id
    await this.markDirty()
    return { id }
  }

  async closePoll(id: number): Promise<HubResult<null>> {
    if (!this.run('UPDATE polls SET closed = 1 WHERE id = ? AND deleted = 0', id)) return { ok: false, code: 'not_found', message: 'No such poll.' }
    await this.markDirty()
    return { ok: true, value: null }
  }

  async vote(userId: number, pollId: number, option: number): Promise<HubResult<null>> {
    const poll = this.sql.exec<{ options: string; closed: number }>('SELECT options, closed FROM polls WHERE id = ? AND deleted = 0', pollId).toArray()[0]
    if (!poll) return { ok: false, code: 'not_found', message: 'No such poll.' }
    if (poll.closed) return { ok: false, code: 'closed', message: 'The polls are closed.' }
    if (!Number.isInteger(option) || option < 0 || option >= (JSON.parse(poll.options) as string[]).length) return { ok: false, code: 'invalid', message: 'No such option.' }
    if (!this.run('INSERT OR IGNORE INTO votes (poll_id, user_id, option) VALUES (?, ?, ?)', pollId, userId, option)) {
      return { ok: false, code: 'invalid', message: 'You already voted in this one.' }
    }
    await this.markDirty()
    return { ok: true, value: null }
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
    this.sql.exec('DELETE FROM callers WHERE user_id = ?', userId)
    this.sql.exec('DELETE FROM user_stats WHERE user_id = ?', userId)
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
        postsTotal: this.get('postsTotal', 0),
      },
      conferences: this.conferences(),
      polls: this.polls(),
      top: { posters: this.top('posts'), callers: this.top('calls'), oneliners: this.top('oneliners') },
    }
  }

  private conferences(): FeedConference[] {
    return this.sql
      .exec<{ n: number; slug: string; name: string; sponsor: string; description: string; posts: number; last_post_id: number; last_post_at: number | null }>(
        'SELECT n, slug, name, sponsor, description, posts, last_post_id, last_post_at FROM conferences ORDER BY n',
      )
      .toArray()
      .map(r => ({
        n: r.n,
        slug: r.slug,
        name: r.name,
        sponsor: r.sponsor,
        description: r.description,
        posts: r.posts,
        lastPostId: r.last_post_id,
        lastPostAt: r.last_post_at ? iso(r.last_post_at) : null,
      }))
  }

  private polls(): FeedPoll[] {
    const rows = this.sql
      .exec<{ id: number; question: string; options: string; created: number; closed: number }>(
        `SELECT id, question, options, created, closed FROM polls WHERE deleted = 0
         ORDER BY closed, id DESC LIMIT ?`,
        LIMITS.feedPolls,
      )
      .toArray()
    return rows.map(r => {
      const counts = new Map(
        this.sql.exec<{ option: number; n: number }>('SELECT option, COUNT(*) AS n FROM votes WHERE poll_id = ? GROUP BY option', r.id).toArray().map(v => [v.option, v.n]),
      )
      const options = (JSON.parse(r.options) as string[]).map((text, i) => ({ text, votes: counts.get(i) ?? 0 }))
      return { id: r.id, question: r.question, options, total: options.reduce((a, o) => a + o.votes, 0), closed: !!r.closed, createdAt: iso(r.created) }
    })
  }

  private top(column: 'posts' | 'calls' | 'oneliners'): TopEntry[] {
    return this.sql
      .exec<{ handle: string; n: number }>(`SELECT handle, ${column} AS n FROM user_stats WHERE ${column} > 0 ORDER BY ${column} DESC, handle LIMIT ?`, LIMITS.topTen)
      .toArray()
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
