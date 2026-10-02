// A Board: one Durable Object per conference (message base), named by the
// conference's slug. It holds the threads and posts and publishes them to R2
// as boards/<slug>/index.json plus one boards/<slug>/threads/<id>.json per
// thread, so reading a conference never reaches a Worker.

import { DurableObject } from 'cloudflare:workers'

import {
  LIMITS,
  PROTOCOL_VERSION,
  boardIndexKey,
  boardThreadKey,
  type BoardIndex,
  type BoardThreadFile,
} from '../../plugin/shared/protocol'
import type { Caller, Env } from './env'
import type { HubResult } from './hub'

const PUBLISH_INTERVAL_MS = 5_000
const HTTP_METADATA = { contentType: 'application/json; charset=utf-8', cacheControl: 'public, max-age=10' }

const iso = (ms: number) => new Date(ms).toISOString()

/** What the Worker hands a Board: every field already sanitized. */
export type NewPost = { subject: string; to: string; body: string; replyTo?: number; thread?: number }

type ThreadRow = { id: number; subject: string; handle: string; created: number; posts: number; last_post_id: number; last_post_at: number; last_handle: string }

export class Board extends DurableObject<Env> {
  private sql: SqlStorage

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.sql = ctx.storage.sql
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value);
      CREATE TABLE IF NOT EXISTS threads (id INTEGER PRIMARY KEY AUTOINCREMENT, subject TEXT NOT NULL, user_id INTEGER NOT NULL, handle TEXT NOT NULL, created INTEGER NOT NULL,
        posts INTEGER NOT NULL DEFAULT 0, last_post_id INTEGER NOT NULL DEFAULT 0, last_post_at INTEGER NOT NULL DEFAULT 0, last_handle TEXT NOT NULL DEFAULT '', deleted INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS posts (id INTEGER PRIMARY KEY AUTOINCREMENT, thread_id INTEGER NOT NULL, user_id INTEGER NOT NULL, handle TEXT NOT NULL, to_handle TEXT NOT NULL,
        subject TEXT NOT NULL, body TEXT NOT NULL, ts INTEGER NOT NULL, reply_to INTEGER, deleted INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS posts_thread ON posts (thread_id, id);
      CREATE INDEX IF NOT EXISTS threads_active ON threads (deleted, last_post_at);
      CREATE TABLE IF NOT EXISTS dirty_threads (thread_id INTEGER PRIMARY KEY);
    `)
  }

  private get<T extends string | number>(key: string, fallback: T): T {
    const row = this.sql.exec<{ value: T }>('SELECT value FROM meta WHERE key = ?', key).toArray()[0]
    return row ? row.value : fallback
  }

  private set(key: string, value: string | number) {
    this.sql.exec('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value)
  }

  // ---- writing ------------------------------------------------------------

  async post(slug: string, user: Caller, p: NewPost): Promise<HubResult<{ id: number; thread: number; ts: number }>> {
    this.set('slug', slug)
    const now = Date.now()
    let threadId: number
    let subject = p.subject
    let to = p.to
    if (p.replyTo !== undefined) {
      const orig = this.sql
        .exec<{ thread_id: number; handle: string; subject: string }>(
          'SELECT p.thread_id, p.handle, p.subject FROM posts p JOIN threads t ON t.id = p.thread_id WHERE p.id = ? AND p.deleted = 0 AND t.deleted = 0',
          p.replyTo,
        )
        .toArray()[0]
      if (!orig) return { ok: false, code: 'not_found', message: 'That message is gone.' }
      threadId = orig.thread_id
      if (!subject) subject = (/^re:/i.test(orig.subject) ? orig.subject : `Re: ${orig.subject}`).slice(0, LIMITS.subjectMax)
      if (!to || to === 'All') to = p.to || orig.handle
    } else if (p.thread !== undefined) {
      const t = this.sql.exec<{ subject: string }>('SELECT subject FROM threads WHERE id = ? AND deleted = 0', p.thread).toArray()[0]
      if (!t) return { ok: false, code: 'not_found', message: 'That thread is gone.' }
      threadId = p.thread
      if (!subject) subject = (/^re:/i.test(t.subject) ? t.subject : `Re: ${t.subject}`).slice(0, LIMITS.subjectMax)
    } else {
      if (!subject) return { ok: false, code: 'invalid', message: 'A new thread needs a subject.' }
      threadId = this.sql
        .exec<{ id: number }>('INSERT INTO threads (subject, user_id, handle, created) VALUES (?, ?, ?, ?) RETURNING id', subject, user.id, user.handle, now)
        .one().id
    }
    const id = this.sql
      .exec<{ id: number }>(
        'INSERT INTO posts (thread_id, user_id, handle, to_handle, subject, body, ts, reply_to) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id',
        threadId,
        user.id,
        user.handle,
        to || 'All',
        subject,
        p.body,
        now,
        p.replyTo ?? null,
      )
      .one().id
    this.sql.exec('UPDATE threads SET posts = posts + 1, last_post_id = ?, last_post_at = ?, last_handle = ? WHERE id = ?', id, now, user.handle, threadId)
    await this.markDirty([threadId])
    return { ok: true, value: { id, thread: threadId, ts: now } }
  }

  async author(postId: number): Promise<number | undefined> {
    return this.sql.exec<{ user_id: number }>('SELECT user_id FROM posts WHERE id = ?', postId).toArray()[0]?.user_id
  }

  /** Hides one post; a thread left with none goes too. */
  async remove(postId: number): Promise<HubResult<null>> {
    const row = this.sql.exec<{ thread_id: number }>('SELECT thread_id FROM posts WHERE id = ? AND deleted = 0', postId).toArray()[0]
    if (!row) return { ok: false, code: 'not_found', message: 'No such message.' }
    this.sql.exec('UPDATE posts SET deleted = 1 WHERE id = ?', postId)
    this.recount(row.thread_id)
    await this.markDirty([row.thread_id])
    return { ok: true, value: null }
  }

  /** Hides everything a user posted here (on ban). Answers how many posts went. */
  async purge(userId: number): Promise<number> {
    const threads = this.sql.exec<{ thread_id: number }>('SELECT DISTINCT thread_id FROM posts WHERE user_id = ? AND deleted = 0', userId).toArray().map(r => r.thread_id)
    if (!threads.length) return 0
    const cursor = this.sql.exec('UPDATE posts SET deleted = 1 WHERE user_id = ? AND deleted = 0', userId)
    cursor.toArray()
    for (const t of threads) this.recount(t)
    await this.markDirty(threads)
    return cursor.rowsWritten
  }

  private recount(threadId: number) {
    const n = this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM posts WHERE thread_id = ? AND deleted = 0', threadId).one().n
    const last = this.sql
      .exec<{ id: number; ts: number; handle: string }>('SELECT id, ts, handle FROM posts WHERE thread_id = ? AND deleted = 0 ORDER BY id DESC LIMIT 1', threadId)
      .toArray()[0]
    if (!last) this.sql.exec('UPDATE threads SET posts = 0, deleted = 1 WHERE id = ?', threadId)
    else this.sql.exec('UPDATE threads SET posts = ?, last_post_id = ?, last_post_at = ?, last_handle = ? WHERE id = ?', n, last.id, last.ts, last.handle, threadId)
  }

  // ---- publishing ---------------------------------------------------------

  private async markDirty(threads: number[]) {
    for (const t of threads) this.sql.exec('INSERT OR IGNORE INTO dirty_threads (thread_id) VALUES (?)', t)
    this.set('seq', this.get('seq', 0) + 1)
    const at = Math.max(Date.now(), this.get('lastPublish', 0) + PUBLISH_INTERVAL_MS)
    const current = await this.ctx.storage.getAlarm()
    if (current === null || current > at) await this.ctx.storage.setAlarm(at)
  }

  async alarm(): Promise<void> {
    await this.publish()
  }

  async index(): Promise<BoardIndex> {
    const rows = this.sql
      .exec<ThreadRow>(
        'SELECT id, subject, handle, created, posts, last_post_id, last_post_at, last_handle FROM threads WHERE deleted = 0 ORDER BY last_post_at DESC, id DESC LIMIT ?',
        LIMITS.indexThreads,
      )
      .toArray()
    return {
      v: PROTOCOL_VERSION,
      slug: this.get('slug', ''),
      seq: this.get('seq', 0),
      generatedAt: iso(Date.now()),
      threads: rows.map(r => ({
        id: r.id,
        subject: r.subject,
        handle: r.handle,
        createdAt: iso(r.created),
        posts: r.posts,
        lastPostId: r.last_post_id,
        lastPostAt: iso(r.last_post_at),
        lastHandle: r.last_handle,
      })),
      threadsTotal: this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM threads WHERE deleted = 0').one().n,
    }
  }

  async thread(id: number): Promise<BoardThreadFile | null> {
    const t = this.sql.exec<{ subject: string; posts: number }>('SELECT subject, posts FROM threads WHERE id = ? AND deleted = 0', id).toArray()[0]
    if (!t) return null
    const rows = this.sql
      .exec<{ id: number; handle: string; to_handle: string; subject: string; body: string; ts: number; reply_to: number | null }>(
        'SELECT id, handle, to_handle, subject, body, ts, reply_to FROM posts WHERE thread_id = ? AND deleted = 0 ORDER BY id DESC LIMIT ?',
        id,
        LIMITS.threadPosts,
      )
      .toArray()
      .reverse()
    const first = t.posts - rows.length + 1
    return {
      v: PROTOCOL_VERSION,
      slug: this.get('slug', ''),
      id,
      subject: t.subject,
      total: t.posts,
      posts: rows.map((r, i) => ({ id: r.id, n: first + i, handle: r.handle, to: r.to_handle, subject: r.subject, body: r.body, ts: iso(r.ts), replyTo: r.reply_to })),
    }
  }

  async publish(): Promise<void> {
    const slug = this.get('slug', '')
    if (!slug) return
    const dirty = this.sql.exec<{ thread_id: number }>('SELECT thread_id FROM dirty_threads').toArray().map(r => r.thread_id)
    for (const id of dirty) {
      const file = await this.thread(id)
      if (file) await this.env.FEED.put(boardThreadKey(slug, id), JSON.stringify(file), { httpMetadata: HTTP_METADATA })
      else await this.env.FEED.delete(boardThreadKey(slug, id))
    }
    await this.env.FEED.put(boardIndexKey(slug), JSON.stringify(await this.index()), { httpMetadata: HTTP_METADATA })
    this.sql.exec('DELETE FROM dirty_threads')
    this.set('lastPublish', Date.now())
  }
}
