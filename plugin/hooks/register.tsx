// lATENT sPACE: a BBS in a pane. This module owns everything with `$`: the
// /bbs command, the pane, polling the public feed, the write API, the account
// in $.store and the coarse "what my Claude is doing" status. The screen
// itself is client/term.tsx, which posts Actions here.
//
// Nothing from the board ever reaches the model: no prompt sections, no tool
// results. It is drawn in the pane and nowhere else.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Account, Action, BoardIndex, Outbox, BoardThreadFile, Feed, Presence, ScanItem, SysopOp, ThreadView, View } from '../types'
import { LIMITS, boardIndexKey, boardThreadKey, describeStatus, encodeStatus, leadingZeroBits, powInput, type ClaudeStatus } from '../shared/protocol'
import { sanitizeUserText, stripPipe } from '../shared/pipe'

type Dollar = EngineInterface

const PANE = 'latent-space'
const POLL_MS = 10_000
/** The poll interval while the pane is open but does not have the keys. */
const UNFOCUSED_POLL_MS = 30_000
/** How often the closed pane checks hub.json for messages addressed to this caller. */
const PAGER_MS = 120_000
/** How long a turn runs before the prompt hint mentions the board. */
const NUDGE_AFTER_MS = 30_000
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
const nudge = atom({ plugin: 'latent-space', key: 'nudge' } as const, '')

/**
 * Defaults, overridden at session start by LATENT_SPACE_API_URL, LATENT_SPACE_FEED_URL, LATENT_SPACE_MODEM
 * (a baud rate, or off), LATENT_SPACE_PAGER=off (no reply alerts while the pane is closed) and
 * LATENT_SPACE_NUDGE=off (no board line in the prompt hint during long turns).
 */
const config = { apiUrl: 'https://bbs.mattfogel.com', feedUrl: 'https://feed.mattfogel.com/hub.json', baud: 28800, pager: true, nudge: true }

// Bookkeeping that may start over on a hot reload without harm.
/** Main-loop tool calls still running, so parallel calls don't report "thinking" early. */
let toolsInFlight = 0
let lastPollAt = 0
/** The main-loop turn running now, for the waiting-room nudge. */
let turnNow: string | undefined
/** The status line last pinned, so polls don't re-pin the same text. */
let pinned: string | undefined
/** The highest action seq run per screen instance; mirrored in view.acks, which outlives a reload. */
const acked = new Map<string, number>()

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

async function api($: Dollar, path: string, body?: unknown, method: 'GET' | 'POST' = 'POST'): Promise<ApiResult> {
  const acct = await account($)
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (acct && path !== '/v1/register') headers.authorization = `Bearer ${acct.secret}`
  let res
  try {
    res = await $.http.fetch(`${config.apiUrl}${path}`, method === 'GET' ? { headers } : { method, headers, body: JSON.stringify(body ?? {}) })
  } catch {
    await update($, view, (v): View => ({ ...v, busy: true, busyNet: true }))
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
    await update($, view, v => (v.busy ? { ...v, busy: false, busyNet: undefined } : v))
    return { ok: true, data }
  }
  if (res.status >= 500 || !err || err.code === 'busy') {
    await update($, view, (v): View => ({ ...v, busy: true, busyNet: undefined }))
    return { ok: false, code: 'busy', message: 'ALL NODES BUSY - TRY AGAIN LATER' }
  }
  if (err.code === 'unauthorized') {
    // The account is gone server-side: start over as a new user, but keep the old
    // secret, so a server-side mistake never costs anyone their handle for good.
    if (acct) await $.store.set('accountRevoked', { ...acct, revokedAt: await $.clock.now() })
    await $.store.delete('account')
    await update($, view, (v): View => ({ ...v, phase: 'new', me: undefined }))
    return { ok: false, code: 'unauthorized', message: 'The board no longer knows this account. Apply again; the old key is kept as accountRevoked.' }
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

async function paneFocused($: Dollar): Promise<boolean> {
  return (await $.ui.panes()).some(p => p.id === PANE && p.isFocused)
}

/** Fetches hub.json and takes it into the view; answers whether the fetch reached the feed. */
async function fetchFeed($: Dollar, force: boolean): Promise<boolean> {
  const r = await fetchJson<Feed>($, config.feedUrl, force)
  if (r.status === 'error' || r.status === 'missing') {
    await update($, view, (v): View => ({ ...v, feedError: r.status === 'error' ? r.message : 'no feed' }))
    return false
  }
  const feed = r.status === 'fresh' ? r.data : undefined
  const ok = !feed || (typeof feed.seq === 'number' && Array.isArray(feed.oneliners))
  await update($, view, (v): View => {
    // A network-caused busy ends once the network answers again; a server busy waits for a write.
    const w = v.busyNet ? { ...v, busy: false, busyNet: undefined } : v
    if (!feed || !ok || (w.feed && w.feed.seq > feed.seq)) return w.feedError || w !== v ? { ...w, feedError: undefined } : w
    return { ...w, feed, feedError: undefined }
  })
  if (feed && ok) await checkMail($)
  return true
}

async function poll($: Dollar, force = false) {
  if (!force && !(await read($, isOpen))) return
  const now = await $.clock.now()
  if (!force) {
    const focused = await paneFocused($)
    if (!focused) {
      const v = await read($, view)
      if (v.alert) await update($, view, (w): View => ({ ...w, alert: undefined }))
      if (now - lastPollAt < UNFOCUSED_POLL_MS - 1_000) return
    }
  }
  lastPollAt = now
  if (!(await fetchFeed($, force)) || force) return
  // Keep what is on screen current too, but only fetch a file the feed says has changed.
  const v = await read($, view)
  const conf = v.board && v.feed?.conferences?.find(c => c.slug === v.board?.slug)
  if (v.board && (!v.board.index || !conf || conf.lastPostId > Math.max(0, ...v.board.index.threads.map(t => t.lastPostId)))) {
    await loadBoard($, v.board.slug, false)
  }
  if (v.thread) {
    const row = v.board?.slug === v.thread.slug ? (await read($, view)).board?.index?.threads.find(t => t.id === v.thread?.id) : undefined
    const newest = Math.max(0, ...v.thread.posts.map(p => p.id))
    if (!row || row.lastPostId > newest) await loadThread($, v.thread.slug, v.thread.id, v.thread.focus, false)
  }
}

/** While the pane is closed: hub.json now and then, for replies addressed to this caller. */
async function pager($: Dollar) {
  if (!config.pager || (await read($, isOpen)) || !(await account($))) return
  await fetchFeed($, false)
}

const oneLine = (text: string, max: number) => stripPipe(sanitizeUserText(text, max))

/** Posts addressed to this caller (not by them) past their read pointers, newest first. */
function forMe(v: View) {
  const me = v.me?.handle.toLowerCase()
  if (!me || !v.feed?.recent) return []
  const live = new Set((v.feed.conferences ?? []).map(c => c.slug))
  return v.feed.recent.filter(p => live.has(p.slug) && p.to.toLowerCase() === me && p.handle.toLowerCase() !== me && p.id > (v.lastRead?.[p.slug] ?? 0))
}

/** Pins the unread count under the prompt and toasts replies not toasted before. */
async function checkMail($: Dollar) {
  const v = await read($, view)
  const mine = forMe(v)
  const line = mine.length ? `lATENT sPACE: ${mine.length} message${mine.length === 1 ? '' : 's'} for you${(await read($, isOpen)) ? '' : ' · /bbs'}` : undefined
  if (line !== pinned) {
    pinned = line
    $.ui.status(line)
  }
  const told = ((await $.store.get('told')) ?? {}) as Record<string, number>
  const fresh = mine.filter(p => p.id > (told[p.slug] ?? 0))
  if (!fresh.length) return
  const next = { ...told }
  for (const p of fresh) next[p.slug] = Math.max(next[p.slug] ?? 0, p.id)
  await $.store.set('told', next)
  const p = fresh[0]
  $.ui.toast(
    fresh.length === 1
      ? `${oneLine(p.handle, LIMITS.handleMax)} replied to you on lATENT sPACE: ${oneLine(p.subject, LIMITS.subjectMax)}`
      : `${fresh.length} new messages for you on lATENT sPACE`,
    { timeoutMs: 8_000 },
  )
}

/** Once a turn has run a while with the board out of sight, the prompt hint mentions it. */
async function nudgeCheck($: Dollar, turnId: string) {
  if (!config.nudge || turnNow !== turnId || !(await account($))) return
  if ((await $.ui.panes()).some(p => p.id === PANE && p.isShown)) return
  if (!(await read($, isOpen))) await fetchFeed($, false)
  const v = await read($, view)
  if (turnNow !== turnId || !v.feed) return
  const online = v.feed.nodes.length
  const unread = (v.feed.recent ?? []).filter(p => p.handle.toLowerCase() !== v.me?.handle.toLowerCase() && p.id > (v.lastRead?.[p.slug] ?? 0)).length
  const text = `/bbs: ${online} online${unread ? `, ${unread}${unread >= LIMITS.feedRecent ? '+' : ''} new` : ''}`
  await update($, nudge, () => text)
}

/** The pane holds the keys and Claude wants them back: say so on the board and in a toast. */
async function needsYou($: Dollar, alert: string, toast: string) {
  if (!(await read($, isOpen)) || !(await paneFocused($))) return
  await update($, view, (v): View => ({ ...v, alert }))
  $.ui.toast(toast, { timeoutMs: 10_000 })
}

const duration = (ms: number) => (ms >= 60_000 ? `${Math.floor(ms / 60_000)}m${String(Math.round((ms % 60_000) / 1000)).padStart(2, '0')}s` : `${Math.round(ms / 1000)}s`)

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
  await checkMail($)
}

/** Every thread with posts newer than this account's read pointers. */
async function newscan($: Dollar) {
  await update($, view, (v): View => ({ ...v, newscan: { scanning: true, items: [] } }))
  await poll($, true)
  const v = await read($, view)
  const items: ScanItem[] = []
  const confs = (v.feed?.conferences ?? []).filter(c => c.lastPostId > (v.lastRead?.[c.slug] ?? 0))
  const indexes = await Promise.all(confs.map(c => fetchJson<BoardIndex>($, feedFile(boardIndexKey(c.slug)), true)))
  confs.forEach((c, i) => {
    const r = indexes[i]
    if (r.status !== 'fresh') return
    const seen = v.lastRead?.[c.slug] ?? 0
    for (const t of r.data.threads.filter(t => t.lastPostId > seen).reverse()) {
      if (items.length >= NEWSCAN_THREADS) break
      items.push({ slug: c.slug, conference: c.name, thread: t.id, subject: t.subject, unread: 0 })
    }
  })
  const files = await Promise.all(items.map(item => fetchJson<BoardThreadFile>($, feedFile(boardThreadKey(item.slug, item.thread)), true)))
  items.forEach((item, i) => {
    const r = files[i]
    if (r.status === 'fresh') item.unread = r.data.posts.filter(p => p.id > (v.lastRead?.[item.slug] ?? 0)).length
  })
  await update($, view, (w): View => ({ ...w, newscan: { scanning: false, items: items.filter(i => i.unread !== 0) } }))
}

async function markAllRead($: Dollar) {
  const v = await read($, view)
  const lastRead = { ...v.lastRead }
  for (const c of v.feed?.conferences ?? []) lastRead[c.slug] = Math.max(lastRead[c.slug] ?? 0, c.lastPostId)
  await $.store.set('lastRead', lastRead)
  await update($, view, (w): View => ({ ...w, lastRead, newscan: w.newscan && { scanning: false, items: [] } }))
  await checkMail($)
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

/** Carries out one sysop-menu change, then refreshes the feed once it has published. */
async function sysop($: Dollar, op: SysopOp) {
  let r: ApiResult
  let done: string
  switch (op.kind) {
    case 'conference':
      r = await api($, '/v1/mod/conference', { slug: op.slug, name: op.name, sponsor: op.sponsor, description: op.description, n: op.n, remove: op.remove })
      done = op.remove ? `Conference ${op.slug} removed.` : `Conference ${op.slug} saved.`
      break
    case 'poll':
      r = await api($, '/v1/mod/poll', { question: op.question, options: op.options })
      done = 'Poll opened.'
      break
    case 'closePoll':
      r = await api($, '/v1/mod/poll/close', { id: op.id })
      done = 'Poll closed.'
      break
    case 'motd':
      r = await api($, '/v1/mod/motd', { text: op.text })
      done = 'Message of the day set.'
      break
    case 'user':
      r = await api($, `/v1/mod/${op.action}`, { handle: op.handle, minutes: op.minutes })
      done = op.action === 'mute' ? `${op.handle} muted for ${op.minutes ?? 60} min.` : `${op.handle} ${op.action === 'ban' ? 'banned' : 'unbanned'}.`
      break
    case 'deletePost':
      r = await api($, '/v1/mod/delete', { kind: 'post', conference: op.conference, id: op.id })
      done = `Message #${op.id} deleted.`
      if (r.ok) {
        $.clock.after(PUBLISH_LAG_MS, () => void refreshAfterPost($, op.conference, op.thread))
        $.clock.after(PUBLISH_LAG_MS * 2, () => void refreshAfterPost($, op.conference, op.thread))
      }
      break
  }
  if (!r.ok) return void (await notify($, r.message, true))
  await notify($, `${done} The feed shows it in a few seconds.`)
  $.clock.after(PUBLISH_LAG_MS, () => void poll($, true))
  $.clock.after(PUBLISH_LAG_MS * 2, () => void poll($, true))
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
      // The role decides whether the hidden sysop key does anything; the server checks it again on every call.
      const me = await api($, '/v1/me', undefined, 'GET')
      const role = me.ok && (me.data.role === 'sysop' || me.data.role === 'mod') ? me.data.role : 'user'
      await update($, view, (v): View => ({ ...v, me: v.me && { ...v.me, role } }))
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
    case 'sysop':
      await sysop($, action.op)
      return
    case 'report': {
      const r = await api($, '/v1/report', { kind: 'post', conference: action.conference, id: action.id })
      await notify($, r.ok ? 'Reported to the SysOp. Thanks.' : r.message, !r.ok)
      return
    }
  }
}

/** Runs the actions of an outbox not run before, in order. */
async function runOutbox($: Dollar, box: Outbox) {
  if (typeof box.iid !== 'string' || !Array.isArray(box.actions)) return
  if (!acked.has(box.iid)) {
    const known = (await read($, view)).acks?.[box.iid] ?? 0
    if (!acked.has(box.iid)) acked.set(box.iid, known)
  }
  const done = acked.get(box.iid) ?? 0
  const todo = box.actions.filter(a => a && typeof a.seq === 'number' && a.seq > done && a.action && typeof a.action.type === 'string')
  if (!todo.length) return
  // Claimed before anything awaits, so a second post carrying the same actions skips them.
  const top = Math.max(...todo.map(a => a.seq))
  acked.set(box.iid, top)
  await update($, view, (v): View => ({ ...v, acks: { ...Object.fromEntries(Object.entries(v.acks ?? {}).slice(-7)), [box.iid]: top } }))
  for (const a of todo) await act($, a.action)
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

export const register: Register = on => {

  // ---- hooks --------------------------------------------------------------

  on('session.start', async ($, e, next) => {
    const apiUrl = await $.env.get('LATENT_SPACE_API_URL')
    const feedUrl = await $.env.get('LATENT_SPACE_FEED_URL')
    const modem = await $.env.get('LATENT_SPACE_MODEM')
    if (apiUrl) config.apiUrl = apiUrl.replace(/\/+$/, '')
    if (feedUrl) config.feedUrl = feedUrl
    if (modem) config.baud = modem === 'off' ? 0 : Number(modem) || config.baud
    config.pager = (await $.env.get('LATENT_SPACE_PAGER')) !== 'off'
    config.nudge = (await $.env.get('LATENT_SPACE_NUDGE')) !== 'off'
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
    // Plugins get no install hook, so the first session that loads this one says how to start it, once.
    if (!(await $.store.get('welcomed'))) {
      await $.store.set('welcomed', true)
      if (!acct) $.ui.toast('lATENT sPACE is installed. Type /bbs to dial in.', { timeoutMs: 15_000 })
    }
    $.clock.every(POLL_MS, () => void poll($))
    $.clock.every(30_000, () => void syncPresence($))
    $.clock.every(PAGER_MS, () => void pager($))
    return next(e)
  })

  // Quitting with the pane open: free the node instead of leaving it in Who's Online for ten minutes.
  // A /clear keeps the process, and the pane, going.
  on('session.end', async ($, e, next) => {
    if (e.reason !== 'clear' && (await read($, isOpen)) && (await read($, view)).me?.node) await api($, '/v1/logoff').catch(() => {})
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
    const data = e.data as Action | Outbox
    if (data && typeof data === 'object' && data.type === 'batch') await runOutbox($, data)
    else if (data && typeof data === 'object' && typeof data.type === 'string') await act($, data)
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
        <Client key="term" module="../client/term.tsx" props={{ view: v, columns, rows, baud: config.baud }} width={columns} height={rows} />
      </Box>
    )
  })

  // The waiting room: during a long turn the hint under the prompt mentions the board. It never opens it.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const tail = await read($, nudge)
    if (!tail || !e.props.isWorking) return next(e)
    return next({ ...e, props: { ...e.props, tail: e.props.tail ? `${e.props.tail} · ${tail}` : tail } })
  })

  // "What my Claude is doing": coarse, main loop only, never arguments.
  on('turn.start', async ($, e, next) => {
    const r = await next(e)
    toolsInFlight = 0
    turnNow = r.turnId
    const turnId = r.turnId
    await update($, view, v => (v.alert ? { ...v, alert: undefined } : v)).catch(() => {})
    await setClaude($, { state: 'thinking' }).catch(() => {})
    $.clock.after(NUDGE_AFTER_MS, () => void nudgeCheck($, turnId).catch(() => {}))
    return r
  })

  on('tool.call', async ($, e, next) => {
    if (!e.agentId) {
      toolsInFlight++
      await setClaude($, { state: 'tool', tool: String(e.tool) }).catch(() => {})
    }
    try {
      return await next(e)
    } finally {
      if (!e.agentId) {
        toolsInFlight = Math.max(0, toolsInFlight - 1)
        if (!toolsInFlight) await setClaude($, { state: 'thinking' }).catch(() => {})
      }
    }
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (!e.agentId) {
      toolsInFlight = 0
      turnNow = undefined
      await update($, nudge, () => '').catch(() => {})
      await setClaude($, { state: 'idle' }).catch(() => {})
      if (e.reason !== 'aborted') {
        const how = e.reason === 'answer' ? 'finished' : 'stopped'
        await needsYou($, `CLAUDE ${how.toUpperCase()} · ESC TO RETURN`, `Claude ${how} · ${duration(e.durationMs)} · Esc to return`).catch(() => {})
      }
    }
    return r
  })

  // Claude asks for permission (or another answer) while the board has the keys.
  on('classic.Notification', async ($, e, next) => {
    if (e.notification_type === 'permission_prompt' || e.notification_type === 'elicitation_dialog') {
      await needsYou($, 'CLAUDE NEEDS YOU · ESC TO RETURN', 'Claude needs your answer · Esc to return').catch(() => {})
    }
    return next(e)
  })
}
