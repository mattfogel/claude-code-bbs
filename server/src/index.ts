// The lATENT sPACE write API. Every route but /register needs
// `Authorization: Bearer <secret>`; reads go to the R2 feed, not here.

import { Hono, type Context } from 'hono'

import { sanitizeUserBody, sanitizeUserText, stripPipe } from '../../plugin/shared/pipe'
import {
  LIMITS,
  checkPow,
  decodeStatus,
  isReservedHandle,
  isValidHandle,
  normalizeHandle,
  SLUG_RE,
  type ApiError,
  type ErrorCode,
  type ItemKind,
  type MeResponse,
  type PostResponse,
  type RegisterResponse,
} from '../../plugin/shared/protocol'
import { mountDoor } from './door/routes'
import type { Caller, Env, UserRow } from './env'
import { FEED_KEY, type HubResult, type PostKind } from './hub'

export { Board } from './board'
export { Universe } from './door/universe'
export { Hub } from './hub'

type App = { Bindings: Env; Variables: { user: UserRow } }

// A 4,000-character post, JSON-escaped, fits with room to spare.
const MAX_BODY = 16_384

const STATUS: Record<ErrorCode, 400 | 401 | 403 | 404 | 409 | 429 | 503> = {
  invalid: 400,
  unauthorized: 401,
  banned: 403,
  muted: 403,
  forbidden: 403,
  not_found: 404,
  taken: 409,
  cooldown: 429,
  rate_limited: 429,
  busy: 503,
  closed: 409,
}

const fail = (c: Context, code: ErrorCode, message: string) => c.json<ApiError>({ error: { code, message } }, STATUS[code])

const now = () => Math.floor(Date.now() / 1000)

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

function newSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** One address per IPv4, one per /64 for IPv6: a single host holds billions of IPv6 addresses. */
function ipKey(ip: string | undefined): string {
  if (!ip) return 'unknown'
  if (!ip.includes(':')) return ip
  const groups = ip.split('::')[0].split(':')
  return groups.slice(0, 4).join(':')
}

async function body<T>(c: Context): Promise<Partial<T> | undefined> {
  if (Number(c.req.header('content-length')) > MAX_BODY) return undefined
  const text = await c.req.text()
  if (text.length > MAX_BODY) return undefined
  try {
    const value = JSON.parse(text || '{}')
    return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined
  } catch {
    return undefined
  }
}

const hub = (env: Env) => env.HUB.get(env.HUB.idFromName('global'))
const board = (env: Env, slug: string) => env.BOARD.get(env.BOARD.idFromName(slug))
const caller = (u: UserRow): Caller => ({ id: u.id, handle: u.handle, location: u.location })

function hubReply<T>(c: Context, r: HubResult<T>) {
  return r.ok ? c.json(r.value ?? { ok: true }) : fail(c, r.code, r.message)
}

const app = new Hono<App>()

app.onError((err, c) => {
  console.error(err)
  return fail(c, 'busy', 'ALL NODES BUSY - TRY AGAIN LATER')
})

app.get('/', c => c.text('lATENT sPACE - write API. Install the Claude Code plugin to call.\n'))

// Dev and tests only: production serves the feed from the public bucket.
app.get('/feed/*', async c => {
  const key = c.req.path.slice('/feed/'.length)
  if (c.env.SERVE_FEED !== '1' || !(key === FEED_KEY || /^boards\/[a-z0-9-]+\/(index|threads\/\d+)\.json$/.test(key) || /^door\/s[0-9]{1,4}\/(map|news)\.json$/.test(key))) return c.notFound()
  const obj = await c.env.FEED.get(key, { onlyIf: c.req.raw.headers })
  if (!obj) return c.notFound()
  const headers = new Headers()
  obj.writeHttpMetadata(headers)
  headers.set('etag', obj.httpEtag)
  if (!('body' in obj)) return new Response(null, { status: 304, headers })
  return new Response(obj.body, { headers })
})

// ---- registration ---------------------------------------------------------

app.post('/v1/register', async c => {
  const req = await body<{ handle: string; location: string; nonce: string }>(c)
  if (!req || typeof req.handle !== 'string' || typeof req.nonce !== 'string') return fail(c, 'invalid', 'Expected {handle, location?, nonce}.')
  const handle = normalizeHandle(req.handle)
  if (!isValidHandle(handle)) return fail(c, 'invalid', `Handles are ${LIMITS.handleMin}-${LIMITS.handleMax} letters, digits, spaces, _ - or .`)
  if (isReservedHandle(handle)) return fail(c, 'taken', `The handle "${handle}" is reserved.`)
  const location = sanitizeUserText(typeof req.location === 'string' ? req.location : '', LIMITS.locationMax).replace(/\|[0-9]{2}/g, '')
  if (!(await checkPow(handle, req.nonce, Number(c.env.POW_BITS) || LIMITS.powBits))) return fail(c, 'invalid', 'Bad proof of work.')

  const ipHash = await sha256Hex(`latent-space:${ipKey(c.req.header('cf-connecting-ip'))}`)
  const stub = hub(c.env)
  if (!(await stub.canRegister(ipHash))) return fail(c, 'rate_limited', 'Too many new accounts from this address today.')

  const secret = newSecret()
  try {
    await c.env.DB.prepare('INSERT INTO users (handle, location, secret_hash, created_at) VALUES (?, ?, ?, ?)')
      .bind(handle, location, await sha256Hex(secret), now())
      .run()
  } catch (err) {
    if (String(err).includes('UNIQUE')) return fail(c, 'taken', `The handle "${handle}" is taken.`)
    throw err
  }
  await stub.registered(ipHash)
  return c.json<RegisterResponse>({ handle, secret }, 201)
})

// ---- everything else needs an account --------------------------------------

app.use('/v1/*', async (c, next) => {
  const auth = c.req.header('authorization') ?? ''
  const m = /^Bearer ([A-Za-z0-9_-]{20,64})$/.exec(auth)
  if (!m) return fail(c, 'unauthorized', 'Missing or malformed credentials.')
  const user = await c.env.DB.prepare('SELECT id, handle, location, role, created_at, banned, muted_until FROM users WHERE secret_hash = ?')
    .bind(await sha256Hex(m[1]))
    .first<UserRow>()
  if (!user) return fail(c, 'unauthorized', 'Unknown account.')
  if (user.banned) return fail(c, 'banned', 'You have been banned from this board.')
  c.set('user', user)
  await next()
})

app.get('/v1/me', c => {
  const u = c.get('user')
  return c.json<MeResponse>({ handle: u.handle, location: u.location, role: u.role, createdAt: new Date(u.created_at * 1000).toISOString() })
})

app.post('/v1/call', async c => {
  if (c.get('user').muted_until > now()) return fail(c, 'muted', 'You are muted for now.')
  return c.json(await hub(c.env).call(caller(c.get('user'))))
})

app.post('/v1/presence', async c => {
  const req = await body<{ status: string }>(c)
  if (!req || !decodeStatus(req.status)) return fail(c, 'invalid', 'Unknown status.')
  return c.json(await hub(c.env).presence(caller(c.get('user')), req.status as string))
})

app.post('/v1/logoff', async c => {
  await hub(c.env).logoff(c.get('user').id)
  return c.json({ ok: true })
})

/** Why this user may not write right now, if they may not. */
function writeBlock(c: Context<App>) {
  const u = c.get('user')
  if (u.muted_until > now()) return fail(c, 'muted', 'You are muted for now.')
  const quiet = u.created_at + LIMITS.newAccountQuietSec - now()
  if (quiet > 0 && u.role === 'user') return fail(c, 'cooldown', `New accounts can post in ${Math.ceil(quiet / 60)} min.`)
  return undefined
}

function postRoute(kind: PostKind, max: number) {
  return async (c: Context<App>) => {
    const u = c.get('user')
    const blocked = writeBlock(c)
    if (blocked) return blocked
    const req = await body<{ text: string }>(c)
    const text = typeof req?.text === 'string' ? sanitizeUserText(req.text, max) : ''
    if (!text) return fail(c, 'invalid', 'Nothing to post.')
    return hubReply(c, await hub(c.env).post(caller(u), kind, text))
  }
}

app.post('/v1/oneliners', postRoute('oneliner', LIMITS.onelinerMax))
app.post('/v1/rumors', postRoute('rumor', LIMITS.rumorMax))

// ---- message bases ------------------------------------------------------

app.post('/v1/posts', async c => {
  const u = c.get('user')
  const blocked = writeBlock(c)
  if (blocked) return blocked
  const req = await body<{ conference: string; subject: string; to: string; body: string; replyTo: number; thread: number }>(c)
  if (!req || typeof req.conference !== 'string' || typeof req.body !== 'string') return fail(c, 'invalid', 'Expected {conference, subject?, to?, body, replyTo?, thread?}.')
  const slug = req.conference
  const replyTo = Number.isInteger(req.replyTo) ? (req.replyTo as number) : undefined
  const thread = Number.isInteger(req.thread) ? (req.thread as number) : undefined
  const text = sanitizeUserBody(req.body, LIMITS.bodyMax, LIMITS.bodyLines)
  if (!text) return fail(c, 'invalid', 'Nothing to post.')
  const subject = stripPipe(sanitizeUserText(typeof req.subject === 'string' ? req.subject : '', LIMITS.subjectMax))
  if (!subject && replyTo === undefined && thread === undefined) return fail(c, 'invalid', 'A new thread needs a subject.')
  const toRaw = typeof req.to === 'string' ? normalizeHandle(req.to) : ''
  const to = !toRaw || toRaw.toLowerCase() === 'all' ? '' : toRaw
  if (to && !isValidHandle(to)) return fail(c, 'invalid', 'To: must be a handle or All.')

  const h = hub(c.env)
  if (!SLUG_RE.test(slug) || !(await h.hasConference(slug))) return fail(c, 'not_found', 'No such conference.')
  const quota = await h.takeMessageQuota(u.id)
  if (!quota.ok) return fail(c, quota.code, quota.message)
  const r = await board(c.env, slug).post(slug, caller(u), { subject, to, body: text, replyTo, thread })
  if (!r.ok) return fail(c, r.code, r.message)
  await h.messagePosted(caller(u), slug, r.value)
  return c.json<PostResponse>({ id: r.value.id, thread: r.value.thread })
})

// ---- voting booth -------------------------------------------------------

app.post('/v1/votes', async c => {
  const req = await body<{ poll: number; option: number }>(c)
  if (!req || !Number.isInteger(req.poll) || !Number.isInteger(req.option)) return fail(c, 'invalid', 'Expected {poll, option}.')
  const blocked = writeBlock(c)
  if (blocked) return blocked
  return hubReply(c, await hub(c.env).vote(c.get('user').id, req.poll as number, req.option as number))
})

const isKind = (k: unknown): k is ItemKind => k === 'oneliner' || k === 'rumor' || k === 'post'
const isPostRef = (req: { kind?: unknown; conference?: unknown }) => req.kind !== 'post' || (typeof req.conference === 'string' && SLUG_RE.test(req.conference))

app.post('/v1/report', async c => {
  const req = await body<{ kind: string; id: number; reason: string; conference: string }>(c)
  if (!req || !isKind(req.kind) || !Number.isInteger(req.id) || !isPostRef(req)) return fail(c, 'invalid', 'Expected {kind, id, conference?, reason?}.')
  const reason = sanitizeUserText(typeof req.reason === 'string' ? req.reason : '', LIMITS.reportReasonMax)
  const quota = await hub(c.env).takeReportQuota(c.get('user').id)
  if (!quota.ok) return fail(c, quota.code, quota.message)
  await c.env.DB.prepare('INSERT OR IGNORE INTO reports (reporter_id, kind, item_id, reason, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(c.get('user').id, req.kind === 'post' ? `post:${req.conference}` : req.kind, req.id, reason, now())
    .run()
  return c.json({ ok: true })
})

// ---- moderation -------------------------------------------------------------

app.use('/v1/mod/*', async (c, next) => {
  if (c.get('user').role === 'user') return fail(c, 'forbidden', 'Sysops and mods only.')
  await next()
})

async function modlog(c: Context<App>, action: string, target: string, detail = '') {
  await c.env.DB.prepare('INSERT INTO modlog (actor_id, action, target, detail, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(c.get('user').id, action, target, detail, now())
    .run()
}

async function target(c: Context<App>, handle: unknown): Promise<UserRow | null> {
  if (typeof handle !== 'string') return null
  return c.env.DB.prepare('SELECT id, handle, location, role, created_at, banned, muted_until FROM users WHERE handle = ?')
    .bind(normalizeHandle(handle))
    .first<UserRow>()
}

app.post('/v1/mod/delete', async c => {
  const req = await body<{ kind: string; id: number; conference: string }>(c)
  if (!req || !isKind(req.kind) || !Number.isInteger(req.id) || !isPostRef(req)) return fail(c, 'invalid', 'Expected {kind, id, conference?}.')
  const id = req.id as number
  if (req.kind === 'post') {
    const slug = req.conference as string
    const b = board(c.env, slug)
    const author = await b.author(id)
    const r = await b.remove(id)
    if (!r.ok) return fail(c, r.code, r.message)
    await hub(c.env).messagesRemoved(slug, 1, author, id)
    await modlog(c, 'delete', `post:${slug}:${id}`)
    return c.json({ ok: true })
  }
  const r = await hub(c.env).remove(req.kind, id)
  if (r.ok) await modlog(c, 'delete', `${req.kind}:${id}`)
  return hubReply(c, r)
})

for (const action of ['ban', 'unban', 'mute'] as const) {
  app.post(`/v1/mod/${action}`, async c => {
    const req = await body<{ handle: string; minutes: number }>(c)
    const t = await target(c, req?.handle)
    if (!t) return fail(c, 'not_found', 'No such user.')
    if (t.role === 'sysop' || (t.role === 'mod' && c.get('user').role !== 'sysop')) return fail(c, 'forbidden', 'Not on them.')
    if (action === 'ban') {
      await c.env.DB.prepare('UPDATE users SET banned = 1 WHERE id = ?').bind(t.id).run()
      const h = hub(c.env)
      await h.purge(t.id)
      for (const slug of await h.conferenceSlugs()) await h.messagesRemoved(slug, await board(c.env, slug).purge(t.id))
    } else if (action === 'unban') {
      await c.env.DB.prepare('UPDATE users SET banned = 0 WHERE id = ?').bind(t.id).run()
    } else {
      const minutes = Math.min(Math.max(Number(req?.minutes) || 60, 1), 60 * 24 * 30)
      await c.env.DB.prepare('UPDATE users SET muted_until = ? WHERE id = ?').bind(now() + minutes * 60, t.id).run()
    }
    await modlog(c, action, t.handle, action === 'mute' ? String(req?.minutes ?? 60) : '')
    return c.json({ ok: true })
  })
}

app.post('/v1/mod/motd', async c => {
  const req = await body<{ text: string }>(c)
  const text = typeof req?.text === 'string' ? sanitizeUserText(req.text, LIMITS.motdMax) : ''
  await hub(c.env).setMotd(text)
  await modlog(c, 'motd', 'hub', text)
  return c.json({ ok: true })
})

app.post('/v1/mod/poll', async c => {
  const req = await body<{ question: string; options: unknown[] }>(c)
  const question = stripPipe(sanitizeUserText(typeof req?.question === 'string' ? req.question : '', LIMITS.pollQuestionMax))
  const options = Array.isArray(req?.options) ? req.options.map(o => stripPipe(sanitizeUserText(typeof o === 'string' ? o : '', LIMITS.pollOptionMax))).filter(Boolean) : []
  if (!question || options.length < LIMITS.pollOptionsMin || options.length > LIMITS.pollOptionsMax) {
    return fail(c, 'invalid', `A question and ${LIMITS.pollOptionsMin}-${LIMITS.pollOptionsMax} options.`)
  }
  const r = await hub(c.env).createPoll(question, options)
  await modlog(c, 'poll', String(r.id), question)
  return c.json(r)
})

app.post('/v1/mod/poll/close', async c => {
  const req = await body<{ id: number }>(c)
  if (!req || !Number.isInteger(req.id)) return fail(c, 'invalid', 'Expected {id}.')
  const r = await hub(c.env).closePoll(req.id as number)
  if (r.ok) await modlog(c, 'poll-close', String(req.id))
  return hubReply(c, r)
})

app.post('/v1/mod/conference', async c => {
  if (c.get('user').role !== 'sysop') return fail(c, 'forbidden', 'Sysop only.')
  const req = await body<{ slug: string; name: string; sponsor: string; description: string; n: number; remove: boolean }>(c)
  if (!req || typeof req.slug !== 'string' || !SLUG_RE.test(req.slug)) return fail(c, 'invalid', 'Expected {slug, name, sponsor?, description?, n?, remove?}.')
  const name = stripPipe(sanitizeUserText(typeof req.name === 'string' ? req.name : '', LIMITS.conferenceNameMax))
  if (!req.remove && !name) return fail(c, 'invalid', 'A conference needs a name.')
  const r = await hub(c.env).setConference({
    slug: req.slug,
    name,
    sponsor: stripPipe(sanitizeUserText(typeof req.sponsor === 'string' ? req.sponsor : '', LIMITS.handleMax)),
    description: sanitizeUserText(typeof req.description === 'string' ? req.description : '', LIMITS.motdMax),
    n: Number.isInteger(req.n) && (req.n as number) > 0 ? (req.n as number) : undefined,
    remove: req.remove === true,
  })
  if (r.ok) await modlog(c, req.remove ? 'conference-remove' : 'conference', req.slug, name)
  return hubReply(c, r)
})

// ---- the HYPERPLANE door --------------------------------------------------

mountDoor(app, { fail, body, writeBlock, modlog })

app.notFound(c => fail(c, 'not_found', 'No such route.'))

export default app
