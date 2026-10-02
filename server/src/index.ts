// The lATENT sPACE write API. Every route but /register needs
// `Authorization: Bearer <secret>`; reads go to the R2 feed, not here.

import { Hono, type Context } from 'hono'

import { sanitizeUserText } from '../../plugin/shared/pipe'
import {
  LIMITS,
  checkPow,
  decodeStatus,
  isValidHandle,
  normalizeHandle,
  type ApiError,
  type ErrorCode,
  type MeResponse,
  type RegisterResponse,
} from '../../plugin/shared/protocol'
import type { Caller, Env, UserRow } from './env'
import { FEED_KEY, type HubResult, type PostKind } from './hub'

export { Hub } from './hub'

type App = { Bindings: Env; Variables: { user: UserRow } }

const MAX_BODY = 4096

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

async function body<T>(c: Context): Promise<Partial<T> | undefined> {
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
app.get('/feed/:key', async c => {
  if (c.env.SERVE_FEED !== '1' || c.req.param('key') !== FEED_KEY) return c.notFound()
  const obj = await c.env.FEED.get(FEED_KEY, { onlyIf: c.req.raw.headers })
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
  const location = sanitizeUserText(typeof req.location === 'string' ? req.location : '', LIMITS.locationMax).replace(/\|[0-9]{2}/g, '')
  if (!(await checkPow(handle, req.nonce, Number(c.env.POW_BITS) || LIMITS.powBits))) return fail(c, 'invalid', 'Bad proof of work.')

  const ipHash = await sha256Hex(`latent-space:${c.req.header('cf-connecting-ip') ?? 'unknown'}`)
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

app.post('/v1/call', async c => c.json(await hub(c.env).call(caller(c.get('user')))))

app.post('/v1/presence', async c => {
  const req = await body<{ status: string }>(c)
  if (!req || !decodeStatus(req.status)) return fail(c, 'invalid', 'Unknown status.')
  return c.json(await hub(c.env).presence(caller(c.get('user')), req.status as string))
})

app.post('/v1/logoff', async c => {
  await hub(c.env).logoff(c.get('user').id)
  return c.json({ ok: true })
})

function postRoute(kind: PostKind, max: number) {
  return async (c: Context<App>) => {
    const u = c.get('user')
    if (u.muted_until > now()) return fail(c, 'muted', 'You are muted for now.')
    const quiet = u.created_at + LIMITS.newAccountQuietSec - now()
    if (quiet > 0 && u.role === 'user') return fail(c, 'cooldown', `New accounts can post in ${Math.ceil(quiet / 60)} min.`)
    const req = await body<{ text: string }>(c)
    const text = typeof req?.text === 'string' ? sanitizeUserText(req.text, max) : ''
    if (!text) return fail(c, 'invalid', 'Nothing to post.')
    return hubReply(c, await hub(c.env).post(caller(u), kind, text))
  }
}

app.post('/v1/oneliners', postRoute('oneliner', LIMITS.onelinerMax))
app.post('/v1/rumors', postRoute('rumor', LIMITS.rumorMax))

const isKind = (k: unknown): k is PostKind => k === 'oneliner' || k === 'rumor'

app.post('/v1/report', async c => {
  const req = await body<{ kind: string; id: number; reason: string }>(c)
  if (!req || !isKind(req.kind) || !Number.isInteger(req.id)) return fail(c, 'invalid', 'Expected {kind, id, reason?}.')
  const reason = sanitizeUserText(typeof req.reason === 'string' ? req.reason : '', LIMITS.reportReasonMax)
  await c.env.DB.prepare('INSERT INTO reports (reporter_id, kind, item_id, reason, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(c.get('user').id, req.kind, req.id, reason, now())
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
  const req = await body<{ kind: string; id: number }>(c)
  if (!req || !isKind(req.kind) || !Number.isInteger(req.id)) return fail(c, 'invalid', 'Expected {kind, id}.')
  const r = await hub(c.env).remove(req.kind, req.id as number)
  if (r.ok) await modlog(c, 'delete', `${req.kind}:${req.id}`)
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
      await hub(c.env).purge(t.id)
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

app.notFound(c => fail(c, 'not_found', 'No such route.'))

export default app
