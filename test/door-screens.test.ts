import { describe, expect, it } from 'vitest'

import type { Action, DoorView, View } from '../plugin/types'
import { draw, initialState, press, type AppState, type ClientKey } from '../plugin/client/app'
import { stripPipe, visibleLength } from '../plugin/shared/pipe'
import type { DoorMap, DoorReply, PlayerSnapshot, PortReport, SectorView } from '../plugin/shared/door/protocol'
import {
  courseLines, eventLines, portReportLines, quickStats, quickStatsLines, sectorLines, shipInfoLines, shipCatalogLines, rankTableLines, densityLines,
} from '../plugin/shared/door/format'
import { applyError, applyReply, emptyKnown, mergeKnown, plan, type DoorCtx } from '../plugin/client/door/session'

const NOW = Date.parse('2026-10-02T18:04:00Z')

/** 1-2-4-6-7-8 and 1-3-5-6; 7 has a port, 1 is Haven. */
export const MAP: DoorMap = {
  v: 1, season: 's1', sectors: 8, concord: [1, 2, 3], lanes: [], generatedAt: '',
  warps: [[], [2, 3], [1, 4], [1, 5], [2, 6], [3, 6], [4, 5, 7], [6, 8], [7]],
}

const snap = (over: Partial<PlayerSnapshot> = {}): PlayerSnapshot => ({
  v: 1, season: 's1', id: 1, name: 'mattf', sector: 1, prevSector: 1, turns: 250, turnsMax: 250, credits: 300, bank: 0, experience: 0, alignment: 0,
  timesBlownUp: 0, commissioned: false, avoids: [], lastSeenLog: 0, requestsToday: 1,
  ship: { type: 1, name: 'Nightjar', holds: 20, cargo: [0, 0, 0], colonists: 0, fighters: 30, shields: 0,
    equipment: { contactMines: 0, limpets: 0, beacons: 0, seeds: 0, crackers: 0, deadman: 0, cloaks: 0, probes: 0, disruptors: 0, photons: 0, scanner: 'none', planetScanner: false, lens: false, jump: 0 } },
  ...over,
})

const sector = (id: number, over: Partial<SectorView> = {}): SectorView => ({
  id, region: id <= 3 ? 'concord' : 'uncharted', planets: [], traders: [], ships: [], navhaz: 0, mines: [], hallucinations: [], marshals: [], warps: MAP.warps[id], ...over,
})

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
    state = run(state, ['d'], base).state
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

  it('keeps the main menu lightbar moving onto Doors and Goodbye', () => {
    let { state } = run(initialState(), ['l', 'x'], base)
    state = { ...state, sel: 9 }
    expect(run(state, ['down'], base).state.sel).toBe(11)
    expect(run({ ...state, sel: 10 }, ['right'], base).state.sel).toBe(11)
    expect(run({ ...state, sel: 11 }, ['up'], base).state.sel).toBe(9)
    expect(screen(state, base)).toMatch(/Doors\s+.*Goodbye/)
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
