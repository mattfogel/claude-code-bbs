import { describe, expect, it } from 'vitest'

import type { Action, BoardIndex, Feed, ThreadView, View } from '../plugin/types'
import { draw, initialState, press, type AppState, type ClientKey } from '../plugin/client/app'
import { stripPipe, visibleLength } from '../plugin/shared/pipe'

const NOW = Date.parse('2026-10-02T18:04:00Z')
const ts = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString()

const feed: Feed = {
  v: 1,
  seq: 9,
  generatedAt: ts(0),
  motd: '',
  oneliners: [],
  rumors: [],
  lastCallers: [],
  nodes: [],
  stats: { users: 3, callsToday: 1, callsTotal: 1, onelinersTotal: 0, postsTotal: 3 },
  conferences: [
    { n: 1, slug: 'general', name: 'General', sponsor: 'SysOp', description: 'Anything goes.', posts: 3, lastPostId: 3, lastPostAt: ts(1) },
    { n: 2, slug: 'claude', name: 'Claude Talk', sponsor: 'SysOp', description: 'Prompts.', posts: 0, lastPostId: 0, lastPostAt: null },
  ],
  polls: [
    { id: 7, question: 'Best modem?', options: [{ text: '14.4', votes: 1 }, { text: 'US Robotics', votes: 3 }], total: 4, closed: false, createdAt: ts(60) },
    { id: 6, question: 'Old poll', options: [{ text: 'a', votes: 0 }, { text: 'b', votes: 0 }], total: 0, closed: true, createdAt: ts(600) },
  ],
  top: { posters: [{ handle: 'Razor', n: 12 }, { handle: 'Blade', n: 3 }], callers: [{ handle: 'mattf', n: 40 }], oneliners: [] },
}

const index: BoardIndex = {
  v: 1,
  slug: 'general',
  seq: 3,
  generatedAt: ts(0),
  threadsTotal: 2,
  threads: [
    { id: 2, subject: 'modems', handle: 'Blade', createdAt: ts(5), posts: 1, lastPostId: 3, lastPostAt: ts(1), lastHandle: 'Blade' },
    { id: 1, subject: 'first post', handle: 'Razor', createdAt: ts(50), posts: 2, lastPostId: 2, lastPostAt: ts(10), lastHandle: 'mattf' },
  ],
}

const thread: ThreadView = {
  slug: 'general',
  id: 1,
  subject: 'first post',
  total: 2,
  focus: 1,
  posts: [
    { id: 1, n: 1, handle: 'Razor', to: 'All', subject: 'first post', ts: ts(50), replyTo: null, body: 'hello |12world\u001b[2J\n\n' + 'word '.repeat(40) },
    { id: 2, n: 2, handle: 'mattf', to: 'Razor', subject: 'Re: first post', ts: ts(10), replyTo: 1, body: 'hi back' },
  ],
}

const view: View = {
  phase: 'ready',
  busy: false,
  claude: 'idle',
  feed,
  me: { handle: 'mattf', location: 'NYC', node: 1 },
  board: { slug: 'general', index },
  thread,
  lastRead: { general: 2 },
  votes: {},
}

const k = (key: string): ClientKey => ({ key })

function run(state: AppState, keys: string[], v: View = view) {
  const actions: Action[] = []
  for (const key of keys) {
    const step = press(state, k(key), v, () => 0, 80)
    state = step.state
    if (step.action) actions.push(step.action)
  }
  return { state, actions }
}

const onMain = () => run(initialState(), ['l', 'x'], view).state
const text = (s: AppState, v: View = view, w = 80, h = 24) => draw(s, v, w, h, NOW).map(stripPipe).join('\n')

describe('message screens', () => {
  it('fill width x height at every size', () => {
    const states: Partial<AppState>[] = [
      { screen: 'bases' },
      { screen: 'threads', base: 'general' },
      { screen: 'read', reader: { slug: 'general', thread: 1, scroll: 0, fromScan: false } },
      { screen: 'editor', editor: { step: 'body', slug: 'general', subject: 's', to: 'All', lines: ['a', 'b'], cur: 'c', back: 'threads' } },
      { screen: 'newscan' },
      { screen: 'vote' },
      { screen: 'poll', poll: 7 },
      { screen: 'top' },
    ]
    for (const extra of states) {
      for (const [w, h] of [[80, 24], [44, 14], [100, 40]]) {
        const lines = draw({ ...initialState(), ...extra } as AppState, { ...view, newscan: { scanning: false, items: [] } }, w, h, NOW)
        expect(lines).toHaveLength(h)
        for (const line of lines) expect(visibleLength(line)).toBe(Math.min(w, 80))
      }
    }
  })

  it('lists conferences with new markers and joins one by number', () => {
    const { state } = run(onMain(), ['b'])
    const out = text(state)
    expect(out).toContain('General')
    expect(out).toMatch(/\* 1\s+General/)
    const joined = run(state, ['2'])
    expect(joined.state.screen).toBe('threads')
    expect(joined.state.base).toBe('claude')
    expect(joined.actions).toEqual([{ type: 'board', slug: 'claude' }])
  })

  it('opens the thread list and a thread from the main menu', () => {
    const { state, actions } = run(onMain(), ['m'])
    expect(actions).toEqual([{ type: 'board', slug: 'general' }])
    expect(text(state)).toContain('modems')
    const opened = run(state, ['down', 'return'])
    expect(opened.actions).toEqual([{ type: 'read', slug: 'general', thread: 1 }])
    expect(opened.state.screen).toBe('read')
  })

  it('reads a message with an Obv/2 header, sanitized and wrapped', () => {
    const s: AppState = { ...onMain(), screen: 'read', reader: { slug: 'general', thread: 1, scroll: 0, fromScan: false } }
    const out = text(s)
    expect(out).toMatch(/╔═╡ General ╞═+╡ Msg 1 of 2 ╞═╗/)
    expect(out).toContain('Msg 1 of 2')
    expect(out).toMatch(/From: Razor\s+Date: /)
    expect(out).toContain('Subj: first post')
    expect(out).toContain('hello world')
    expect(out).not.toContain('\u001b')
    for (const line of draw(s, view, 40, 20, NOW)) expect(visibleLength(line)).toBe(40)

    const next = run(s, ['n'])
    expect(next.actions).toEqual([{ type: 'read', slug: 'general', thread: 1, post: 2 }])
    const atEnd = run(s, ['n'], { ...view, thread: { ...thread, focus: 2 } })
    expect(atEnd.actions).toEqual([])
    expect(text(atEnd.state)).toContain('End of thread')
  })

  it('replies through the line editor, wrapping words', () => {
    const s: AppState = { ...onMain(), screen: 'read', reader: { slug: 'general', thread: 1, scroll: 0, fromScan: false } }
    let { state } = run(s, ['r'])
    expect(state.screen).toBe('editor')
    expect(text(state)).toContain('To: Razor')
    const long = 'all work and no play makes jack a dull boy '.repeat(3)
    state = run(state, [...long.trim()].map(c => (c === ' ' ? 'space' : c))).state
    expect(state.editor!.lines.length).toBe(1)
    expect(visibleLength(state.editor!.lines[0])).toBeLessThanOrEqual(74)
    const saved = run(state, ['return', '/', 's', 'return'])
    expect(saved.state.screen).toBe('read')
    expect(saved.actions).toEqual([
      { type: 'message', conference: 'general', subject: '', to: 'Razor', body: expect.stringContaining('all work and no play'), replyTo: 1, thread: undefined },
    ])
  })

  it('starts a new thread: subject, To:, body, /S', () => {
    let { state } = run(onMain(), ['m', 'p'])
    expect(state.editor?.step).toBe('subject')
    state = run(state, [...'hi', 'return']).state
    expect(state.editor?.step).toBe('to')
    state = run(state, ['return', ...'line one', 'return', '/', 's']).state
    const { actions } = run(state, ['return'])
    expect(actions).toEqual([{ type: 'message', conference: 'general', subject: 'hi', to: '', body: 'line one', replyTo: undefined, thread: undefined }])
  })

  it('aborts with /A and joins lines on backspace', () => {
    let { state } = run(onMain(), ['m', 'p', 'x', 'return', 'return', 'a', 'return'])
    expect(state.editor!.lines).toEqual(['a'])
    state = run(state, ['backspace']).state
    expect(state.editor!.cur).toBe('a')
    const aborted = run({ ...state, editor: { ...state.editor!, cur: '/a' } }, ['return'])
    expect(aborted.state.screen).toBe('threads')
    expect(aborted.actions).toEqual([])
  })

  it('newscans: lists new threads, reads through them, ends on the main menu', () => {
    const scanView: View = {
      ...view,
      newscan: {
        scanning: false,
        items: [
          { slug: 'general', conference: 'General', thread: 1, subject: 'first post', unread: 1 },
          { slug: 'general', conference: 'General', thread: 2, subject: 'modems', unread: 1 },
        ],
      },
    }
    let step = run(onMain(), ['n'], scanView)
    expect(step.actions).toEqual([{ type: 'newscan' }])
    expect(text(step.state, scanView)).toContain('2 new messages in 2 threads')
    step = run(step.state, ['return'], scanView)
    expect(step.actions).toEqual([{ type: 'read', slug: 'general', thread: 1 }])
    const onLast = { ...scanView, thread: { ...thread, focus: 2 } }
    step = run(step.state, ['n'], onLast)
    expect(step.actions).toEqual([{ type: 'read', slug: 'general', thread: 2 }])
    expect(step.state.scan).toBe(1)
    const lastThread = { ...scanView, thread: { ...thread, id: 2, focus: 2 } }
    step = run(step.state, ['n'], lastThread)
    expect(step.state.screen).toBe('main')
    expect(text(step.state, lastThread)).toContain('Newscan complete')
  })

  it('votes once in an open poll and shows bars', () => {
    let { state } = run(onMain(), ['v'])
    expect(text(state)).toContain('Best modem?')
    state = run(state, ['1']).state
    expect(state.screen).toBe('poll')
    expect(text(state)).toMatch(/US Robotics\s+█+░*\s+75%/)
    const voted = run(state, ['2'])
    expect(voted.actions).toEqual([{ type: 'vote', poll: 7, option: 1 }])
    const again = run(state, ['1'], { ...view, votes: { '7': 1 } })
    expect(again.actions).toEqual([])
    expect(text(again.state, { ...view, votes: { '7': 1 } })).toContain('already voted')
    const closed = run({ ...state, poll: 6 }, ['1'])
    expect(closed.actions).toEqual([])
  })

  it('draws Top Ten as bars', () => {
    const { state } = run(onMain(), ['t'])
    const out = text(state)
    expect(out).toContain('Posters')
    expect(out).toMatch(/1\. Razor\s+█+\s+12/)
    expect(out).toContain('nobody yet')
  })
})
