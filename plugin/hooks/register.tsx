// lATENT sPACE: a BBS in a pane. This module owns everything with `$`: the
// /bbs command, the pane, polling the public feed, the write API, the account
// in $.store and the coarse "what my Claude is doing" status. The screen
// itself is client/term.tsx, which posts Actions here.
//
// Nothing from the board ever reaches the model: no prompt sections, no tool
// results. It is drawn in the pane and nowhere else.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Account, Action, BoardIndex, BoardThreadFile, Feed, Presence, ScanItem, ThreadView, View } from '../types'
import { LIMITS, boardIndexKey, boardThreadKey, describeStatus, encodeStatus, leadingZeroBits, powInput, type ClaudeStatus } from '../shared/protocol'

type Dollar = EngineInterface

const PANE = 'latent-space'
const POLL_MS = 10_000
const PRESENCE_MIN_GAP_MS = 120_000
const PRESENCE_KEEPALIVE_MS = 300_000
const POW_CHUNK = 2_000
/** Characters of post bodies handed to the screen at once, around the post being read. */
const BODY_BUDGET = 30_000
const THREAD_CACHE = 12
/** How long a new post takes to reach the feed: the Board's publish delay plus the cache. */
const PUBLISH_LAG_MS = 7_000
const NEWSCAN_THREADS = 20

const view = atom({ plugin: 'latent-space', key: 'view' } as const, { phase: 'new', busy: false, claude: 'idle', lastRead: {}, votes: {} } as View)
const isOpen = atom({ plugin: 'latent-space', key: 'isOpen' } as const, false)
const etags = atom({ plugin: 'latent-space', key: 'etags' } as const, {} as Record<string, string>)
const threads = atom({ plugin: 'latent-space', key: 'threads' } as const, {} as Record<string, BoardThreadFile>)
const presence = atom({ plugin: 'latent-space', key: 'presence' } as const, { sent: '', sentAt: 0, wanted: 'idle' } as Presence)

/** Set by register from the plugin's options. */
const config = { apiUrl: 'https://bbs.mattfogel.com', feedUrl: 'https://feed.mattfogel.com/hub.json' }

/** A file next to hub.json on the feed (boards/<slug>/...). */
const feedFile = (key: string) => config.feedUrl.replace(/[^/]*$/, '') + key

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

type Fetched<T> = { status: 'fresh'; data: T } | { status: 'same' } | { status: 'missing' } | { status: 'error'; message: string }

/** GETs a feed file as JSON, with If-None-Match unless forced. */
async function fetchJson<T>($: Dollar, url: string, force: boolean): Promise<Fetched<T>> {
  const headers: Record<string, string> = {}
  const tag = (await read($, etags))[url]
  if (tag && !force) headers['if-none-match'] = tag
  let res
  try {
    res = await $.http.fetch(url, { headers })
  } catch {
    return { status: 'error', message: 'no carrier' }
  }
  if (res.status === 304) return { status: 'same' }
  if (res.status === 404) return { status: 'missing' }
  if (!res.ok) return { status: 'error', message: `HTTP ${res.status}` }
  let data: T
  try {
    data = JSON.parse(res.text)
  } catch {
    return { status: 'error', message: 'line noise' }
  }
  const tagNow = res.headers.etag ?? ''
  await update($, etags, e => ({ ...e, [url]: tagNow }))
  return { status: 'fresh', data }
}

async function poll($: Dollar, force = false) {
  if (!force && !(await read($, isOpen))) return
  const r = await fetchJson<Feed>($, config.feedUrl, force)
  if (r.status === 'error' || r.status === 'missing') {
    await update($, view, (v): View => ({ ...v, feedError: r.status === 'error' ? r.message : 'no feed' }))
  } else if (r.status === 'fresh') {
    const feed = r.data
    if (feed && typeof feed.seq === 'number' && Array.isArray(feed.oneliners)) {
      await update($, view, v => (v.feed && v.feed.seq > feed.seq ? { ...v, feedError: undefined } : { ...v, feed, feedError: undefined }))
    }
  }
  if (force) return
  // Keep what is on screen current too: cheap, since an unchanged file is a 304.
  const v = await read($, view)
  if (v.board) await loadBoard($, v.board.slug, false)
  if (v.thread) await loadThread($, v.thread.slug, v.thread.id, v.thread.focus, false)
}

// ---- message bases --------------------------------------------------------

async function loadBoard($: Dollar, slug: string, force: boolean) {
  if (force) await update($, view, (v): View => ({ ...v, board: v.board?.slug === slug ? { ...v.board, loading: true } : { slug, loading: true } }))
  const r = await fetchJson<BoardIndex>($, feedFile(boardIndexKey(slug)), force)
  await update($, view, (v): View => {
    if (v.board?.slug !== slug) return v
    if (r.status === 'fresh') return { ...v, board: { slug, index: r.data } }
    if (r.status === 'missing') return { ...v, board: { slug, index: { v: 1, slug, seq: 0, generatedAt: '', threads: [], threadsTotal: 0 } } }
    return { ...v, board: { ...v.board, loading: false } }
  })
}

const threadKey = (slug: string, id: number) => `${slug}/${id}`

/** Headers for every post, bodies only around `focus` within BODY_BUDGET. */
function windowThread(file: BoardThreadFile, focus: number): ThreadView {
  const posts: ThreadView['posts'] = file.posts.map(({ body, ...head }) => head)
  let at = file.posts.findIndex(p => p.id === focus)
  if (at < 0) at = 0
  let budget = BODY_BUDGET
  for (let d = 0; d < file.posts.length && budget > 0; d++) {
    for (const i of d ? [at - d, at + d] : [at]) {
      const p = file.posts[i]
      if (!p || budget <= 0) continue
      posts[i] = { ...posts[i], body: p.body }
      budget -= p.body.length
    }
  }
  return { slug: file.slug, id: file.id, subject: file.subject, total: file.total, posts, focus: file.posts[at]?.id ?? 0 }
}

async function loadThread($: Dollar, slug: string, id: number, focus: number | undefined, force: boolean) {
  const key = threadKey(slug, id)
  const cached = (await read($, threads))[key]
  if (force && !cached) {
    await update($, view, (v): View => ({ ...v, thread: { slug, id, subject: '', total: 0, posts: [], focus: focus ?? 0, loading: true } }))
  }
  const r = await fetchJson<BoardThreadFile>($, feedFile(boardThreadKey(slug, id)), force || !cached)
  let file = cached
  if (r.status === 'fresh') {
    file = r.data
    await update($, threads, t => {
      const next = { ...t, [key]: r.data }
      const keys = Object.keys(next)
      for (const k of keys.slice(0, Math.max(0, keys.length - THREAD_CACHE))) if (k !== key) delete next[k]
      return next
    })
  }
  const lastRead = (await read($, view)).lastRead?.[slug] ?? 0
  await update($, view, (v): View => {
    if (focus === undefined && v.thread && (v.thread.slug !== slug || v.thread.id !== id)) return v
    if (!file) return { ...v, thread: { slug, id, subject: '', total: 0, posts: [], focus: focus ?? 0, missing: r.status === 'missing' } }
    const firstUnread = file.posts.find(p => p.id > lastRead)?.id ?? file.posts[0]?.id ?? 0
    return { ...v, thread: windowThread(file, focus ?? v.thread?.focus ?? firstUnread) }
  })
}

async function markRead($: Dollar, slug: string, postId: number) {
  const v = await read($, view)
  if ((v.lastRead?.[slug] ?? 0) >= postId) return
  const lastRead = { ...v.lastRead, [slug]: postId }
  await $.store.set('lastRead', lastRead)
  await update($, view, (w): View => ({ ...w, lastRead: { ...w.lastRead, [slug]: Math.max(w.lastRead?.[slug] ?? 0, postId) } }))
}

/** Every thread with posts newer than this account's read pointers. */
async function newscan($: Dollar) {
  await update($, view, (v): View => ({ ...v, newscan: { scanning: true, items: [] } }))
  await poll($, true)
  const v = await read($, view)
  const items: ScanItem[] = []
  for (const c of v.feed?.conferences ?? []) {
    const seen = v.lastRead?.[c.slug] ?? 0
    if (c.lastPostId <= seen) continue
    const r = await fetchJson<BoardIndex>($, feedFile(boardIndexKey(c.slug)), true)
    if (r.status !== 'fresh') continue
    for (const t of r.data.threads.filter(t => t.lastPostId > seen).reverse()) {
      if (items.length >= NEWSCAN_THREADS) break
      items.push({ slug: c.slug, conference: c.name, thread: t.id, subject: t.subject, unread: 0 })
    }
  }
  for (const item of items) {
    const r = await fetchJson<BoardThreadFile>($, feedFile(boardThreadKey(item.slug, item.thread)), true)
    if (r.status === 'fresh') item.unread = r.data.posts.filter(p => p.id > (v.lastRead?.[item.slug] ?? 0)).length
  }
  await update($, view, (w): View => ({ ...w, newscan: { scanning: false, items: items.filter(i => i.unread !== 0) } }))
}

async function markAllRead($: Dollar) {
  const v = await read($, view)
  const lastRead = { ...v.lastRead }
  for (const c of v.feed?.conferences ?? []) lastRead[c.slug] = Math.max(lastRead[c.slug] ?? 0, c.lastPostId)
  await $.store.set('lastRead', lastRead)
  await update($, view, (w): View => ({ ...w, lastRead, newscan: w.newscan && { scanning: false, items: [] } }))
  await notify($, 'All messages marked read.')
}

async function sendMessage($: Dollar, m: Extract<Action, { type: 'message' }>) {
  const r = await api($, '/v1/posts', { conference: m.conference, subject: m.subject, to: m.to, body: m.body, replyTo: m.replyTo, thread: m.thread })
  if (!r.ok) return void (await notify($, r.message, true))
  const id = Number(r.data.id)
  const thread = Number(r.data.thread)
  await notify($, `Message #${id} saved.`)
  await markRead($, m.conference, id)
  // Show it now; the feed catches up once the Board publishes.
  const ts = new Date(await $.clock.now()).toISOString()
  await update($, view, (v): View => {
    if (!v.me || v.board?.slug !== m.conference || !v.board.index) return v
    const index = v.board.index
    const old = index.threads.find(t => t.id === thread)
    const row = old
      ? { ...old, posts: old.posts + 1, lastPostId: id, lastPostAt: ts, lastHandle: v.me.handle }
      : { id: thread, subject: m.subject, handle: v.me.handle, createdAt: ts, posts: 1, lastPostId: id, lastPostAt: ts, lastHandle: v.me.handle }
    return { ...v, board: { ...v.board, index: { ...index, threads: [row, ...index.threads.filter(t => t.id !== thread)] } } }
  })
  $.clock.after(PUBLISH_LAG_MS, () => void refreshAfterPost($, m.conference, thread))
  $.clock.after(PUBLISH_LAG_MS * 2, () => void refreshAfterPost($, m.conference, thread))
}

async function refreshAfterPost($: Dollar, slug: string, thread: number) {
  const v = await read($, view)
  if (v.board?.slug === slug) await loadBoard($, slug, true)
  if (v.thread?.slug === slug && v.thread.id === thread) await loadThread($, slug, thread, undefined, true)
}

async function castVote($: Dollar, pollId: number, option: number) {
  const r = await api($, '/v1/votes', { poll: pollId, option })
  if (!r.ok) return void (await notify($, r.message, true))
  const votes = { ...(await read($, view)).votes, [String(pollId)]: option }
  await $.store.set('votes', votes)
  await update($, view, (v): View => {
    const polls = v.feed?.polls?.map(p =>
      p.id === pollId ? { ...p, total: p.total + 1, options: p.options.map((o, i) => (i === option ? { ...o, votes: o.votes + 1 } : o)) } : p,
    )
    return { ...v, votes, feed: v.feed && polls ? { ...v.feed, polls } : v.feed }
  })
  await notify($, 'Vote counted.')
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
    case 'board':
      await update($, view, (v): View => ({ ...v, board: v.board?.slug === action.slug ? v.board : { slug: action.slug, loading: true }, thread: undefined }))
      await loadBoard($, action.slug, true)
      return
    case 'read': {
      const v = await read($, view)
      const same = v.thread?.slug === action.slug && v.thread.id === action.thread && !v.thread.loading
      await loadThread($, action.slug, action.thread, action.post, !same)
      const focus = (await read($, view)).thread?.focus
      if (focus) await markRead($, action.slug, focus)
      return
    }
    case 'message':
      await sendMessage($, action)
      return
    case 'newscan':
      await newscan($)
      return
    case 'markAllRead':
      await markAllRead($)
      return
    case 'vote':
      await castVote($, action.poll, action.option)
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
    const lastRead = ((await $.store.get('lastRead')) ?? {}) as Record<string, number>
    const votes = ((await $.store.get('votes')) ?? {}) as Record<string, number>
    await update($, view, (v): View => ({
      ...v,
      phase: acct ? 'ready' : 'new',
      me: acct ? { handle: acct.handle, location: acct.location, node: v.me?.node } : undefined,
      registering: undefined,
      lastRead,
      votes,
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
