import { describe, expect, it } from 'vitest'

import type { Action, Feed, View } from '../plugin/types'
import { draw, initialState, press, type AppState, type ClientKey } from '../plugin/client/app'
import { stripPipe, visibleLength } from '../plugin/shared/pipe'

const NOW = Date.parse('2026-10-02T18:04:00Z')

const feed: Feed = {
  v: 1,
  seq: 1,
  generatedAt: new Date(NOW).toISOString(),
  motd: 'old motd',
  oneliners: [],
  rumors: [],
  lastCallers: [],
  nodes: [],
  stats: { users: 1, callsToday: 1, callsTotal: 1, onelinersTotal: 0 },
  conferences: [{ n: 1, slug: 'general', name: 'General', sponsor: 'SysOp', description: 'Anything goes.', posts: 0, lastPostId: 0, lastPostAt: null }],
  polls: [{ id: 4, question: 'Best modem?', options: [{ text: 'a', votes: 0 }, { text: 'b', votes: 0 }], total: 0, closed: false, createdAt: new Date(NOW).toISOString() }],
}

const as = (role: 'user' | 'mod' | 'sysop'): View => ({ phase: 'ready', busy: false, claude: 'idle', feed, me: { handle: 'mattf', location: 'NYC', node: 1, role }, lastRead: {}, votes: {} })
const sysop = as('sysop')

const keys = (s: string) => [...s].map(c => (c === ' ' ? 'space' : c))

function run(state: AppState, input: string[], v: View = sysop) {
  const actions: Action[] = []
  for (const key of input) {
    const step = press(state, { key } as ClientKey, v, () => 0, 80, NOW)
    state = step.state
    if (step.action) actions.push(step.action)
  }
  return { state, actions }
}

const onMain = (v: View = sysop) => run(initialState(), ['l', 'x'], v).state
const text = (s: AppState, v: View = sysop) => draw(s, v, 80, 24, NOW).map(stripPipe).join('\n')

describe('sysop menu', () => {
  it('is reached by a hidden key that does nothing for callers', () => {
    const user = run(onMain(as('user')), ['*'], as('user'))
    expect(user.state.screen).toBe('main')
    expect(text(onMain(as('user')), as('user'))).toBe(text(onMain(), sysop))
    expect(run(onMain(), ['*']).state.screen).toBe('sysop')
    expect(run(onMain(as('mod')), ['*'], as('mod')).state.screen).toBe('sysop')
    expect(text(run(onMain(), ['*']).state)).toContain('Conferences')
  })

  it('adds a conference through a form and a Y/N', () => {
    let { state } = run(onMain(), ['*', 'c', 'a'])
    expect(state.screen).toBe('sysForm')
    state = run(state, [...keys('demoscene'), 'return', ...keys('Demoscene'), 'return', ...keys('mattf'), 'return', ...keys('art and intros'), 'return', '5', 'return']).state
    expect(text(state)).toContain('Save conference demoscene (Demoscene)? (Y/N)')
    const { state: after, actions } = run(state, ['y'])
    expect(actions).toEqual([{ type: 'sysop', op: { kind: 'conference', slug: 'demoscene', name: 'Demoscene', sponsor: 'mattf', description: 'art and intros', n: 5 } }])
    expect(after.screen).toBe('sysConfs')
  })

  it('refuses a bad slug and cancels on N', () => {
    let { state } = run(onMain(), ['*', 'c', 'a', ...keys('Bad Slug'), 'return', 'x', 'return', 'return', 'return', 'return'])
    expect(text(state)).toContain('Slug: lowercase')
    state = run(onMain(), ['*', 'c', 'd']).state
    expect(text(state)).toContain('Remove conference general?')
    const no = run(state, ['n'])
    expect(no.actions).toEqual([])
    expect(no.state.confirm).toBeUndefined()
  })

  it('edits a conference with its values filled in', () => {
    let { state } = run(onMain(), ['*', 'c', 'return'])
    expect(state.form?.fields.map(f => f.value)).toEqual(['General', 'SysOp', 'Anything goes.', '1'])
    state = run(state, ['return', 'return', 'return', 'return']).state
    const { actions } = run(state, ['y'])
    expect(actions).toEqual([{ type: 'sysop', op: { kind: 'conference', slug: 'general', name: 'General', sponsor: 'SysOp', description: 'Anything goes.', n: 1 } }])
  })

  it('opens a poll, stopping at the first blank option, and closes one', () => {
    let { state } = run(onMain(), ['*', 'p', 'n', ...keys('Tabs or spaces?'), 'return', ...keys('Tabs'), 'return', ...keys('Spaces'), 'return', 'return'])
    expect(text(state)).toContain('Open poll "Tabs or spaces?" with 2 options?')
    let r = run(state, ['y'])
    expect(r.actions).toEqual([{ type: 'sysop', op: { kind: 'poll', question: 'Tabs or spaces?', options: ['Tabs', 'Spaces'] } }])
    state = run(onMain(), ['*', 'p', 'c']).state
    expect(text(state)).toContain('Close this poll?')
    r = run(state, ['y'])
    expect(r.actions).toEqual([{ type: 'sysop', op: { kind: 'closePoll', id: 4 } }])
  })

  it('sets the message of the day, starting from the current one', () => {
    let { state } = run(onMain(), ['*', 'm'])
    expect(state.form?.fields[0].value).toBe('old motd')
    state = run(state, [...Array(8).fill('backspace'), ...keys('new'), 'return']).state
    expect(run(state, ['y']).actions).toEqual([{ type: 'sysop', op: { kind: 'motd', text: 'new' } }])
  })

  it('bans, unbans and mutes by handle', () => {
    const fill = (handle: string, action: string, minutes?: string) => {
      let { state } = run(onMain(), ['*', 'u', ...keys(handle), 'return', ...Array(4).fill('backspace'), ...keys(action), 'return'])
      if (minutes) state = run(state, ['backspace', 'backspace', ...keys(minutes)]).state
      return run(run(state, ['return']).state, ['y']).actions
    }
    expect(fill('Lamer', 'ban')).toEqual([{ type: 'sysop', op: { kind: 'user', action: 'ban', handle: 'Lamer', minutes: undefined } }])
    expect(fill('Lamer', 'u')).toEqual([{ type: 'sysop', op: { kind: 'user', action: 'unban', handle: 'Lamer', minutes: undefined } }])
    expect(fill('Lamer', 'mute', '15')).toEqual([{ type: 'sysop', op: { kind: 'user', action: 'mute', handle: 'Lamer', minutes: 15 } }])
    const bad = run(onMain(), ['*', 'u', ...keys('Lamer'), 'return', ...Array(4).fill('backspace'), 'x', 'return', 'return'])
    expect(text(bad.state)).toContain('Ban, unban or mute.')
  })

  it('fills every sysop screen to width x height and leaves when the role goes', () => {
    for (const path of [['*'], ['*', 'c'], ['*', 'p'], ['*', 'm'], ['*', 'u'], ['*', 'c', 'a']]) {
      const s = run(onMain(), path).state
      for (const [w, h] of [[80, 24], [44, 14]]) {
        const lines = draw(s, sysop, w, h, NOW)
        expect(lines).toHaveLength(h)
        for (const line of lines) expect(visibleLength(line)).toBe(Math.min(w, 80))
      }
    }
    const s = run(onMain(), ['*', 'c']).state
    expect(run(s, ['down'], as('user')).state.screen).toBe('main')
  })
})
