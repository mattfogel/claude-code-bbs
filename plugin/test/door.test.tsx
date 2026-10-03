import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const PANE = 'latent-space'
const API = 'https://bbs.mattfogel.com'
const FEED = 'https://feed.mattfogel.com/hub.json'
const MAP_URL = 'https://feed.mattfogel.com/door/s1/map.json'
const NEWS_URL = 'https://feed.mattfogel.com/door/s1/news.json'
const NOW = Date.parse('2026-10-02T18:00:00Z')
const ISO = new Date(NOW).toISOString()
const MATTF = { handle: 'mattf', location: 'Toronto', secret: 's3cret-mattf-xxxxxxxxxxxxxxxxxxxxxxxx' }

/** 1-2-4-6-7-8 and 1-3-5-6. Haven at 1, a class 5 port (SBS) at 7. */
const WARPS = [[], [2, 3], [1, 4], [1, 5], [2, 6], [3, 6], [4, 5, 7], [6, 8], [7]]
const UNIT = [15, 50, 90]

const paneProps = () => ({ title: 'lATENT sPACE', isFocused: true, bodyColumns: 80, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 24 }, view: {} })

type Step = { commodity: 0 | 1 | 2; side: 'buy' | 'sell'; max: number; defaultQty: number; unitOffer: number }

/** A board and a tiny HYPERPLANE universe answering the plugin's fetches per the door protocol. */
function fakeDoor(on: On) {
  const door = {
    requests: [] as { url: string; method: string; body: unknown }[],
    player: undefined as undefined | { sector: number; turns: number; credits: number; holds: number; cargo: [number, number, number]; shipName: string },
    explored: new Set<number>(),
    trade: undefined as undefined | { todo: (0 | 2)[]; active?: { c: 0 | 2; qty: number; offer: number } },
    closed: false,
  }
  const json = (status: number, data: unknown, headers: Record<string, string> = {}) => ({ value: { status, ok: status < 300, headers, text: JSON.stringify(data) } })
  const fail = (status: number, code: string, message: string) => json(status, { error: { code, message } })
  const sector = (id: number) => ({
    id, region: id <= 3 ? 'concord' : 'uncharted', planets: id === 1 ? [{ id: 1, name: 'Terra', class: 'T' }] : [], traders: [], ships: [], navhaz: 0, mines: [],
    hallucinations: [], marshals: [], warps: WARPS[id],
    ...(id === 1 ? { port: { name: 'Haven', class: 0 } } : id === 7 ? { port: { name: 'Kestrel Yard', class: 5 } } : {}),
  })
  const report = () => ({ sector: 7, name: 'Kestrel Yard', class: 5, seenAt: ISO, items: [{ status: 'selling', trading: 1200, pct: 100 }, { status: 'buying', trading: 900, pct: 80 }, { status: 'selling', trading: 600, pct: 90 }] })
  const free = () => door.player!.holds - door.player!.cargo.reduce((a, b) => a + b, 0)
  const steps = (): Step[] => {
    const t = door.trade
    if (!t) return []
    return t.todo.flatMap(c => {
      if (t.active?.c === c) return [{ commodity: c, side: 'buy' as const, max: t.active.qty, defaultQty: t.active.qty, unitOffer: UNIT[c] }]
      const max = free()
      return max > 0 ? [{ commodity: c, side: 'buy' as const, max, defaultQty: Math.min(max, 10), unitOffer: UNIT[c] }] : []
    })
  }
  const snapshot = () => {
    const p = door.player!
    return {
      v: 1, season: 's1', id: 1, name: 'mattf', sector: p.sector, prevSector: 1, turns: p.turns, turnsMax: 250, credits: p.credits, bank: 0, experience: 0, alignment: 0,
      timesBlownUp: 0, commissioned: false, avoids: [], lastSeenLog: 0, requestsToday: door.requests.length,
      ship: { type: 1, name: p.shipName, holds: p.holds, cargo: p.cargo, colonists: 0, fighters: 30, shields: 0,
        equipment: { contactMines: 0, limpets: 0, beacons: 0, seeds: 0, crackers: 0, deadman: 0, cloaks: 0, probes: 0, disruptors: 0, photons: 0, scanner: 'none', planetScanner: false, lens: false, jump: 0 } },
    }
  }
  const reply = (events: unknown[], known = { explored: [] as number[], ports: [] as unknown[] }) => {
    const s = steps()
    if (door.trade && !s.length) door.trade = undefined
    return json(200, { ok: true, snapshot: snapshot(), here: sector(door.player!.sector), events, known, ...(door.trade ? { pending: { sector: 7, steps: s, at: NOW, round: door.trade.active ? 1 : 0 } } : {}) })
  }

  on('http.fetch', async ($, e) => {
    const method = e.init?.method ?? 'GET'
    const body = e.init?.body ? JSON.parse(e.init.body) : undefined
    door.requests.push({ url: e.url, method, body })
    if (e.url === FEED) return json(200, { v: 1, seq: 1, generatedAt: ISO, motd: '', oneliners: [], rumors: [], lastCallers: [], nodes: [], stats: { users: 1, callsToday: 1, callsTotal: 1, onelinersTotal: 0 } }, { etag: '"1"' })
    if (e.url === MAP_URL) return json(200, { v: 1, season: 's1', sectors: 8, warps: WARPS, concord: [1, 2, 3], lanes: [], generatedAt: ISO }, { etag: '"m"' })
    if (e.url === NEWS_URL) {
      return json(200, {
        v: 1, season: 's1', seq: 3, generatedAt: ISO,
        status: { title: 'HYPERPLANE', season: 's1', startedAt: ISO, ageDays: 0, sectors: 8, ports: 2, planets: 1, traders: 1, goodPct: 100, hallucinations: 0, drifters: 0, turnsPerDay: 250, drydock: 5 },
        log: [{ id: 1, ts: ISO, kind: 'bang', text: '|11The Big Bang! |07Epoch 1 begins.' }], comm: [],
        rankings: { traders: [{ name: 'Razor', rank: 3, title: 'Able Spacer', experience: 9, alignment: 5, netWorth: 50000 }], corps: [] },
      }, { etag: '"n"' })
    }
    const path = e.url.slice(API.length)
    if (path === '/v1/call') return json(200, { node: 1 })
    if (path === '/v1/me') return json(200, { handle: 'mattf', location: 'Toronto', role: 'user', createdAt: ISO })
    if (path === '/v1/presence' || path === '/v1/logoff') return json(200, { ok: true })
    if (door.closed && path.startsWith('/v1/door/')) return fail(409, 'closed', 'No Epoch is running yet.')
    if (path === '/v1/door/state') {
      if (!door.player) return json(200, { ok: true, created: false, events: [], known: { explored: [], ports: [] } })
      return json(200, { ok: true, created: true, snapshot: snapshot(), here: sector(door.player.sector), events: [], known: { explored: [...door.explored], ports: [] } })
    }
    if (path === '/v1/door/create') {
      if (door.player) return fail(409, 'taken', 'You already fly in this Epoch.')
      door.player = { sector: 1, turns: 250, credits: 5000, holds: 20, cargo: [0, 0, 0], shipName: body.shipName }
      door.explored.add(1)
      return reply([], { explored: [1], ports: [] })
    }
    const p = door.player
    if (!p) return fail(404, 'not_found', 'You have no trader in this Epoch yet.')
    switch (path) {
      case '/v1/door/move': {
        let at = p.sector
        for (const s of body.path) {
          if (!WARPS[at].includes(s)) return fail(400, 'invalid', 'That course does not follow the warps.')
          at = s
        }
        const events: unknown[] = []
        at = p.sector
        for (const s of body.path) {
          events.push({ kind: 'warp', from: at, to: s, turns: 3 })
          at = s
          door.explored.add(s)
        }
        events.push({ kind: 'stop', sector: at, reason: 'arrived' })
        p.sector = at
        p.turns -= 3 * body.path.length
        door.trade = undefined
        return reply(events, { explored: body.path, ports: at === 7 ? [report()] : [] })
      }
      case '/v1/door/dock':
        p.turns--
        if (p.sector === 1) return reply([{ kind: 'class0', holdPrice: 200 + 20 * p.holds, fighterPrice: 200, shieldPrice: 150 }])
        if (p.sector !== 7) return fail(400, 'invalid', 'There is no port in this sector.')
        door.trade = { todo: [0, 2] }
        return reply([{ kind: 'dock', report: report(), turnsLeft: p.turns, steps: steps() }], { explored: [], ports: [report()] })
      case '/v1/door/offer': {
        const t = door.trade
        if (!t) return fail(400, 'invalid', 'You are not docked at a port.')
        const c = body.commodity as 0 | 2
        const figure = t.active?.offer ?? Math.round(UNIT[c] * body.qty)
        if (body.price >= figure) {
          p.cargo[c] += body.qty
          p.credits -= body.price
          t.todo = t.todo.filter(x => x !== c)
          t.active = undefined
          return reply([{ kind: 'trade', commodity: c, side: 'buy', qty: body.qty, price: body.price, xp: 2 }, { kind: 'xp', exp: 2, align: 0, reason: 'trade' }])
        }
        if (body.price >= figure * 0.85) {
          t.active = { c, qty: body.qty, offer: Math.round(figure * 0.97) }
          return reply([{ kind: 'counter', commodity: c, price: t.active.offer, final: false }])
        }
        t.todo = t.todo.filter(x => x !== c)
        t.active = undefined
        return reply([{ kind: 'refused', commodity: c, line: 'Our clerk laughed so hard he had to sit down.' }])
      }
      case '/v1/door/class0': {
        if (p.sector !== 1) return fail(400, 'invalid', 'Holds, fighters and shields are sold at Haven.')
        const cost = body.holds * (200 + 20 * p.holds) + 20 * ((body.holds * (body.holds - 1)) / 2)
        p.holds += body.holds
        p.credits -= cost
        return reply([{ kind: 'bought', what: 'holds', qty: body.holds, cost }])
      }
    }
    return fail(404, 'not_found', path)
  })
  return door
}

function engine(on: On) {
  mock.store(on, { account: MATTF })
  on('ui.panes', async () => ({ value: [{ id: PANE, title: 'lATENT sPACE', isFocused: true, isShown: true, isPlaced: true }] }) as never)
  mock.env(on, { LATENT_SPACE_MODEM: 'off' })
  mock.clock(on, { now: NOW })
  on('command.register', async () => ({ value: undefined }) as never)
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  on('session.start', async ($, e) => ({ cwd: e.cwd }))
}

type Ui = { drawn: (s?: { in?: string }) => Promise<unknown>; key: (k: { key: string }) => Promise<unknown>; advance: (ms: number) => Promise<unknown>; unmount: () => Promise<unknown> }

const screen = async (ui: Ui) => {
  const tree = await ui.drawn({ in: 'term' })
  const out: string[] = []
  const walk = (node: unknown) => {
    if (typeof node === 'string') out.push(node)
    else if (Array.isArray(node)) node.forEach(walk)
    else if (node && typeof node === 'object') {
      const n = node as { props?: { children?: unknown }; children?: unknown }
      walk(n.children ?? n.props?.children)
    }
  }
  walk(tree)
  return out.join('')
}

/** Presses keys, letting each door action finish before the next key, as a player would. */
async function press(ui: Ui, keys: string[]) {
  for (const key of keys) {
    await ui.key({ key })
    for (let i = 0; i < 20 && /\(…\)|Opening the lanes/.test(await screen(ui)); i++) await ui.advance(20)
  }
}

const doorCalls = (d: { requests: { url: string; body: unknown }[] }) => d.requests.filter(r => r.url.startsWith(`${API}/v1/door/`))

describe('HYPERPLANE', () => {
  test('a new trader enters, flies, haggles and buys holds on a request budget', async ($, on) => {
    engine(on)
    const d = fakeDoor(on)
    await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
    await $.command.run({ command: 'bbs', args: '', origin: { kind: 'composer' } } as never)
    const ui = (await $.ui.mount({ plugin: PANE, surface: 'terminal', component: 'Pane', props: paneProps(), requestId: PANE })) as unknown as Ui

    await press(ui, ['l', 'x', 'd'])
    expect(await screen(ui)).toContain('HYPERPLANE')
    await press(ui, ['1'])
    expect(await screen(ui)).toContain('[E]nter the lanes')

    // Entering is one request; no character yet, so the ship gets a name.
    await press(ui, ['e'])
    expect(doorCalls(d).map(r => r.url)).toEqual([`${API}/v1/door/state`])
    expect(await screen(ui)).toContain('What do you want to name your ship?')
    await press(ui, [...'Nightjar', 'return'])
    expect(doorCalls(d).at(-1)?.body).toEqual({ shipName: 'Nightjar' })
    expect(await screen(ui)).toContain('Sector  : 1 in Concord Space.')
    expect(await screen(ui)).toContain('Sect 1│Turns 250│Creds 5,000')

    // A four-hop course: plotted locally, flown in exactly one request.
    let before = doorCalls(d).length
    await press(ui, ['7', 'return'])
    expect(await screen(ui)).toContain('The shortest path (4 hops, 12 turns) from sector 1 to sector 7 is:')
    expect(await screen(ui)).toContain('Engage the autopilot?')
    await press(ui, ['return'])
    expect(doorCalls(d).length - before).toBe(1)
    expect(doorCalls(d).at(-1)?.body).toEqual({ path: [2, 4, 6, 7], mode: 'alert' })
    expect(await screen(ui)).toContain('Warping to sector 7')
    expect(await screen(ui)).toContain('Ports   : Kestrel Yard, Class 5 (SBS)')

    // Dock, take 10 Compute at the opening figure, then haggle Weights: a counter, then a refusal.
    await press(ui, ['p'])
    expect(await screen(ui)).toContain('Commerce report for Kestrel Yard')
    expect(await screen(ui)).toContain('How many holds of Compute do you want to buy [10]?')
    before = doorCalls(d).length
    await press(ui, ['return'])
    expect(doorCalls(d).length).toBe(before)
    expect(await screen(ui)).toContain('Your offer [150] ?')
    await press(ui, ['return'])
    expect(doorCalls(d).at(-1)?.body).toEqual({ commodity: 0, qty: 10, price: 150 })
    expect(await screen(ui)).toContain('Sharp trading earns you 2 experience points.')
    expect(await screen(ui)).toContain('How many holds of Weights do you want to buy [10]?')
    await press(ui, ['return', ...'800', 'return'])
    expect(doorCalls(d).at(-1)?.body).toEqual({ commodity: 2, qty: 10, price: 800 })
    expect(await screen(ui)).toContain("We'll sell them for 873 credits.")
    expect(await screen(ui)).toContain('Your offer [873] ?')
    await press(ui, [...'500', 'return'])
    expect(await screen(ui)).toContain('Our clerk laughed')
    expect(await screen(ui)).toContain('You cast off from the port.')
    expect(await screen(ui)).toContain('Command [T=237]:[7]')

    // Home to Haven and two more holds.
    await press(ui, ['1', 'return', 'return', 'p'])
    expect(await screen(ui)).toContain('How many cargo holds do you want to buy [0]?')
    await press(ui, ['2', 'return', 'return', 'return'])
    expect(doorCalls(d).at(-1)?.body).toEqual({ holds: 2, fighters: 0, shields: 0 })
    expect(await screen(ui)).toContain('Bought 2 holds')
    expect(await screen(ui)).toContain('Hlds 22')

    // Local commands cost nothing: redisplay, info, the plotter, a port report from memory.
    before = d.requests.length
    await press(ui, ['d', 'i', 'c', 'f', '8', 'return', 'r', '7', 'return', 'q'])
    expect(d.requests.slice(before).filter(r => !r.url.endsWith('hub.json'))).toEqual([])
    const out = await screen(ui)
    expect(out).toContain('Port report for Kestrel Yard')
    expect(out).toContain('<Computer deactivated>')
    await ui.unmount()
  })

  test('says the lanes are dark before the first Epoch', async ($, on) => {
    engine(on)
    const d = fakeDoor(on)
    d.closed = true
    await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
    await $.command.run({ command: 'bbs', args: '', origin: { kind: 'composer' } } as never)
    const ui = (await $.ui.mount({ plugin: PANE, surface: 'terminal', component: 'Pane', props: paneProps(), requestId: PANE })) as unknown as Ui
    await press(ui, ['l', 'x', 'd', '1', 'e'])
    expect(await screen(ui)).toContain('The lanes are dark. No Epoch has begun.')
    expect(await screen(ui)).toContain('[E]nter the lanes')
    await ui.unmount()
  })

  test('shows the daily log and rankings from news.json', async ($, on) => {
    engine(on)
    const d = fakeDoor(on)
    await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
    await $.command.run({ command: 'bbs', args: '', origin: { kind: 'composer' } } as never)
    const ui = (await $.ui.mount({ plugin: PANE, surface: 'terminal', component: 'Pane', props: paneProps(), requestId: PANE })) as unknown as Ui
    await press(ui, ['l', 'x', 'd', '1', 'l'])
    for (let i = 0; i < 5 && !(await screen(ui)).includes('Big Bang'); i++) await ui.advance(20)
    expect(await screen(ui)).toContain('The Big Bang! Epoch 1 begins.')
    await press(ui, ['x', 'r'])
    for (let i = 0; i < 5 && !(await screen(ui)).includes('Razor'); i++) await ui.advance(20)
    expect(await screen(ui)).toContain('Razor')
    expect(doorCalls(d)).toEqual([])
    await ui.unmount()
  })
})
