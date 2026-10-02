import { describe, expect, it } from 'vitest'

import type { Feed, View } from '../plugin/types'
import { draw, initialState, press, type AppState, type ClientKey } from '../plugin/client/app'
import { visibleLength, stripPipe } from '../plugin/shared/pipe'

const NOW = Date.parse('2026-10-02T18:04:00Z')

const feed: Feed = {
  v: 1,
  seq: 7,
  generatedAt: '2026-10-02T18:03:55Z',
  motd: '|13welcome to the void',
  oneliners: [{ id: 1, handle: 'Phiber', text: '|11hack the planet', ts: '2026-10-02T18:00:00Z' }],
  rumors: [{ id: 3, text: 'the sysop runs Telegard', ts: '2026-10-02T17:00:00Z' }],
  lastCallers: [{ handle: 'Phiber', location: 'NYC', ts: '2026-10-02T18:00:00Z', node: 1 }],
  nodes: [{ node: 1, handle: 'Phiber', status: 'tool:Bash', since: '2026-10-02T18:02:00Z' }],
  stats: { users: 3, callsToday: 5, callsTotal: 50, onelinersTotal: 9 },
}

const guest: View = { phase: 'new', busy: false, claude: 'idle', feed }
const member: View = { phase: 'ready', busy: false, claude: 'running Bash…', feed, me: { handle: 'mattf', location: 'NYC', node: 2 } }

const k = (key: string, mods: Partial<ClientKey> = {}): ClientKey => ({ key, ...mods }) as ClientKey

function run(state: AppState, keys: string[], view: View) {
  const actions = []
  for (const key of keys) {
    const step = press(state, k(key), view, () => 0)
    state = step.state
    if (step.action) actions.push(step.action)
  }
  return { state, actions }
}

const text = (lines: string[]) => lines.map(stripPipe).join('\n')

describe('draw', () => {
  it('always fills width x height', () => {
    for (const screen of ['matrix', 'apply', 'logon', 'main', 'oneliners', 'rumors', 'callers', 'who', 'stats', 'goodbye'] as const) {
      for (const [w, h] of [[80, 24], [44, 16], [120, 40]]) {
        const lines = draw({ ...initialState(), screen }, member, w, h, NOW)
        expect(lines).toHaveLength(h)
        for (const line of lines) expect(visibleLength(line)).toBe(Math.min(w, 80))
      }
    }
  })

  it('shows the logo when it fits and a text title when not', () => {
    expect(text(draw(initialState(), guest, 80, 24, NOW))).toContain('█')
    expect(text(draw(initialState(), guest, 40, 24, NOW))).toContain('lATENT sPACE')
  })

  it('puts node, handle and Claude status on the status bar', () => {
    const last = stripPipe(draw(initialState(), member, 80, 24, NOW).at(-1)!)
    expect(last).toContain('Node 2')
    expect(last).toContain('mattf')
    expect(last).toContain('Claude: running Bash')
    expect(stripPipe(draw(initialState(), { ...member, busy: true }, 80, 24, NOW).at(-1)!)).toContain('ALL NODES BUSY')
  })

  it("describes who's online coarsely", () => {
    expect(text(draw({ ...initialState(), screen: 'who' }, member, 80, 24, NOW))).toContain('Claude is running Bash')
  })

  it('sanitizes feed text again before drawing', () => {
    const evil: View = { ...member, feed: { ...feed, oneliners: [{ id: 9, handle: 'x', text: 'a\u001b[2Jb|99', ts: feed.generatedAt }] } }
    const out = text(draw({ ...initialState(), screen: 'oneliners' }, evil, 80, 24, NOW))
    expect(out).toContain('x: ab')
    expect(out).not.toContain('\u001b')
  })
})

describe('press', () => {
  it('walks a new user through the application', () => {
    const { state, actions } = run(initialState(), ['a', 'Z', 'e', 'r', 'o', 'return', 'N', 'Y', 'C', 'return'], guest)
    expect(actions).toEqual([{ type: 'register', handle: 'Zero', location: 'NYC' }])
    expect(state.screen).toBe('apply')
    expect(text(draw(state, { ...guest, registering: { progress: 0.5 } }, 80, 24, NOW))).toContain('Negotiating carrier... 50%')
    const accepted = run(state, ['x'], { ...guest, phase: 'ready', me: { handle: 'Zero', location: 'NYC' } })
    expect(accepted.actions).toEqual([{ type: 'call' }])
    expect(accepted.state.screen).toBe('logon')
  })

  it('refuses bad handles locally', () => {
    const { state, actions } = run(initialState(), ['a', '!', 'return'], guest)
    expect(actions).toEqual([])
    expect(state.input?.purpose).toBe('handle')
    expect(text(draw(state, guest, 80, 24, NOW))).toContain('letters, digits')
  })

  it('logs a member on, through the logon screen to the main menu', () => {
    const { state, actions } = run(initialState(), ['return', 'x'], member)
    expect(actions).toEqual([{ type: 'call' }])
    expect(state.screen).toBe('main')
    expect(text(draw(state, member, 80, 24, NOW))).toContain('[Main Menu] Command:')
  })

  it('moves the lightbar and opens items by hotkey', () => {
    let { state } = run(initialState(), ['l', 'x'], member)
    state = run(state, ['down', 'right'], member).state
    expect(state.sel).toBe(3)
    state = run(state, ['return'], member).state
    expect(state.screen).toBe('oneliners')
    state = run(state, ['q', 'w'], member).state
    expect(state.screen).toBe('who')
  })

  it('posts a one-liner and shows the outcome once', () => {
    let { state } = run(initialState(), ['l', 'x', 'o', 'a'], member)
    const typed = run(state, [...'eleet', 'space', 'return'], member)
    expect(typed.actions).toEqual([{ type: 'post', kind: 'oneliner', text: 'eleet' }])
    const done: View = { ...member, notice: { id: 1, text: 'Wait 42s before posting again.', isError: true } }
    expect(text(draw(typed.state, done, 80, 24, NOW))).toContain('Wait 42s')
    state = run(typed.state, ['x'], done).state
    expect(text(draw(state, done, 80, 24, NOW))).not.toContain('Wait 42s')
  })

  it('says goodbye and hangs up back to the matrix', () => {
    const { state, actions } = run(initialState(), ['l', 'x', 'g'], member)
    expect(actions.at(-1)).toEqual({ type: 'logoff' })
    expect(text(draw(state, member, 80, 24, NOW))).toContain('NO CARRIER')
    expect(run(state, ['x'], member).state.screen).toBe('matrix')
  })

  it('sends a guest who wanders into a list back to the matrix', () => {
    const { state } = run(initialState(), ['w', 'q'], guest)
    expect(state.screen).toBe('matrix')
  })
})
