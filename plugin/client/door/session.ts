// HYPERPLANE's command runner as pure functions: `plan` turns a door command
// into transcript lines and maybe one request; `applyReply` and `applyError`
// turn what came back into lines, the next question and what became known.
// hooks/register.tsx reads its atoms, calls these, does the I/O and writes back.

import type * as T from '../../types'
import type { DoorAsk, DoorBoard, DoorCmd, DoorKnown, DoorLocalKey, DoorView } from '../../types'
import { DEFAULT_CONFIG, SHIPS, type Commodity, type ItemId } from '../../shared/door/data'
import { plotCourse } from '../../shared/door/nav'
import type {
  AnnounceRequest, BankRequest, DoorEvent, DoorMap, DoorNews, DoorReply, DoorStateReply, KnownDelta, PlayerSnapshot, PortReport, SectorView,
  ShipwrightRequest, TradeStep,
} from '../../shared/door/protocol'
import {
  courseLines, eventLines, logLines, num, portReportLines, quickStatsLines, rankTableLines, shipCatalogLines, shipInfoLines, sectorLines,
  statusLines, warpList, alignmentWordsLine, type Explored,
} from '../../shared/door/format'
import { COMPUTER_HELP, HELP } from './content'

// types/index.d.ts mirrors the wire types (a contract stands alone); this fails to compile if they drift.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
type Mirrors = [
  Same<T.PlayerSnapshot, PlayerSnapshot>, Same<T.SectorView, SectorView>, Same<T.PortReport, PortReport>, Same<T.TradeStep, TradeStep>,
  Same<T.DoorMap, DoorMap>, Same<T.DoorNews, DoorNews>, Same<T.ShipwrightRequest, ShipwrightRequest>, Same<T.BankRequest, BankRequest>,
  Same<T.AnnounceRequest, AnnounceRequest>, Same<T.Commodity, Commodity>, Same<T.ItemId, ItemId>,
]
export const MIRRORS_MATCH: Mirrors = [true, true, true, true, true, true, true, true, true, true, true]

export const TRANSCRIPT_MAX = 300
/** Today's log lines kept for the title's Log page. */
export const BOARD_LOG = 60

export const newDoorView = (season = 's1'): DoorView => ({ season, phase: 'title', rev: 0, transcript: [], busy: false })
export const emptyKnown = (season = ''): DoorKnown => ({ season, explored: [], ports: {} })

/** Everything a command may read. */
export type DoorCtx = {
  season: string
  map?: DoorMap
  known: DoorKnown
  snapshot?: PlayerSnapshot
  here?: SectorView
  news?: DoorNews
  ask?: DoorAsk
}

export type DoorRequest = { method: 'GET' | 'POST'; path: string; body?: unknown }

/** `ask`: undefined keeps the question open, null drops it. */
export type Plan = { lines: string[]; ask?: DoorAsk | null; phase?: DoorView['phase']; request?: DoorRequest }

export type Outcome = { lines: string[]; ask?: DoorAsk | null; phase?: DoorView['phase']; known?: DoorKnown }

export const explorer = (k: DoorKnown): Explored => {
  const set = new Set(k.explored)
  return s => set.has(s)
}

/** A reply's `known` merged in: a delta, or (GET state) the whole thing. */
export function mergeKnown(k: DoorKnown, season: string, delta: KnownDelta | undefined, complete = false): DoorKnown {
  const base = complete || k.season !== season ? emptyKnown(season) : k
  if (!delta) return base
  const explored = [...new Set([...base.explored, ...delta.explored])].sort((a, b) => a - b)
  const ports = { ...base.ports }
  for (const p of delta.ports) ports[p.sector] = p
  return { season, explored, ports }
}

const red = (s: string) => `|12${s}`
const post = (path: string, body: unknown = {}): DoorRequest => ({ method: 'POST', path: `/v1/door/${path}`, body })
const maxCourse = DEFAULT_CONFIG.maxCourse

/** The lines and request for one command. */
export function plan(ctx: DoorCtx, c: DoorCmd): Plan {
  const s = ctx.snapshot
  switch (c.cmd) {
    case 'enter':
      return { lines: [], phase: 'loading', ask: null, request: { method: 'GET', path: '/v1/door/state' } }
    case 'leave':
      return { lines: [], phase: 'title', ask: null }
    case 'news':
    case 'clear':
      return { lines: [], ask: c.cmd === 'clear' ? null : undefined }
    case 'create':
      return { lines: [], request: post('create', { shipName: c.shipName }) }
    case 'local':
      return { lines: local(ctx, c.key, c.arg) }
    case 'plot':
      return plot(ctx, c.to, c.engage)
    case 'move':
      return { lines: [], ask: null, request: post('move', { path: c.path, mode: c.mode }) }
    case 'dock':
      return { lines: ['|10Requesting a berth...'], request: post('dock') }
    case 'offer':
      return { lines: [], request: post('offer', { commodity: c.commodity, qty: c.qty, price: c.price }) }
    case 'skip':
      return { lines: [], ask: null, request: post('skip') }
    case 'class0':
      if (c.holds + c.fighters + c.shields <= 0) return { lines: ['|08You leave the trading post empty-handed.'], ask: null }
      return { lines: [], request: post('class0', { holds: c.holds, fighters: c.fighters, shields: c.shields }) }
    case 'outfit':
      return { lines: [], request: post('outfit', { item: c.item, qty: c.qty }) }
    case 'shipwright':
      return { lines: [], request: post('shipwright', c.body) }
    case 'bank':
      return { lines: [], request: post('bank', c.body) }
    case 'announce':
      return { lines: [], request: post('announce', c.body) }
    case 'scan':
      return { lines: [], request: post('scan', { kind: c.kind }) }
    case 'probe': {
      if (!s) return { lines: [] }
      if (!ctx.map) return { lines: [red('The navigation computer has no star map. Try again in a moment.')] }
      if (c.to === s.sector) return { lines: [red('The probe is already here.')] }
      const path = plotCourse(ctx.map, s.sector, c.to, undefined, maxCourse)
      if (!path) return { lines: [red(`No course to sector ${c.to} within ${maxCourse} warps.`)] }
      return { lines: [], request: post('probe', { path: path.slice(1) }) }
    }
    case 'avoid': {
      if (!s) return { lines: [] }
      const set = c.sector === 0 ? [] : s.avoids.includes(c.sector) ? s.avoids.filter(a => a !== c.sector) : [...s.avoids, c.sector]
      const what = c.sector === 0 ? 'Avoid list cleared.' : s.avoids.includes(c.sector) ? `Sector ${c.sector} is no longer avoided.` : `Sector ${c.sector} will be avoided.`
      return { lines: [`|10${what}`], request: post('avoids', { set }) }
    }
  }
}

/** Plots locally over the cached map; one hop goes straight to a move request. */
function plot(ctx: DoorCtx, to: number, engage: boolean): Plan {
  const s = ctx.snapshot
  if (!s) return { lines: [] }
  const map = ctx.map
  if (!map) return { lines: [red('The navigation computer has no star map. Try again in a moment.')] }
  if (!Number.isInteger(to) || to < 1 || to > map.sectors) return { lines: [red(`There is no sector ${to}. Sectors run 1 to ${map.sectors}.`)] }
  if (to === s.sector) return { lines: [red('You are already in that sector.')] }
  const tpw = SHIPS[s.ship.type]?.turnsPerWarp ?? 1
  if (engage && map.warps[s.sector]?.includes(to)) {
    return { lines: [], ask: null, request: post('move', { path: [to], mode: 'alert' }) }
  }
  let path = plotCourse(map, s.sector, to, s.avoids, maxCourse)
  const lines: string[] = []
  if (!path && s.avoids.length) {
    path = plotCourse(map, s.sector, to, undefined, maxCourse)
    if (path) lines.push('|14Your avoid list blocks every course; this one ignores it.')
  }
  if (!path) return { lines: [red(`No course to sector ${to} within ${maxCourse} warps.`)] }
  lines.unshift(...courseLines(path, tpw, explorer(ctx.known)))
  if (!engage) return { lines: [...lines, ''] }
  return { lines, ask: { kind: 'engage', path } }
}

/** The commands that cost nothing. */
export function local(ctx: DoorCtx, key: DoorLocalKey, arg?: number): string[] {
  const s = ctx.snapshot
  const ex = explorer(ctx.known)
  switch (key) {
    case 'D':
      return ctx.here ? ['', ...sectorLines(ctx.here, ex), ''] : []
    case 'I':
      return s ? ['', ...shipInfoLines(s), ''] : []
    case '/':
      return s ? quickStatsLines(s) : []
    case '?':
      return ['', ...HELP, '']
    case 'C?':
      return ['', ...COMPUTER_HELP, '']
    case 'V':
      return ctx.news ? ['', ...statusLines(ctx.news.status), ''] : [red('No word from the lanes yet. Try again in a moment.')]
    case 'CI': {
      const sec = arg ?? s?.sector ?? 1
      const warps = ctx.map?.warps[sec]
      if (!warps) return [red(`There is no sector ${sec}.`)]
      return [`|10Sector |11${sec}|10 has warps to: ${warpList(warps, ex)}`]
    }
    case 'CK': {
      const total = ctx.map?.sectors ?? 0
      const n = ctx.known.explored.length
      const pct = total ? Math.floor((100 * n) / total) : 0
      return [`|10You have explored |14${num(n)}|10 of |14${num(total)}|10 sectors (|14${pct}%|10) and seen |14${Object.keys(ctx.known.ports).length}|10 ports.`]
    }
    case 'CR': {
      const sec = arg ?? s?.sector ?? 1
      const r = ctx.known.ports[sec]
      if (!r) return [red(`You have no record of a port in sector ${sec}.`)]
      return ['', ...portReportLines(r, s?.ship.cargo, 'Port report for'), `|08(as of ${r.seenAt.slice(0, 16).replace('T', ' ')} UTC)`, '']
    }
    case 'CX':
      return s?.avoids.length ? ['|10<Avoided sectors>', `|11${s.avoids.join('|10, |11')}`] : ['|10<Avoided sectors>', '|08None.']
    case 'CL':
      return ['', ...shipCatalogLines(), '']
    case 'CG':
    case 'CE':
      return ['', ...rankTableLines(key === 'CE'), alignmentWordsLine(), '']
  }
  return []
}

// ---------------------------------------------------------------------------
// Replies.

/** The haggle question a reply leaves open, if any. */
export function tradeAsk(reply: Pick<DoorReply, 'pending' | 'events'>, known: DoorKnown): DoorAsk | null {
  const p = reply.pending
  if (!p) return null
  const ask: Extract<DoorAsk, { kind: 'trade' }> = { kind: 'trade', steps: p.steps, at: p.at, round: p.round }
  const report = known.ports[p.sector] ?? reply.events.flatMap(e => (e.kind === 'dock' ? [e.report] : []))[0]
  if (report) ask.trading = report.items.map(i => i.trading)
  const counter = [...reply.events].reverse().find((e): e is Extract<DoorEvent, { kind: 'counter' }> => e.kind === 'counter')
  const step = counter && p.steps.find(s => s.commodity === counter.commodity)
  if (counter && step) {
    ask.commodity = counter.commodity
    ask.qty = step.max
    ask.ask = counter.price
    ask.final = counter.final
  }
  return ask
}

function format(events: DoorEvent[], ctx: { snapshot?: PlayerSnapshot; known: DoorKnown; steps?: readonly TradeStep[]; here?: SectorView }): string[] {
  return events.flatMap(e => eventLines(e, { snapshot: ctx.snapshot, steps: ctx.steps, explored: explorer(ctx.known), portName: ctx.here?.port?.name }))
}

/** Log lines newer than `after`, at most `max`. */
function since(news: DoorNews | undefined, after: number, max = 12): string[] {
  const fresh = (news?.log ?? []).filter(e => e.id > after)
  if (!fresh.length) return []
  return ['|13-=-=- |10Since your last visit |13-=-=-', ...logLines(fresh.slice(-max)), '']
}

/** What a successful reply prints and leaves open. */
export function applyReply(ctx: DoorCtx, c: DoorCmd, reply: DoorReply | DoorStateReply): Outcome {
  if (c.cmd === 'enter') {
    const r = reply as DoorStateReply
    if (!r.created) return { lines: [], phase: 'new', ask: null, known: mergeKnown(ctx.known, ctx.season, r.known, true) }
    const known = mergeKnown(ctx.known, r.snapshot.season, r.known, true)
    const steps = r.pending?.steps
    const lines = [
      `|10Welcome back to the lanes, |11${r.snapshot.name}|10.`,
      '',
      ...since(ctx.news, r.snapshot.lastSeenLog),
      ...format(r.events, { snapshot: r.snapshot, known, steps, here: r.here }),
      ...sectorLines(r.here, explorer(known)),
      '',
    ]
    if (r.pending) lines.push('|14Your haggle is still open at this port.')
    return { lines, phase: 'ready', ask: tradeAsk(r, known), known }
  }
  const r = reply as DoorReply
  const known = mergeKnown(ctx.known, r.snapshot.season, r.known)
  const fmt = (events: DoorEvent[]) => format(events, { snapshot: r.snapshot, known, steps: r.pending?.steps ?? (ctx.ask?.kind === 'trade' ? ctx.ask.steps : undefined), here: r.here })
  switch (c.cmd) {
    case 'create':
      return {
        lines: [
          `|10The |11${r.snapshot.ship.name}|10 is fueled and cleared. Welcome to the lanes, |11${r.snapshot.name}|10.`,
          `|10You have |14${num(r.snapshot.credits)}|10 credits, |14${r.snapshot.ship.holds}|10 empty holds and |14${num(r.snapshot.turns)}|10 turns. Type |14?|10 for help.`,
          '',
          ...fmt(r.events),
          ...sectorLines(r.here, explorer(known)),
          '',
        ],
        phase: 'ready',
        ask: null,
        known,
      }
    case 'move':
    case 'plot':
      return { lines: [...fmt(r.events), ...sectorLines(r.here, explorer(known)), ''], ask: null, known }
    case 'dock': {
      const ev = r.events
      let ask: DoorAsk | null = null
      const c0 = ev.find((e): e is Extract<DoorEvent, { kind: 'class0' }> => e.kind === 'class0')
      if (c0) ask = { kind: 'class0', prices: { hold: c0.holdPrice, fighter: c0.fighterPrice, shield: c0.shieldPrice } }
      else if (r.here.port?.class === 9) ask = { kind: 'drydock' }
      else ask = tradeAsk(r, known)
      const lines = fmt(ev)
      if (ask?.kind === 'drydock') lines.push(`|10One turn used, |14${num(r.snapshot.turns)}|10 left. The concourse opens before you.`, '')
      return { lines, ask, known }
    }
    case 'offer':
    case 'skip': {
      const ask = tradeAsk(r, known)
      const lines = fmt(r.events)
      if (!ask) lines.push('|08You cast off from the port.', '')
      return { lines, ask, known }
    }
    case 'class0':
      return { lines: [...fmt(r.events), `|10You have |14${num(r.snapshot.credits)}|10 credits left.`, ''], ask: null, known }
    default:
      return { lines: fmt(r.events), known }
  }
}

/** What a refused command prints. Busy and rate limits keep an open haggle; other errors drop it. */
export function applyError(ctx: DoorCtx, c: DoorCmd, code: string, message: string): Outcome {
  const text = code === 'closed' ? 'The lanes are dark. No Epoch has begun.' : code === 'busy' ? 'The lanes are jammed. Try again in a moment.' : message
  const keep = code === 'busy' || code === 'rate_limited'
  let ask: DoorAsk | null | undefined
  if (ctx.ask?.kind === 'trade' && !keep) ask = null
  if (ctx.ask?.kind === 'engage') ask = null
  const phase: DoorView['phase'] | undefined = c.cmd === 'enter' ? 'title' : c.cmd === 'create' && code === 'taken' ? 'title' : undefined
  return { lines: [red(text)], ask, phase }
}

/** The title pages' cut of news.json. */
export function boardOf(news: DoorNews | undefined, now: number): DoorBoard {
  if (!news) return { log: [], rankings: [], missing: true }
  const day = new Date(now).toISOString().slice(0, 10)
  const today = news.log.filter(e => e.ts.slice(0, 10) === day)
  return { status: news.status, log: (today.length ? today : news.log).slice(-BOARD_LOG), rankings: news.rankings.traders.slice(0, 20) }
}

/** The transcript with lines added, capped. */
export function appendLines(transcript: string[], ...more: string[][]): string[] {
  const next = transcript.concat(...more)
  return next.length > TRANSCRIPT_MAX ? next.slice(-TRANSCRIPT_MAX) : next
}
