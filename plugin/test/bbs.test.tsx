import { describe, expect, mock, test, type Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const PANE = 'latent-space'
const API = 'https://bbs.mattfogel.com'
const FEED = 'https://feed.mattfogel.com/hub.json'
const NOW = Date.parse('2026-10-02T18:00:00Z')

const paneProps = (columns = 80, rows = 24) => ({
  title: 'lATENT sPACE',
  isFocused: true,
  bodyColumns: columns,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: rows },
  view: {},
})

/** A board in memory, answering the plugin's $.http.fetch calls. */
function fakeBoard(on: On) {
  const board = {
    seq: 1,
    users: new Map<string, string>(), // secret -> handle
    oneliners: [] as { id: number; handle: string; text: string; ts: string }[],
    calls: [] as string[],
    presence: [] as string[],
    requests: [] as { url: string; body: unknown; auth?: string }[],
    down: false,
  }
  const json = (status: number, data: unknown, headers: Record<string, string> = {}) => ({ value: { status, ok: status < 300, headers, text: JSON.stringify(data) } })
  on('http.fetch', async ($, e) => {
    const body = e.init?.body ? JSON.parse(e.init.body) : undefined
    const auth = e.init?.headers?.authorization
    board.requests.push({ url: e.url, body, auth })
    if (board.down) throw new Error('connect ECONNREFUSED')
    if (e.url === FEED) {
      const etag = `"${board.seq}"`
      if (e.init?.headers?.['if-none-match'] === etag) return { value: { status: 304, ok: false, headers: { etag }, text: '' } }
      return json(200, {
        v: 1,
        seq: board.seq,
        generatedAt: new Date(NOW).toISOString(),
        motd: '',
        oneliners: board.oneliners,
        rumors: [],
        lastCallers: board.calls.map(handle => ({ handle, location: 'NYC', ts: new Date(NOW).toISOString(), node: 1 })),
        nodes: [],
        stats: { users: board.users.size, callsToday: board.calls.length, callsTotal: board.calls.length, onelinersTotal: board.oneliners.length },
      }, { etag })
    }
    const path = e.url.slice(API.length)
    if (path === '/v1/register') {
      if ([...board.users.values()].includes(body.handle)) return json(409, { error: { code: 'taken', message: 'taken' } })
      const secret = `s3cret-${body.handle}-xxxxxxxxxxxxxxxxxxxxxxxx`
      board.users.set(secret, body.handle)
      return json(201, { handle: body.handle, secret })
    }
    const handle = board.users.get(String(auth).replace('Bearer ', ''))
    if (!handle) return json(401, { error: { code: 'unauthorized', message: 'Unknown account.' } })
    if (path === '/v1/call') {
      board.calls.unshift(handle)
      board.seq++
      return json(200, { node: 1 })
    }
    if (path === '/v1/oneliners') {
      const id = board.oneliners.length + 1
      board.oneliners.push({ id, handle, text: body.text, ts: new Date(NOW).toISOString() })
      board.seq++
      return json(200, { id })
    }
    if (path === '/v1/presence') {
      board.presence.push(body.status)
      return json(200, { node: 1 })
    }
    if (path === '/v1/logoff') return json(200, { ok: true })
    return json(404, { error: { code: 'not_found', message: path } })
  })
  return board
}

/** The engine pieces beneath the plugin a session would provide. */
function engine(on: On, store: Record<string, unknown> = {}) {
  mock.store(on, store)
  const clock = mock.clock(on, { now: NOW })
  on('command.register', async () => ({ value: undefined }) as never)
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  on('session.start', async ($, e) => ({ cwd: e.cwd }))
  return clock
}

async function start($: Engine) {
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'bbs', args: '', origin: { kind: 'composer' } } as never)
}

const screen = async (ui: { drawn: (s?: { in?: string }) => Promise<unknown> }) => {
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

describe('lATENT sPACE', () => {
  test('a new caller applies, logs on and posts a one-liner', async ($, on) => {
    const clock = engine(on)
    const board = fakeBoard(on)
    await start($)

    const ui = await $.ui.mount({ plugin: PANE, surface: 'terminal', component: 'Pane', props: paneProps(), requestId: PANE })
    expect(await screen(ui)).toContain('[A]pply')

    for (const key of ['a', ...'Zero', 'return', ...'NYC', 'return']) await ui.key({ key })
    // The proof of work runs a chunk per clock tick, at real hashing speed.
    for (let i = 0; i < 5000 && !(await screen(ui)).includes('Application accepted'); i++) await clock.advance(5)
    expect(await screen(ui)).toContain('Application accepted')

    await ui.key({ key: 'x' }) // log on, with the secret the application returned
    expect(board.calls).toEqual(['Zero'])
    expect(board.requests.find(r => r.url.endsWith('/v1/call'))?.auth).toBe('Bearer s3cret-Zero-xxxxxxxxxxxxxxxxxxxxxxxx')
    expect(await screen(ui)).toContain('Logging on')
    expect(await screen(ui)).toContain('node 1')

    for (const key of ['x', 'o', 'a', ...'eleet', 'return']) await ui.key({ key })
    expect(board.oneliners.map(o => o.text)).toEqual(['eleet'])
    expect(await screen(ui)).toContain('One-liner posted.')
    expect(await screen(ui)).toContain('Zero: eleet')
    await ui.unmount()
  })

  test('a returning caller logs on with the stored secret', async ($, on) => {
    engine(on, { account: { handle: 'mattf', location: 'Toronto', secret: 's3cret-mattf-xxxxxxxxxxxxxxxxxxxxxxxx' } })
    const board = fakeBoard(on)
    board.users.set('s3cret-mattf-xxxxxxxxxxxxxxxxxxxxxxxx', 'mattf')
    await start($)
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: PANE, surface, component: 'Pane', props: paneProps(), requestId: PANE })
      await ui.key({ key: 'l' })
      expect(board.requests.find(r => r.url.endsWith('/v1/call'))?.auth).toBe('Bearer s3cret-mattf-xxxxxxxxxxxxxxxxxxxxxxxx')
      expect(await screen(ui)).toContain('as mattf')
      await ui.unmount()
    }
  })

  test('only a coarse status leaves the machine', async ($, on) => {
    const clock = engine(on, { account: { handle: 'mattf', location: 'Toronto', secret: 's3cret-mattf-xxxxxxxxxxxxxxxxxxxxxxxx' } })
    const board = fakeBoard(on)
    board.users.set('s3cret-mattf-xxxxxxxxxxxxxxxxxxxxxxxx', 'mattf')
    on('tool.call', async () => ({ result: 'ok' }) as never)
    on('turn.start', async ($, e) => ({ turnId: e.turnId }))
    on('turn.complete', async () => ({ text: '' }) as never)
    await start($)
    const ui = await $.ui.mount({ plugin: PANE, surface: 'terminal', component: 'Pane', props: paneProps(), requestId: PANE })
    await ui.key({ key: 'l' })

    await $.turn.start({ text: 'refactor ~/work/secret-project/billing.ts', turnId: 't1' })
    await $.tool.call({ tool: 'Bash', command: 'cat ~/work/secret-project/.env', description: 'peek' } as never)
    await $.tool.call({ tool: 'mcp__acme-internal__deploy', target: 'prod' } as never)
    await clock.advance(5 * 60_000)

    const sent = JSON.stringify(board.requests.filter(r => !r.url.endsWith('hub.json')).map(r => r.body))
    expect(sent).not.toContain('secret-project')
    expect(sent).not.toContain('acme')
    expect(board.presence.length).toBeGreaterThan(0)
    for (const s of board.presence) expect(['idle', 'thinking', 'tool', 'tool:Bash']).toContain(s)
  })

  test('shows ALL NODES BUSY when the board is unreachable', async ($, on) => {
    engine(on, { account: { handle: 'mattf', location: 'Toronto', secret: 's3cret-mattf-xxxxxxxxxxxxxxxxxxxxxxxx' } })
    const board = fakeBoard(on)
    board.down = true
    await start($)
    const ui = await $.ui.mount({ plugin: PANE, surface: 'terminal', component: 'Pane', props: paneProps(), requestId: PANE })
    await ui.key({ key: 'l' })
    expect(await screen(ui)).toContain('ALL NODES BUSY')
  })
})
