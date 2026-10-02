import { SELF, applyD1Migrations, env, runDurableObjectAlarm } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'

import { leadingZeroBits, powInput, type HubFeed } from '../../plugin/shared/protocol'

const BITS = Number(env.POW_BITS)
const BASE = 'https://bbs.test'
let ipCounter = 0

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
})

async function solve(handle: string): Promise<string> {
  for (let n = 0; ; n++) {
    const nonce = n.toString(36)
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', powInput(handle, nonce)))
    if (leadingZeroBits(digest) >= BITS) return nonce
  }
}

function api(path: string, init: { secret?: string; body?: unknown; ip?: string; method?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (init.secret) headers.authorization = `Bearer ${init.secret}`
  if (init.ip) headers['cf-connecting-ip'] = init.ip
  return SELF.fetch(`${BASE}${path}`, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
}

/** Registers a user from a fresh IP and lifts the new-account quiet period. */
async function user(handle: string, opts: { role?: string } = {}) {
  const res = await api('/v1/register', { body: { handle, location: 'Cyberspace', nonce: await solve(handle) }, ip: `10.0.0.${++ipCounter}` })
  expect(res.status).toBe(201)
  const { secret } = (await res.json()) as { secret: string }
  await env.DB.prepare('UPDATE users SET created_at = created_at - 3600, role = ? WHERE handle = ?').bind(opts.role ?? 'user', handle).run()
  return secret
}

async function publishedFeed(): Promise<HubFeed> {
  const stub = env.HUB.get(env.HUB.idFromName('global'))
  await runDurableObjectAlarm(stub)
  const res = await SELF.fetch(`${BASE}/feed/hub.json`)
  expect(res.status).toBe(200)
  return res.json()
}

describe('register', () => {
  it('issues a secret once and claims the handle', async () => {
    const nonce = await solve('Phiber')
    const res = await api('/v1/register', { body: { handle: 'Phiber', location: '|04NYC\u0007', nonce }, ip: '10.1.0.1' })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { handle: string; secret: string }
    expect(body.handle).toBe('Phiber')
    expect(body.secret).toMatch(/^[A-Za-z0-9_-]{43}$/)

    const row = await env.DB.prepare('SELECT location, secret_hash FROM users WHERE handle = ?').bind('Phiber').first<{ location: string; secret_hash: string }>()
    expect(row?.location).toBe('NYC')
    expect(row?.secret_hash).not.toContain(body.secret)

    const again = await api('/v1/register', { body: { handle: 'phiber', nonce: await solve('phiber') }, ip: '10.1.0.2' })
    expect(again.status).toBe(409)
  })

  it('rejects bad handles and bad proof of work', async () => {
    expect((await api('/v1/register', { body: { handle: 'x', nonce: '0' } })).status).toBe(400)
    expect((await api('/v1/register', { body: { handle: '<script>', nonce: '0' } })).status).toBe(400)
    let bad = 0
    while (leadingZeroBits(new Uint8Array(await crypto.subtle.digest('SHA-256', powInput('Lamer', bad.toString(36))))) >= BITS) bad++
    expect((await api('/v1/register', { body: { handle: 'Lamer', nonce: bad.toString(36) } })).status).toBe(400)
  })

  it('limits registrations per address per day', async () => {
    for (let i = 0; i < 3; i++) {
      const h = `Clone${i}`
      expect((await api('/v1/register', { body: { handle: h, nonce: await solve(h) }, ip: '10.2.0.1' })).status).toBe(201)
    }
    const res = await api('/v1/register', { body: { handle: 'Clone3', nonce: await solve('Clone3') }, ip: '10.2.0.1' })
    expect(res.status).toBe(429)
  })
})

describe('auth', () => {
  it('needs a known bearer secret', async () => {
    expect((await api('/v1/me')).status).toBe(401)
    expect((await api('/v1/me', { secret: 'A'.repeat(43) })).status).toBe(401)
    const secret = await user('Acid Burn')
    const me = await api('/v1/me', { secret })
    expect(me.status).toBe(200)
    expect(await me.json()).toMatchObject({ handle: 'Acid Burn', role: 'user' })
  })
})

describe('posting', () => {
  it('keeps new accounts quiet for a while', async () => {
    const res = await api('/v1/register', { body: { handle: 'Newbie', nonce: await solve('Newbie') }, ip: '10.3.0.1' })
    const { secret } = (await res.json()) as { secret: string }
    const post = await api('/v1/oneliners', { secret, body: { text: 'first!' } })
    expect(post.status).toBe(429)
    expect(((await post.json()) as { error: { code: string } }).error.code).toBe('cooldown')
  })

  it('sanitizes, rate limits and publishes one-liners and rumors', async () => {
    const secret = await user('Zero Cool')
    const ok = await api('/v1/oneliners', { secret, body: { text: '|11hack the |15planet\u001b[2J |99%UN' } })
    expect(ok.status).toBe(200)
    const again = await api('/v1/oneliners', { secret, body: { text: 'second' } })
    expect(again.status).toBe(429)
    expect((await api('/v1/oneliners', { secret, body: { text: '   ' } })).status).toBe(400)
    expect((await api('/v1/rumors', { secret, body: { text: 'the sysop runs Telegard' } })).status).toBe(200)

    const feed = await publishedFeed()
    const mine = feed.oneliners.find(o => o.handle === 'Zero Cool')
    expect(mine?.text).toBe('|11hack the |15planet')
    expect(feed.rumors.map(r => r.text)).toContain('the sysop runs Telegard')
    expect(JSON.stringify(feed.rumors)).not.toContain('Zero Cool')
  })
})

describe('logon and presence', () => {
  it('hands out nodes, records callers and shows coarse status', async () => {
    const a = await user('Cereal')
    const b = await user('Lord Nikon')
    const na = (await (await api('/v1/call', { secret: a, body: {} })).json()) as { node: number }
    const nb = (await (await api('/v1/call', { secret: b, body: {} })).json()) as { node: number }
    expect(na.node).not.toBe(nb.node)

    expect((await api('/v1/presence', { secret: a, body: { status: 'tool:Bash' } })).status).toBe(200)
    expect((await api('/v1/presence', { secret: a, body: { status: 'reading ~/secret-project' } })).status).toBe(400)

    const feed = await publishedFeed()
    expect(feed.nodes.find(n => n.handle === 'Cereal')?.status).toBe('tool:Bash')
    expect(feed.lastCallers[0].handle).toBe('Lord Nikon')
    expect(feed.stats.callsToday).toBeGreaterThanOrEqual(2)

    await api('/v1/logoff', { secret: a, body: {} })
    expect((await publishedFeed()).nodes.some(n => n.handle === 'Cereal')).toBe(false)
  })

  it('serves the feed with ETags', async () => {
    await publishedFeed()
    const first = await SELF.fetch(`${BASE}/feed/hub.json`)
    const etag = first.headers.get('etag')!
    expect(first.headers.get('cache-control')).toBe('public, max-age=10')
    await first.arrayBuffer()
    const second = await SELF.fetch(`${BASE}/feed/hub.json`, { headers: { 'if-none-match': etag } })
    expect(second.status).toBe(304)
  })
})

describe('moderation', () => {
  it('lets the sysop delete, ban and set the motd', async () => {
    const sysop = await user('SysOp', { role: 'sysop' })
    const lamer = await user('Lamer2')
    expect((await api('/v1/mod/motd', { secret: lamer, body: { text: 'pwned' } })).status).toBe(403)

    const posted = (await (await api('/v1/oneliners', { secret: lamer, body: { text: 'buy warez at ...' } })).json()) as { id: number }
    expect((await api('/v1/mod/delete', { secret: sysop, body: { kind: 'oneliner', id: posted.id } })).status).toBe(200)
    expect((await api('/v1/mod/delete', { secret: sysop, body: { kind: 'oneliner', id: posted.id } })).status).toBe(404)

    expect((await api('/v1/mod/ban', { secret: sysop, body: { handle: 'lamer2' } })).status).toBe(200)
    const banned = await api('/v1/me', { secret: lamer })
    expect(banned.status).toBe(403)
    expect((await api('/v1/mod/ban', { secret: lamer, body: { handle: 'SysOp' } })).status).toBe(403)

    expect((await api('/v1/mod/motd', { secret: sysop, body: { text: '|13welcome to |15lATENT sPACE' } })).status).toBe(200)
    const feed = await publishedFeed()
    expect(feed.motd).toBe('|13welcome to |15lATENT sPACE')
    expect(feed.oneliners.some(o => o.text.includes('warez'))).toBe(false)

    const log = await env.DB.prepare('SELECT action FROM modlog ORDER BY id').all<{ action: string }>()
    expect(log.results.map(r => r.action)).toEqual(['delete', 'ban', 'motd'])
  })
})
