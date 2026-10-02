// The BBS screen as a pure state machine: `press` turns a key into the next
// local state (and maybe an Action for the hooks module), `draw` turns state
// plus the hooks module's View into exactly `height` pipe-coded lines.
// No `$`, no I/O: term.tsx wires it to the Client surface, tests call it bare.

import type { Action, View } from '../types'
import { fitPipe, sanitizeUserText, stripPipe, visibleLength } from '../shared/pipe'
import { LIMITS, decodeStatus, describeStatus, isValidHandle, normalizeHandle } from '../shared/protocol'
import { logo } from './logo'
import { drawMessages, isMessageScreen, openThreads, pressMessages, type Editor, type MessageScreen, type Reader } from './messages'
import { LIGHTBAR, ago, center, clean, footer, frame, header, hotkey, pad, panel, plain, type Item } from './ui'

/** A key as the Client surface hands it (ClientKeyEvent). */
export type ClientKey = { key: string; ctrl?: true; shift?: true; meta?: true }

export type Screen = 'matrix' | 'apply' | 'logon' | 'main' | 'oneliners' | 'rumors' | 'callers' | 'who' | 'stats' | 'goodbye' | MessageScreen

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
  /** The conference picked on the base-change screen (slug). */
  base?: string
  /** The lightbar row on list screens (bases, threads, polls). */
  list: number
  reader?: Reader
  editor?: Editor
  /** Which newscan item is being read. */
  scan: number
  /** The poll on screen. */
  poll?: number
  /** When this call logged on (ms), for the time-left counter. */
  loggedAt?: number
}

export const initialState = (seed = 0): AppState => ({ screen: 'matrix', sel: 0, input: null, apply: { handle: '', location: '' }, rumorSeed: seed, seen: 0, onBoard: false, list: 0, scan: 0 })

export const MATRIX: Item[] = [
  { key: 'l', label: 'Login' },
  { key: 'a', label: 'Apply' },
  { key: 'w', label: "Who's On" },
]

/** The main menu: two panels of five, then Goodbye on its own. */
export const MAIN: (Item & { screen: Screen })[] = [
  { key: 'm', label: 'Messages', screen: 'threads' },
  { key: 'n', label: 'Newscan', screen: 'newscan' },
  { key: 'b', label: 'Base Change', screen: 'bases' },
  { key: 'v', label: 'Voting Booth', screen: 'vote' },
  { key: 't', label: 'Top Ten', screen: 'top' },
  { key: 'o', label: 'One-liners', screen: 'oneliners' },
  { key: 'r', label: 'Rumors', screen: 'rumors' },
  { key: 'l', label: 'Last Callers', screen: 'callers' },
  { key: 'w', label: "Who's Online", screen: 'who' },
  { key: 's', label: 'Stats', screen: 'stats' },
  { key: 'g', label: 'Goodbye', screen: 'goodbye' },
]
const PANEL = 5
const GOODBYE = MAIN.length - 1

/** Session length shown as time left, as a board's per-call limit was. Never enforced. */
export const CALL_MINUTES = 60

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
export function press(state: AppState, key: ClientKey, view: View, rand: () => number = Math.random, width = 80, now = Date.now()): Step {
  const s: AppState = { ...state, msg: undefined, seen: latestNotice(view) }
  if (s.input) return typing(s, key, view)
  if (isMessageScreen(s.screen)) return pressMessages(s, key, view, width)

  switch (s.screen) {
    case 'matrix': {
      const hot = MATRIX.findIndex(i => i.key === key.key.toLowerCase())
      const sel = moveSel(s.sel, key, MATRIX.length, MATRIX.length)
      if (hot < 0 && !isEnter(key)) return { state: { ...s, sel } }
      const pick = MATRIX[hot >= 0 ? hot : s.sel].key
      if (pick === 'l') {
        if (view.phase !== 'ready') return { state: { ...s, sel: 1, msg: 'No account on this node. |15A|07pply first.' } }
        return { state: { ...s, screen: 'logon', onBoard: true, loggedAt: now, rumorSeed: Math.floor(rand() * 1e6) }, action: { type: 'call' } }
      }
      if (pick === 'a') {
        if (view.phase === 'ready') return { state: { ...s, msg: `You are already on file as |15${view.me?.handle}|07. Login.` } }
        return { state: { ...s, screen: 'apply', apply: { handle: '', location: '' }, input: { purpose: 'handle', value: '' } } }
      }
      return { state: { ...s, screen: 'who' } }
    }

    case 'apply': {
      // Sent, and either accepted or refused: any key moves on.
      if (view.phase === 'ready') return { state: { ...s, screen: 'logon', onBoard: true, loggedAt: now, rumorSeed: Math.floor(rand() * 1e6) }, action: { type: 'call' } }
      if (view.registering) return { state: s }
      return { state: { ...s, apply: { handle: '', location: '' }, input: { purpose: 'handle', value: '' } } }
    }

    case 'logon':
      return { state: { ...s, screen: 'main', sel: 0 } }

    case 'main': {
      const hot = MAIN.findIndex(i => i.key === key.key.toLowerCase())
      if (hot >= 0) return enterMain(s, hot, view)
      if (isEnter(key)) return enterMain(s, s.sel, view)
      return { state: { ...s, sel: moveMain(s.sel, key) } }
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

    default:
      return { state: s }
  }
}

/** Back to the main menu, or the matrix when not logged on. */
function home(s: AppState): AppState {
  return s.onBoard ? { ...s, screen: 'main' } : { ...s, screen: 'matrix', sel: 0 }
}

function enterMain(s: AppState, index: number, view: View): Step {
  const item = MAIN[index]
  const next: AppState = { ...s, sel: index, screen: item.screen }
  switch (item.screen) {
    case 'goodbye':
      return { state: next, action: { type: 'logoff' } }
    case 'threads':
      return openThreads(next, view)
    case 'bases': {
      const at = (view.feed?.conferences ?? []).findIndex(c => c.slug === s.base)
      return { state: { ...next, list: Math.max(0, at) } }
    }
    case 'newscan':
      return { state: next, action: { type: 'newscan' } }
    case 'vote':
      return { state: { ...next, list: 0 } }
  }
  return { state: next }
}

/** Lightbar moves on the main menu: down a panel, across panels, Goodbye below both. */
function moveMain(sel: number, key: ClientKey): number {
  const col = sel === GOODBYE ? -1 : Math.floor(sel / PANEL)
  const row = sel % PANEL
  switch (key.key) {
    case 'down':
      return col < 0 ? 0 : row === PANEL - 1 ? GOODBYE : sel + 1
    case 'up':
      return col < 0 ? PANEL - 1 : row === 0 ? GOODBYE : sel - 1
    case 'left':
    case 'right':
    case 'tab':
      return col < 0 ? sel : (sel + PANEL) % (PANEL * 2)
  }
  return sel
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

function clock(now: number): string {
  const d = new Date(now)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** The status bar: two inverse lines, Obv/2 style, or one when rows are short. */
function statusBar(view: View, width: number, now: number, base: string | undefined, rows: number): string[] {
  const sep = ' |09\u2502|15 '
  const parts = ['|11lATENT sPACE|15']
  if (view.me?.node) parts.push(`Node ${view.me.node}`)
  if (view.me) parts.push(view.me.handle)
  if (base) parts.push(base)
  if (frame.minsLeft !== undefined) parts.push(`${frame.minsLeft} mins`)
  parts.push(clock(now))
  const claude = view.busy ? '|14ALL NODES BUSY - TRY AGAIN LATER' : `|09Claude |15${view.claude}`
  const top = `|17|15 ${parts.join(sep)}`
  if (rows < 2) return [fitPipe(`${top}${sep}${claude}`, width)]
  return [fitPipe(top, width), fitPipe(`|17 ${claude}`, width)]
}

/** One main-menu entry inside a panel, `width` cells, lit when selected. */
function panelItem(item: Item, isSel: boolean, width: number): string {
  if (isSel) return fitPipe(`${LIGHTBAR} ${item.key.toUpperCase()}  ${item.label}`, width) + '|16'
  return fitPipe(` |01\u2590|17|15${item.key.toUpperCase()}|16|01\u258c |07${item.label}`, width)
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
  const barRows = height >= 18 ? 2 : 1
  const body = Math.max(1, height - barRows)
  const base = (state.base ? view.feed?.conferences?.find(c => c.slug === state.base) : view.feed?.conferences?.[0])?.name
  frame.w = w
  frame.h = body
  frame.handle = state.onBoard ? view.me?.handle : undefined
  frame.minsLeft = state.onBoard && state.loggedAt !== undefined ? Math.max(0, CALL_MINUTES - Math.floor((now - state.loggedAt) / 60_000)) : undefined
  frame.menu = menuName(state, base)
  const lines = pad(screenLines(state, view, w, body, now), body).slice(0, body)
  const msg = messageLine(state, view)
  if (msg && !state.input && state.screen !== 'apply' && body > 1) lines[body - 1] = msg
  const out = lines.map(l => fitPipe(`|07|16${l}`, w))
  out.push(...statusBar(view, w, now, state.onBoard ? base : undefined, barRows))
  return out.slice(-Math.max(1, height))
}

const MENU_NAMES: Partial<Record<Screen, string>> = {
  matrix: 'Matrix', apply: 'New User', logon: 'Logon', main: 'Main', oneliners: 'One-liners', rumors: 'Rumors',
  callers: 'Callers', who: "Who's On", stats: 'Stats', bases: 'Bases', editor: 'Editor', newscan: 'Newscan',
  vote: 'Voting', poll: 'Voting', top: 'Top Ten', goodbye: 'Goodbye',
}

function menuName(state: AppState, base: string | undefined): string {
  if (state.screen === 'threads' || state.screen === 'read') return base ?? 'Messages'
  return MENU_NAMES[state.screen] ?? 'Main'
}


function screenLines(state: AppState, view: View, w: number, h: number, now: number): string[] {
  if (isMessageScreen(state.screen)) return drawMessages(state, view, w, h, now)
  const feed = view.feed
  switch (state.screen) {
    case 'matrix': {
      const big = logo(w - 2)
      const art = big ?? ['|01\u2591|09\u2592|11\u2593|13\u2588 |13l|15ATENT |13s|15PACE |13\u2588|11\u2593|09\u2592|01\u2591']
      const tagline = `|07${feed?.motd ? clean(feed.motd, LIMITS.motdMax) : 'a board for the hours Claude is busy'}`
      const ruleW = Math.max(0, Math.floor((Math.min(w, 64) - visibleLength(tagline) - 2) / 2))
      const rule = (flip: boolean) => {
        const ramp = ['|01', '|09', '|11', '|13']
        const cells = Array.from({ length: ruleW }, (_, i) => ramp[Math.min(3, Math.floor((i / Math.max(1, ruleW)) * 4))] + '\u2500')
        return (flip ? cells.reverse() : cells).join('')
      }
      const items = MATRIX.map((item, i) => hotkey(item, i === state.sel)).join('  ')
      const box = panel('Connect', [` ${items} `], visibleLength(items) + 4)
      const online = feed ? `|08${feed.nodes.length} online \u00b7 ${feed.stats.users} users \u00b7 ${feed.stats.callsToday} calls today` : `|08${view.feedError ? 'carrier lost: ' + view.feedError : 'dialing...'}`
      const block = [
        ...art.map(l => center(l, w)),
        '',
        center(`${rule(false)} ${tagline} ${rule(true)}`, w),
        '',
        ...box.map(l => center(l, w)),
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
      const side = w >= 66
      // Stacked panels need the rows a big header would take.
      const lines = [...header('Main Menu', w, false, side)]
      const pw = side ? Math.min(36, Math.floor((w - 3) / 2)) : Math.min(40, w - 2)
      const box = (title: string, from: number) => panel(title, MAIN.slice(from, from + PANEL).map((item, i) => panelItem(item, state.sel === from + i, pw - 2)), pw)
      const left = box('Messages', 0)
      const right = box('The Board', PANEL)
      if (side) left.forEach((l, i) => lines.push(` ${fitPipe(l, pw + 1)} ${right[i]}`))
      else lines.push(...left.map(l => ` ${l}`), ...right.map(l => ` ${l}`))
      lines.push(` ${panelItem(MAIN[GOODBYE], state.sel === GOODBYE, 20)}`)
      if (feed?.motd && h - lines.length > 3) lines.push('', `|07${clean(feed.motd, LIMITS.motdMax)}`)
      return [...pad(lines, h - 1).slice(0, h - 1), footer(`|07Command|08: |15${MAIN[state.sel]?.label ?? ''}`, w)]
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
        row('Messages', st?.postsTotal),
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
