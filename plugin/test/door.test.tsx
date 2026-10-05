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
    player: undefined as undefined | { sector: number; turns: number; credits: number; holds: number; cargo: [number, number, number]; shipName: string; fighters: number; alignment: number; limpet: boolean; blocked: boolean },
    /** Fighters the player left in sector 2. */
    left: undefined as undefined | { count: number; mode: string },
    explored: new Set<number>(),
    trade: undefined as undefined | { todo: (0 | 2)[]; active?: { c: 0 | 2; qty: number; offer: number } },
    closed: false,
  }
  const json = (status: number, data: unknown, headers: Record<string, string> = {}) => ({ value: { status, ok: status < 300, headers, text: JSON.stringify(data) } })
  const fail = (status: number, code: string, message: string) => json(status, { error: { code, message } })
  const sector = (id: number) => ({
    id, region: id === 1 ? 'concord' : 'uncharted', planets: id === 1 ? [{ id: 1, name: 'Terra', class: 'T' }] : [],
    traders: id === 2 ? [{ name: 'Razor', ship: 'Vex', shipType: 8, fighters: 120 }] : [], ships: [], navhaz: 0, mines: [],
    hallucinations: [], marshals: [], warps: WARPS[id],
    ...(id === 2 && door.left ? { fighters: { count: door.left.count, owner: 'mattf', isYours: true, isCorp: false, mode: door.left.mode } } : {}),
    ...(id === 1 ? { port: { name: 'Haven', class: 0 } } : id === 7 ? { port: { name: 'Kestrel Yard', class: 5 } } : id === 8 ? { port: { name: 'Drydock Anchorage', class: 9 } } : {}),
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
      v: 1, season: 's1', id: 1, name: 'mattf', sector: p.sector, prevSector: 1, turns: p.turns, turnsMax: 250, credits: p.credits, bank: 0, experience: 0, alignment: p.alignment,
      timesBlownUp: 0, commissioned: false, avoids: [], lastSeenLog: 0, requestsToday: door.requests.length, limpet: p.limpet, blocked: p.blocked,
      ship: { type: 1, name: p.shipName, holds: p.holds, cargo: p.cargo, colonists: 0, fighters: p.fighters, shields: 0,
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
      door.player = { sector: 1, turns: 250, credits: 5000, holds: 20, cargo: [0, 0, 0], shipName: body.shipName, fighters: 30, alignment: 0, limpet: false, blocked: false }
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
        if (p.sector === 8) return reply([{ kind: 'text', text: 'You dock.' }])
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
        if (body.removeLimpet) {
          p.limpet = false
          p.credits -= 5000
          return reply([{ kind: 'bought', what: 'limpet removal', qty: 1, cost: 5000 }])
        }
        const cost = body.holds * (200 + 20 * p.holds) + 20 * ((body.holds * (body.holds - 1)) / 2)
        p.holds += body.holds
        p.credits -= cost
        return reply([{ kind: 'bought', what: 'holds', qty: body.holds, cost }])
      }
    }
    // Phase 2: each answers with the one event the screen should show.
    switch (path) {
      case '/v1/door/attack':
        p.blocked = true
        return reply([{ kind: 'attack', target: body.target, sent: body.fighters, lost: 1, killed: 3, shieldsLost: 0, destroyed: false, captured: false, fled: false }])
      case '/v1/door/deploy':
        door.left = { count: body.count, mode: body.mode }
        p.fighters -= body.count
        return reply([{ kind: 'deployed', what: 'fighters', count: body.count, mode: body.mode }])
      case '/v1/door/collect':
        p.fighters += body.count
        door.left = door.left && door.left.count > body.count ? { ...door.left, count: door.left.count - body.count } : undefined
        return reply([{ kind: 'collected', what: 'fighters', count: body.count }])
      case '/v1/door/retreat':
        p.blocked = false
        p.sector = 1
        return reply([{ kind: 'retreat', to: 1 }])
      case '/v1/door/rob':
        return reply([{ kind: 'robbed', credits: body.credits }])
      case '/v1/door/steal':
        return reply([{ kind: 'stolen', commodity: body.commodity, qty: body.qty }])
      case '/v1/door/marshal':
        return reply(body.op === 'wanted' ? [{ kind: 'wanted', rows: [{ name: 'Razor', reward: 9000 }] }] : [{ kind: 'text', text: 'The Marshal stamps something.' }])
      case '/v1/door/sal':
        return reply([{ kind: 'text', text: 'Sal says nothing useful.' }])
      case '/v1/door/backroom':
        return reply([{ kind: 'text', text: 'The Back Room hums.' }])
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

    await press(ui, ['l', 'x', 'g'])
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
    await press(ui, ['l', 'x', 'g', '1', 'e'])
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
    await press(ui, ['l', 'x', 'g', '1', 'l'])
    for (let i = 0; i < 5 && !(await screen(ui)).includes('Big Bang'); i++) await ui.advance(20)
    expect(await screen(ui)).toContain('The Big Bang! Epoch 1 begins.')
    await press(ui, ['x', 'r'])
    for (let i = 0; i < 5 && !(await screen(ui)).includes('Razor'); i++) await ui.advance(20)
    expect(await screen(ui)).toContain('Razor')
    expect(doorCalls(d)).toEqual([])
    await ui.unmount()
  })

  test('fights, deploys, robs and plays the back rooms, one request each', async ($, on) => {
    engine(on)
    const d = fakeDoor(on)
    await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
    await $.command.run({ command: 'bbs', args: '', origin: { kind: 'composer' } } as never)
    const ui = (await $.ui.mount({ plugin: PANE, surface: 'terminal', component: 'Pane', props: paneProps(), requestId: PANE })) as unknown as Ui
    await press(ui, ['l', 'x', 'g', '1', 'e', ...'Nightjar', 'return'])
    const last = () => doorCalls(d).at(-1)

    // Next door: one trader. Fighters deployed in Toll mode, then some taken back.
    await press(ui, ['2', 'return'])
    expect(await screen(ui)).toContain('Traders : Razor, w/ 120 ftrs,')
    await press(ui, ['f', 'd', ...'10', 'return', 't'])
    expect(last()).toMatchObject({ url: `${API}/v1/door/deploy`, body: { kind: 'fighters', count: 10, owner: 'personal', mode: 'toll' } })
    expect(await screen(ui)).toContain('10 fighters deployed (toll).')
    await press(ui, ['f', 't', '3', 'return'])
    expect(last()).toMatchObject({ url: `${API}/v1/door/collect`, body: { kind: 'fighters', count: 3 } })
    expect(await screen(ui)).toContain('You take back 3 fighters.')

    // Attack: one target, so straight to the fighters; the reply leaves us held, so only A, R and Y work.
    await press(ui, ['a', ...'5', 'return'])
    expect(last()).toMatchObject({ url: `${API}/v1/door/attack`, body: { target: 'Razor', fighters: 5 } })
    expect(await screen(ui)).toContain('You send 5 fighters at Razor: 3 destroyed')
    expect(await screen(ui)).toContain('Hostile fighters hold this sector: (A)ttack, (R)etreat or (Y)ield.')
    let before = doorCalls(d).length
    await press(ui, ['1', 'return'])
    expect(doorCalls(d).length).toBe(before)
    expect(await screen(ui)).toContain('Attack them, retreat or yield')
    d.player!.limpet = true
    d.player!.alignment = -200
    await press(ui, ['r'])
    expect(last()).toMatchObject({ url: `${API}/v1/door/retreat`, body: {} })
    expect(await screen(ui)).toContain('You back away and run for sector 1.')
    expect(await screen(ui)).not.toContain('Hostile fighters hold this sector: (A)ttack')
    before = doorCalls(d).length
    await press(ui, ['r', 'y'])
    expect(doorCalls(d).length).toBe(before)
    expect(await screen(ui)).toContain('nothing to yield to')

    // A limpet comes off at Haven's trading post.
    await press(ui, ['p'])
    expect(await screen(ui)).toContain('A limpet is clamped to your hull.')
    await press(ui, ['l'])
    expect(last()).toMatchObject({ url: `${API}/v1/door/class0`, body: { removeLimpet: true } })
    expect(await screen(ui)).toContain('The limpet is pried off your hull for 5,000 credits.')
    await press(ui, ['q'])

    // An outlaw at an ordinary port: the crime menu, then a rob and a steal.
    await press(ui, ['7', 'return', 'return', 'p'])
    expect(await screen(ui)).toContain('<Kestrel Yard> (T)rade, (R)ob, (S)teal, (Q)uit')
    await press(ui, ['r', ...'700', 'return'])
    expect(last()).toMatchObject({ url: `${API}/v1/door/rob`, body: { credits: 700 } })
    await press(ui, ['p', 's', 'd', '4', 'return'])
    expect(last()).toMatchObject({ url: `${API}/v1/door/steal`, body: { commodity: 1, qty: 4 } })

    // The Drydock as an honest pilot: the Marshal's Office takes you, the Back Room does not.
    d.player!.alignment = 600
    await press(ui, ['8', 'return', 'return', 'p'])
    expect(await screen(ui)).toContain('<Drydock> Where to?')
    await press(ui, ['m', 'w'])
    expect(last()).toMatchObject({ url: `${API}/v1/door/marshal`, body: { op: 'wanted' } })
    expect(await screen(ui)).toContain('Razor')
    await press(ui, ['p', ...'Razor', 'return', ...'5000', 'return'])
    expect(last()).toMatchObject({ url: `${API}/v1/door/marshal`, body: { op: 'reward', target: 'Razor', amount: 5000 } })
    await press(ui, ['q', 't', 's', 'f'])
    expect(last()).toMatchObject({ url: `${API}/v1/door/sal`, body: { op: 'fortune' } })
    before = doorCalls(d).length
    await press(ui, ['q', 'b'])
    expect(doorCalls(d).length).toBe(before)
    expect(await screen(ui)).toContain('The bouncer looks you over')

    // Down on his luck, he is let in; every Back Room request carries the password.
    d.player!.alignment = -300
    await press(ui, ['s', 'f', 'q', 'b', ...'quiet kernel', 'return'])
    expect(doorCalls(d).length).toBe(before + 1)
    expect(await screen(ui)).toContain('<Back Room> (H)it, (C)ollect, (A)lias, (Q)uit')
    await press(ui, ['c'])
    expect(last()).toMatchObject({ url: `${API}/v1/door/backroom`, body: { password: 'quiet kernel', op: 'collect' } })
    await press(ui, ['h', ...'Razor', 'return', ...'2500', 'return'])
    expect(last()).toMatchObject({ url: `${API}/v1/door/backroom`, body: { password: 'quiet kernel', op: 'hit', target: 'Razor', amount: 2500 } })
    await ui.unmount()
  })
})
