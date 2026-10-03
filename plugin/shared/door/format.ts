// HYPERPLANE's text output: pure formatters from the wire types to
// pipe-coded transcript lines, at most 80 columns. The visual convention is
// the classic one: green labels (|10), cyan data (|11), yellow numbers (|14),
// red (|12) for danger and for warps not yet explored, prompts in |13/|05.

import {
  ALIGN_WORDS, COMMODITIES, COMMODITY_SHORT, ITEMS, PORT_CLASSES, RANKS_EVIL, RANKS_GOOD, SHIPS,
  alignWord, rankExp, rankOf, rankTitle, shipCost, type Commodity, type PortClassId,
} from './data'
import { DEATH } from './text'
import type {
  DensityRow, DoorEvent, GameStatus, LogEntry, PlayerSnapshot, PortReport, SectorView, StopReason, TradeStep, TraderRanking,
} from './protocol'

/** Is a sector explored? Absent means "treat everything as explored". */
export type Explored = ((sector: number) => boolean) | undefined

export const num = (n: number) => Math.round(n).toLocaleString('en-US')
const plural = (n: number, one: string, many = one + 's') => (n === 1 ? one : many)

/** User-supplied text (names, beacons) with any pipe codes taken out. */
export const bare = (s: unknown) => String(s ?? '').replace(/\|[0-9]{2}/g, '').replace(/[\u0000-\u001f\u007f-\u009f]/g, '')

/** A sector-display label: 8 wide, then ': ', so values start at column 11. */
export const label = (l: string) => `|10${l.padEnd(8)}|14: `
/** Continuation lines line up under the value column. */
const CONT = ' '.repeat(10)

export function portCode(cls: PortClassId): string {
  if (cls === 0) return 'Special'
  if (cls === 9) return 'Drydock'
  return PORT_CLASSES[cls].code
}

/** A port's class letters, buying in green and selling in cyan. */
function classLetters(cls: PortClassId): string {
  if (cls === 0 || cls === 9) return `|11${portCode(cls)}`
  return [...PORT_CLASSES[cls].code].map(ch => (ch === 'B' ? `|10${ch}` : `|11${ch}`)).join('')
}

/** Warps as `2 - (3) - 4`, unexplored ones red in parentheses. */
export function warpList(warps: readonly number[], explored: Explored): string {
  if (!warps.length) return '|08none'
  return warps.map(w => (explored && !explored(w) ? `|12(${w})` : `|11${w}`)).join('|02 - ')
}

/** Wraps ` - `/` > ` separated items into lines of at most `width`, continuing under `indent`. */
function wrapItems(head: string, items: string[], sep: string, width = 78, indent = CONT): string[] {
  const vis = (s: string) => s.replace(/\|[0-9]{2}/g, '').length
  const out: string[] = []
  let line = head
  let len = vis(head)
  items.forEach((item, i) => {
    const piece = (i ? sep : '') + item
    if (i && len + vis(piece) > width) {
      out.push(line + sep.replace(/\s+$/, ''))
      line = indent + item
      len = indent.length + vis(item)
    } else {
      line += piece
      len += vis(piece)
    }
  })
  out.push(line)
  return out
}

// ---------------------------------------------------------------------------
// The sector display (D).

export function sectorLines(v: SectorView, explored?: Explored): string[] {
  const out: string[] = []
  const where = v.region === 'concord' ? '|10in |09Concord Space|10.' : '|10in |09uncharted space|10.'
  out.push(`${label('Sector')}|11${v.id} ${where}`)
  if (v.beacon) out.push(`${label('Beacon')}|12${bare(v.beacon)}`)
  if (v.port) {
    const p = v.port
    if (p.destroyed) out.push(`${label('Ports')}|12Wreckage. Whatever traded here is gone.`)
    else out.push(`${label('Ports')}|11${bare(p.name)}|14, |10Class |14${p.class} |14(${classLetters(p.class)}|14)`)
    if (p.buildingDays) out.push(`${CONT}|08(under construction, |14${p.buildingDays}|08 ${plural(p.buildingDays, 'day')} left)`)
  }
  v.planets.forEach((p, i) => {
    const owner = p.owner ? ` |08[|07${bare(p.owner)}|08]` : ''
    out.push(`${i ? CONT : label('Planets')}|14(|11${p.class}|14) |11${bare(p.name)}${owner}${p.shielded ? ' |12<shielded>' : ''}`)
  })
  v.traders.forEach((t, i) => {
    const corp = t.corp ? ` |08[${bare(t.corp)}]` : ''
    out.push(`${i ? CONT : label('Traders')}|11${bare(t.name)}${corp}|10, w/ |14${num(t.fighters)}|10 ftrs,`)
    out.push(`${CONT}|10in |11${bare(t.ship)} |14(|10${SHIPS[t.shipType]?.name ?? 'unknown hull'}|14)`)
  })
  v.ships.forEach((s, i) => {
    out.push(`${i ? CONT : label('Ships')}|11${bare(s.name)} |08[owned by] |11${bare(s.owner)}|10, w/ |14${num(s.fighters)}|10 ftrs,`)
    out.push(`${CONT}|14(|10${SHIPS[s.shipType]?.name ?? 'unknown hull'}|14)`)
  })
  v.hallucinations.forEach((h, i) => {
    out.push(`${i ? CONT : label('Raiders')}|12${bare(h.name)}|10, w/ |14${num(h.fighters)}|10 ftrs |14(|12${SHIPS[h.shipType]?.name ?? 'Hallucination'}|14)`)
  })
  if (v.marshals.length) out.push(`${label('Patrol')}|11${v.marshals.map(bare).join('|10, |11')}`)
  if (v.fighters) {
    const f = v.fighters
    const whose = f.isYours ? '|11(yours)' : f.isCorp ? '|11(belong to your corp)' : `|12(belong to ${bare(f.owner)})`
    const mode = f.mode === 'toll' ? ' |14[Toll]' : f.mode === 'defensive' ? ' |14[Defensive]' : ''
    out.push(`${label('Fighters')}|14${num(f.count)} ${whose}${mode}`)
  }
  if (v.navhaz) out.push(`${label('NavHaz')}|12${v.navhaz}% |08(drifting wreckage)`)
  v.mines.forEach((m, i) => {
    const whose = m.isYours ? '|11(yours)' : `|12(belong to ${bare(m.owner)})`
    out.push(`${i ? `|10${' '.repeat(8)}|14: ` : label('Mines')}|14${num(m.count)} |10(${m.kind === 'contact' ? 'Contact' : 'Limpet'}) ${whose}`)
  })
  out.push(...wrapItems('|10Warps to Sector(s) |14:  ', warpList(v.warps, explored).split('|02 - '), '|02 - '))
  return out
}

// ---------------------------------------------------------------------------
// Ports.

/** A commerce report table; `onBoard` is the ship's cargo. */
export function portReportLines(r: PortReport, onBoard?: readonly number[], title = 'Commerce report for'): string[] {
  const out = [
    `|10${title} |11${bare(r.name)}|10, Class |14${r.class} |14(${classLetters(r.class)}|14)`,
    '',
    '|10 Items     Status  Trading % of max OnBoard',
    '|02 -----     ------  ------- -------- -------',
  ]
  r.items.forEach((it, c) => {
    const status = it.status === 'buying' ? '|10Buying ' : '|11Selling'
    out.push(`|11${COMMODITIES[c].padEnd(10)} ${status} |14${String(it.trading).padStart(7)} ${String(it.pct).padStart(7)}% ${String(onBoard?.[c] ?? 0).padStart(7)}`)
  })
  return out
}

export function holdsFree(s: PlayerSnapshot): number {
  return s.ship.holds - s.ship.cargo[0] - s.ship.cargo[1] - s.ship.cargo[2] - s.ship.colonists
}

/** The haggle's opening figure for `qty` units. */
export const openingFigure = (step: Pick<TradeStep, 'unitOffer'>, qty: number) => Math.max(1, Math.round(step.unitOffer * qty))

export function counterLine(price: number, side: 'sell' | 'buy' | undefined, final: boolean): string {
  if (final) return `|13Our final offer is |14${num(price)}|13 credits.`
  return `|13We'll ${side === 'buy' ? 'sell' : 'buy'} them for |14${num(price)}|13 credits.`
}

// ---------------------------------------------------------------------------
// Movement.

/** "The shortest path (N hops, T turns) from A to B is:" and the path. */
export function courseLines(path: readonly number[], turnsPerWarp: number, explored?: Explored): string[] {
  const hops = Math.max(0, path.length - 1)
  const head = `|10The shortest path |14(${hops} ${plural(hops, 'hop')}, ${hops * turnsPerWarp} ${plural(hops * turnsPerWarp, 'turn')})|10 from sector |11${path[0]}|10 to sector |11${path[path.length - 1]}|10 is:`
  const items = path.map(s => (explored && !explored(s) ? `|12(${s})` : `|11${s}`))
  return [head, ...wrapItems('', items, '|14 > ', 78, '')]
}

const STOPS: Record<StopReason, string> = {
  arrived: '',
  port: 'a port',
  planet: 'a planet',
  trader: 'another ship',
  fighters: 'hostile fighters',
  mines: 'mines',
  toll: 'a toll blockade',
  navhaz: 'drifting wreckage',
  turns: '',
  hallucination: 'a Hallucination',
  blocked: 'a blockade',
  interdicted: 'an interdiction field',
  dead: '',
}

// ---------------------------------------------------------------------------
// Events.

/** What an event formatter may need to know besides the event. */
export type EventCtx = { snapshot?: PlayerSnapshot; steps?: readonly TradeStep[]; explored?: Explored; portName?: string }

export function eventLines(ev: DoorEvent, ctx: EventCtx = {}): string[] {
  switch (ev.kind) {
    case 'warp':
      return [`|02>> |10Warping to sector |11${ev.to}|08 (${ev.turns} ${plural(ev.turns, 'turn')})`]
    case 'stop': {
      if (ev.reason === 'arrived') return [`|10Arrived in sector |11${ev.sector}|10.`, '']
      if (ev.reason === 'turns') return [`|12Out of turns. The autopilot holds in sector ${ev.sector}.`, '']
      if (ev.reason === 'dead') return ['|12Your ship is lost.', '']
      if (ev.reason === 'fighters' || ev.reason === 'toll' || ev.reason === 'blocked') return [`|12Halted in sector ${ev.sector} by ${STOPS[ev.reason]}.`, '']
      return [`|14Autopilot halted in sector |11${ev.sector}|14: ${STOPS[ev.reason]} ahead.`, '']
    }
    case 'navhaz':
      return [`|12Wreckage scrapes the hull for ${num(ev.damage)} damage.`]
    case 'mines':
      return [`|12${ev.detonated} ${plural(ev.detonated, 'mine')} detonate against your hull: ${num(ev.damage)} damage.`]
    case 'limpet':
      return ['|12Something clamps onto your hull with a dull clank.']
    case 'toll':
      return [ev.paid ? `|14You pay a toll of ${num(ev.amount)} credits.` : `|12You can't cover the ${num(ev.amount)} credit toll.`]
    case 'fightersEncounter':
      return [ev.mode === 'offensive'
        ? `|12${num(ev.count)} offensive fighters belonging to ${bare(ev.owner)} open fire as you arrive.`
        : `|12${num(ev.count)} ${ev.mode} fighters belonging to ${bare(ev.owner)} hold this sector.`]
    case 'dock': {
      const out = ['', ...portReportLines(ev.report, ctx.snapshot?.ship.cargo), '', `|10One turn used, |14${num(ev.turnsLeft)}|10 left.`]
      if (ctx.snapshot) out.push(`|10You have |14${num(ctx.snapshot.credits)}|10 credits and |14${holdsFree(ctx.snapshot)}|10 empty cargo holds.`)
      if (!ev.steps.length) out.push('|14Nothing on this dock matches your cargo or your purse. You cast off.')
      out.push('')
      return out
    }
    case 'counter':
      return [counterLine(ev.price, ctx.steps?.find(s => s.commodity === ev.commodity)?.side, ev.final)]
    case 'trade': {
      const verb = ev.side === 'sell' ? 'sell' : 'buy'
      const out = [`|10Done. You ${verb} |14${num(ev.qty)}|10 ${plural(ev.qty, 'unit')} of |11${COMMODITIES[ev.commodity]}|10 for |14${num(ev.price)}|10 credits.`]
      if (ev.pctOfBest !== undefined) out.push(`|11Haggle Lens: you got |14${ev.pctOfBest}%|11 of the best price.`)
      return out
    }
    case 'refused':
      return [`|12${bare(ev.line)}`, '']
    case 'class0':
      return [
        '',
        `|10Trading post${ctx.portName ? ` |11${bare(ctx.portName)}` : ''}|10. Today's prices:`,
        `|10  Cargo holds   |14${num(ev.holdPrice).padStart(6)}|10 for the next one, |14+20|10 for each after`,
        `|10  Fighters      |14${num(ev.fighterPrice).padStart(6)}|10 each`,
        `|10  Shield points |14${num(ev.shieldPrice).padStart(6)}|10 each`,
        '',
      ]
    case 'bought':
      if (ev.what === 'announcement') return [`|10Your announcement goes out for |14${num(ev.cost)}|10 credits.`]
      if (ev.what === 'registration') return [`|10The new name is painted on for |14${num(ev.cost)}|10 credits.`]
      if (ev.what === 'limpet removal') return [`|10The limpet is pried off your hull for |14${num(ev.cost)}|10 credits.`]
      return [`|10Bought |14${num(ev.qty)}|10 ${ev.what} for |14${num(ev.cost)}|10 credits.`]
    case 'density':
      return densityLines(ev.rows, ctx.explored)
    case 'holo':
      return ['|10Holo scan of the neighboring sectors:', '', ...ev.sectors.flatMap(s => [...sectorLines(s, ctx.explored), ''])]
    case 'probe': {
      const out = [`|10Ghost Probe away along |14${ev.path.length}|10 ${plural(ev.path.length, 'sector')}.`, '']
      for (const s of ev.sectors) out.push(`|02>> |10Probe entering sector |11${s.id}`, ...sectorLines(s, ctx.explored), '')
      out.push(ev.destroyedAt ? `|12The probe goes dark in sector ${ev.destroyedAt}.` : '|10The probe reaches the end of its course and self-destructs.')
      return out
    }
    case 'attack': {
      const who = ev.target === '*fighters' ? 'the sector fighters' : bare(ev.target)
      const out = [`|10You send |14${num(ev.sent)}|10 fighters at ${who}: |14${num(ev.killed)}|10 destroyed, |14${num(ev.shieldsLost)}|10 shield points down, |14${num(ev.lost)}|10 lost.`]
      if (ev.destroyed) out.push(`|14${who === 'the sector fighters' ? 'The sector fighters are' : `${who} is`} destroyed.`)
      if (ev.captured) out.push(`|14${who} is yours.`)
      if (ev.fled) out.push(`|14${who} breaks off and runs.`)
      if (ev.salvageCredits) out.push(`|10You salvage |14${num(ev.salvageCredits)}|10 credits.`)
      return out
    }
    case 'attacked':
      return [`|12${bare(ev.by)} attacks: ${num(ev.damage)} damage, ${num(ev.lost)} fighters lost.`]
    case 'podded':
      return [`|12Your ship is destroyed${ev.by ? ` by ${bare(ev.by)}` : ''}. The escape pod fires; you come to in sector ${ev.sector}.`]
    case 'deployed':
      return [`|10${num(ev.count)} ${bare(ev.what)} deployed${ev.mode ? ` (${ev.mode})` : ''}.`]
    case 'collected':
      return [`|10You take back |14${num(ev.count)}|10 ${bare(ev.what)}.`, ...(ev.credits ? [`|14${num(ev.credits)}|10 credits of tolls come aboard with them.`] : [])]
    case 'retreat':
      return [`|14You back away and run for sector |11${ev.to}|14.`]
    case 'dead':
      return [...(ev.by ? [`|12${bare(ev.by)} finishes your ship.`] : []), ...DEATH.outForTheDay]
    case 'disrupted':
      return [ev.mines + ev.limpets
        ? `|10The disruptor goes off in sector |11${ev.sector}|10: |14${num(ev.mines)}|10 ${plural(ev.mines, 'mine')} and |14${num(ev.limpets)}|10 ${plural(ev.limpets, 'limpet')} destroyed.`
        : `|10The disruptor goes off in sector |11${ev.sector}|10 and finds nothing to destroy.`]
    case 'limpets':
      return ev.rows.length
        ? ['|10Your limpets report:', ...ev.rows.map(r => `|11${bare(r.name).padEnd(20)} |10in sector |14${r.sector}`)]
        : ['|08None of your limpets is clamped to a ship.']
    case 'wanted':
      return ev.rows.length
        ? ['|10<Most wanted>', ...ev.rows.map((r, i) => `|14${String(i + 1).padStart(3)} |11${bare(r.name).padEnd(20)} |14${num(r.reward).padStart(10)}|10 cr`)]
        : ['|08Nobody is wanted at the moment.']
    case 'busted':
      return [`|12Busted! You lose ${num(ev.expLost)} experience and ${num(ev.holdsLost)} ${plural(ev.holdsLost, 'hold')}.`]
    case 'robbed':
      return [`|14You make off with ${num(ev.credits)} credits.`]
    case 'stolen':
      return [`|14You make off with ${num(ev.qty)} units of ${COMMODITIES[ev.commodity]}.`]
    case 'xp':
      return [xpLine(ev.exp, ev.align, ev.reason)]
    case 'rank':
      return [`|14You are now known as |15${bare(ev.title)}|14.`]
    case 'message': {
      const what = ev.type === 'hail' ? 'Hail from' : ev.type === 'memo' ? 'Corp memo from' : 'Report from'
      return [`|13${what} |11${bare(ev.from)}|13: |07${bare(ev.text)}`]
    }
    case 'text':
      return [`|07${ev.text}`]
  }
}

function xpLine(exp: number, align: number, reason: string): string {
  if (reason === 'trade') return `|10Sharp trading earns you |14${exp}|10 experience ${plural(exp, 'point')}.`
  if (reason === 'daily') return `|10A new day in the lanes: |14+${exp}|10 experience, |14${align >= 0 ? '+' : ''}${align}|10 alignment.`
  const parts = [exp ? `|14${exp > 0 ? '+' : ''}${exp}|10 experience` : '', align ? `|14${align > 0 ? '+' : ''}${align}|10 alignment` : ''].filter(Boolean)
  return `|10${parts.join(', ')}.`
}

export function densityLines(rows: readonly DensityRow[], explored?: Explored): string[] {
  const out = ['|10Relative density scan:', '|02 Sector  Density  Warps  NavHaz  Anomaly', '|02 ------  -------  -----  ------  -------']
  for (const r of rows) {
    const sec = explored && !explored(r.sector) ? `|12${`(${r.sector})`.padStart(6)}` : `|11${String(r.sector).padStart(6)}`
    out.push(` ${sec}  |14${num(r.density).padStart(7)}  ${String(r.warps).padStart(5)}  ${`${r.navhaz}%`.padStart(6)}  ${r.anomaly ? '|12    Yes' : '|10     No'}`)
  }
  return out
}

// ---------------------------------------------------------------------------
// The player.

/** The one-line bar under the prompt. */
export function quickStats(s: PlayerSnapshot): string {
  const sep = '|08│'
  const f = (k: string, v: string | number) => `|10${k} |14${typeof v === 'number' ? num(v) : v}`
  const c = s.ship.cargo
  return [f('Sect', String(s.sector)), f('Turns', s.turns), f('Creds', s.credits), f('Figs', s.ship.fighters), f('Shlds', s.ship.shields), f('Hlds', s.ship.holds),
    f(COMMODITY_SHORT[0], c[0]), f(COMMODITY_SHORT[1], c[1]), f(COMMODITY_SHORT[2], c[2])].join(sep)
}

/** The `/` screen: the quick-stats bar plus two more rows. */
export function quickStatsLines(s: PlayerSnapshot): string[] {
  const sep = '|08│'
  const f = (k: string, v: string | number) => `|10${k} |14${typeof v === 'number' ? num(v) : v}`
  const e = s.ship.equipment
  const lrs = e.scanner === 'holo' ? 'Holo' : e.scanner === 'density' ? 'Dens' : 'None'
  return [
    ` ${quickStats(s)}`,
    ` ${[f('Col', s.ship.colonists), f('Prb', e.probes), f('LRS', lrs), f('Lens', e.lens ? 'Yes' : 'No'), f('Bank', s.bank), f('Aln', s.alignment), f('Exp', s.experience)].join(sep)}`,
    ` ${[f('Corp', s.corp?.name ? bare(s.corp.name) : 'None'), f('Ship', `${s.ship.type} ${(SHIPS[s.ship.type]?.name ?? '?').slice(0, 10)}`), f('Turns/warp', SHIPS[s.ship.type]?.turnsPerWarp ?? 0)].join(sep)}`,
    ` ${[f('CMn', e.contactMines), f('LMn', e.limpets), f('Bcn', e.beacons), f('Dis', e.disruptors), f('Ddm', e.deadman), f('Limpet', s.limpet ? 'Yes' : 'No'), f('Held', s.blocked ? 'Yes' : 'No')].join(sep)}`,
  ]
}

const infoRow = (k: string, v: string) => `|10${k.padEnd(15)}|14: ${v}`

export function shipInfoLines(s: PlayerSnapshot): string[] {
  const spec = SHIPS[s.ship.type]
  const e = s.ship.equipment
  const c = s.ship.cargo
  const special = [e.scanner === 'holo' ? 'Holo Scanner' : e.scanner === 'density' ? 'Density Scanner' : '', e.lens ? 'Haggle Lens' : '', e.probes ? `${e.probes} Ghost ${plural(e.probes, 'Probe')}` : ''].filter(Boolean)
  const deploy = [
    e.contactMines ? `${e.contactMines} Contact` : '',
    e.limpets ? `${e.limpets} Limpet` : '',
    e.beacons ? `${e.beacons} Beacon` : '',
    e.disruptors ? `${e.disruptors} Disruptor` : '',
    e.deadman ? `${e.deadman} Deadman` : '',
  ].filter(Boolean)
  return [
    infoRow('Trader Name', `|11${bare(s.name)}`),
    infoRow('Rank and Exp', `|14${num(s.experience)}|10 points, Alignment=|14${num(s.alignment)} |11${alignWord(s.alignment)}`),
    infoRow('Title', `|11${rankTitle(s.experience, s.alignment)} |08(rank ${rankOf(s.experience)})`),
    infoRow('Times Blown Up', `|14${s.timesBlownUp}`),
    ...(s.corp ? [infoRow('Corp', `|11${bare(s.corp.name)}${s.corp.isCeo ? ' |08(CEO)' : ''}`)] : []),
    infoRow('Ship Name', `|11${bare(s.ship.name)}`),
    infoRow('Ship Info', `|11${spec?.name ?? '?'}`),
    infoRow('Turns to Warp', `|14${spec?.turnsPerWarp ?? '?'}`),
    infoRow('Current Sector', `|14${s.sector}`),
    infoRow('Turns left', `|14${num(s.turns)}|10 of |14${num(s.turnsMax)}`),
    infoRow('Total Holds', `|14${s.ship.holds}|10 - ${COMMODITIES.map((n, i) => `${n}=|14${c[i]}|10`).join(' ')} Empty=|14${holdsFree(s)}`),
    infoRow('Fighters', `|14${num(s.ship.fighters)}`),
    infoRow('Shield points', `|14${num(s.ship.shields)}`),
    infoRow('Equipment', special.length ? `|11${special.join('|10, |11')}` : '|08none'),
    infoRow('Deployables', deploy.length ? `|11${deploy.join('|10, |11')}` : '|08none'),
    ...(s.limpet ? [infoRow('Hull', '|12A limpet is clamped to it. Class 0 ports remove it.')] : []),
    ...(s.blocked ? [infoRow('Held', '|12Hostile fighters hold this sector: attack, retreat or yield.')] : []),
    infoRow('Credits', `|14${num(s.credits)}${s.bank ? `|10 (|14${num(s.bank)}|10 in the bank)` : ''}`),
  ]
}

/** The prompt at the foot of the game view. */
export function commandPrompt(s: Pick<PlayerSnapshot, 'turns' | 'sector'>, name = 'Command'): string {
  return `|13${name} |13[|02T=|14${s.turns}|13]|13:|13[|14${s.sector}|13] |13(|14?|05=Help|13)? : `
}

// ---------------------------------------------------------------------------
// Reference tables (the computer).

export function shipCatalogLines(): string[] {
  const out = ['|10<Ship Catalog>', '|02 #  Hull                  Cost    Holds  Fighters  Shields  T/W', '|02 -- --------------------  ------- -----  --------  -------  ---']
  for (const s of SHIPS) {
    if (!s.buyable) continue
    const req = s.requires === 'ceo' ? ' |08(CEO)' : s.requires === 'commission' ? ' |08(comm.)' : ''
    out.push(`|14${String(s.id).padStart(3)} |11${s.name.padEnd(20)} |14${num(shipCost(s)).padStart(8)} ${`${s.initHolds}/${s.maxHolds}`.padStart(6)} ${num(s.maxFighters).padStart(9)} ${num(s.maxShields).padStart(8)} ${String(s.turnsPerWarp).padStart(4)}${req}`)
  }
  return out
}

export function rankTableLines(evil: boolean): string[] {
  const titles = evil ? RANKS_EVIL : RANKS_GOOD
  const out = [`|10<${evil ? 'Outlaw' : 'Lawful'} trader ranks>`]
  titles.forEach((t, i) => out.push(`|14${String(i).padStart(3)} |11${t.padEnd(22)} |14${num(rankExp(i)).padStart(10)}|10 exp`))
  return out
}

export function alignmentWordsLine(): string {
  return `|10Alignment runs |12${ALIGN_WORDS[0]}|10 to |11${ALIGN_WORDS[ALIGN_WORDS.length - 1]}|10.`
}

/** The Outfitter's stock built so far. */
export function outfitterLines(s: PlayerSnapshot, phase = 2): string[] {
  const out = ['|10<Outfitter>  What we have in stock:', '']
  for (const it of ITEMS) {
    if (it.phase > phase) continue
    out.push(`|13<|14${it.key}|13> |11${it.name.padEnd(16)} |14${num(it.price).padStart(7)}|10 cr  |08${it.blurb.slice(0, 44)}`)
  }
  out.push(`|13<|14Q|13> |11Leave`, '', `|10You have |14${num(s.credits)}|10 credits.`)
  return out
}

// ---------------------------------------------------------------------------
// The V screen, the daily log and rankings (news.json).

export function statusLines(st: GameStatus): string[] {
  const row = (k: string, v: string) => `|10${k.padEnd(22, '.')}|14 ${v}`
  const out = [
    `|11${bare(st.title)}|10, Epoch |14${String(st.season).replace(/^s/, '')}`,
    '',
    row('Running for', `${st.ageDays} ${plural(st.ageDays, 'day')}`),
    row('Sectors', num(st.sectors)),
    row('Ports', num(st.ports)),
    row('Planets', num(st.planets)),
    row('Traders', `${num(st.traders)} (${st.goodPct}% lawful)`),
    row('Hallucinations', num(st.hallucinations)),
    row('Drifters', num(st.drifters)),
    row('Turns a day', num(st.turnsPerDay)),
  ]
  if (st.drydock) out.push(row('The Drydock', `sector ${st.drydock}`))
  return out
}

export function logLines(entries: readonly LogEntry[]): string[] {
  return entries.map(e => {
    const t = new Date(e.ts)
    const hm = Number.isNaN(t.getTime()) ? '--:--' : `${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}`
    // Log text is server-authored and may carry colors; control characters never pass.
    return `|08${hm} |07${String(e.text).replace(/[\u0000-\u001f\u007f-\u009f]/g, '')}`
  })
}

export function rankingLines(rows: readonly TraderRanking[]): string[] {
  const out = ['|02 #   Trader            Title                    Experience  Align', '|02 --  ----------------  -----------------------  ----------  -----']
  rows.forEach((r, i) => {
    out.push(`|14${String(i + 1).padStart(3)}  |11${bare(r.name).slice(0, 16).padEnd(16)}  |10${bare(r.title).slice(0, 23).padEnd(23)}  |14${num(r.experience).padStart(10)}  ${String(r.alignment).padStart(5)}`)
  })
  if (!rows.length) out.push('|08Nobody flies yet. The lanes are yours.')
  return out
}

export const commodityName = (c: Commodity) => COMMODITIES[c]
