// The BBS screen as a pure state machine: `press` turns a key into the next
// local state (and maybe an Action for the hooks module), `draw` turns state
// plus the hooks module's View into exactly `height` pipe-coded lines.
// No `$`, no I/O: term.tsx wires it to the Client surface, tests call it bare.

import type { Action, View } from '../types'
import { fitPipe, sanitizeUserText, stripPipe, visibleLength } from '../shared/pipe'
import { LIMITS, decodeStatus, describeStatus, isValidHandle, normalizeHandle } from '../shared/protocol'
import { logo } from './logo'

/** A key as the Client surface hands it (ClientKeyEvent). */
export type ClientKey = { key: string; ctrl?: true; shift?: true; meta?: true }

export type Screen = 'matrix' | 'apply' | 'logon' | 'main' | 'oneliners' | 'rumors' | 'callers' | 'who' | 'stats' | 'goodbye'

type InputPurpose = 'handle' | 'location' | 'oneliner' | 'rumor'

export type AppState = {
  screen: Screen
  /** The lightbar's position on the matrix and main menus. */
  sel: number
  input: { purpose: InputPurpose; value: string } | null
  /** The application being filled in. */
  apply: { handle: string; location: string; sentAfter?: number }
  /** Which rumor the logon screen shows. */
  rumorSeed: number
  /** A local one-line message (validation, hints); cleared by the next key. */
  msg?: string
  /** Notices up to this id have been seen. */
  seen: number
  /** Logged on this call: the main menu is home, not the matrix. */
  onBoard: boolean
}

export const initialState = (seed = 0): AppState => ({ screen: 'matrix', sel: 0, input: null, apply: { handle: '', location: '' }, rumorSeed: seed, seen: 0, onBoard: false })

type Item = { key: string; label: string }

export const MATRIX: Item[] = [
  { key: 'l', label: 'Login' },
  { key: 'a', label: 'Apply' },
  { key: 'w', label: "Who's On" },
]

export const MAIN: (Item & { screen: Screen })[] = [
  { key: 'o', label: 'One-liners', screen: 'oneliners' },
  { key: 'r', label: 'Rumors', screen: 'rumors' },
  { key: 'l', label: 'Last Callers', screen: 'callers' },
  { key: 'w', label: "Who's Online", screen: 'who' },
  { key: 's', label: 'Stats', screen: 'stats' },
  { key: 'g', label: 'Goodbye', screen: 'goodbye' },
]

const INPUT_MAX: Record<InputPurpose, number> = {
  handle: LIMITS.handleMax,
  location: LIMITS.locationMax,
  oneliner: LIMITS.onelinerMax,
  rumor: LIMITS.rumorMax,
}

export type Step = { state: AppState; action?: Action }

const isBack = (k: ClientKey) => k.key === 'q' || k.key === 'left' || k.key === 'backspace'
const isEnter = (k: ClientKey) => k.key === 'return' || k.key === 'enter'
const isChar = (k: ClientKey) => !k.ctrl && !k.meta && (k.key.length === 1 || k.key === 'space')
const charOf = (k: ClientKey) => (k.key === 'space' ? ' ' : k.key)
const latestNotice = (view: View) => view.notice?.id ?? 0

/** One key pressed while the BBS has the keyboard. */
export function press(state: AppState, key: ClientKey, view: View, rand: () => number = Math.random): Step {
  const s: AppState = { ...state, msg: undefined, seen: latestNotice(view) }
  if (s.input) return typing(s, key, view)

  switch (s.screen) {
    case 'matrix': {
      const hot = MATRIX.findIndex(i => i.key === key.key.toLowerCase())
      const sel = moveSel(s.sel, key, MATRIX.length, MATRIX.length)
      if (hot < 0 && !isEnter(key)) return { state: { ...s, sel } }
      const pick = MATRIX[hot >= 0 ? hot : s.sel].key
      if (pick === 'l') {
        if (view.phase !== 'ready') return { state: { ...s, sel: 1, msg: 'No account on this node. |15A|07pply first.' } }
        return { state: { ...s, screen: 'logon', onBoard: true, rumorSeed: Math.floor(rand() * 1e6) }, action: { type: 'call' } }
      }
      if (pick === 'a') {
        if (view.phase === 'ready') return { state: { ...s, msg: `You are already on file as |15${view.me?.handle}|07. Login.` } }
        return { state: { ...s, screen: 'apply', apply: { handle: '', location: '' }, input: { purpose: 'handle', value: '' } } }
      }
      return { state: { ...s, screen: 'who' } }
    }

    case 'apply': {
      // Sent, and either accepted or refused: any key moves on.
      if (view.phase === 'ready') return { state: { ...s, screen: 'logon', onBoard: true, rumorSeed: Math.floor(rand() * 1e6) }, action: { type: 'call' } }
      if (view.registering) return { state: s }
      return { state: { ...s, apply: { handle: '', location: '' }, input: { purpose: 'handle', value: '' } } }
    }

    case 'logon':
      return { state: { ...s, screen: 'main', sel: 0 } }

    case 'main': {
      const hot = MAIN.findIndex(i => i.key === key.key.toLowerCase())
      if (hot >= 0) return enterMain(s, hot)
      if (isEnter(key)) return enterMain(s, s.sel)
      return { state: { ...s, sel: moveSel(s.sel, key, MAIN.length, 2) } }
    }

    case 'oneliners':
    case 'rumors': {
      if (key.key.toLowerCase() === 'a') {
        if (view.phase !== 'ready') return { state: { ...s, msg: 'Log on to post.' } }
        return { state: { ...s, input: { purpose: s.screen === 'oneliners' ? 'oneliner' : 'rumor', value: '' } } }
      }
      if (isBack(key) || isEnter(key)) return { state: home(s) }
      return { state: s }
    }

    case 'who':
    case 'callers':
    case 'stats':
      if (key.key.toLowerCase() === 'r') return { state: s, action: { type: 'refresh' } }
      return { state: home(s) }

    case 'goodbye':
      return { state: { ...initialState(s.rumorSeed), seen: s.seen } }
  }
}

/** Back to the main menu, or the matrix when not logged on. */
function home(s: AppState): AppState {
  return s.onBoard ? { ...s, screen: 'main' } : { ...s, screen: 'matrix', sel: 0 }
}

function enterMain(s: AppState, index: number): Step {
  const item = MAIN[index]
  const next: AppState = { ...s, sel: index, screen: item.screen }
  if (item.screen === 'goodbye') return { state: next, action: { type: 'logoff' } }
  return { state: next }
}

function moveSel(sel: number, key: ClientKey, count: number, perRow: number): number {
  const step: Record<string, number> = { right: 1, left: -1, down: perRow, up: -perRow, tab: 1 }
  const d = step[key.key]
  if (d === undefined) return sel
  return (((sel + d) % count) + count) % count
}

function typing(s: AppState, key: ClientKey, view: View): Step {
  const input = s.input!
  if (isEnter(key)) return submit({ ...s, input: null }, input.purpose, input.value.trim(), view)
  if (key.key === 'backspace' || key.key === 'delete') return { state: { ...s, input: { ...input, value: input.value.slice(0, -1) } } }
  if (key.ctrl && key.key === 'u') return { state: { ...s, input: { ...input, value: '' } } }
  if (isChar(key) && [...input.value].length < INPUT_MAX[input.purpose]) return { state: { ...s, input: { ...input, value: input.value + charOf(key) } } }
  return { state: s }
}

function submit(s: AppState, purpose: InputPurpose, value: string, view: View): Step {
  switch (purpose) {
    case 'handle': {
      if (!value) return { state: { ...s, screen: 'matrix', sel: 1 } }
      const handle = normalizeHandle(value)
      if (!isValidHandle(handle)) {
        return { state: { ...s, input: { purpose, value }, msg: `${LIMITS.handleMin}-${LIMITS.handleMax} chars: letters, digits, space _ - .` } }
      }
      return { state: { ...s, apply: { ...s.apply, handle }, input: { purpose: 'location', value: '' } } }
    }
    case 'location': {
      const location = sanitizeUserText(value, LIMITS.locationMax).replace(/\|[0-9]{2}/g, '')
      return {
        state: { ...s, apply: { ...s.apply, location, sentAfter: latestNotice(view) } },
        action: { type: 'register', handle: s.apply.handle, location },
      }
    }
    case 'oneliner':
    case 'rumor': {
      const text = sanitizeUserText(value, INPUT_MAX[purpose])
      if (!text) return { state: s }
      return { state: { ...s, msg: purpose === 'oneliner' ? 'Posting one-liner...' : 'Spreading rumor...' }, action: { type: 'post', kind: purpose, text } }
    }
  }
}

// ---------------------------------------------------------------------------
// Drawing

const center = (text: string, width: number) => ' '.repeat(Math.max(0, Math.floor((width - visibleLength(text)) / 2))) + text

/** Text from the feed, sanitized again before it is drawn (never trust the wire). */
const clean = (text: unknown, max: number) => sanitizeUserText(String(text ?? ''), max)
const plain = (text: unknown, max: number) => stripPipe(clean(text, max))

function header(title: string, width: number): string[] {
  const label = `|05▒▓|13█|16|15 ${title} |13█|05▓▒`
  const rule = '─'.repeat(Math.max(0, width - visibleLength(label) - 1))
  return [`${label} |08${rule}`, '']
}

function footer(keys: string, width: number): string {
  return `|08${'─'.repeat(2)} ${keys} |08${'─'.repeat(Math.max(0, width - visibleLength(keys) - 4))}`
}

const hotkey = (item: Item, isSel: boolean) =>
  isSel ? `|21|15 ${item.label} |16` : `|08[|15${item.label[0]}|08]|07${item.label.slice(1)}`

function ago(ts: string, now: number): string {
  const s = Math.max(0, Math.floor((now - Date.parse(ts)) / 1000))
  if (!Number.isFinite(s)) return '?'
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

function clock(now: number): string {
  const d = new Date(now)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function statusBar(view: View, width: number, now: number): string {
  const sep = '|05│|15'
  const parts = ['lATENT sPACE']
  if (view.me?.node) parts.push(`Node ${view.me.node}`)
  if (view.me) parts.push(view.me.handle)
  parts.push(clock(now))
  parts.push(view.busy ? '|14ALL NODES BUSY|15' : `Claude: ${view.claude}`)
  return `|21|15 ${parts.join(` ${sep} `)}`
}

function inputLine(label: string, value: string, max: number): string {
  return `|13${label}|08: |15${value}|13▄|08${'·'.repeat(Math.max(0, max - [...value].length))}`
}

/** The message line: an unseen notice, else a local message. */
function messageLine(state: AppState, view: View): string | undefined {
  // A notice arrived after the last key, so it is newer than any local message.
  if (view.notice && view.notice.id > state.seen) return `${view.notice.isError ? '|12' : '|10'}${view.notice.text}`
  if (state.msg) return `|07${state.msg}`
  return undefined
}

/** Exactly `height` pipe-coded lines of exactly `width` cells. */
export function draw(state: AppState, view: View, width: number, height: number, now: number = Date.now()): string[] {
  const w = Math.max(20, Math.min(width, 80))
  const body = Math.max(1, height - 1)
  const lines = pad(screenLines(state, view, w, body, now), body).slice(0, body)
  const msg = messageLine(state, view)
  if (msg && !state.input && state.screen !== 'apply' && body > 1) lines[body - 1] = msg
  const out = lines.map(l => fitPipe(`|07|16${l}`, w))
  out.push(fitPipe(statusBar(view, w, now), w))
  return out.slice(-Math.max(1, height))
}

function pad(lines: string[], n: number): string[] {
  return lines.length >= n ? lines : [...lines, ...Array.from({ length: n - lines.length }, () => '')]
}

function screenLines(state: AppState, view: View, w: number, h: number, now: number): string[] {
  const feed = view.feed
  switch (state.screen) {
    case 'matrix': {
      const big = logo(w - 2)
      const art = big ?? ['|05\u2591\u2592\u2593|13\u2588 |13l|15ATENT |13s|15PACE |13\u2588|05\u2593\u2592\u2591']
      const items = MATRIX.map((item, i) => hotkey(item, i === state.sel)).join('  ')
      const online = feed ? `|08${feed.nodes.length} online · ${feed.stats.users} users · ${feed.stats.callsToday} calls today` : `|08${view.feedError ? 'carrier lost: ' + view.feedError : 'dialing...'}`
      const block = [
        ...art.map(l => center(l, w)),
        '',
        ...(big ? [center('|08-=|07[ |13l|15ATENT |13s|15PACE |07]|08=-', w)] : []),
        center(`|07${feed?.motd ? clean(feed.motd, LIMITS.motdMax) : 'a board for the hours Claude is busy'}`, w),
        '',
        center(items, w),
        '',
        center(online, w),
      ]
      const top = Math.max(0, Math.floor((h - block.length - 1) / 2))
      return [...Array.from({ length: top }, () => ''), ...block]
    }

    case 'apply': {
      const lines = [...header('New User Application', w)]
      lines.push('|07Pick a handle the board will know you by.', '')
      const input = state.input
      const handle = input?.purpose === 'handle' ? input.value : state.apply.handle
      lines.push(input?.purpose === 'handle' ? inputLine('Handle', handle, LIMITS.handleMax) : `|13Handle|08: |15${handle}`)
      if (input?.purpose !== 'handle') {
        lines.push(input?.purpose === 'location' ? inputLine('Location', input.value, LIMITS.locationMax) : `|13Location|08: |15${state.apply.location || '-'}`)
      }
      lines.push('')
      if (state.msg) lines.push(`|12${state.msg}`)
      else if (input) lines.push('|08Enter to accept. Empty handle cancels.')
      else if (view.phase === 'ready') lines.push(`|10Application accepted.|07 Welcome aboard, |15${view.me?.handle}|07.`, '', '|08[|15Hit a key to log on|08]')
      else if (view.registering) {
        const pct = Math.floor(view.registering.progress * 100)
        const bar = Math.floor(view.registering.progress * 30)
        lines.push(`|07Negotiating carrier... |15${pct}%`, `|13${'█'.repeat(bar)}|08${'░'.repeat(30 - bar)}`)
      } else if (view.notice && view.notice.id > (state.apply.sentAfter ?? 0)) {
        lines.push(`${view.notice.isError ? '|12' : '|10'}${view.notice.text}`, '', '|08[|15Hit a key to try again|08]')
      } else lines.push('|07Dialing...')
      return lines
    }

    case 'logon': {
      const lines = [`|07Logging on to |13lATENT sPACE|07 as |15${view.me?.handle ?? '?'}|07, node |15${view.me?.node ?? '?'}|07.`, '']
      const rumors = feed?.rumors ?? []
      if (rumors.length) {
        lines.push('|05▒|13 Rumor of the day', `  |07"${clean(rumors[state.rumorSeed % rumors.length].text, LIMITS.rumorMax)}|07"`, '')
      }
      const room = Math.max(0, h - lines.length - 4)
      const callers = (feed?.lastCallers ?? []).slice(0, Math.min(4, Math.floor(room / 2)))
      if (callers.length) {
        lines.push('|05▒|13 Last callers')
        for (const c of callers) lines.push(`  |15${plain(c.handle, LIMITS.handleMax).padEnd(16)} |07${plain(c.location, LIMITS.locationMax).padEnd(18)} |08${ago(c.ts, now)} ago`)
        lines.push('')
      }
      const ones = (feed?.oneliners ?? []).slice(-Math.max(0, h - lines.length - 3))
      if (ones.length) {
        lines.push('|05▒|13 One-liners')
        for (const o of ones) lines.push(`  |11${plain(o.handle, LIMITS.handleMax)}|08: |07${clean(o.text, LIMITS.onelinerMax)}`)
      }
      lines.push('', '|08[|15Hit a key|08]')
      return lines
    }

    case 'main': {
      const lines = [...header('Main Menu', w)]
      const colWidth = Math.max(18, Math.floor((w - 4) / 2))
      for (let i = 0; i < MAIN.length; i += 2) {
        const left = fitPipe(hotkey(MAIN[i], state.sel === i), colWidth)
        const right = MAIN[i + 1] ? hotkey(MAIN[i + 1], state.sel === i + 1) : ''
        lines.push(`  ${left}${right}`)
      }
      lines.push('')
      if (feed?.motd) lines.push(`|07${clean(feed.motd, LIMITS.motdMax)}`, '')
      lines.push(`|08[|13Main Menu|08] |07Command: |15${MAIN[state.sel]?.label ?? ''}`)
      return lines
    }

    case 'oneliners': {
      const lines = [...header('One-liners', w)]
      const ones = feed?.oneliners ?? []
      const room = Math.max(0, h - lines.length - 3)
      if (!ones.length) lines.push('|08Nobody has said anything yet. Be first.')
      for (const o of ones.slice(-room)) lines.push(`|11${plain(o.handle, LIMITS.handleMax)}|08: |07${clean(o.text, LIMITS.onelinerMax)}`)
      return withInput(lines, state, h, w, '|08[|15A|08]|07dd one-liner  |08[|15Q|08]|07uit')
    }

    case 'rumors': {
      const lines = [...header('Rumors', w)]
      const rumors = feed?.rumors ?? []
      const room = Math.max(0, h - lines.length - 3)
      if (!rumors.length) lines.push('|08No rumors. Suspicious.')
      for (const r of rumors.slice(0, room)) lines.push(`|05» |07${clean(r.text, LIMITS.rumorMax)}`)
      return withInput(lines, state, h, w, '|08[|15A|08]|07dd rumor (anonymous)  |08[|15Q|08]|07uit')
    }

    case 'callers': {
      const lines = [...header('Last Callers', w), `|13${'Node'.padEnd(6)}${'Handle'.padEnd(17)}${'Location'.padEnd(19)}When`]
      for (const c of feed?.lastCallers ?? []) {
        lines.push(`|15${String(c.node).padEnd(6)}|11${plain(c.handle, LIMITS.handleMax).padEnd(17)}|07${plain(c.location, LIMITS.locationMax).padEnd(19)}|08${ago(c.ts, now)} ago`)
      }
      return [...lines, '', footer('|08[|15R|08]|07efresh  |08[|15Q|08]|07uit', w)]
    }

    case 'who': {
      const lines = [...header("Who's Online", w), `|13${'Node'.padEnd(6)}${'Handle'.padEnd(17)}Doing`]
      const nodes = feed?.nodes ?? []
      if (!nodes.length) lines.push('|08All nodes idle. Waiting for caller...')
      for (const n of nodes) {
        lines.push(`|15${String(n.node).padEnd(6)}|11${plain(n.handle, LIMITS.handleMax).padEnd(17)}|07${describeStatus(decodeStatus(n.status))} |08${ago(n.since, now)}`)
      }
      return [...lines, '', footer('|08[|15R|08]|07efresh  |08[|15Q|08]|07uit', w)]
    }

    case 'stats': {
      const st = feed?.stats
      const row = (k: string, v: string | number | undefined) => `|13${k.padEnd(18, '.')}|15 ${v ?? '?'}`
      return [
        ...header('System Stats', w),
        row('Users', st?.users),
        row('Calls today', st?.callsToday),
        row('Calls total', st?.callsTotal),
        row('One-liners', st?.onelinersTotal),
        row('Nodes online', feed?.nodes.length),
        row('Your node', view.me?.node),
        row('Feed seq', feed?.seq),
        '',
        footer('|08[|15R|08]|07efresh  |08[|15Q|08]|07uit', w),
      ]
    }

    case 'goodbye':
      return [
        ...Array.from({ length: Math.max(0, Math.floor(h / 2) - 3) }, () => ''),
        center('|07Thanks for calling |13lATENT sPACE|07.', w),
        '',
        center('|08+++', w),
        center('|15NO CARRIER', w),
        '',
        center('|08[|15Hit a key|08]', w),
      ]
  }
}

function withInput(lines: string[], state: AppState, h: number, w: number, keys: string): string[] {
  const input = state.input
  const tail = input ? [inputLine(input.purpose === 'oneliner' ? 'Say' : 'Psst', input.value, INPUT_MAX[input.purpose])] : [footer(keys, w)]
  return [...pad(lines, h - tail.length - 1).slice(0, h - tail.length - 1), '', ...tail]
}
