// The door screens: the Doors list, HYPERPLANE's title pages, the new
// character prompt and the game view (a scrolling transcript, the live
// prompt and a quick-stats bar). Same contract as app.ts: pure functions of
// state, key and View. The screen keeps only its local prompt and what is
// typed; every command goes to the hooks module as one `door` Action carrying
// the lines typed for it, and keys wait until view.door.rev moves past it.

import type { AppState, ClientKey, Screen, Step } from '../app'
import type { Action, DoorAsk, DoorCmd, DoorView, View } from '../../types'
import { COMMODITIES, GAME, ITEMS, SHIPS, holdsCost, type Commodity, type ItemId } from '../../shared/door/data'
import { DOOR_LIMITS } from '../../shared/door/protocol'
import {
  commandPrompt, counterLine, num, openingFigure, outfitterLines, quickStats, rankingLines, shipCatalogLines, logLines, warpList,
} from '../../shared/door/format'
import { LIMITS } from '../../shared/protocol'
import { fitPipe, visibleLength } from '../../shared/pipe'
import { LIGHTBAR, center, footer, header, pad } from '../ui'
import { newDoorView } from './session'
import { DRYDOCK_HELP, INSTRUCTION_PAGES, titleArt } from './content'

export const DOOR_SCREENS = ['doors', 'door'] as const
export type DoorScreen = (typeof DOOR_SCREENS)[number]
export const isDoorScreen = (s: Screen): s is DoorScreen => (DOOR_SCREENS as readonly string[]).includes(s)

/** The doors on the Doors menu. */
export const DOORS = [{ key: '1', title: GAME.title, blurb: 'Trade, haggle and explore across a thousand sectors.' }]

export type DoorPage = 'title' | 'instructions' | 'log' | 'rankings' | 'game'

type Venue = 'top' | 'yard' | 'outfit' | 'bank' | 'tavern'

/** The prompt on screen. Kinds tied to a hooks-set question (trade, class0, drydock) only apply while it is open. */
export type DoorPrompt =
  | { kind: 'command' }
  | { kind: 'move'; quick?: boolean }
  | { kind: 'quit' }
  | { kind: 'computer' }
  | { kind: 'cplot' }
  | { kind: 'cwarps' }
  | { kind: 'cport' }
  | { kind: 'cavoid' }
  | { kind: 'scan' }
  | { kind: 'probe' }
  | { kind: 'engage' }
  | { kind: 'shipName' }
  | { kind: 'tradeQty' }
  /** `rev`: the view it was made for; a newer reply replaces it. */
  | { kind: 'offer'; rev: number; commodity: Commodity; qty: number; figure: number; final?: boolean }
  | { kind: 'class0'; field: 0 | 1 | 2; buy: [number, number, number] }
  | { kind: 'dock'; venue: Venue }
  | { kind: 'yardShip' }
  | { kind: 'yardName'; ship: number }
  | { kind: 'rename' }
  | { kind: 'outfitQty'; item: ItemId }
  | { kind: 'bankTo' }
  | { kind: 'bankAmt'; op: 'deposit' | 'withdraw' | 'transfer'; to?: string }
  | { kind: 'announce' }

export type DoorLocal = {
  page: DoorPage
  prompt: DoorPrompt
  /** What is typed at the prompt. */
  buf: string
  /** Lines of local exchanges (menus, prompts answered) not yet sent; they go out as the next action's echo. */
  scratch: string[]
  /** The last action posted: keys wait until view.door.rev passes `rev`; `lines` show meanwhile. */
  wait?: { rev: number; at: number; lines: string[] }
  /** The Instructions page being read. */
  leaf?: number
}

/** Keys stop waiting on a lost action after this long. */
const WAIT_MS = 20_000
const SCRATCH_MAX = 120
const CMD: DoorPrompt = { kind: 'command' }
const DRYDOCK_KINDS = ['dock', 'yardShip', 'yardName', 'rename', 'outfitQty', 'bankTo', 'bankAmt', 'announce']
/** Later systems' keys: answered, not ignored. */
const LATER = 'afghjklnortuwxyz'

export const initialDoor = (): DoorLocal => ({ page: 'title', prompt: CMD, buf: '', scratch: [] })

const lower = (k: ClientKey) => k.key.toLowerCase()
const isEnter = (k: ClientKey) => k.key === 'return' || k.key === 'enter'
const isBack = (k: ClientKey) => k.key === 'backspace' || k.key === 'delete'
const isChar = (k: ClientKey) => !k.ctrl && !k.meta && (k.key.length === 1 || k.key === 'space')
const charOf = (k: ClientKey) => (k.key === 'space' ? ' ' : k.key)
const red = (s: string) => `|12${s}`

const doorView = (view: View): DoorView => view.door ?? newDoorView()

/** True while the last action has not come back. */
export function isWaiting(d: DoorLocal | undefined, dv: DoorView, now: number): boolean {
  return !!d?.wait && dv.rev <= d.wait.rev && now - d.wait.at < WAIT_MS
}

/** The game view draws its own foot, so app.ts leaves the message line alone. */
export function doorOwnsFoot(s: AppState, view: View): boolean {
  return s.screen === 'door' && s.door?.page === 'game' && doorView(view).phase !== 'title'
}

// ---------------------------------------------------------------------------
// Prompts: what each one shows, given the open question.

/** The prompt in force: a hooks-set question wins over the local one. */
export function effectivePrompt(d: DoorLocal, dv: DoorView): DoorPrompt {
  const ask = dv.ask
  const p = d.prompt
  if (dv.phase === 'new') return { kind: 'shipName' }
  if (ask?.kind === 'engage') return { kind: 'engage' }
  if (ask?.kind === 'trade') {
    if (p.kind === 'offer' && p.rev === dv.rev) return p
    if (ask.qty !== undefined && ask.ask !== undefined && ask.commodity !== undefined) {
      return { kind: 'offer', rev: dv.rev, commodity: ask.commodity, qty: ask.qty, figure: ask.ask, final: ask.final }
    }
    return { kind: 'tradeQty' }
  }
  if (ask?.kind === 'class0') return p.kind === 'class0' ? p : { kind: 'class0', field: 0, buy: [0, 0, 0] }
  if (ask?.kind === 'drydock') return DRYDOCK_KINDS.includes(p.kind) ? p : { kind: 'dock', venue: 'top' }
  if (['engage', 'tradeQty', 'offer', 'class0', 'shipName', ...DRYDOCK_KINDS].includes(p.kind)) return CMD
  return p
}

type Shown = { lead: string[]; label: string; max: number; digits?: boolean; text?: boolean }

const CLASS0_WHAT = ['cargo holds', 'fighters', 'shield points'] as const

/** How many of each Class 0 good the player can still take, after `buy`. */
export function class0Max(dv: DoorView, ask: Extract<DoorAsk, { kind: 'class0' }>, buy: readonly number[], field: 0 | 1 | 2): number {
  const s = dv.snapshot
  if (!s) return 0
  const spec = SHIPS[s.ship.type]
  const base = ask.prices.hold - 20 * s.ship.holds
  let left = s.credits - (buy[0] ? holdsCost(base, s.ship.holds, buy[0]) : 0) - buy[1] * ask.prices.fighter - buy[2] * ask.prices.shield
  if (field === 0) {
    let n = 0
    while (s.ship.holds + n < spec.maxHolds && holdsCost(base, s.ship.holds, n + 1) <= left) n++
    return n
  }
  if (field === 1) return Math.max(0, Math.min(spec.maxFighters - s.ship.fighters, Math.floor(left / ask.prices.fighter)))
  left = Math.max(0, left)
  return Math.max(0, Math.min(spec.maxShields - s.ship.shields, Math.floor(left / ask.prices.shield)))
}

export function shown(p: DoorPrompt, dv: DoorView): Shown {
  const s = dv.snapshot
  const at = { turns: s?.turns ?? 0, sector: s?.sector ?? 0 }
  // Defaults in brackets: `How many [20]? `; `Your offer [412] ? ` keeps its space.
  const q = (t: string, def?: string | number, end = '? ') => `|13${t}${def !== undefined ? ` |14[${def}]` : ''}|13${def !== undefined ? end : ` ${end}`}`
  switch (p.kind) {
    case 'command':
      return { lead: [], label: commandPrompt(at), max: 1 }
    case 'move':
      return p.quick ? { lead: [], label: commandPrompt(at), max: 5, digits: true } : { lead: [], label: q('To which sector'), max: 5, digits: true }
    case 'quit':
      return { lead: [], label: q(`Leave ${GAME.title}? (Y/N)`, 'N'), max: 1 }
    case 'computer':
      return { lead: [], label: commandPrompt(at, 'Computer command'), max: 1 }
    case 'cplot':
      return { lead: [], label: q('Plot a course to which sector'), max: 5, digits: true }
    case 'cwarps':
      return { lead: [], label: q("Show which sector's warps", at.sector), max: 5, digits: true }
    case 'cport':
      return { lead: [], label: q('What sector is the port in', at.sector), max: 5, digits: true }
    case 'cavoid':
      return { lead: [], label: q('Avoid which sector (0 clears the list)'), max: 5, digits: true }
    case 'scan':
      return { lead: [], label: q('(D)ensity or (H)olo scan', 'D'), max: 1 }
    case 'probe':
      return { lead: [`|10You have |14${s?.ship.equipment.probes ?? 0}|10 Ghost Probes.`], label: q('Send the probe to which sector'), max: 5, digits: true }
    case 'engage':
      return { lead: [], label: q('Engage the autopilot? (Y/N/Express)', 'Y', ' '), max: 1 }
    case 'shipName':
      return { lead: [], label: q(`What do you want to name your ship? (${DOOR_LIMITS.shipName} letters)`).replace(/ \? $/, ': '), max: DOOR_LIMITS.shipName, text: true }
    case 'tradeQty': {
      const ask = dv.ask as Extract<DoorAsk, { kind: 'trade' }>
      const step = ask.steps[0]
      const c = step.commodity
      const trading = ask.trading?.[c] ?? step.max
      const side = step.side === 'sell' ? 'buying' : 'selling'
      return {
        lead: [`|10We are ${side} up to |14${num(trading)}|10.  You have |14${num(s?.ship.cargo[c] ?? 0)}|10 in your holds.`],
        label: q(`How many holds of |11${COMMODITIES[c]}|13 do you want to ${step.side}`, step.defaultQty),
        max: 6,
        digits: true,
      }
    }
    case 'offer':
      return { lead: [], label: q('Your offer', p.figure, ' ? '), max: 9, digits: true }
    case 'class0': {
      const ask = dv.ask as Extract<DoorAsk, { kind: 'class0' }>
      const most = class0Max(dv, ask, p.buy, p.field)
      return { lead: [`|10You can take |14${num(most)}|10 more.`], label: q(`How many ${CLASS0_WHAT[p.field]} do you want to buy`, 0), max: 6, digits: true }
    }
    case 'dock': {
      const labels: Record<Venue, string> = {
        top: '<Drydock> Where to? (?=Help)',
        yard: '<Shipwright> (B)uy, (R)ename, (L)ist, (Q)uit',
        outfit: '<Outfitter> Which item? (Q to leave)',
        bank: '<Exchange Bank> (D)eposit, (W)ithdraw, (T)ransfer, (E)xamine, (Q)uit',
        tavern: '<The Last Light> (A)nnouncement, (Q)uit',
      }
      return { lead: [], label: q(labels[p.venue]), max: 1 }
    }
    case 'yardShip':
      return { lead: [], label: q('Which hull (number, 0 to cancel)'), max: 2, digits: true }
    case 'yardName':
      return { lead: [], label: q(`Name your new ${SHIPS[p.ship]?.name}`), max: DOOR_LIMITS.shipName, text: true }
    case 'rename':
      return { lead: [], label: q('New name for your ship (5,000 credits)'), max: DOOR_LIMITS.shipName, text: true }
    case 'outfitQty':
      return { lead: [], label: q(`How many ${ITEMS.find(i => i.id === p.item)?.name}s`, 1), max: 3, digits: true }
    case 'bankTo':
      return { lead: [], label: q('Transfer to which trader'), max: LIMITS.handleMax, text: true }
    case 'bankAmt':
      return { lead: [], label: q(`How much to ${p.op === 'transfer' ? `send to ${p.to}` : p.op}`), max: 7, digits: true }
    case 'announce':
      return { lead: ['|10Your announcement goes in the daily log for 100 credits.'], label: q('Announce'), max: DOOR_LIMITS.announce, text: true }
  }
}

// ---------------------------------------------------------------------------
// Keys.

export function pressDoor(s: AppState, key: ClientKey, view: View, now: number): Step {
  const dv = doorView(view)
  if (s.screen === 'doors') {
    if (key.key === 'q' || key.key === 'left' || key.key === 'backspace') return { state: { ...s, screen: 'main' } }
    const pick = DOORS.findIndex(d => d.key === key.key)
    if (pick >= 0 || isEnter(key) || key.key === 'right') return { state: { ...s, screen: 'door', door: { ...initialDoor(), page: 'title' } } }
    return { state: s }
  }
  let d = s.door ?? initialDoor()
  if (d.wait) {
    if (key.key === 'escape' || !isWaiting(d, dv, now)) d = { ...d, wait: undefined }
    else return { state: s }
    if (key.key === 'escape') return { state: { ...s, door: d } }
  }
  // Refused at the door (no Epoch, say): back to the title.
  if (d.page === 'game' && dv.phase === 'title') d = { ...d, page: 'title', prompt: CMD, buf: '', scratch: [] }
  const x: X = { s, d, dv, now }

  switch (d.page) {
    case 'title': {
      const k = lower(key)
      if (k === 'e') return send({ ...x, d: { ...d, page: 'game', prompt: CMD, buf: '', scratch: [] } }, { cmd: 'enter' }, undefined)
      if (k === 'i') return { state: { ...s, door: { ...d, page: 'instructions', leaf: 0 } } }
      if (k === 'l' || k === 'r') return { state: { ...s, door: { ...d, page: k === 'l' ? 'log' : 'rankings' } }, action: { type: 'door', cmd: 'news' } }
      if (k === 'q' || key.key === 'backspace') return { state: { ...s, screen: 'doors', door: undefined } }
      return { state: { ...s, door: d } }
    }
    case 'instructions': {
      const leaf = (d.leaf ?? 0) + 1
      if (leaf < INSTRUCTION_PAGES.length && lower(key) !== 'q') return { state: { ...s, door: { ...d, leaf } } }
      return { state: { ...s, door: { ...d, page: 'title', leaf: undefined } } }
    }
    case 'log':
    case 'rankings':
      return { state: { ...s, door: { ...d, page: 'title' } } }
    case 'game':
      if (dv.phase === 'loading') return { state: { ...s, door: d } }
      return pressGame(x, key)
  }
}

type X = { s: AppState; d: DoorLocal; dv: DoorView; now: number }

const withDoor = (x: X, d: Partial<DoorLocal>): AppState => ({ ...x.s, door: { ...x.d, ...d } })

/** Posts a command; `answered` is the prompt line as answered, `extra` lines follow it. */
function send(x: X, cmd: DoorCmd, answered: string | undefined, next: DoorPrompt = CMD, extra: string[] = []): Step {
  const echo = [...x.d.scratch, ...(answered !== undefined ? [answered] : []), ...extra]
  const action = { type: 'door', echo, ...cmd } as Action
  return { state: withDoor(x, { prompt: next, buf: '', scratch: [], wait: { rev: x.dv.rev, at: x.now, lines: echo } }), action }
}

/** A local exchange: lines kept on screen until the next command carries them. */
function say(x: X, lines: string[], next: DoorPrompt = CMD): Step {
  return { state: withDoor(x, { prompt: next, buf: '', scratch: [...x.d.scratch, ...lines].slice(-SCRATCH_MAX) }) }
}

/** The prompt as it reads once answered with `value`. */
const answer = (sh: Shown, value: string) => [...sh.lead, `${sh.label}|15${value}`]

function pressGame(x: X, key: ClientKey): Step {
  const p = effectivePrompt(x.d, x.dv)
  const sh = shown(p, x.dv)
  // Typed answers: digits or text, ended by Enter.
  if (sh.digits || sh.text) {
    if (isBack(key)) {
      if (!x.d.buf && p.kind !== 'shipName' && !p.kind.startsWith('trade') && p.kind !== 'offer' && p.kind !== 'class0') return cancel(x, p, sh)
      return { state: withDoor(x, { prompt: p, buf: x.d.buf.slice(0, -1) }) }
    }
    if (key.key === 'escape') return cancel(x, p, sh)
    if (isEnter(key)) return submit(x, p, sh, x.d.buf.trim())
    if (sh.digits && /^[0-9]$/.test(key.key) && x.d.buf.length < sh.max) return { state: withDoor(x, { prompt: p, buf: x.d.buf + key.key }) }
    if (sh.text && isChar(key) && [...x.d.buf].length < sh.max) return { state: withDoor(x, { prompt: p, buf: x.d.buf + charOf(key) }) }
    // A letter at a number prompt: Q leaves the haggle or the trading post.
    if (sh.digits && lower(key) === 'q') {
      if (p.kind === 'tradeQty' || p.kind === 'offer') return send(x, { cmd: 'skip' }, `${sh.label}|15Q`)
      if (p.kind === 'class0') return send(x, { cmd: 'class0', holds: 0, fighters: 0, shields: 0 }, `${sh.label}|15Q`)
      return cancel(x, p, sh)
    }
    return { state: withDoor(x, { prompt: p }) }
  }
  return pressKey(x, p, sh, key)
}

/** Backs out of a typed prompt without sending anything. */
function cancel(x: X, p: DoorPrompt, sh: Shown): Step {
  const lines = answer(sh, '')
  if (['cplot', 'cwarps', 'cport', 'cavoid'].includes(p.kind)) return say(x, lines, { kind: 'computer' })
  if (p.kind === 'yardShip' || p.kind === 'yardName' || p.kind === 'rename') return say(x, lines, { kind: 'dock', venue: 'yard' })
  if (p.kind === 'outfitQty') return say(x, lines, { kind: 'dock', venue: 'outfit' })
  if (p.kind === 'bankAmt' || p.kind === 'bankTo') return say(x, lines, { kind: 'dock', venue: 'bank' })
  if (p.kind === 'announce') return say(x, lines, { kind: 'dock', venue: 'tavern' })
  if (p.kind === 'shipName') return { state: withDoor(x, { page: 'title', buf: '', prompt: CMD }) }
  return say(x, lines)
}

function submit(x: X, p: DoorPrompt, sh: Shown, v: string): Step {
  const n = Number(v)
  const s = x.dv.snapshot
  switch (p.kind) {
    case 'move':
      if (!v) return say(x, answer(sh, ''))
      return send(x, { cmd: 'plot', to: n, engage: true }, undefined, CMD, answer(sh, v))
    case 'cplot':
      if (!v) return say(x, answer(sh, ''), { kind: 'computer' })
      return send(x, { cmd: 'plot', to: n, engage: false }, undefined, { kind: 'computer' }, answer(sh, v))
    case 'cwarps':
      return send(x, { cmd: 'local', key: 'CI', arg: v ? n : s?.sector }, undefined, { kind: 'computer' }, answer(sh, v))
    case 'cport':
      return send(x, { cmd: 'local', key: 'CR', arg: v ? n : s?.sector }, undefined, { kind: 'computer' }, answer(sh, v))
    case 'cavoid':
      if (!v) return say(x, answer(sh, ''), { kind: 'computer' })
      return send(x, { cmd: 'avoid', sector: n }, undefined, { kind: 'computer' }, answer(sh, v))
    case 'probe':
      if (!v) return say(x, answer(sh, ''))
      return send(x, { cmd: 'probe', to: n }, undefined, CMD, answer(sh, v))
    case 'shipName':
      if (!v) return { state: withDoor(x, { page: 'title', buf: '', prompt: CMD }) }
      return send(x, { cmd: 'create', shipName: v }, undefined, CMD, answer(sh, v))
    case 'tradeQty': {
      const ask = x.dv.ask as Extract<DoorAsk, { kind: 'trade' }>
      const step = ask.steps[0]
      const qty = v ? n : step.defaultQty
      if (qty > step.max) return { state: withDoor(x, { prompt: p, buf: '', scratch: [...x.d.scratch, ...answer(sh, v), red(`You can ${step.side} at most ${num(step.max)}.`)] }) }
      if (qty === 0) return send(x, { cmd: 'offer', commodity: step.commodity, qty: 0, price: 0 }, undefined, CMD, answer(sh, String(qty)))
      const figure = openingFigure(step, qty)
      return say(x, [...answer(sh, String(qty)), `|10Agreed, |14${num(qty)}|10 units.`, '', counterLine(figure, step.side, false)], { kind: 'offer', rev: x.dv.rev, commodity: step.commodity, qty, figure })
    }
    case 'offer': {
      if (p.kind !== 'offer') break
      const price = v ? n : p.figure
      return send(x, { cmd: 'offer', commodity: p.commodity, qty: p.qty, price }, undefined, CMD, answer(sh, String(price)))
    }
    case 'class0': {
      const ask = x.dv.ask as Extract<DoorAsk, { kind: 'class0' }>
      const qty = v ? n : 0
      const most = class0Max(x.dv, ask, p.buy, p.field)
      if (qty > most) return { state: withDoor(x, { prompt: p, buf: '', scratch: [...x.d.scratch, ...answer(sh, v), red(`You can take at most ${num(most)}.`)] }) }
      const buy = [...p.buy] as [number, number, number]
      buy[p.field] = qty
      if (p.field < 2) return say(x, answer(sh, String(qty)), { kind: 'class0', field: (p.field + 1) as 1 | 2, buy })
      return send(x, { cmd: 'class0', holds: buy[0], fighters: buy[1], shields: buy[2] }, undefined, CMD, answer(sh, String(qty)))
    }
    case 'yardShip': {
      if (!v || n === 0) return say(x, answer(sh, v), { kind: 'dock', venue: 'yard' })
      const spec = SHIPS[n]
      if (!spec?.buyable) return { state: withDoor(x, { prompt: p, buf: '', scratch: [...x.d.scratch, ...answer(sh, v), red('We don\'t build that one.')] }) }
      return say(x, answer(sh, v), { kind: 'yardName', ship: n })
    }
    case 'yardName':
      if (!v) return say(x, answer(sh, ''), { kind: 'dock', venue: 'yard' })
      return send(x, { cmd: 'shipwright', body: { op: 'buy', ship: p.ship, name: v } }, undefined, { kind: 'dock', venue: 'yard' }, answer(sh, v))
    case 'rename':
      if (!v) return say(x, answer(sh, ''), { kind: 'dock', venue: 'yard' })
      return send(x, { cmd: 'shipwright', body: { op: 'rename', name: v } }, undefined, { kind: 'dock', venue: 'yard' }, answer(sh, v))
    case 'outfitQty':
      return send(x, { cmd: 'outfit', item: p.item, qty: v ? n : 1 }, undefined, { kind: 'dock', venue: 'outfit' }, answer(sh, v || '1'))
    case 'bankTo':
      if (!v) return say(x, answer(sh, ''), { kind: 'dock', venue: 'bank' })
      return say(x, answer(sh, v), { kind: 'bankAmt', op: 'transfer', to: v })
    case 'bankAmt': {
      if (!v || n === 0) return say(x, answer(sh, v), { kind: 'dock', venue: 'bank' })
      const body = p.op === 'transfer' ? { op: 'transfer' as const, amount: n, to: p.to ?? '' } : { op: p.op, amount: n }
      return send(x, { cmd: 'bank', body }, undefined, { kind: 'dock', venue: 'bank' }, answer(sh, v))
    }
    case 'announce':
      if (!v) return say(x, answer(sh, ''), { kind: 'dock', venue: 'tavern' })
      return send(x, { cmd: 'announce', body: { text: v } }, undefined, { kind: 'dock', venue: 'tavern' }, answer(sh, v))
  }
  return { state: withDoor(x, { prompt: p }) }
}

/** Single-key prompts. */
function pressKey(x: X, p: DoorPrompt, sh: Shown, key: ClientKey): Step {
  const k = lower(key)
  const shownKey = isEnter(key) ? '' : key.key.length === 1 ? key.key.toUpperCase() : ''
  const echo = `${sh.label}|15${shownKey}`
  const dv = x.dv
  const s = dv.snapshot
  switch (p.kind) {
    case 'command': {
      if (/^[0-9]$/.test(key.key)) return { state: withDoor(x, { prompt: { kind: 'move', quick: true }, buf: key.key }) }
      if (!s) return { state: x.s }
      switch (k) {
        case 'm':
          return say(x, [echo, '|10<Move>', `|10Warps to Sector(s) |14:  ${warpList(dv.here?.warps ?? [], undefined)}`], { kind: 'move' })
        case 'd':
          return send(x, { cmd: 'local', key: 'D' }, echo)
        case 'p':
          if (!dv.here?.port) return say(x, [echo, red('There is no port in this sector.')])
          return send(x, { cmd: 'dock' }, echo)
        case 's': {
          const scanner = s.ship.equipment.scanner
          if (scanner === 'none') return say(x, [echo, red('You have no long range scanner. The Outfitter at the Drydock sells them.')])
          if (scanner === 'density') return send(x, { cmd: 'scan', kind: 'density' }, echo)
          return say(x, [echo], { kind: 'scan' })
        }
        case 'c':
          return say(x, [echo, '|10<Computer activated>'], { kind: 'computer' })
        case 'i':
          return send(x, { cmd: 'local', key: 'I' }, echo)
        case '/':
          return send(x, { cmd: 'local', key: '/' }, echo)
        case 'v':
          return send(x, { cmd: 'local', key: 'V' }, echo)
        case '?':
          return send(x, { cmd: 'local', key: '?' }, echo)
        case 'e':
          if (!s.ship.equipment.probes) return say(x, [echo, red('You have no Ghost Probes. The Outfitter sells them.')])
          return say(x, [echo], { kind: 'probe' })
        case 'q':
          return say(x, [echo], { kind: 'quit' })
      }
      if (k.length === 1 && LATER.includes(k)) return say(x, [echo, '|08That system comes online in a later Epoch.'])
      return { state: x.s }
    }
    case 'quit':
      if (k === 'y') return send({ ...x, d: { ...x.d, page: 'title' } }, { cmd: 'leave' }, echo, CMD, ['|08You power down and return to the station.'])
      return say(x, [`${sh.label}|15N`])
    case 'computer': {
      const stay: DoorPrompt = { kind: 'computer' }
      const next: Record<string, DoorPrompt> = { f: { kind: 'cplot' }, i: { kind: 'cwarps' }, r: { kind: 'cport' }, v: { kind: 'cavoid' } }
      if (next[k]) return say(x, [echo], next[k])
      const locals: Record<string, 'CK' | 'CX' | 'CL' | 'CG' | 'CE' | 'C?'> = { k: 'CK', x: 'CX', l: 'CL', g: 'CG', e: 'CE', '?': 'C?' }
      if (locals[k]) return send(x, { cmd: 'local', key: locals[k] }, echo, stay)
      if (k === 'q' || key.key === 'escape') return say(x, [echo, '|10<Computer deactivated>'])
      return { state: withDoor(x, { prompt: stay }) }
    }
    case 'scan':
      if (k === 'h') return send(x, { cmd: 'scan', kind: 'holo' }, echo)
      if (k === 'd' || isEnter(key)) return send(x, { cmd: 'scan', kind: 'density' }, `${sh.label}|15D`)
      if (k === 'q' || key.key === 'escape') return say(x, [echo])
      return { state: withDoor(x, { prompt: p }) }
    case 'engage': {
      const ask = dv.ask as Extract<DoorAsk, { kind: 'engage' }>
      if (k === 'y' || isEnter(key)) return send(x, { cmd: 'move', path: ask.path.slice(1), mode: 'alert' }, `${sh.label}|15Y`, CMD, ['|10<Autopilot engaged>'])
      if (k === 'e') return send(x, { cmd: 'move', path: ask.path.slice(1), mode: 'express' }, echo, CMD, ['|10<Express autopilot engaged>'])
      if (k === 'n' || k === 'q' || key.key === 'escape') return send(x, { cmd: 'clear' }, `${sh.label}|15N`)
      return { state: x.s }
    }
    case 'dock':
      return pressDrydock(x, p.venue, sh, k, echo, key)
  }
  return { state: x.s }
}

function pressDrydock(x: X, venue: Venue, sh: Shown, k: string, echo: string, key: ClientKey): Step {
  const s = x.dv.snapshot
  const at = (v: Venue): DoorPrompt => ({ kind: 'dock', venue: v })
  const back = k === 'q' || key.key === 'escape'
  switch (venue) {
    case 'top':
      if (k === 's') return say(x, [echo, '|10<Shipwright>'], at('yard'))
      if (k === 'o' && s) return say(x, [echo, ...outfitterLines(s)], at('outfit'))
      if (k === 'b') return say(x, [echo, '|10<Exchange Bank>'], at('bank'))
      if (k === 't') return say(x, [echo, '|10<The Last Light> |08Smoke, low music, and a board of announcements by the door.'], at('tavern'))
      if (k === '?') return say(x, [echo, ...DRYDOCK_HELP], at('top'))
      if (back) return send(x, { cmd: 'clear' }, echo, CMD, ['|08You cast off from the Drydock.', ''])
      return { state: withDoor(x, { prompt: at('top') }) }
    case 'yard':
      if (k === 'b') return say(x, [echo, ...shipCatalogLines()], { kind: 'yardShip' })
      if (k === 'l') return say(x, [echo, ...shipCatalogLines()], at('yard'))
      if (k === 'r') return say(x, [echo], { kind: 'rename' })
      if (back) return say(x, [echo], at('top'))
      return { state: withDoor(x, { prompt: at('yard') }) }
    case 'outfit': {
      const item = ITEMS.find(i => i.phase === 1 && i.key.toLowerCase() === k)
      if (item) return say(x, [echo], { kind: 'outfitQty', item: item.id })
      if (back) return say(x, [echo], at('top'))
      return { state: withDoor(x, { prompt: at('outfit') }) }
    }
    case 'bank':
      if (k === 'd' || k === 'w') return say(x, [echo], { kind: 'bankAmt', op: k === 'd' ? 'deposit' : 'withdraw' })
      if (k === 't') return say(x, [echo], { kind: 'bankTo' })
      if (k === 'e') return say(x, [echo, `|10You have |14${num(s?.bank ?? 0)}|10 credits on deposit and |14${num(s?.credits ?? 0)}|10 on hand.`], at('bank'))
      if (back) return say(x, [echo], at('top'))
      return { state: withDoor(x, { prompt: at('bank') }) }
    case 'tavern':
      if (k === 'a') return say(x, [echo], { kind: 'announce' })
      if (back) return say(x, [echo], at('top'))
      return { state: withDoor(x, { prompt: at('tavern') }) }
  }
}

// ---------------------------------------------------------------------------
// Drawing: at most `h` lines; app.ts pads and fits them.

export function drawDoor(s: AppState, view: View, w: number, h: number, now: number): string[] {
  const dv = doorView(view)
  if (s.screen === 'doors') {
    const lines = [...header('Doors', w)]
    DOORS.forEach((d, i) => lines.push(`${i === 0 ? LIGHTBAR : '|07'} ${d.key} |16 |11${d.title.padEnd(12)} |07${d.blurb}`))
    lines.push('', '|08Doors are games that run beside the board. Your progress is kept on the server.')
    return [...pad(lines, h - 1).slice(0, h - 1), footer('|08[|151|08]|07 Play  |08[|15Q|08]|07uit', w)]
  }
  const d = s.door ?? initialDoor()
  const waiting = isWaiting(d, dv, now)
  const page = d.page === 'game' && dv.phase === 'title' && !waiting ? 'title' : d.page
  switch (page) {
    case 'title':
      return drawTitle(dv, w, h)
    case 'instructions': {
      const leaf = Math.min(d.leaf ?? 0, INSTRUCTION_PAGES.length - 1)
      const more = INSTRUCTION_PAGES.length > 1 ? ` |08(page ${leaf + 1} of ${INSTRUCTION_PAGES.length}, Q to stop)` : ''
      return withKey([...header('Instructions', w, false, false), ...INSTRUCTION_PAGES[leaf].slice(0, Math.max(1, h - 4))], w, h, more)
    }
    case 'log': {
      const b = dv.board
      const body = !b ? ['|07Fetching the daily log...'] : b.missing ? ['|08No log yet. The lanes are quiet.'] : logLines(b.log)
      return withKey([...header('Daily Log', w, false, false), ...body.slice(-Math.max(1, h - 4))], w, h)
    }
    case 'rankings': {
      const b = dv.board
      const body = !b ? ['|07Fetching the rankings...'] : b.missing ? ['|08No rankings yet.'] : rankingLines(b.rankings)
      return withKey([...header('Rankings', w, false, false), ...body.slice(0, Math.max(1, h - 4))], w, h)
    }
    case 'game':
      return drawGame(d, dv, w, h, now, waiting)
  }
}

function withKey(lines: string[], w: number, h: number, more = ''): string[] {
  return [...pad(lines, h - 1).slice(0, h - 1), center(`|08[|15Hit a key|08]${more}`, w)]
}

function drawTitle(dv: DoorView, w: number, h: number): string[] {
  // Art drawn as a block: one left margin for every row, so its columns line up.
  const raw = h >= 16 ? titleArt(w) : [`|11${GAME.title}`]
  const margin = ' '.repeat(Math.max(0, Math.floor((w - Math.max(...raw.map(visibleLength))) / 2)))
  const epoch = `|08Epoch ${dv.season.replace(/^s/, '')}${dv.board?.status ? ` |08· |07${dv.board.status.traders} traders · day ${dv.board.status.ageDays + 1}` : ''}`
  const menu = '|08[|15E|08]|07nter the lanes  |08[|15I|08]|07nstructions  |08[|15L|08]|07og (today)  |08[|15R|08]|07ankings  |08[|15Q|08]|07uit'
  const block = [...raw.map(l => margin + l), '', center(epoch, w), '', center(menu, w)]
  const top = Math.max(0, Math.floor((h - block.length) / 2))
  return [...Array.from({ length: top }, () => ''), ...block]
}

function drawGame(d: DoorLocal, dv: DoorView, w: number, h: number, now: number, waiting: boolean): string[] {
  if (dv.phase === 'loading' || (waiting && dv.phase === 'title')) return ['', `|10Opening the lanes${'.'.repeat(1 + (Math.floor(now / 500) % 3))}`]
  const p = effectivePrompt(d, dv)
  const sh = shown(p, dv)
  if (dv.phase === 'new') {
    const lines = [...header(GAME.title, w, false, false), `|10There is no record of you in Epoch ${dv.season.replace(/^s/, '')}. Every trader starts somewhere:`,
      '|10a Freetrader, a few hundred credits, and sector 1.', '', ...dv.transcript.slice(-3), '']
    const input = waiting ? `${sh.label}|15${d.buf} |08(…)` : `${sh.label}|15${d.buf}|13▄`
    return [...lines, input, '', '|08Enter to launch. An empty name goes back.']
  }
  const rows = Math.max(1, h - 2)
  const pending = waiting ? (d.wait?.lines ?? []) : []
  const tail = [...dv.transcript, ...pending, ...d.scratch, ...(waiting ? [] : sh.lead)]
  const shownTail = tail.slice(-rows)
  const prompt = waiting ? `${sh.label}|08(…)` : `${sh.label}|15${d.buf}|13▄`
  const stats = dv.snapshot ? quickStats(dv.snapshot) : ''
  return [...pad(shownTail, rows), fitPipe(prompt, w), `|16${stats}`]
}
