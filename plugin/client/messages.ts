// Phase 2 screens: message bases (base change, thread list, reader, line
// editor), newscan, the voting booth and Top Ten. Same contract as app.ts:
// pure functions of state, key and View; Actions go to the hooks module.

import type { AppState, ClientKey, Screen, Step } from './app'
import type { Conference, View } from '../types'
import { fitPipe, sanitizeUserBody, stripPipe, visibleLength, wrapPipe } from '../shared/pipe'
import { LIMITS, isValidHandle, normalizeHandle } from '../shared/protocol'
import { LIGHTBAR, ago, bar, clean, footer, header, pad, panel, plain, stamp, windowOf } from './ui'

export type Editor = {
  step: 'subject' | 'to' | 'body'
  slug: string
  subject: string
  to: string
  /** Finished lines of the body. */
  lines: string[]
  /** The line being typed (the subject or To: while on those steps). */
  cur: string
  replyTo?: number
  thread?: number
  /** Where /S or /A returns to. */
  back: Screen
}

/** `confirm`: a pending Y/N to report the message on screen, or (sysops) delete it. */
export type Reader = { slug: string; thread: number; scroll: number; fromScan: boolean; confirm?: 'report' | 'delete' }

const canModerate = (view: View) => view.me?.role === 'sysop' || view.me?.role === 'mod'

export const MESSAGE_SCREENS = ['bases', 'threads', 'read', 'editor', 'newscan', 'vote', 'poll', 'top'] as const
export type MessageScreen = (typeof MESSAGE_SCREENS)[number]
export const isMessageScreen = (s: Screen): s is MessageScreen => (MESSAGE_SCREENS as readonly string[]).includes(s)

const lower = (k: ClientKey) => k.key.toLowerCase()
const isEnter = (k: ClientKey) => k.key === 'return' || k.key === 'enter'
const isBack = (k: ClientKey) => k.key === 'q' || k.key === 'left' || k.key === 'backspace'
const isChar = (k: ClientKey) => !k.ctrl && !k.meta && (k.key.length === 1 || k.key === 'space')
const charOf = (k: ClientKey) => (k.key === 'space' ? ' ' : k.key)
const digit = (k: ClientKey) => (/^[1-9]$/.test(k.key) ? Number(k.key) : undefined)

const conferences = (view: View): Conference[] => view.feed?.conferences ?? []
const lastRead = (view: View, slug: string) => view.lastRead?.[slug] ?? 0

/** The conference on screen: the one picked, else the first. */
export function currentBase(state: AppState, view: View): Conference | undefined {
  const all = conferences(view)
  return all.find(c => c.slug === state.base) ?? all[0]
}

function threadList(state: AppState, view: View) {
  const slug = currentBase(state, view)?.slug
  return slug && view.board?.slug === slug ? (view.board.index?.threads ?? []) : []
}

function home(s: AppState): AppState {
  return { ...s, screen: s.onBoard ? 'main' : 'matrix', reader: undefined, editor: undefined }
}

/** Opens a conference's thread list. */
export function openThreads(s: AppState, view: View, slug?: string): Step {
  const base = slug ?? currentBase(s, view)?.slug
  if (!base) return { state: { ...s, msg: 'No message bases yet.' } }
  return { state: { ...s, screen: 'threads', base, list: base === s.base ? s.list : 0, reader: undefined }, action: { type: 'board', slug: base } }
}

function newEditor(s: AppState, view: View, e: Partial<Editor> & { slug: string; back: Screen }): Step {
  if (view.phase !== 'ready') return { state: { ...s, msg: 'Log on to post.' } }
  return { state: { ...s, screen: 'editor', editor: { step: 'subject', subject: '', to: 'All', lines: [], cur: '', ...e } } }
}

// ---------------------------------------------------------------------------
// Keys

export function pressMessages(s: AppState, key: ClientKey, view: View, width: number): Step {
  switch (s.screen as MessageScreen) {
    case 'bases': {
      const all = conferences(view)
      const n = digit(key)
      const byNumber = n !== undefined ? all.find(c => c.n === n) : undefined
      if (byNumber) return openThreads(s, view, byNumber.slug)
      if (isEnter(key) || key.key === 'right') return all[s.list] ? openThreads(s, view, all[s.list].slug) : { state: s }
      if (isBack(key)) return { state: home(s) }
      return { state: { ...s, list: move(s.list, key, all.length) } }
    }

    case 'threads': {
      const base = currentBase(s, view)
      const list = threadList(s, view)
      if (isEnter(key) || key.key === 'right') {
        const t = list[s.list]
        if (!t || !base) return { state: s }
        return { state: { ...s, screen: 'read', reader: { slug: base.slug, thread: t.id, scroll: 0, fromScan: false } }, action: { type: 'read', slug: base.slug, thread: t.id } }
      }
      if (lower(key) === 'p' && base) return newEditor(s, view, { slug: base.slug, back: 'threads' })
      if (lower(key) === 'b') return { state: { ...s, screen: 'bases', list: Math.max(0, conferences(view).findIndex(c => c.slug === base?.slug)) } }
      if (lower(key) === 'r' && base) return { state: s, action: { type: 'board', slug: base.slug } }
      if (isBack(key)) return { state: home(s) }
      return { state: { ...s, list: move(s.list, key, list.length) } }
    }

    case 'read': {
      const r = s.reader
      const t = view.thread
      if (!r) return { state: home(s) }
      const loaded = t && t.slug === r.slug && t.id === r.thread && !t.loading
      const at = loaded ? t.posts.findIndex(p => p.id === t.focus) : -1
      const post = loaded ? t.posts[at] : undefined
      const k = lower(key)
      if (r.confirm) {
        const unconfirmed = { ...s, reader: { ...r, confirm: undefined } }
        if (k !== 'y' || !post) return { state: { ...unconfirmed, msg: 'Cancelled.' } }
        if (r.confirm === 'report') return { state: { ...unconfirmed, msg: 'Reporting...' }, action: { type: 'report', conference: r.slug, id: post.id } }
        return { state: { ...unconfirmed, msg: 'Deleting...' }, action: { type: 'sysop', op: { kind: 'deletePost', conference: r.slug, id: post.id, thread: r.thread } } }
      }
      if (k === 'q' || key.key === 'backspace') return r.fromScan ? { state: home(s) } : openThreads(s, view, r.slug)
      if (k === 't') return openThreads(s, view, r.slug)
      if (key.key === 'down') return { state: { ...s, reader: { ...r, scroll: r.scroll + 1 } } }
      if (key.key === 'up') return { state: { ...s, reader: { ...r, scroll: Math.max(0, r.scroll - 1) } } }
      if (key.key === 'pagedown') return { state: { ...s, reader: { ...r, scroll: r.scroll + 10 } } }
      if (key.key === 'pageup') return { state: { ...s, reader: { ...r, scroll: Math.max(0, r.scroll - 10) } } }
      if (!loaded) return { state: s }
      if (k === 'n' || key.key === 'right' || key.key === 'space' || k === ' ' || isEnter(key)) {
        const next = t.posts[at + 1]
        if (next) return { state: { ...s, reader: { ...r, scroll: 0 } }, action: { type: 'read', slug: r.slug, thread: r.thread, post: next.id } }
        if (r.fromScan) return nextScan(s, view)
        return { state: { ...s, msg: 'End of thread. |15T|07hread list, |15R|07eply.' } }
      }
      if (k === 'p' || key.key === 'left') {
        const prev = t.posts[at - 1]
        if (!prev) return { state: { ...s, msg: 'First message.' } }
        return { state: { ...s, reader: { ...r, scroll: 0 } }, action: { type: 'read', slug: r.slug, thread: r.thread, post: prev.id } }
      }
      if (k === '!' && post) return { state: { ...s, reader: { ...r, confirm: 'report' } } }
      if (k === 'd' && post && canModerate(view)) return { state: { ...s, reader: { ...r, confirm: 'delete' } } }
      if (k === 'r' && post) {
        return newEditor(s, view, { slug: r.slug, step: 'body', subject: replySubject(post.subject), to: post.handle, replyTo: post.id, back: 'read' })
      }
      return { state: s }
    }

    case 'editor':
      return editing(s, key, view, width)

    case 'newscan': {
      const scan = view.newscan
      if (isBack(key)) return { state: home(s) }
      if (!scan || scan.scanning) return { state: s }
      if (lower(key) === 'm') return { state: s, action: { type: 'markAllRead' } }
      if (isEnter(key) && scan.items.length) {
        const first = scan.items[0]
        return { state: { ...s, screen: 'read', scan: 0, reader: { slug: first.slug, thread: first.thread, scroll: 0, fromScan: true } }, action: { type: 'read', slug: first.slug, thread: first.thread } }
      }
      return { state: s }
    }

    case 'vote': {
      const polls = view.feed?.polls ?? []
      const n = digit(key)
      if (n !== undefined && polls[n - 1]) return { state: { ...s, screen: 'poll', poll: polls[n - 1].id, list: n - 1 } }
      if ((isEnter(key) || key.key === 'right') && polls[s.list]) return { state: { ...s, screen: 'poll', poll: polls[s.list].id } }
      if (isBack(key)) return { state: home(s) }
      return { state: { ...s, list: move(s.list, key, polls.length) } }
    }

    case 'poll': {
      const poll = view.feed?.polls?.find(p => p.id === s.poll)
      if (isBack(key) || !poll) return { state: { ...s, screen: 'vote' } }
      const n = digit(key)
      if (n === undefined || !poll.options[n - 1]) return { state: s }
      if (poll.closed) return { state: { ...s, msg: 'The polls are closed.' } }
      if (view.votes?.[String(poll.id)] !== undefined) return { state: { ...s, msg: 'You already voted in this one.' } }
      if (view.phase !== 'ready') return { state: { ...s, msg: 'Log on to vote.' } }
      return { state: { ...s, msg: 'Casting vote...' }, action: { type: 'vote', poll: poll.id, option: n - 1 } }
    }

    case 'top':
      return { state: home(s) }
  }
}

function move(sel: number, key: ClientKey, count: number): number {
  const d = ({ down: 1, up: -1, pagedown: 10, pageup: -10, home: -1e6, end: 1e6 } as Record<string, number>)[key.key]
  if (d === undefined || count === 0) return sel
  return Math.max(0, Math.min(count - 1, sel + d))
}

function replySubject(subject: string): string {
  return (/^re:/i.test(subject) ? subject : `Re: ${subject}`).slice(0, LIMITS.subjectMax)
}

/** On to the next thread newscan found, or home when there are no more. */
function nextScan(s: AppState, view: View): Step {
  const items = view.newscan?.items ?? []
  const i = s.scan + 1
  const item = items[i]
  if (!item) return { state: { ...home(s), msg: 'Newscan complete.' } }
  return { state: { ...s, scan: i, reader: { slug: item.slug, thread: item.thread, scroll: 0, fromScan: true } }, action: { type: 'read', slug: item.slug, thread: item.thread } }
}

// ---------------------------------------------------------------------------
// The line editor: one line at a time, words wrap, /S saves, /A aborts.

function bodyText(ed: Editor) {
  return [...ed.lines, ed.cur].join('\n')
}

function editing(s: AppState, key: ClientKey, view: View, width: number): Step {
  const ed = s.editor!
  const lineWidth = Math.max(20, Math.min(LIMITS.bodyWidth, width - 6))
  const back = (msg: string, action?: Step['action']): Step => ({ state: { ...s, screen: ed.back, editor: undefined, msg }, action })

  if (isEnter(key)) {
    if (ed.step === 'subject') {
      const subject = ed.cur.trim()
      if (!subject) return back('Aborted.')
      return { state: { ...s, editor: { ...ed, subject, step: 'to', cur: ed.to } } }
    }
    if (ed.step === 'to') {
      const to = normalizeHandle(ed.cur) || 'All'
      if (to.toLowerCase() !== 'all' && !isValidHandle(to)) return { state: { ...s, msg: 'To: a handle, or All.' } }
      return { state: { ...s, editor: { ...ed, to: to.toLowerCase() === 'all' ? 'All' : to, step: 'body', cur: '' } } }
    }
    const cmd = ed.cur.trim().toLowerCase()
    if (cmd === '/a') return back('Message aborted.')
    if (cmd === '/s') {
      const body = sanitizeUserBody(ed.lines.join('\n'), LIMITS.bodyMax, LIMITS.bodyLines)
      if (!body) return { state: { ...s, editor: { ...ed, cur: '' }, msg: 'Nothing to save. /A aborts.' } }
      return back('Saving message...', {
        type: 'message',
        conference: ed.slug,
        subject: ed.replyTo === undefined ? ed.subject : '',
        to: ed.to === 'All' ? '' : ed.to,
        body,
        replyTo: ed.replyTo,
        thread: ed.thread,
      })
    }
    if (ed.lines.length + 1 >= LIMITS.bodyLines) return { state: { ...s, msg: 'Message full. /S saves.' } }
    return { state: { ...s, editor: { ...ed, lines: [...ed.lines, ed.cur.trimEnd()], cur: '' } } }
  }

  if (key.key === 'backspace' || key.key === 'delete') {
    if (ed.cur) return { state: { ...s, editor: { ...ed, cur: [...ed.cur].slice(0, -1).join('') } } }
    if (ed.step === 'body' && ed.lines.length) return { state: { ...s, editor: { ...ed, lines: ed.lines.slice(0, -1), cur: ed.lines[ed.lines.length - 1] } } }
    return { state: s }
  }
  if (key.ctrl && key.key === 'u') return { state: { ...s, editor: { ...ed, cur: '' } } }
  if (!isChar(key)) return { state: s }

  const ch = charOf(key)
  if (ed.step !== 'body') {
    const max = ed.step === 'subject' ? LIMITS.subjectMax : LIMITS.handleMax
    return [...ed.cur].length < max ? { state: { ...s, editor: { ...ed, cur: ed.cur + ch } } } : { state: s }
  }
  if (bodyText(ed).length >= LIMITS.bodyMax) return { state: { ...s, msg: 'Message full. /S saves.' } }
  const cur = ed.cur + ch
  if (visibleLength(cur) <= lineWidth) return { state: { ...s, editor: { ...ed, cur } } }
  // Word wrap: the last word moves down; a word wider than the line breaks.
  if (ed.lines.length + 1 >= LIMITS.bodyLines) return { state: { ...s, msg: 'Message full. /S saves.' } }
  const cut = cur.lastIndexOf(' ')
  const [line, rest] = cut > 0 ? [cur.slice(0, cut), cur.slice(cut + 1)] : [cur.slice(0, -1), ch]
  return { state: { ...s, editor: { ...ed, lines: [...ed.lines, line.trimEnd()], cur: rest } } }
}

// ---------------------------------------------------------------------------
// Drawing

export function drawMessages(s: AppState, view: View, w: number, h: number, now: number): string[] {
  switch (s.screen as MessageScreen) {
    case 'bases': {
      const all = conferences(view)
      const lines = [...header('Message Bases', w), `|13${' #'.padEnd(5)}${'Name'.padEnd(26)}${'Msgs'.padStart(6)}  Sponsor`]
      if (!all.length) lines.push('|08No message bases on this board.')
      const [top, end] = windowOf(all.length, s.list, h - 7)
      for (let i = top; i < end; i++) {
        const c = all[i]
        const fresh = c.lastPostId > lastRead(view, c.slug) ? '|12*' : ' '
        const row = `${fresh}|15${String(c.n).padStart(2)}  |11${plain(c.name, LIMITS.conferenceNameMax).padEnd(26)}|07${String(c.posts).padStart(6)}  |08${plain(c.sponsor, LIMITS.handleMax)}`
        lines.push(i === s.list ? `${LIGHTBAR}${fitPipe(stripPipe(row), w - 1)}|16` : row)
      }
      const sel = all[s.list]
      lines.push('', sel?.description ? `|07${clean(sel.description, LIMITS.motdMax)}` : '')
      return [...pad(lines, h - 1), footer('|08[|15#|08]|07 Join  |12*|07 new  |08[|15Q|08]|07uit', w)]
    }

    case 'threads': {
      const base = currentBase(s, view)
      if (!base) return [...header('Messages', w), '|08No message bases yet.']
      const lines = [...header(plain(base.name, LIMITS.conferenceNameMax), w, true)]
      lines.push(`|08Base |15#${base.n}|08  Sponsor: |07${plain(base.sponsor, LIMITS.handleMax) || '-'}  |08Threads: |07${view.board?.slug === base.slug ? (view.board.index?.threadsTotal ?? '?') : '?'}`)
      const subjW = Math.max(10, w - 32)
      lines.push(`|13  ${'Subject'.padEnd(subjW)} ${'By'.padEnd(13)}${'Msgs'.padStart(4)}  Last`)
      const list = threadList(s, view)
      if (view.board?.slug !== base.slug || (view.board.loading && !view.board.index)) lines.push('|08Loading...')
      else if (!list.length) lines.push('|08No messages yet. |15P|08ost the first.')
      const [top, end] = windowOf(list.length, s.list, h - 6)
      for (let i = top; i < end; i++) {
        const t = list[i]
        const fresh = t.lastPostId > lastRead(view, base.slug) ? '|12*' : ' '
        const text = `${plain(t.subject, LIMITS.subjectMax).slice(0, subjW).padEnd(subjW)} ${plain(t.lastHandle || t.handle, LIMITS.handleMax).slice(0, 13).padEnd(13)}${String(t.posts).padStart(4)}  ${ago(t.lastPostAt, now)}`
        lines.push(i === s.list ? `${fresh}${LIGHTBAR}${fitPipe(`\u00bb${text}`, w - 2)}|16` : `${fresh} |07${text}`)
      }
      return [...pad(lines, h - 1).slice(0, h - 1), footer('|08[|15P|08]|07ost  |08[|15B|08]|07ase  |08[|15R|08]|07efresh  |08[|15Q|08]|07uit', w)]
    }

    case 'read':
      return drawReader(s, view, w, h)

    case 'editor':
      return drawEditor(s, view, w, h)

    case 'newscan': {
      const scan = view.newscan
      const lines = [...header('Newscan', w)]
      if (!scan || scan.scanning) lines.push('|07Scanning message bases...')
      else if (!scan.items.length) lines.push('|07No new messages. Go outside.')
      else {
        const total = scan.items.reduce((a, i) => a + i.unread, 0)
        lines.push(`|15${total}|07 new message${total === 1 ? '' : 's'} in |15${scan.items.length}|07 thread${scan.items.length === 1 ? '' : 's'}:`, '')
        for (const item of scan.items.slice(0, Math.max(0, h - 8))) {
          lines.push(`|13${plain(item.conference, LIMITS.conferenceNameMax).padEnd(18)} |07${plain(item.subject, LIMITS.subjectMax).padEnd(Math.max(10, w - 32))} |15${item.unread} new`)
        }
      }
      const keys = scan && !scan.scanning && scan.items.length ? '|08[|15Enter|08]|07 Read  |08[|15M|08]|07ark all read  |08[|15Q|08]|07uit' : '|08[|15Q|08]|07uit'
      return [...pad(lines, h - 1).slice(0, h - 1), footer(keys, w)]
    }

    case 'vote': {
      const polls = view.feed?.polls ?? []
      const lines = [...header('Voting Booth', w)]
      if (!polls.length) lines.push('|08No polls running. The sysop is thinking of one.')
      polls.forEach((p, i) => {
        const mine = view.votes?.[String(p.id)] !== undefined
        const status = `${p.closed ? '|08closed' : '|10open'}|08, ${p.total} vote${p.total === 1 ? '' : 's'}${mine ? ', |11voted' : ''}`
        const q = plain(p.question, LIMITS.pollQuestionMax).slice(0, Math.max(10, w - 30))
        lines.push(i === s.list ? `${LIGHTBAR}${fitPipe(` ${i + 1}. ${q}  ${stripPipe(status)}`, w - 1)}|16` : `|15 ${i + 1}|08. |07${q} |08(${status}|08)`)
      })
      return [...pad(lines, h - 1).slice(0, h - 1), footer('|08[|15#|08]|07 View  |08[|15Q|08]|07uit', w)]
    }

    case 'poll': {
      const p = view.feed?.polls?.find(x => x.id === s.poll)
      if (!p) return [...header('Voting Booth', w), '|08That poll is gone.']
      const mine = view.votes?.[String(p.id)]
      const lines = [...header('Voting Booth', w), `|15${plain(p.question, LIMITS.pollQuestionMax)}`, `|08${p.closed ? 'Closed' : 'Open'} · ${p.total} vote${p.total === 1 ? '' : 's'} · asked ${ago(p.createdAt, now)} ago`, '']
      const labelW = Math.min(LIMITS.pollOptionMax, Math.max(12, w - 34))
      const barW = Math.max(6, Math.min(20, w - labelW - 18))
      p.options.forEach((o, i) => {
        const frac = p.total ? o.votes / p.total : 0
        const marker = mine === i ? '|11»' : ' '
        lines.push(`${marker}|15${i + 1}|08. |07${plain(o.text, LIMITS.pollOptionMax).slice(0, labelW).padEnd(labelW)} ${bar(frac, barW)} |15${String(Math.round(frac * 100)).padStart(3)}% |08(${o.votes})`)
      })
      const canVote = !p.closed && mine === undefined
      return [...pad(lines, h - 1).slice(0, h - 1), footer(canVote ? `|08[|151-${p.options.length}|08]|07 Vote  |08[|15Q|08]|07uit` : '|08[|15Q|08]|07uit', w)]
    }

    case 'top': {
      const top = view.feed?.top
      const lines = [...header('Top Ten', w)]
      const per = Math.max(1, Math.min(LIMITS.topTen, Math.floor((h - 9) / 3)))
      const section = (title: string, rows: { handle: string; n: number }[] | undefined) => {
        lines.push(`|05▒|13 ${title}`)
        const list = (rows ?? []).slice(0, per)
        if (!list.length) lines.push('  |08nobody yet')
        const max = Math.max(1, ...list.map(r => r.n))
        const barW = Math.max(6, Math.min(30, w - 30))
        list.forEach((r, i) => lines.push(`  |15${String(i + 1).padStart(2)}. |11${plain(r.handle, LIMITS.handleMax).padEnd(16)} ${bar(r.n / max, barW)} |07${r.n}`))
      }
      section('Posters', top?.posters)
      section('Callers', top?.callers)
      section('One-liners', top?.oneliners)
      return [...pad(lines, h - 1).slice(0, h - 1), footer('|08[|15Hit a key|08]', w)]
    }
  }
}

function drawReader(s: AppState, view: View, w: number, h: number): string[] {
  const r = s.reader
  const t = view.thread
  const base = conferences(view).find(c => c.slug === r?.slug)
  const name = plain(base?.name ?? r?.slug ?? '', LIMITS.conferenceNameMax)
  if (!r || !t || t.slug !== r.slug || t.id !== r.thread || t.loading) return [...header(name || 'Messages', w), '|07Loading...']
  if (t.missing || !t.posts.length) return [...header(name, w), '|08That thread is gone.', '', footer('|08[|15T|08]|07hreads  |08[|15Q|08]|07uit', w)]
  const post = t.posts.find(p => p.id === t.focus) ?? t.posts[0]
  const pos = `Msg ${post.n} of ${t.total}`
  const scanTag = r.fromScan ? ` |08· |07Newscan ${s.scan + 1}/${view.newscan?.items.length ?? 0}` : ''
  const lines = panel(`${name}${scanTag}`, [
    ` |13From|08: |15${plain(post.handle, LIMITS.handleMax).padEnd(17)}|13Date|08: |07${stamp(post.ts)}`,
    ` |13  To|08: |15${plain(post.to, LIMITS.handleMax)}`,
    ` |13Subj|08: |15${plain(post.subject, LIMITS.subjectMax)}`,
  ], w, { right: pos, shadow: false })
  const room = Math.max(1, h - lines.length - 1)
  let body: string[]
  if (post.body === undefined) body = ['|08Loading...']
  else body = sanitizeUserBody(post.body, LIMITS.bodyMax, LIMITS.bodyLines).split('\n').flatMap(l => wrapPipe(`|07${l}`, w))
  const scroll = Math.min(r.scroll, Math.max(0, body.length - room))
  const shown = body.slice(scroll, scroll + room)
  const more = body.length > scroll + room ? ` |08↓ ${body.length - scroll - room} more` : ''
  if (r.confirm) {
    const ask = r.confirm === 'report' ? `Report message #${post.id} to the SysOp?` : `Delete message #${post.id}?`
    return [...lines, ...pad(shown, room), fitPipe(`|14${ask} |15(Y/N)`, w)]
  }
  const del = canModerate(view) ? ' |08[|15D|08]|07el' : ''
  return [...lines, ...pad(shown, room), footer(`|08[|15N|08]|07ext |08[|15P|08]|07rev |08[|15R|08]|07eply |08[|15T|08]|07hreads |08[|15!|08]|07Report${del} |08[|15Q|08]|07uit${more}`, w)]
}

function drawEditor(s: AppState, view: View, w: number, h: number): string[] {
  const ed = s.editor
  if (!ed) return []
  const base = conferences(view).find(c => c.slug === ed.slug)
  const lines = [...header(ed.replyTo !== undefined ? 'Reply' : 'Post', w, true), `|08Base: |07${plain(base?.name ?? ed.slug, LIMITS.conferenceNameMax)}`]
  const field = (label: string, value: string, active: boolean, max: number) =>
    active ? `|13${label}|08: |15${value}|13▄|08${'·'.repeat(Math.max(0, max - [...value].length))}` : `|13${label}|08: |15${value}`
  if (ed.replyTo !== undefined) lines.push(`|13Subj|08: |15${plain(ed.subject, LIMITS.subjectMax)}`)
  else lines.push(field('Subj', ed.step === 'subject' ? ed.cur : ed.subject, ed.step === 'subject', LIMITS.subjectMax))
  if (ed.step !== 'subject') lines.push(field('  To', ed.step === 'to' ? ed.cur : ed.to, ed.step === 'to', LIMITS.handleMax))
  if (ed.step !== 'body') {
    lines.push('', ed.step === 'subject' ? '|08Enter a subject. Empty aborts.' : '|08Enter a handle, or All.')
    return lines
  }
  lines.push(`|08${'─'.repeat(w)}`)
  const room = Math.max(1, h - lines.length - 1)
  const numbered = [...ed.lines, null].map((l, i) => {
    const num = `|08${String(i + 1).padStart(3)}: `
    return l === null ? `${num}|15${ed.cur}|13▄` : `${num}|07${l}`
  })
  const shown = numbered.slice(-room)
  return [...lines, ...pad(shown, room), footer(`|07/S|08 save  |07/A|08 abort  |08line ${ed.lines.length + 1}/${LIMITS.bodyLines}`, w)]
}
