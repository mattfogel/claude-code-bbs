// lATENT sPACE: a BBS in a pane. This module owns everything with `$`: the
// /bbs command, the pane, polling the public feed, the write API, the account
// in $.store and the coarse "what my Claude is doing" status. The screen
// itself is client/term.tsx, which posts Actions here.
//
// Nothing from the board ever reaches the model: no prompt sections, no tool
// results. It is drawn in the pane and nowhere else.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Account, Action, Feed, Presence, View } from '../types'
import { LIMITS, describeStatus, encodeStatus, leadingZeroBits, powInput, type ClaudeStatus } from '../shared/protocol'

type Dollar = EngineInterface

const PANE = 'latent-space'
const POLL_MS = 10_000
const PRESENCE_MIN_GAP_MS = 120_000
const PRESENCE_KEEPALIVE_MS = 300_000
const POW_CHUNK = 2_000

const view = atom({ plugin: 'latent-space', key: 'view' } as const, { phase: 'new', busy: false, claude: 'idle' } as View)
const isOpen = atom({ plugin: 'latent-space', key: 'isOpen' } as const, false)
const etag = atom({ plugin: 'latent-space', key: 'etag' } as const, '')
const presence = atom({ plugin: 'latent-space', key: 'presence' } as const, { sent: '', sentAt: 0, wanted: 'idle' } as Presence)

/** Set by register from the plugin's options. */
const config = { apiUrl: 'https://bbs.mattfogel.com', feedUrl: 'https://feed.mattfogel.com/hub.json' }

type ApiResult = { ok: true; data: Record<string, unknown> } | { ok: false; code: string; message: string }

// ---- helpers (top level: the engine follows $ only into these) ----------

async function account($: Dollar): Promise<Account | undefined> {
  return (await $.store.get('account')) as Account | undefined
}

async function notify($: Dollar, text: string, isError = false) {
  await update($, view, (v): View => ({ ...v, notice: { id: (v.notice?.id ?? 0) + 1, text, isError } }))
}

async function api($: Dollar, path: string, body?: unknown): Promise<ApiResult> {
  const acct = await account($)
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (acct && path !== '/v1/register') headers.authorization = `Bearer ${acct.secret}`
  let res
  try {
    res = await $.http.fetch(`${config.apiUrl}${path}`, { method: 'POST', headers, body: JSON.stringify(body ?? {}) })
  } catch {
    await update($, view, (v): View => ({ ...v, busy: true }))
    return { ok: false, code: 'busy', message: 'ALL NODES BUSY - TRY AGAIN LATER' }
  }
  let data: Record<string, unknown> = {}
  try {
    data = JSON.parse(res.text)
  } catch {
    // Cloudflare's own error pages (1027 when the daily limit is spent) are HTML.
  }
  const err = data.error as { code?: string; message?: string } | undefined
  if (res.ok) {
    await update($, view, v => (v.busy ? { ...v, busy: false } : v))
    return { ok: true, data }
  }
  if (res.status >= 500 || !err || err.code === 'busy') {
    await update($, view, (v): View => ({ ...v, busy: true }))
    return { ok: false, code: 'busy', message: 'ALL NODES BUSY - TRY AGAIN LATER' }
  }
  if (err.code === 'unauthorized') {
    // The account is gone server-side: start over as a new user.
    await $.store.delete('account')
    await update($, view, (v): View => ({ ...v, phase: 'new', me: undefined }))
  }
  return { ok: false, code: String(err.code), message: String(err.message ?? 'Failed.') }
}

async function poll($: Dollar, force = false) {
  if (!force && !(await read($, isOpen))) return
  const headers: Record<string, string> = {}
  const tag = await read($, etag)
  if (tag && !force) headers['if-none-match'] = tag
  let res
  try {
    res = await $.http.fetch(config.feedUrl, { headers })
  } catch (err) {
    await update($, view, (v): View => ({ ...v, feedError: 'no carrier' }))
    return
  }
  if (res.status === 304) return
  if (!res.ok) {
    await update($, view, (v): View => ({ ...v, feedError: `HTTP ${res.status}` }))
    return
  }
  let feed: Feed
  try {
    feed = JSON.parse(res.text)
  } catch {
    await update($, view, (v): View => ({ ...v, feedError: 'line noise' }))
    return
  }
  if (!feed || typeof feed.seq !== 'number' || !Array.isArray(feed.oneliners)) return
  await update($, etag, () => res.headers.etag ?? '')
  await update($, view, v => (v.feed && v.feed.seq > feed.seq ? { ...v, feedError: undefined } : { ...v, feed, feedError: undefined }))
}

/** Sends the wanted presence when it changed (at most every 2 min) or to keep the node alive. */
async function syncPresence($: Dollar) {
  if (!(await read($, isOpen))) return
  const v = await read($, view)
  if (v.phase !== 'ready' || !v.me?.node) return
  const p = await read($, presence)
  const now = await $.clock.now()
  const changed = p.wanted !== p.sent && now - p.sentAt >= PRESENCE_MIN_GAP_MS
  const stale = now - p.sentAt >= PRESENCE_KEEPALIVE_MS
  if (!changed && !stale) return
  await update($, presence, (q): Presence => ({ ...q, sent: q.wanted, sentAt: now }))
  await api($, '/v1/presence', { status: p.wanted })
}

async function setClaude($: Dollar, status: ClaudeStatus) {
  const words = status.state === 'idle' ? 'idle' : describeStatus(status).replace(/^Claude is /, '')
  await update($, view, v => (v.claude === words ? v : { ...v, claude: words }))
  const wire = encodeStatus(status)
  await update($, presence, p => (p.wanted === wire ? p : { ...p, wanted: wire }))
}

/** Finds a proof-of-work nonce a chunk at a time, then applies. */
function apply($: Dollar, handle: string, location: string) {
  void update($, view, (v): View => ({ ...v, registering: { progress: 0 } })).then(() => powStep($, { handle, location, n: 0 }))
}

type PowJob = { handle: string; location: string; n: number }

async function powStep($: Dollar, job: PowJob) {
  const expected = 2 ** LIMITS.powBits
  try {
    for (let i = 0; i < POW_CHUNK; i++, job.n++) {
      const nonce = job.n.toString(36)
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', powInput(job.handle, nonce)))
      if (leadingZeroBits(digest) >= LIMITS.powBits) return await sendApplication($, job.handle, job.location, nonce)
    }
    await update($, view, (v): View => ({ ...v, registering: { progress: Math.min(0.99, job.n / (expected * 1.5)) } }))
    $.clock.after(1, () => void powStep($, job))
  } catch {
    await update($, view, (v): View => ({ ...v, registering: undefined }))
    await notify($, 'Carrier dropped while applying. Try again.', true)
  }
}

async function sendApplication($: Dollar, handle: string, location: string, nonce: string) {
  const r = await api($, '/v1/register', { handle, location, nonce })
  if (!r.ok) {
    await update($, view, (v): View => ({ ...v, registering: undefined }))
    await notify($, r.code === 'taken' ? `"${handle}" is taken. Pick another handle.` : r.message, true)
    return
  }
  const acct: Account = { handle: String(r.data.handle), location, secret: String(r.data.secret) }
  await $.store.set('account', acct)
  await update($, view, (v): View => ({ ...v, phase: 'ready', registering: undefined, me: { handle: acct.handle, location } }))
}

async function act($: Dollar, action: Action) {
  switch (action.type) {
    case 'register':
      if ((await read($, view)).registering) return
      apply($, action.handle, action.location)
      return
    case 'call': {
      const r = await api($, '/v1/call')
      if (!r.ok) return void (await notify($, r.message, true))
      const node = Number(r.data.node)
      await update($, view, (v): View => ({ ...v, me: v.me && { ...v.me, node } }))
      const sentAt = await $.clock.now()
        await update($, presence, (q): Presence => ({ ...q, sent: 'idle', sentAt }))
      await poll($, true)
      return
    }
    case 'post': {
      const r = await api($, action.kind === 'oneliner' ? '/v1/oneliners' : '/v1/rumors', { text: action.text })
      if (!r.ok) return void (await notify($, r.message, true))
      await notify($, action.kind === 'oneliner' ? 'One-liner posted.' : 'Rumor spread.')
      await mergeOwnPost($, action.kind, Number(r.data.id), action.text)
      return
    }
    case 'logoff':
      await api($, '/v1/logoff')
      await update($, view, (v): View => ({ ...v, me: v.me && { ...v.me, node: undefined } }))
      return
    case 'refresh':
      await poll($, true)
      return
  }
}

/** Shows a post right away; the next feed replaces it with the real thing. */
async function mergeOwnPost($: Dollar, kind: 'oneliner' | 'rumor', id: number, text: string) {
  const now = new Date(await $.clock.now()).toISOString()
  await update($, view, v => {
    if (!v.feed || !v.me) return v
    const feed = { ...v.feed }
    if (kind === 'oneliner') feed.oneliners = [...feed.oneliners, { id, handle: v.me.handle, text, ts: now }].slice(-LIMITS.feedOneliners)
    else feed.rumors = [{ id, text, ts: now }, ...feed.rumors].slice(0, LIMITS.feedRumors)
    return { ...v, feed }
  })
}

async function openPane($: Dollar) {
  await update($, isOpen, () => true)
  await $.ui.open({ id: PANE, title: 'lATENT sPACE', focus: true, rows: 24, columns: 80 })
  void poll($, true)
}

export const register: Register = (on, options) => {
  config.apiUrl = String(options.apiUrl || config.apiUrl).replace(/\/+$/, '')
  config.feedUrl = String(options.feedUrl || config.feedUrl)

  // ---- hooks --------------------------------------------------------------

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'bbs', description: 'Call lATENT sPACE, the BBS in a pane' })
    const acct = await account($)
    await update($, view, (v): View => ({
      ...v,
      phase: acct ? 'ready' : 'new',
      me: acct ? { handle: acct.handle, location: acct.location, node: v.me?.node } : undefined,
      registering: undefined,
    }))
    $.clock.every(POLL_MS, () => void poll($))
    $.clock.every(30_000, () => void syncPresence($))
    return next(e)
  })

  on('command.run', { command: 'bbs' }, async $ => {
    await openPane($)
    return { text: 'Dialing lATENT sPACE... (ctrl+x tab focuses the pane, Esc hands the keys back)' }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) {
      await update($, isOpen, () => false)
      const v = await read($, view)
      if (v.me?.node) void act($, { type: 'logoff' })
    }
    return next(e)
  })

  on('ui.message', async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    const action = e.data as Action
    if (action && typeof action === 'object' && typeof action.type === 'string') await act($, action)
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') {
      const { Text } = $.ui.resolve(e)
      return <Text>lATENT sPACE needs a terminal (or the desktop app) to call.</Text>
    }
    const { Box, Client } = $.ui.resolve(e)
    const v = await read($, view)
    const columns = e.props.bodyColumns
    const rows = Math.max(10, e.props.scroll.bodyRows)
    return (
      <Box flexDirection="column">
        <Client key="term" module="../client/term.tsx" props={{ view: v, columns, rows }} width={columns} height={rows} />
      </Box>
    )
  })

  // "What my Claude is doing": coarse, main loop only, never arguments.
  on('turn.start', async ($, e, next) => {
    const r = await next(e)
    await setClaude($, { state: 'thinking' }).catch(() => {})
    return r
  })

  on('tool.call', async ($, e, next) => {
    if (!e.agentId) await setClaude($, { state: 'tool', tool: String(e.tool) }).catch(() => {})
    const r = await next(e)
    if (!e.agentId) await setClaude($, { state: 'thinking' }).catch(() => {})
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (!e.agentId) await setClaude($, { state: 'idle' }).catch(() => {})
    return r
  })
}
