import { describe, expect, mock, test, type Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const PANE = 'latent-space'
const API = 'https://bbs.mattfogel.com'
const FEED = 'https://feed.mattfogel.com/hub.json'
const NOW = Date.parse('2026-10-02T18:00:00Z')
/** Screens appear whole: the draw-in runs on the real clock, which tests do not drive. */
const OFFLINE_MODEM = { options: { modemSpeed: 'off' } }

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
    posts: [] as { id: number; slug: string; thread: number; handle: string; to: string; subject: string; body: string; ts: string; replyTo: number | null }[],
    votes: [] as { poll: number; option: number; handle: string }[],
  }
  const iso = new Date(NOW).toISOString()
  const conferences = () =>
    ['general', 'claude'].map((slug, i) => {
      const mine = board.posts.filter(p => p.slug === slug)
      return { n: i + 1, slug, name: slug === 'general' ? 'General' : 'Claude Talk', sponsor: 'SysOp', description: '', posts: mine.length, lastPostId: Math.max(0, ...mine.map(p => p.id)), lastPostAt: mine.length ? iso : null }
    })
  const threadsOf = (slug: string) => [...new Set(board.posts.filter(p => p.slug === slug).map(p => p.thread))]
  const threadFile = (slug: string, thread: number) => {
    const posts = board.posts.filter(p => p.slug === slug && p.thread === thread).map((p, i) => ({ ...p, n: i + 1 }))
    return { v: 1, slug, id: thread, subject: posts[0].subject, total: posts.length, posts }
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
        stats: { users: board.users.size, callsToday: board.calls.length, callsTotal: board.calls.length, onelinersTotal: board.oneliners.length, postsTotal: board.posts.length },
        conferences: conferences(),
        polls: [{ id: 1, question: 'Best modem?', options: [0, 1].map(o => ({ text: o ? 'US Robotics' : '14.4', votes: board.votes.filter(v => v.option === o).length })), total: board.votes.length, closed: false, createdAt: iso }],
        top: { posters: [], callers: [], oneliners: [] },
      }, { etag })
    }
    const file = /^https:\/\/feed\.mattfogel\.com\/boards\/([a-z]+)\/(index|threads\/(\d+))\.json$/.exec(e.url)
    if (file) {
      const slug = file[1]
      if (file[2] === 'index') {
        const threads = threadsOf(slug).map(id => {
          const f = threadFile(slug, id)
          const last = f.posts[f.posts.length - 1]
          return { id, subject: f.subject, handle: f.posts[0].handle, createdAt: iso, posts: f.total, lastPostId: last.id, lastPostAt: iso, lastHandle: last.handle }
        })
        return json(200, { v: 1, slug, seq: board.posts.length, generatedAt: iso, threads: threads.reverse(), threadsTotal: threads.length })
      }
      const id = Number(file[3])
      return threadsOf(slug).includes(id) ? json(200, threadFile(slug, id)) : json(404, {})
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
    if (path === '/v1/posts') {
      const id = board.posts.length + 1
      const orig = board.posts.find(p => p.id === body.replyTo)
      const thread = orig?.thread ?? Math.max(0, ...board.posts.map(p => p.thread)) + 1
      board.posts.push({ id, slug: body.conference, thread, handle, to: body.to || orig?.handle || 'All', subject: body.subject || `Re: ${orig?.subject}`, body: body.body, ts: iso, replyTo: body.replyTo ?? null })
      board.seq++
      return json(200, { id, thread })
    }
    if (path === '/v1/votes') {
      if (board.votes.some(v => v.handle === handle)) return json(400, { error: { code: 'invalid', message: 'You already voted in this one.' } })
      board.votes.push({ poll: body.poll, option: body.option, handle })
      board.seq++
      return json(200, { ok: true })
    }
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
  test('a new caller applies, logs on and posts a one-liner', OFFLINE_MODEM, async ($, on) => {
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

  test('a returning caller logs on with the stored secret', OFFLINE_MODEM, async ($, on) => {
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

  test('only a coarse status leaves the machine', OFFLINE_MODEM, async ($, on) => {
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

  test('newscans, reads, replies and votes', OFFLINE_MODEM, async ($, on) => {
    engine(on, { account: { handle: 'mattf', location: 'Toronto', secret: 's3cret-mattf-xxxxxxxxxxxxxxxxxxxxxxxx' } })
    const board = fakeBoard(on)
    board.users.set('s3cret-mattf-xxxxxxxxxxxxxxxxxxxxxxxx', 'mattf')
    board.posts.push({ id: 1, slug: 'general', thread: 1, handle: 'Razor', to: 'All', subject: 'modems', body: 'what did you dial in with?', ts: new Date(NOW).toISOString(), replyTo: null })
    await start($)
    const ui = await $.ui.mount({ plugin: PANE, surface: 'terminal', component: 'Pane', props: paneProps(), requestId: PANE })
    for (const key of ['l', 'x']) await ui.key({ key })
    expect(await screen(ui)).toContain('(Main)')

    await ui.key({ key: 'n' })
    expect(await screen(ui)).toContain('1 new message in 1 thread')
    await ui.key({ key: 'return' })
    expect(await screen(ui)).toContain('what did you dial in with?')
    expect(await screen(ui)).toContain('From: Razor')

    for (const key of ['r', ...'a 2400', 'return', '/', 's', 'return']) await ui.key({ key: key === ' ' ? 'space' : key })
    const sent = board.requests.find(r => r.url.endsWith('/v1/posts'))
    expect(sent?.body).toMatchObject({ conference: 'general', replyTo: 1, body: 'a 2400', to: 'Razor' })
    expect(await screen(ui)).toContain('Message #2 saved.')

    // Read pointers persist: the next newscan finds nothing new.
    for (const key of ['q', 'n']) await ui.key({ key })
    expect(await screen(ui)).toContain('No new messages')

    for (const key of ['q', 'v', '1', '2']) await ui.key({ key })
    expect(board.votes).toEqual([{ poll: 1, option: 1, handle: 'mattf' }])
    expect(await screen(ui)).toContain('Vote counted.')
    await ui.unmount()
  })

  test('shows ALL NODES BUSY when the board is unreachable', OFFLINE_MODEM, async ($, on) => {
    engine(on, { account: { handle: 'mattf', location: 'Toronto', secret: 's3cret-mattf-xxxxxxxxxxxxxxxxxxxxxxxx' } })
    const board = fakeBoard(on)
    board.down = true
    await start($)
    const ui = await $.ui.mount({ plugin: PANE, surface: 'terminal', component: 'Pane', props: paneProps(), requestId: PANE })
    await ui.key({ key: 'l' })
    expect(await screen(ui)).toContain('ALL NODES BUSY')
  })
})
