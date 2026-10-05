import { describe, expect, it } from 'vitest'

import type { Action, DoorView, View } from '../plugin/types'
import { draw, initialState, press, type AppState, type ClientKey } from '../plugin/client/app'
import { stripPipe, visibleLength } from '../plugin/shared/pipe'
import type { DoorMap, DoorReply, PlayerSnapshot, PortReport, SectorView } from '../plugin/shared/door/protocol'
import {
  courseLines, eventLines, portReportLines, quickStats, quickStatsLines, sectorLines, shipInfoLines, shipCatalogLines, rankTableLines, densityLines,
} from '../plugin/shared/door/format'
import { applyError, applyReply, emptyKnown, mergeKnown, plan, type DoorCtx } from '../plugin/client/door/session'
import { DEATH } from '../plugin/shared/door/text'
import { outfitterLines } from '../plugin/shared/door/format'

const NOW = Date.parse('2026-10-02T18:04:00Z')

/** 1-2-4-6-7-8 and 1-3-5-6; 7 has a port, 1 is Haven. */
export const MAP: DoorMap = {
  v: 1, season: 's1', sectors: 8, concord: [1, 2, 3], lanes: [], generatedAt: '',
  warps: [[], [2, 3], [1, 4], [1, 5], [2, 6], [3, 6], [4, 5, 7], [6, 8], [7]],
}

const snap = (over: Partial<PlayerSnapshot> = {}): PlayerSnapshot => ({
  v: 1, season: 's1', id: 1, name: 'mattf', sector: 1, prevSector: 1, turns: 250, turnsMax: 250, credits: 300, bank: 0, experience: 0, alignment: 0,
  timesBlownUp: 0, commissioned: false, avoids: [], lastSeenLog: 0, requestsToday: 1, limpet: false, blocked: false,
  ship: { type: 1, name: 'Nightjar', holds: 20, cargo: [0, 0, 0], colonists: 0, fighters: 30, shields: 0,
    equipment: { contactMines: 0, limpets: 0, beacons: 0, seeds: 0, crackers: 0, deadman: 0, cloaks: 0, probes: 0, disruptors: 0, photons: 0, scanner: 'none', planetScanner: false, lens: false, jump: 0 } },
  ...over,
})

const sector = (id: number, over: Partial<SectorView> = {}): SectorView => ({
  id, region: id <= 3 ? 'concord' : 'uncharted', planets: [], traders: [], ships: [], navhaz: 0, mines: [], hallucinations: [], marshals: [], warps: MAP.warps[id], ...over,
})

/** The default ship with some equipment swapped in. */
const kit = (equipment: Partial<PlayerSnapshot['ship']['equipment']>, ship: Partial<PlayerSnapshot['ship']> = {}): PlayerSnapshot['ship'] =>
  ({ ...snap().ship, ...ship, equipment: { ...snap().ship.equipment, ...equipment } })

const HAVEN = sector(1, { port: { name: 'Haven', class: 0 }, beacon: 'Concord Space. Concord Law is enforced.', planets: [{ id: 1, name: 'Terra', class: 'T' }] })
const PORT7 = sector(7, { port: { name: 'Kestrel Yard', class: 5 } })
const REPORT: PortReport = {
  sector: 7, name: 'Kestrel Yard', class: 5, seenAt: '2026-10-02T18:00:00.000Z',
  items: [{ status: 'selling', trading: 1200, pct: 100 }, { status: 'buying', trading: 900, pct: 80 }, { status: 'selling', trading: 600, pct: 90 }],
}

const text = (lines: string[]) => lines.map(stripPipe).join('\n')
const fits = (lines: string[]) => lines.every(l => visibleLength(l) <= 80)

describe('format', () => {
  it('draws the sector display with 8-wide labels and unexplored warps in red parentheses', () => {
    const lines = sectorLines(HAVEN, s => s === 2)
    const out = text(lines)
    expect(out).toContain('Sector  : 1 in Concord Space.')
    expect(out).toContain('Ports   : Haven, Class 0 (Special)')
    expect(out).toContain('Planets : (T) Terra')
    expect(out).toContain('Warps to Sector(s) :  2 - (3)')
    expect(lines.at(-1)).toContain('|12(3)')
    expect(text(sectorLines(PORT7))).toContain('Class 5 (SBS)')
    expect(fits(lines)).toBe(true)
  })

  it('keeps traders under the value column', () => {
    const lines = text(sectorLines(sector(4, { traders: [{ name: 'Razor', ship: 'Vex', shipType: 8, fighters: 120 }] }))).split('\n')
    expect(lines[1]).toBe('Traders : Razor, w/ 120 ftrs,')
    expect(lines[2]).toBe('          in Vex (Fast Freighter)')
  })

  it('fits the quick-stats bar and the / screen in 80 columns', () => {
    const s = snap({ sector: 3554, turns: 187, credits: 2412, ship: { ...snap().ship, cargo: [0, 20, 0] } })
    expect(stripPipe(quickStats(s))).toBe('Sect 3554│Turns 187│Creds 2,412│Figs 30│Shlds 0│Hlds 20│Cmp 0│Dat 20│Wgt 0')
    expect(fits(quickStatsLines(s))).toBe(true)
    expect(fits(shipInfoLines(s))).toBe(true)
    expect(text(shipInfoLines(s))).toContain('Total Holds    : 20 - Compute=0 Data=20 Weights=0 Empty=0')
  })

  it('formats courses, port reports, tables and events in 80 columns', () => {
    const course = courseLines([1, 2, 4, 6, 7], 3, s => s < 4)
    expect(text(course)).toBe('The shortest path (4 hops, 12 turns) from sector 1 to sector 7 is:\n1 > 2 > (4) > (6) > (7)')
    const long = courseLines(Array.from({ length: 46 }, (_, i) => 1000 + i), 3)
    expect(long.length).toBeGreaterThan(2)
    expect(fits(long)).toBe(true)
    const report = text(portReportLines(REPORT, [0, 5, 0]))
    expect(report).toMatch(/Data\s+Buying\s+900\s+80%\s+5/)
    for (const t of [shipCatalogLines(), rankTableLines(false), rankTableLines(true), densityLines([{ sector: 9, density: 140, warps: 3, navhaz: 0, anomaly: false }])]) expect(fits(t)).toBe(true)
    expect(text(eventLines({ kind: 'counter', commodity: 0, price: 290, final: false }, { steps: [{ commodity: 0, side: 'buy', max: 20, defaultQty: 20, unitOffer: 14 }] }))).toBe("We'll sell them for 290 credits.")
    expect(text(eventLines({ kind: 'counter', commodity: 1, price: 410, final: true }))).toBe('Our final offer is 410 credits.')
    expect(text(eventLines({ kind: 'trade', commodity: 2, side: 'buy', qty: 20, price: 1810, xp: 2, pctOfBest: 98 }))).toContain('98%')
  })
})

// ---------------------------------------------------------------------------

const ctx = (over: Partial<DoorCtx> = {}): DoorCtx => ({ season: 's1', map: MAP, known: { season: 's1', explored: [1, 2], ports: {} }, snapshot: snap(), here: HAVEN, ...over })
const reply = (over: Partial<DoorReply> = {}): DoorReply => ({ ok: true, snapshot: snap(), here: HAVEN, events: [], known: { explored: [], ports: [] }, ...over })

describe('session', () => {
  it('plots locally and asks to engage; one hop moves at once', () => {
    const far = plan(ctx(), { cmd: 'plot', to: 7, engage: true })
    expect(far.request).toBeUndefined()
    expect(far.ask).toEqual({ kind: 'engage', path: [1, 2, 4, 6, 7] })
    expect(text(far.lines)).toContain('The shortest path (4 hops, 12 turns) from sector 1 to sector 7 is:')
    const near = plan(ctx(), { cmd: 'plot', to: 2, engage: true })
    expect(near.request).toEqual({ method: 'POST', path: '/v1/door/move', body: { path: [2], mode: 'alert' } })
    expect(plan(ctx(), { cmd: 'plot', to: 7, engage: false }).ask).toBeUndefined()
    expect(text(plan(ctx(), { cmd: 'plot', to: 99, engage: true }).lines)).toContain('There is no sector 99')
  })

  it('routes around avoids, and says so when they block every course', () => {
    const around = plan(ctx({ snapshot: snap({ avoids: [2] }) }), { cmd: 'plot', to: 6, engage: true })
    expect(around.ask).toEqual({ kind: 'engage', path: [1, 3, 5, 6] })
    const blocked = plan(ctx({ snapshot: snap({ avoids: [6] }) }), { cmd: 'plot', to: 7, engage: true })
    expect(text(blocked.lines)).toContain('avoid list blocks every course')
  })

  it('runs local commands without a request', () => {
    for (const key of ['D', 'I', '/', '?', 'CI', 'CK', 'CR', 'CX', 'CL', 'CG', 'CE', 'C?'] as const) {
      const p = plan(ctx({ known: { season: 's1', explored: [1], ports: { 7: REPORT } } }), { cmd: 'local', key, arg: 7 })
      expect(p.request).toBeUndefined()
      expect(p.lines.length).toBeGreaterThan(0)
      expect(fits(p.lines)).toBe(true)
    }
    expect(text(plan(ctx({ known: { season: 's1', explored: [1, 2, 3, 4], ports: {} } }), { cmd: 'local', key: 'CK' }).lines)).toContain('explored 4 of 8 sectors (50%)')
  })

  it('toggles avoids and plans a probe over the map', () => {
    expect(plan(ctx({ snapshot: snap({ avoids: [4] }) }), { cmd: 'avoid', sector: 5 }).request?.body).toEqual({ set: [4, 5] })
    expect(plan(ctx({ snapshot: snap({ avoids: [4, 5] }) }), { cmd: 'avoid', sector: 4 }).request?.body).toEqual({ set: [5] })
    expect(plan(ctx(), { cmd: 'avoid', sector: 0 }).request?.body).toEqual({ set: [] })
    expect(plan(ctx(), { cmd: 'probe', to: 8 }).request?.body).toEqual({ path: [2, 4, 6, 7, 8] })
  })

  it('merges known deltas and replaces them on a full state', () => {
    const k = mergeKnown({ season: 's1', explored: [1, 2], ports: {} }, 's1', { explored: [4, 2], ports: [REPORT] })
    expect(k.explored).toEqual([1, 2, 4])
    expect(k.ports[7]).toBe(REPORT)
    expect(mergeKnown(k, 's1', { explored: [9], ports: [] }, true).explored).toEqual([9])
    expect(mergeKnown(k, 's2', { explored: [3], ports: [] }).explored).toEqual([3])
  })

  it('opens a haggle on dock, follows counters, and closes on refusal', () => {
    const steps = [{ commodity: 0 as const, side: 'buy' as const, max: 20, defaultQty: 20, unitOffer: 14.6 }]
    const docked = applyReply(ctx({ here: PORT7 }), { cmd: 'dock' }, reply({ here: PORT7, events: [{ kind: 'dock', report: REPORT, turnsLeft: 249, steps }], pending: { sector: 7, steps, at: NOW, round: 0 } }))
    expect(docked.ask).toMatchObject({ kind: 'trade', steps, trading: [1200, 900, 600] })
    expect(text(docked.lines)).toContain('Commerce report for Kestrel Yard')
    const countered = applyReply(ctx({ ask: docked.ask ?? undefined }), { cmd: 'offer', commodity: 0, qty: 20, price: 250 }, reply({
      events: [{ kind: 'counter', commodity: 0, price: 280, final: false }], pending: { sector: 7, steps, at: NOW, round: 1 },
    }))
    expect(countered.ask).toMatchObject({ kind: 'trade', commodity: 0, qty: 20, ask: 280, final: false })
    expect(text(countered.lines)).toContain("We'll sell them for 280 credits.")
    const refused = applyReply(ctx({ ask: countered.ask ?? undefined }), { cmd: 'offer', commodity: 0, qty: 20, price: 100 }, reply({ events: [{ kind: 'refused', commodity: 0, line: 'No deal.' }] }))
    expect(refused.ask).toBeNull()
    expect(text(refused.lines)).toContain('You cast off')
  })

  it('opens the trading post and the Drydock menus', () => {
    const c0 = applyReply(ctx(), { cmd: 'dock' }, reply({ events: [{ kind: 'class0', holdPrice: 573, fighterPrice: 200, shieldPrice: 150 }] }))
    expect(c0.ask).toEqual({ kind: 'class0', prices: { hold: 573, fighter: 200, shield: 150 } })
    const dd = sector(5, { port: { name: 'Drydock Anchorage', class: 9 } })
    expect(applyReply(ctx(), { cmd: 'dock' }, reply({ here: dd, events: [{ kind: 'text', text: 'You dock.' }] })).ask).toEqual({ kind: 'drydock' })
  })

  it('resumes an open haggle from state', () => {
    const steps = [{ commodity: 2 as const, side: 'buy' as const, max: 10, defaultQty: 10, unitOffer: 80 }]
    const o = applyReply(ctx({ known: emptyKnown('s1') }), { cmd: 'enter' }, {
      ok: true, created: true, snapshot: snap({ sector: 7 }), here: PORT7, known: { explored: [1, 7], ports: [REPORT] },
      events: [{ kind: 'counter', commodity: 2, price: 790, final: true }], pending: { sector: 7, steps, at: NOW, round: 2 },
    })
    expect(o.phase).toBe('ready')
    expect(o.ask).toMatchObject({ kind: 'trade', commodity: 2, qty: 10, ask: 790, final: true })
    expect(o.known?.explored).toEqual([1, 7])
  })

  it('shows refusals in red; busy keeps the haggle, others drop it', () => {
    const ask = { kind: 'trade' as const, steps: [], at: 0, round: 1 }
    expect(applyError(ctx({ ask }), { cmd: 'offer', commodity: 0, qty: 1, price: 1 }, 'busy', '').ask).toBeUndefined()
    expect(applyError(ctx({ ask }), { cmd: 'offer', commodity: 0, qty: 1, price: 1 }, 'rate_limited', 'Slow down').ask).toBeUndefined()
    const bad = applyError(ctx({ ask }), { cmd: 'offer', commodity: 0, qty: 1, price: 1 }, 'invalid', 'Name a price.')
    expect(bad.ask).toBeNull()
    expect(bad.lines).toEqual(['|12Name a price.'])
    const closed = applyError(ctx(), { cmd: 'enter' }, 'closed', 'No Epoch is running yet.')
    expect(closed.phase).toBe('title')
    expect(text(closed.lines)).toBe('The lanes are dark. No Epoch has begun.')
  })
})

// ---------------------------------------------------------------------------
// Screens: keys in, Actions out, as test/messages.test.ts does for the boards.

const base: View = { phase: 'ready', busy: false, claude: 'idle', me: { handle: 'mattf', location: 'NYC', node: 1 }, lastRead: {}, votes: {} }
const door = (over: Partial<DoorView> = {}): View => ({ ...base, door: { season: 's1', phase: 'ready', rev: 1, transcript: ['|10Welcome.'], busy: false, snapshot: snap(), here: HAVEN, ...over } })

const k = (key: string): ClientKey => ({ key })

function run(state: AppState, keys: string[], v: View) {
  const actions: Action[] = []
  for (const key of keys) {
    const step = press(state, k(key), v, () => 0, 80, NOW)
    state = step.state
    if (step.action) actions.push(step.action)
  }
  return { state, actions }
}

/** Marks the last action done, as the hooks module would by bumping rev. */
const done = (v: View, over: Partial<DoorView> = {}): View => ({ ...v, door: { ...v.door!, rev: v.door!.rev + 1, ...over } })
const screen = (s: AppState, v: View, w = 80, h = 24) => draw(s, v, w, h, NOW).map(stripPipe).join('\n')
const inGame = (): AppState => ({ ...initialState(), screen: 'door', onBoard: true, door: { page: 'game', prompt: { kind: 'command' }, buf: '', scratch: [] } })

describe('door screens', () => {
  it('reaches HYPERPLANE from the main menu and enters with one action', () => {
    let { state } = run(initialState(), ['l', 'x'], base)
    state = run(state, ['g'], base).state
    expect(state.screen).toBe('doors')
    expect(screen(state, base)).toContain('HYPERPLANE')
    state = run(state, ['1'], base).state
    expect(screen(state, door({ phase: 'title' }))).toContain('[E]nter the lanes')
    const entered = run(state, ['e'], door({ phase: 'title' }))
    expect(entered.actions).toEqual([{ type: 'door', echo: [], cmd: 'enter' }])
    expect(screen(entered.state, door({ phase: 'title' }))).toContain('Opening the lanes')
    // Q from the title goes back to the door list, and again to the main menu.
    const out = run({ ...state }, ['q', 'q'], door({ phase: 'title' }))
    expect(out.state.screen).toBe('main')
  })

  it('keeps the main menu lightbar moving onto Games and Goodbye', () => {
    let { state } = run(initialState(), ['l', 'x'], base)
    state = { ...state, sel: 9 }
    expect(run(state, ['down'], base).state.sel).toBe(11)
    expect(run({ ...state, sel: 10 }, ['right'], base).state.sel).toBe(11)
    expect(run({ ...state, sel: 11 }, ['up'], base).state.sel).toBe(9)
    expect(screen(state, base)).toMatch(/Games\s+.*Goodbye/)
  })

  it('names a new character', () => {
    const v = door({ phase: 'new', snapshot: undefined, here: undefined, transcript: [] })
    const s = inGame()
    expect(screen(s, v)).toContain('What do you want to name your ship?')
    const r = run(s, [...'Nightjar', 'return'], v)
    expect(r.actions).toEqual([expect.objectContaining({ type: 'door', cmd: 'create', shipName: 'Nightjar' })])
  })

  it('fills width x height on every page', () => {
    const pages = ['title', 'instructions', 'log', 'rankings', 'game'] as const
    for (const page of pages) {
      for (const [w, h] of [[80, 24], [44, 16], [100, 40]]) {
        const lines = draw({ ...inGame(), door: { page, prompt: { kind: 'command' }, buf: '', scratch: [] } }, door({ board: { log: [], rankings: [] } }), w, h, NOW)
        expect(lines).toHaveLength(h)
        for (const line of lines) expect(visibleLength(line)).toBe(Math.min(w, 80))
      }
    }
  })

  it('shows the prompt and the quick-stats bar under the transcript', () => {
    const out = screen(inGame(), door()).split('\n')
    expect(out.at(-4)).toContain('Command [T=250]:[1] (?=Help)? :')
    expect(out.at(-3)).toContain('Sect 1│Turns 250│Creds 300')
  })

  it('moves by sector number: plot, then engage, one action each', () => {
    let v = door()
    const typed = run(inGame(), ['7', 'return'], v)
    expect(typed.actions).toEqual([expect.objectContaining({ type: 'door', cmd: 'plot', to: 7, engage: true })])
    // Keys wait until the hooks module answers.
    expect(run(typed.state, ['d'], v).actions).toEqual([])
    expect(screen(typed.state, v)).toContain('(…)')
    v = done(v, { ask: { kind: 'engage', path: [1, 2, 4, 6, 7] } })
    expect(screen(typed.state, v)).toContain('Engage the autopilot? (Y/N/Express) [Y]')
    const engaged = run(typed.state, ['return'], v)
    expect(engaged.actions).toEqual([expect.objectContaining({ type: 'door', cmd: 'move', path: [2, 4, 6, 7], mode: 'alert' })])
    const express = run(typed.state, ['e'], v)
    expect(express.actions).toEqual([expect.objectContaining({ cmd: 'move', mode: 'express' })])
    expect(run(typed.state, ['n'], v).actions).toEqual([expect.objectContaining({ cmd: 'clear' })])
  })

  it('answers local commands locally or with a zero-request action', () => {
    const v = door()
    expect(run(inGame(), ['d'], v).actions).toEqual([expect.objectContaining({ cmd: 'local', key: 'D' })])
    expect(run(inGame(), ['i'], v).actions).toEqual([expect.objectContaining({ cmd: 'local', key: 'I' })])
    const noPort = run(inGame(), ['p'], door({ here: sector(4) }))
    expect(noPort.actions).toEqual([])
    expect(screen(noPort.state, v)).toContain('There is no port in this sector.')
    const comp = run(inGame(), ['c', 'r', 'return'], v)
    expect(comp.actions).toEqual([expect.objectContaining({ cmd: 'local', key: 'CR', arg: 1 })])
    expect(comp.actions[0]).toMatchObject({ echo: expect.arrayContaining([expect.stringContaining('<Computer activated>')]) })
  })

  it('haggles: quantity, the local opening figure, then one offer', () => {
    const steps = [{ commodity: 0 as const, side: 'buy' as const, max: 20, defaultQty: 18, unitOffer: 14.6 }]
    const v = door({ here: PORT7, ask: { kind: 'trade', steps, at: NOW, round: 0, trading: [1200, 900, 600] } })
    const s = inGame()
    expect(screen(s, v)).toContain('How many holds of Compute do you want to buy [18]?')
    let r = run(s, ['return'], v)
    expect(r.actions).toEqual([])
    expect(screen(r.state, v)).toContain("We'll sell them for 263 credits.")
    expect(screen(r.state, v)).toContain('Your offer [263] ?')
    r = run(r.state, ['return'], v)
    expect(r.actions).toEqual([expect.objectContaining({ cmd: 'offer', commodity: 0, qty: 18, price: 263 })])
    // A counter: the prompt carries the port's figure for the locked quantity.
    const counter = done(v, { ask: { kind: 'trade', steps, at: NOW, round: 1, commodity: 0, qty: 18, ask: 255 } })
    const bid = run(r.state, [...'240', 'return'], counter)
    expect(bid.actions).toEqual([expect.objectContaining({ cmd: 'offer', qty: 18, price: 240 })])
    expect(run(s, ['5', '0', 'return'], v).state.door?.scratch.join()).toContain('at most 20')
  })

  it('buys holds at a trading post with one action', () => {
    const v = door({ snapshot: snap({ credits: 5000 }), ask: { kind: 'class0', prices: { hold: 573, fighter: 200, shield: 150 } } })
    const s = inGame()
    expect(screen(s, v)).toContain('How many cargo holds do you want to buy [0]?')
    const r = run(s, ['2', 'return', 'return', '1', 'return'], v)
    expect(r.actions).toEqual([expect.objectContaining({ cmd: 'class0', holds: 2, fighters: 0, shields: 1 })])
  })

  it('walks the Drydock venues', () => {
    const v = door({ snapshot: snap({ credits: 50_000 }), ask: { kind: 'drydock' } })
    const s = inGame()
    expect(screen(s, v)).toContain('<Drydock> Where to?')
    const probe = run(s, ['o', 'g', '2', 'return'], v)
    expect(probe.actions).toEqual([expect.objectContaining({ cmd: 'outfit', item: 'probe', qty: 2 })])
    const bank = run(s, ['b', 'd', ...'1000', 'return'], v)
    expect(bank.actions).toEqual([expect.objectContaining({ cmd: 'bank', body: { op: 'deposit', amount: 1000 } })])
    const ship = run(s, ['s', 'b', '8', 'return', ...'Gull', 'return'], v)
    expect(ship.actions).toEqual([expect.objectContaining({ cmd: 'shipwright', body: { op: 'buy', ship: 8, name: 'Gull' } })])
    expect(run(s, ['q'], v).actions).toEqual([expect.objectContaining({ cmd: 'clear' })])
  })
})

// ---------------------------------------------------------------------------
// Phase 2: conflict.

const RAZOR = { name: 'Razor', ship: 'Vex', shipType: 8, fighters: 120 }
const FIGHTERS = { count: 40, owner: 'Gull', isYours: false, isCorp: false, mode: 'defensive' as const }
const lastAction = (r: { actions: Action[] }) => r.actions.at(-1)

describe('combat formatting', () => {
  it('reads the new events', () => {
    expect(text(eventLines({ kind: 'collected', what: 'fighters', count: 30, credits: 150 }))).toBe('You take back 30 fighters.\n150 credits of tolls come aboard with them.')
    expect(text(eventLines({ kind: 'retreat', to: 4 }))).toContain('sector 4')
    const dead = text(eventLines({ kind: 'dead', until: '2026-10-03T00:00:00Z', by: 'Razor' }))
    expect(dead).toContain('Razor finishes your ship.')
    expect(dead).toContain(stripPipe(DEATH.outForTheDay[0]))
    expect(text(eventLines({ kind: 'dead', until: '2026-10-03T00:00:00Z' }))).not.toContain('finishes')
    expect(text(eventLines({ kind: 'disrupted', sector: 6, mines: 12, limpets: 1 }))).toBe('The disruptor goes off in sector 6: 12 mines and 1 limpet destroyed.')
    expect(text(eventLines({ kind: 'disrupted', sector: 6, mines: 0, limpets: 0 }))).toContain('finds nothing')
    expect(text(eventLines({ kind: 'limpets', rows: [{ name: 'Razor', sector: 44 }] }))).toContain('Razor')
    expect(text(eventLines({ kind: 'limpets', rows: [] }))).toContain('None of your limpets')
    const wanted = text(eventLines({ kind: 'wanted', rows: [{ name: 'Razor', reward: 12000 }, { name: 'Gull', reward: 3000 }] }))
    expect(wanted).toMatch(/1 Razor\s+12,000 cr/)
    expect(text(eventLines({ kind: 'wanted', rows: [] }))).toContain('Nobody is wanted')
  })

  it('reads the existing combat events and never prints a pipe code a player typed', () => {
    expect(text(eventLines({ kind: 'attack', target: 'Razor', sent: 20, lost: 4, killed: 9, shieldsLost: 3, destroyed: true, captured: false, fled: false, salvageCredits: 500 })))
      .toBe('You send 20 fighters at Razor: 9 destroyed, 3 shield points down, 4 lost.\nRazor is destroyed.\nYou salvage 500 credits.')
    expect(text(eventLines({ kind: 'attack', target: '*fighters', sent: 20, lost: 4, killed: 9, shieldsLost: 0, destroyed: true, captured: false, fled: false }))).toContain('The sector fighters are destroyed.')
    expect(text(eventLines({ kind: 'attacked', by: 'Razor', damage: 40, lost: 7 }))).toBe('Razor attacks: 40 damage, 7 fighters lost.')
    expect(text(eventLines({ kind: 'podded', sector: 9, by: 'Razor' }))).toContain('destroyed by Razor')
    expect(text(eventLines({ kind: 'busted', expLost: 4, holdsLost: 2 }))).toContain('Busted!')
    expect(text(eventLines({ kind: 'robbed', credits: 900 }))).toContain('900 credits')
    expect(text(eventLines({ kind: 'stolen', commodity: 2, qty: 5 }))).toContain('Weights')
    expect(text(eventLines({ kind: 'toll', amount: 200, paid: false }))).toContain("can't cover")
    expect(text(eventLines({ kind: 'fightersEncounter', count: 40, owner: 'Gull', mode: 'offensive' }))).toContain('open fire')
    expect(text(eventLines({ kind: 'deployed', what: 'fighters', count: 30, mode: 'toll' }))).toBe('30 fighters deployed (toll).')
    const out = [
      ...eventLines({ kind: 'attacked', by: '|09Evil', damage: 1, lost: 0 }), ...eventLines({ kind: 'limpets', rows: [{ name: '|09Bad', sector: 1 }] }),
      ...eventLines({ kind: 'wanted', rows: [{ name: '|09Bad', reward: 1 }] }), ...eventLines({ kind: 'dead', until: '', by: '|09Bad' }),
      ...eventLines({ kind: 'attack', target: '|09Bad', sent: 1, lost: 0, killed: 0, shieldsLost: 0, destroyed: false, captured: false, fled: true }),
    ].join('\n')
    expect(out).not.toContain('|09')
    expect(fits(out.split('\n'))).toBe(true)
  })

  it('shows the limpet, the hold and the deployables on / and I', () => {
    const s = snap({ limpet: true, blocked: true, ship: kit({ contactMines: 5, limpets: 2, beacons: 1, disruptors: 3, deadman: 40 }) })
    const info = text(shipInfoLines(s))
    expect(info).toContain('Deployables    : 5 Contact, 2 Limpet, 1 Beacon, 3 Disruptor, 40 Deadman')
    expect(info).toContain('A limpet is clamped to it.')
    expect(info).toContain('Hostile fighters hold this sector')
    expect(text(shipInfoLines(snap()))).toContain('Deployables    : none')
    const quick = text(quickStatsLines(s))
    expect(quick).toContain('Limpet Yes')
    expect(quick).toContain('Held Yes')
    expect(quick).toContain('CMn 5')
    expect(fits(shipInfoLines(s))).toBe(true)
    expect(fits(quickStatsLines(s))).toBe(true)
  })

  it('lists the phase 2 items at the Outfitter', () => {
    const out = text(outfitterLines(snap()))
    for (const name of ['Marker Beacon', 'Deadman Charge', 'Contact Mine', 'Limpet Mine', 'Mine Disruptor']) expect(out).toContain(name)
    expect(out).not.toContain('Seed Torpedo')
    expect(text(outfitterLines(snap(), 1))).not.toContain('Limpet')
  })
})

describe('combat session', () => {
  it('routes every phase 2 command to its request', () => {
    const body = (c: Parameters<typeof plan>[1]) => plan(ctx(), c).request
    expect(body({ cmd: 'attack', target: 'Razor', fighters: 12 })).toEqual({ method: 'POST', path: '/v1/door/attack', body: { target: 'Razor', fighters: 12 } })
    expect(body({ cmd: 'attack', target: '*fighters', fighters: 5 })?.body).toEqual({ target: '*fighters', fighters: 5 })
    expect(body({ cmd: 'retreat' })).toEqual({ method: 'POST', path: '/v1/door/retreat', body: {} })
    expect(body({ cmd: 'surrender' })).toEqual({ method: 'POST', path: '/v1/door/surrender', body: {} })
    expect(body({ cmd: 'deploy', body: { kind: 'fighters', count: 9, owner: 'personal', mode: 'toll' } })).toEqual({ method: 'POST', path: '/v1/door/deploy', body: { kind: 'fighters', count: 9, owner: 'personal', mode: 'toll' } })
    expect(body({ cmd: 'collect', body: { kind: 'limpet', count: 2 } })).toEqual({ method: 'POST', path: '/v1/door/collect', body: { kind: 'limpet', count: 2 } })
    expect(body({ cmd: 'rob', credits: 800 })).toEqual({ method: 'POST', path: '/v1/door/rob', body: { credits: 800 } })
    expect(body({ cmd: 'steal', commodity: 2, qty: 3 })).toEqual({ method: 'POST', path: '/v1/door/steal', body: { commodity: 2, qty: 3 } })
    expect(body({ cmd: 'marshal', body: { op: 'wanted' } })).toEqual({ method: 'POST', path: '/v1/door/marshal', body: { op: 'wanted' } })
    expect(body({ cmd: 'backroom', body: { password: 'quiet kernel', op: 'collect' } })?.body).toEqual({ password: 'quiet kernel', op: 'collect' })
    expect(body({ cmd: 'beacon', text: 'hi' })).toEqual({ method: 'POST', path: '/v1/door/beacon', body: { text: 'hi' } })
    expect(body({ cmd: 'disrupt', sector: 2 })).toEqual({ method: 'POST', path: '/v1/door/disrupt', body: { sector: 2 } })
    expect(body({ cmd: 'sal', body: { op: 'trace', target: 'Razor' } })?.body).toEqual({ op: 'trace', target: 'Razor' })
    expect(body({ cmd: 'removeLimpet' })).toEqual({ method: 'POST', path: '/v1/door/class0', body: { removeLimpet: true } })
    expect(body({ cmd: 'scan', kind: 'limpet' })?.body).toEqual({ kind: 'limpet' })
  })

  it('refuses to plot a course while held, with no request', () => {
    const p = plan(ctx({ snapshot: snap({ blocked: true }) }), { cmd: 'plot', to: 2, engage: true })
    expect(p.request).toBeUndefined()
    expect(text(p.lines)).toContain('Attack them, retreat or yield')
  })

  it('shows the new place after a pod or a retreat, and nothing after a death', () => {
    const there = sector(4)
    const podded = applyReply(ctx(), { cmd: 'attack', target: 'Razor', fighters: 9 }, reply({ here: there, events: [{ kind: 'podded', sector: 4, by: 'Razor' }] }))
    expect(text(podded.lines)).toContain('Sector  : 4')
    expect(podded.ask).toBeNull()
    const retreat = applyReply(ctx(), { cmd: 'retreat' }, reply({ here: there, events: [{ kind: 'retreat', to: 4 }] }))
    expect(text(retreat.lines)).toContain('Sector  : 4')
    const dead = applyReply(ctx(), { cmd: 'attack', target: 'Marshal Ostrander', fighters: 1 }, reply({ here: there, events: [{ kind: 'podded', sector: 4 }, { kind: 'dead', until: '2026-10-03T00:00:00Z' }] }))
    expect(text(dead.lines)).toContain('no shape to fly')
    expect(text(dead.lines)).not.toContain('Sector  : 4')
    const moved = applyReply(ctx(), { cmd: 'move', path: [2], mode: 'alert' }, reply({ here: sector(2, { fighters: FIGHTERS }), events: [{ kind: 'fightersEncounter', count: 40, owner: 'Gull', mode: 'defensive' }, { kind: 'stop', sector: 2, reason: 'fighters' }], snapshot: snap({ blocked: true }) }))
    expect(text(moved.lines)).toContain('Halted in sector 2 by hostile fighters.')
    expect(text(moved.lines)).toContain('Fighters: 40 (belong to Gull) [Defensive]')
  })

  it('keeps the Drydock and the trading post open after menu replies, and prints refusals in red', () => {
    const open = ctx({ ask: { kind: 'drydock' } })
    for (const c of [{ cmd: 'marshal', body: { op: 'wanted' } }, { cmd: 'sal', body: { op: 'fortune' } }, { cmd: 'removeLimpet' }] as const) {
      expect(applyReply(open, c, reply({ events: [{ kind: 'text', text: 'ok' }] })).ask).toBeUndefined()
      expect(applyError(open, c, 'invalid', 'Nope.')).toMatchObject({ ask: undefined, lines: ['|12Nope.'] })
    }
    expect(applyError(ctx(), { cmd: 'attack', target: 'X', fighters: 1 }, 'invalid', 'You are in no shape to fly.').lines).toEqual(['|12You are in no shape to fly.'])
  })
})

describe('combat screens', () => {
  const sent = (r: { actions: Action[] }) => r.actions.map(a => (a as { cmd?: string }).cmd)

  it('attacks: pick a target, then fighters up to the hull limit', () => {
    const v = door({ snapshot: snap({ ship: kit({}, { fighters: 900 }) }), here: sector(4, { traders: [RAZOR, { ...RAZOR, name: 'Gull' }], fighters: FIGHTERS }) })
    const list = run(inGame(), ['a'], v)
    expect(list.actions).toEqual([])
    const out = screen(list.state, v)
    expect(out).toContain('1 Razor, 120 ftrs, Vex')
    expect(out).toContain('3 The sector fighters (40 of Gull)')
    expect(out).toContain('Attack which target (0 to cancel)')
    const picked = run(list.state, ['2', 'return'], v)
    expect(screen(picked.state, v)).toContain('How many fighters (0 to 750)')
    // More than the hull allows is refused locally.
    const over = run(picked.state, [...'900', 'return'], v)
    expect(over.actions).toEqual([])
    expect(screen(over.state, v)).toContain('You can send at most 750.')
    const go = run(picked.state, [...'25', 'return'], v)
    expect(go.actions).toEqual([expect.objectContaining({ type: 'door', cmd: 'attack', target: 'Gull', fighters: 25 })])
    const fighters = run(list.state, ['3', 'return', '7', 'return'], v)
    expect(lastAction(fighters)).toMatchObject({ cmd: 'attack', target: '*fighters', fighters: 7 })
    // 0 or empty cancels.
    expect(run(picked.state, ['0', 'return'], v).actions).toEqual([])
    expect(run(picked.state, ['return'], v).state.door?.prompt).toEqual({ kind: 'command' })
  })

  it('attacks a lone trader at once, and a Marshal only after an are-you-sure', () => {
    const lone = door({ here: sector(4, { traders: [RAZOR] }) })
    const r = run(inGame(), ['a'], lone)
    expect(screen(r.state, lone)).toContain('How many fighters (0 to 30)')
    expect(lastAction(run(r.state, ['4', 'return'], lone))).toMatchObject({ cmd: 'attack', target: 'Razor', fighters: 4 })
    const marshal = door({ here: sector(2, { marshals: ['Commodore Vale'] }) })
    const m = run(inGame(), ['a'], marshal)
    expect(screen(m.state, marshal)).toContain('Are you POSITIVE? (Y/N) [N]')
    expect(run(m.state, ['n'], marshal).state.door?.prompt).toEqual({ kind: 'command' })
    const yes = run(m.state, ['y', '3', 'return'], marshal)
    expect(lastAction(yes)).toMatchObject({ cmd: 'attack', target: 'Commodore Vale', fighters: 3 })
  })

  it('does not attack your own fighters, or with nobody there, or with no fighters; no request', () => {
    const mine = door({ here: sector(4, { fighters: { ...FIGHTERS, isYours: true, owner: 'mattf' } }) })
    expect(run(inGame(), ['a'], mine).actions).toEqual([])
    expect(screen(run(inGame(), ['a'], mine).state, mine)).toContain('There is nobody here to attack.')
    const none = door({ snapshot: snap({ ship: kit({}, { fighters: 0 }) }), here: sector(4, { traders: [RAZOR] }) })
    const r = run(inGame(), ['a'], none)
    expect(r.actions).toEqual([])
    expect(screen(r.state, none)).toContain('You have no fighters to send.')
  })

  it('deploys fighters in a mode, and takes them back', () => {
    const v = door({ here: sector(4) })
    const menu = run(inGame(), ['f'], v)
    expect(screen(menu.state, v)).toContain('<Fighters> (D)eploy, (T)ake back, (Q)uit')
    const modes = { return: 'defensive', d: 'defensive', o: 'offensive', t: 'toll' } as const
    for (const [key, mode] of Object.entries(modes)) {
      const r = run(menu.state, ['d', ...'12', 'return', key], v)
      expect(lastAction(r)).toMatchObject({ cmd: 'deploy', body: { kind: 'fighters', count: 12, owner: 'personal', mode } })
    }
    expect(run(menu.state, ['d', ...'31', 'return'], v).actions).toEqual([])
    expect(screen(run(menu.state, ['d', ...'31', 'return'], v).state, v)).toContain('You can leave at most 30.')
    const mineHere = door({ snapshot: snap({ ship: kit({}, { fighters: 10 }) }), here: sector(4, { fighters: { ...FIGHTERS, isYours: true, owner: 'mattf', count: 25 } }) })
    const take = run(inGame(), ['f', 't'], mineHere)
    expect(screen(take.state, mineHere)).toContain('How many fighters to take back (0 to 25)')
    expect(lastAction(run(take.state, ['2', '0', 'return'], mineHere))).toMatchObject({ cmd: 'collect', body: { kind: 'fighters', count: 20 } })
    expect(run(menu.state, ['q'], v).state.door?.prompt).toEqual({ kind: 'command' })
  })

  it('checks locally before deploying fighters: none aboard, Concord Space, none here to take', () => {
    const empty = door({ snapshot: snap({ ship: kit({}, { fighters: 0 }) }), here: sector(4) })
    expect(run(inGame(), ['f', 'd'], empty).actions).toEqual([])
    expect(screen(run(inGame(), ['f', 'd'], empty).state, empty)).toContain('You have no fighters aboard.')
    const concord = door({ here: sector(2) })
    expect(screen(run(inGame(), ['f', 'd'], concord).state, concord)).toContain('Concord Space allows no fighters.')
    expect(screen(run(inGame(), ['f', 't'], door({ here: sector(4) })).state, door({ here: sector(4) }))).toContain('You have no fighters in this sector.')
  })

  it('deploys, takes back and sweeps mines; local checks send nothing', () => {
    const armed = door({ snapshot: snap({ ship: kit({ contactMines: 6, limpets: 2, disruptors: 1 }) }), here: sector(4, { mines: [{ kind: 'contact', count: 8, owner: 'mattf', isYours: true }], warps: [3, 5] }) })
    expect(lastAction(run(inGame(), ['h', 'c', 'd', '4', 'return'], armed))).toMatchObject({ cmd: 'deploy', body: { kind: 'contact', count: 4, owner: 'personal' } })
    expect(lastAction(run(inGame(), ['h', 'l', 'd', '2', 'return'], armed))).toMatchObject({ cmd: 'deploy', body: { kind: 'limpet', count: 2, owner: 'personal' } })
    expect(screen(run(inGame(), ['h', 'c', 'd', '9', 'return'], armed).state, armed)).toContain('At most 6.')
    // Taking back is capped by the room aboard (the hull carries 50) and by what is here.
    const take = run(inGame(), ['h', 'c', 't'], armed)
    expect(screen(take.state, armed)).toContain('(0 to 8)')
    expect(lastAction(run(take.state, ['8', 'return'], armed))).toMatchObject({ cmd: 'collect', body: { kind: 'contact', count: 8 } })
    // Sweep: only an adjacent sector.
    const sweep = run(inGame(), ['h', 'c', 's'], armed)
    expect(screen(sweep.state, armed)).toContain('You have 1 Mine Disruptors.')
    const far = run(sweep.state, ['9', 'return'], armed)
    expect(far.actions).toEqual([])
    expect(screen(far.state, armed)).toContain('Sector 9 is not next door.')
    expect(lastAction(run(sweep.state, ['5', 'return'], armed))).toMatchObject({ cmd: 'disrupt', sector: 5 })
    // Nothing aboard, nothing here, no disruptor, Concord Space.
    const bare = door({ here: sector(4) })
    for (const keys of [['h', 'c', 'd'], ['h', 'l', 'd'], ['h', 'c', 't'], ['h', 'c', 's']]) {
      const r = run(inGame(), keys, bare)
      expect(r.actions, keys.join()).toEqual([])
      expect(screen(r.state, bare)).toMatch(/You have no (Contact|Limpet) Mines aboard|in this sector|no Mine Disruptors/)
    }
    const concord = door({ snapshot: armed.door!.snapshot, here: sector(2) })
    expect(screen(run(inGame(), ['h', 'c', 'd'], concord).state, concord)).toContain('Concord Space allows no mines.')
  })

  it('leaves a beacon with the text typed, and only with one aboard outside Concord Space', () => {
    const v = door({ snapshot: snap({ ship: kit({ beacons: 1 }) }), here: sector(4) })
    const r = run(inGame(), ['b', ...'Hello', 'return'], v)
    expect(r.actions).toEqual([expect.objectContaining({ cmd: 'beacon', text: 'Hello' })])
    expect(run(inGame(), ['b', 'return'], v).actions).toEqual([])
    const long = run(inGame(), ['b', ...'x'.repeat(60)], v)
    expect(long.state.door?.buf.length).toBe(41)
    const none = run(inGame(), ['b'], door({ here: sector(4) }))
    expect(none.actions).toEqual([])
    expect(screen(none.state, door({ here: sector(4) }))).toContain('You have no Marker Beacons.')
    const concord = door({ snapshot: v.door!.snapshot, here: sector(2) })
    expect(screen(run(inGame(), ['b'], concord).state, concord)).toContain('Concord Space allows no beacons.')
  })

  it('retreats and yields only while held', () => {
    const free = door({ here: sector(4) })
    for (const key of ['r', 'y']) {
      const r = run(inGame(), [key], free)
      expect(r.actions, key).toEqual([])
      expect(screen(r.state, free)).toMatch(/nothing to (retreat from|yield to)/)
    }
    const held = door({ snapshot: snap({ blocked: true }), here: sector(4, { fighters: FIGHTERS }) })
    expect(screen(inGame(), held)).toContain('Hostile fighters hold this sector: (A)ttack, (R)etreat or (Y)ield.')
    expect(sent(run(inGame(), ['r'], held))).toEqual(['retreat'])
    const y = run(inGame(), ['y'], held)
    expect(y.actions).toEqual([])
    expect(screen(y.state, held)).toContain('Hand over your cargo? (Y/N) [N]')
    expect(sent(run(y.state, ['n'], held))).toEqual([])
    expect(sent(run(y.state, ['y'], held))).toEqual(['surrender'])
    const toll = door({ snapshot: snap({ blocked: true }), here: sector(4, { fighters: { ...FIGHTERS, mode: 'toll' } }) })
    expect(screen(run(inGame(), ['y'], toll).state, toll)).toContain('Hand over the toll in credits?')
    // The hint goes with the block.
    expect(screen(inGame(), free)).not.toContain('Hostile fighters hold')
  })

  it('scans for limpets from the S prompt with a holo scanner, and from the computer without one', () => {
    const holo = door({ snapshot: snap({ ship: kit({ scanner: 'holo' }) }) })
    const r = run(inGame(), ['s'], holo)
    expect(screen(r.state, holo)).toContain('(D)ensity, (H)olo or (L)impet scan')
    expect(lastAction(run(r.state, ['l'], holo))).toMatchObject({ cmd: 'scan', kind: 'limpet' })
    const dens = door({ snapshot: snap({ ship: kit({ scanner: 'density' }) }) })
    expect(lastAction(run(inGame(), ['s'], dens))).toMatchObject({ cmd: 'scan', kind: 'density' })
    expect(lastAction(run(inGame(), ['c', 't'], door()))).toMatchObject({ cmd: 'scan', kind: 'limpet' })
  })

  it('offers the rob and steal menu to outlaws at an ordinary port; everyone else docks directly', () => {
    const outlaw = door({ snapshot: snap({ alignment: -150, experience: 300 }), here: PORT7 })
    const menu = run(inGame(), ['p'], outlaw)
    expect(menu.actions).toEqual([])
    expect(screen(menu.state, outlaw)).toContain('<Kestrel Yard> (T)rade, (R)ob, (S)teal, (Q)uit')
    expect(sent(run(menu.state, ['t'], outlaw))).toEqual(['dock'])
    expect(run(menu.state, ['q'], outlaw).state.door?.prompt).toEqual({ kind: 'command' })
    const rob = run(menu.state, ['r'], outlaw)
    expect(screen(rob.state, outlaw)).toContain('about 900 credits')
    expect(lastAction(run(rob.state, [...'700', 'return'], outlaw))).toMatchObject({ cmd: 'rob', credits: 700 })
    expect(run(rob.state, ['0', 'return'], outlaw).actions).toEqual([])
    for (const [key, commodity] of [['c', 0], ['d', 1], ['w', 2]] as const) {
      const steal = run(menu.state, ['s', key], outlaw)
      expect(lastAction(run(steal.state, ['5', 'return'], outlaw))).toMatchObject({ cmd: 'steal', commodity, qty: 5 })
    }
    expect(screen(run(menu.state, ['s', 'c', ...'21', 'return'], outlaw).state, outlaw)).toContain('You have room for 20.')
    const full = door({ snapshot: snap({ alignment: -150, ship: kit({}, { cargo: [20, 0, 0] }) }), here: PORT7 })
    expect(screen(run(inGame(), ['p', 's'], full).state, full)).toContain('Your holds are full.')
    // A good player, a mildly bad one, and Haven or the Drydock go straight in.
    for (const [align, here] of [[0, PORT7], [-99, PORT7], [-500, HAVEN], [-500, sector(5, { port: { name: 'Drydock Anchorage', class: 9 } })]] as const) {
      const v = door({ snapshot: snap({ alignment: align }), here })
      expect(sent(run(inGame(), ['p'], v)), `${align} ${here.id}`).toEqual(['dock'])
    }
  })

  it('removes a limpet at the trading post and the Drydock, only when there is one', () => {
    const c0 = { kind: 'class0' as const, prices: { hold: 573, fighter: 200, shield: 150 } }
    const clamped = door({ snapshot: snap({ limpet: true, credits: 9000 }), ask: c0 })
    expect(screen(inGame(), clamped)).toContain('A limpet is clamped to your hull. Press L')
    expect(lastAction(run(inGame(), ['l'], clamped))).toMatchObject({ cmd: 'removeLimpet' })
    const clean = door({ ask: c0 })
    const r = run(inGame(), ['l'], clean)
    expect(r.actions).toEqual([])
    expect(screen(r.state, clean)).toContain('There is no limpet on your hull.')
    expect(screen(r.state, clean)).toContain('How many cargo holds')
    const dock = door({ snapshot: snap({ limpet: true }), ask: { kind: 'drydock' } })
    expect(lastAction(run(inGame(), ['l'], dock))).toMatchObject({ cmd: 'removeLimpet' })
    const noDock = door({ ask: { kind: 'drydock' } })
    expect(run(inGame(), ['l'], noDock).actions).toEqual([])
  })

  it('walks the Marshal\'s Office', () => {
    const v = (over: Partial<PlayerSnapshot> = {}) => door({ snapshot: snap({ alignment: 600, ...over }), ask: { kind: 'drydock' } })
    expect(lastAction(run(inGame(), ['m', 'a'], v()))).toMatchObject({ cmd: 'marshal', body: { op: 'commission' } })
    expect(lastAction(run(inGame(), ['m', 'w'], v()))).toMatchObject({ cmd: 'marshal', body: { op: 'wanted' } })
    expect(lastAction(run(inGame(), ['m', 'c'], v()))).toMatchObject({ cmd: 'marshal', body: { op: 'claim' } })
    const reward = run(inGame(), ['m', 'p', ...'Razor', 'return', ...'5000', 'return'], v())
    expect(lastAction(reward)).toMatchObject({ cmd: 'marshal', body: { op: 'reward', target: 'Razor', amount: 5000 } })
    const low = run(inGame(), ['m', 'p', ...'Razor', 'return', ...'500', 'return'], v())
    expect(low.actions).toEqual([])
    expect(screen(low.state, v())).toContain('The Marshals post nothing under 1,000 credits.')
    // Local refusals: too low for a commission, already commissioned, shunned outright.
    const low2 = v({ alignment: 100 })
    const r = run(inGame(), ['m', 'a'], low2)
    expect(r.actions).toEqual([])
    expect(screen(r.state, low2)).toContain('needs an alignment of 500')
    expect(screen(run(inGame(), ['m', 'a'], v({ commissioned: true })).state, v())).toContain('already hold a commission')
    const shunned = run(inGame(), ['m'], v({ alignment: -200 }))
    expect(shunned.actions).toEqual([])
    expect(screen(shunned.state, v())).toContain('want nothing to do with you')
    expect(run(inGame(), ['m', 'p', 'escape'], v()).actions).toEqual([])
  })

  it('talks to Old Sal', () => {
    const v = door({ ask: { kind: 'drydock' } })
    const t = run(inGame(), ['t', 's'], v)
    expect(screen(t.state, v)).toContain('Old Sal')
    expect(lastAction(run(t.state, ['t', ...'Razor', 'return'], v))).toMatchObject({ cmd: 'sal', body: { op: 'trace', target: 'Razor' } })
    expect(lastAction(run(t.state, ['p'], v))).toMatchObject({ cmd: 'sal', body: { op: 'password' } })
    expect(lastAction(run(t.state, ['f'], v))).toMatchObject({ cmd: 'sal', body: { op: 'fortune' } })
    expect(lastAction(run(t.state, ['s'], v))).toMatchObject({ cmd: 'sal', body: { op: 'swear' } })
    expect(run(t.state, ['q'], v).actions).toEqual([])
  })

  it('carries the Back Room password in every request', () => {
    const v = door({ snapshot: snap({ alignment: -300, experience: 50 }), ask: { kind: 'drydock' } })
    const at = run(inGame(), ['t', 'b'], v)
    expect(screen(at.state, v)).toContain('Password')
    // Entering sends nothing: the door is a prompt, and the password stays local.
    const inside = run(at.state, [...'quiet kernel', 'return'], v)
    expect(inside.actions).toEqual([])
    expect(screen(inside.state, v)).toContain('<Back Room> (H)it, (C)ollect, (A)lias, (Q)uit')
    expect(screen(inside.state, v)).not.toContain('quiet kernel')
    const pw = 'quiet kernel'
    expect(lastAction(run(inside.state, ['c'], v))).toMatchObject({ cmd: 'backroom', body: { password: pw, op: 'collect' } })
    expect(lastAction(run(inside.state, ['h', ...'Razor', 'return', ...'5000', 'return'], v))).toMatchObject({ cmd: 'backroom', body: { password: pw, op: 'hit', target: 'Razor', amount: 5000 } })
    const alias = run(inside.state, ['a'], v)
    expect(screen(alias.state, v)).toContain('A new alias costs 1,500 credits.')
    expect(lastAction(run(alias.state, [...'Shade', 'return'], v))).toMatchObject({ cmd: 'backroom', body: { password: pw, op: 'alias', alias: 'Shade' } })
    expect(screen(run(inside.state, ['h', ...'Razor', 'return', ...'100', 'return'], v).state, v)).toContain('Nobody takes a hit under 250 credits.')
    // After a request the prompt is still inside, still holding the password.
    const after = run(inside.state, ['c'], v)
    expect(after.state.door?.prompt).toEqual({ kind: 'back', pw })
    expect(run(inside.state, ['q'], v).state.door?.prompt).toEqual({ kind: 'dock', venue: 'tavern' })
    // An empty password goes back to the tavern; a good name is turned away at the door.
    expect(run(at.state, ['return'], v).state.door?.prompt).toEqual({ kind: 'dock', venue: 'tavern' })
    const saint = door({ snapshot: snap({ alignment: 400 }), ask: { kind: 'drydock' } })
    const door1 = run(inGame(), ['t', 'b'], saint)
    expect(door1.actions).toEqual([])
    expect(screen(door1.state, saint)).toContain('The bouncer looks you over')
  })

  it('shows the Outfitter\'s phase 2 items and sells them', () => {
    const v = door({ snapshot: snap({ credits: 50_000 }), ask: { kind: 'drydock' } })
    const o = run(inGame(), ['o'], v)
    for (const name of ['Marker Beacon', 'Deadman Charge', 'Contact Mine', 'Limpet Mine', 'Mine Disruptor']) expect(screen(o.state, v)).toContain(name)
    for (const [key, item] of [['b', 'beacon'], ['d', 'deadman'], ['m', 'contact'], ['l', 'limpet'], ['r', 'disruptor']] as const) {
      expect(lastAction(run(o.state, [key, '5', 'return'], v)), item).toMatchObject({ cmd: 'outfit', item, qty: 5 })
    }
    expect(lastAction(run(o.state, ['d', ...'1000', 'return'], v))).toMatchObject({ cmd: 'outfit', item: 'deadman', qty: 1000 })
    // The seed torpedo is a later phase.
    expect(run(o.state, ['s'], v).state.door?.prompt).toEqual({ kind: 'dock', venue: 'outfit' })
  })

  it('still answers the later systems\' keys without a request', () => {
    for (const key of ['l', 'u', 't', 'g']) {
      const r = run(inGame(), [key], door())
      expect(r.actions).toEqual([])
      expect(screen(r.state, door())).toContain('comes online in a later Epoch')
    }
    for (const key of ['a', 'f', 'h', 'r', 'y', 'b']) expect(screen(run(inGame(), [key], door({ here: sector(4) })).state, door())).not.toContain('later Epoch')
  })
})
