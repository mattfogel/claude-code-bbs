// Prints every BBS screen in truecolor ANSI, for eyeballing the art without
// a Claude Code session: `bun scripts/screens.ts [width] [height]`.

import type { Feed, View } from '../plugin/types'
import { draw, initialState, type Screen } from '../plugin/client/app'
import { parsePipe } from '../plugin/shared/pipe'
import { THEME } from '../plugin/client/theme'
import { commandPrompt, courseLines, eventLines, sectorLines } from '../plugin/shared/door/format'

const args = process.argv.slice(2).filter(a => !a.startsWith('--'))
const width = Number(args[0] ?? 80)
const height = Number(args[1] ?? 24)
const now = Date.now()
const ago = (s: number) => new Date(now - s * 1000).toISOString()

const feed: Feed = {
  v: 1,
  seq: 42,
  generatedAt: ago(3),
  motd: '|07a board for the hours |13Claude|07 is busy',
  oneliners: [
    { id: 1, handle: 'Phiber', text: '|11hack the planet', ts: ago(3600) },
    { id: 2, handle: 'Acid Burn', text: 'mess with the best, die like the rest', ts: ago(1800) },
    { id: 3, handle: 'mattf', text: '|13first board since 1996. |15feels good', ts: ago(60) },
  ],
  rumors: [{ id: 1, text: 'the sysop still runs a 14.4 in the closet', ts: ago(600) }],
  lastCallers: [
    { handle: 'mattf', location: 'Toronto', ts: ago(60), node: 2 },
    { handle: 'Acid Burn', location: 'NYC', ts: ago(1800), node: 1 },
  ],
  nodes: [
    { node: 1, handle: 'Acid Burn', status: 'tool:Bash', since: ago(40) },
    { node: 2, handle: 'mattf', status: 'thinking', since: ago(5) },
  ],
  stats: { users: 31, callsToday: 12, callsTotal: 512, onelinersTotal: 88, postsTotal: 140 },
  conferences: [
    { n: 1, slug: 'general', name: 'General', sponsor: 'SysOp', description: 'Anything goes. Mostly.', posts: 96, lastPostId: 96, lastPostAt: ago(120) },
    { n: 2, slug: 'claude', name: 'Claude Talk', sponsor: 'SysOp', description: 'Prompts, skills, hooks, mods and war stories.', posts: 31, lastPostId: 31, lastPostAt: ago(900) },
    { n: 3, slug: 'showoff', name: 'Show Off', sponsor: 'Acid Burn', description: 'What you built while waiting.', posts: 13, lastPostId: 13, lastPostAt: ago(4000) },
    { n: 4, slug: 'sysop', name: 'Sysop & Feedback', sponsor: 'SysOp', description: 'Bugs, ideas, complaints to the management.', posts: 0, lastPostId: 0, lastPostAt: null },
  ],
  polls: [
    { id: 2, question: 'Which modem did you have first?', options: [{ text: '2400 baud', votes: 3 }, { text: '14.4k', votes: 9 }, { text: 'US Robotics Courier', votes: 5 }, { text: 'Acoustic coupler, kid', votes: 1 }], total: 18, closed: false, createdAt: ago(7200) },
    { id: 1, question: 'Tabs or spaces?', options: [{ text: 'Tabs', votes: 4 }, { text: 'Spaces', votes: 4 }], total: 8, closed: true, createdAt: ago(90000) },
  ],
  top: {
    posters: [{ handle: 'Acid Burn', n: 42 }, { handle: 'mattf', n: 31 }, { handle: 'Phiber', n: 12 }],
    callers: [{ handle: 'mattf', n: 120 }, { handle: 'Acid Burn', n: 77 }],
    oneliners: [{ handle: 'Phiber', n: 9 }],
  },
}
const index = {
  v: 1, slug: 'general', seq: 9, generatedAt: ago(3), threadsTotal: 3,
  threads: [
    { id: 3, subject: 'what are you building?', handle: 'Acid Burn', createdAt: ago(3000), posts: 7, lastPostId: 96, lastPostAt: ago(120), lastHandle: 'mattf' },
    { id: 2, subject: 'best Obv/2 mods', handle: 'Phiber', createdAt: ago(9000), posts: 3, lastPostId: 90, lastPostAt: ago(7000), lastHandle: 'Phiber' },
    { id: 1, subject: 'first post', handle: 'mattf', createdAt: ago(90000), posts: 12, lastPostId: 40, lastPostAt: ago(50000), lastHandle: 'Acid Burn' },
  ],
}
const thread = {
  slug: 'general', id: 3, subject: 'what are you building?', total: 7, focus: 95,
  posts: [
    { id: 95, n: 6, handle: 'Acid Burn', to: 'mattf', subject: 'Re: what are you building?', ts: ago(400), replyTo: 94,
      body: '> a BBS that lives in a Claude Code pane\n\n|11no way.|07 does it have a voting booth? because if it\ndoes not have a voting booth i am not calling.\n\n  -=|13AB|07=-' },
    { id: 96, n: 7, handle: 'mattf', to: 'Acid Burn', subject: 'Re: what are you building?', ts: ago(120), replyTo: 95, body: 'it does now.' },
  ],
}
const view: View = {
  phase: 'ready', busy: false, claude: 'running Bash…', feed, me: { handle: 'mattf', location: 'Toronto', node: 2 },
  board: { slug: 'general', index }, thread, lastRead: { general: 90, claude: 31 }, votes: { '1': 0 },
  newscan: { scanning: false, items: [{ slug: 'general', conference: 'General', thread: 3, subject: 'what are you building?', unread: 4 }, { slug: 'general', conference: 'General', thread: 2, subject: 'best Obv/2 mods', unread: 0 }] },
}

// HYPERPLANE: a trader docked at a port, mid-haggle, after a short flight.
const ship = { type: 1, name: 'Nightjar', holds: 20, cargo: [0, 20, 0] as [number, number, number], colonists: 0, fighters: 30, shields: 0,
  equipment: { contactMines: 0, limpets: 0, beacons: 0, seeds: 0, crackers: 0, deadman: 0, cloaks: 0, probes: 2, disruptors: 0, photons: 0, scanner: 'density' as const, planetScanner: false, lens: false, jump: 0 as const } }
const snapshot = { v: 1 as const, season: 's1', id: 1, name: 'mattf', sector: 3554, prevSector: 412, turns: 187, turnsMax: 250, credits: 2412, bank: 0, experience: 40, alignment: 12,
  timesBlownUp: 0, commissioned: false, ship, avoids: [], lastSeenLog: 0, requestsToday: 14 }
const here = { id: 3554, region: 'uncharted' as const, port: { name: 'Kestrel Yard', class: 5 as const }, planets: [], traders: [{ name: 'Acid Burn', ship: 'Zero Cool', shipType: 8, fighters: 120 }],
  ships: [], navhaz: 0, mines: [], hallucinations: [], marshals: [], warps: [412, 1877, 3009] }
const report = { sector: 3554, name: 'Kestrel Yard', class: 5 as const, seenAt: ago(5), items: [{ status: 'selling' as const, trading: 2140, pct: 100 }, { status: 'buying' as const, trading: 1620, pct: 98 }, { status: 'selling' as const, trading: 1180, pct: 100 }] }
const steps = [{ commodity: 1 as const, side: 'sell' as const, max: 20, defaultQty: 20, unitOffer: 20.6 }, { commodity: 0 as const, side: 'buy' as const, max: 20, defaultQty: 20, unitOffer: 14.8 }]
const transcript = [
  ...courseLines([1, 2, 412, 3554], 3, s => s < 100),
  `${commandPrompt({ turns: 196, sector: 1 })}|15Y`,
  ...eventLines({ kind: 'warp', from: 1, to: 2, turns: 3 }), ...eventLines({ kind: 'warp', from: 2, to: 412, turns: 3 }), ...eventLines({ kind: 'warp', from: 412, to: 3554, turns: 3 }),
  ...eventLines({ kind: 'stop', sector: 3554, reason: 'arrived' }),
  ...sectorLines(here, s => s !== 1877), '',
  `${commandPrompt(snapshot)}|15P`,
  ...eventLines({ kind: 'dock', report, turnsLeft: 187, steps }, { snapshot }),
]
const doorView: View = { ...view, door: { season: 's1', phase: 'ready', rev: 3, transcript, busy: false, snapshot, here, ask: { kind: 'trade', steps, at: now, round: 0, trading: [2140, 1620, 1180] },
  board: { log: [{ id: 1, ts: ago(3600), kind: 'bang', text: '|11The Big Bang! |07Epoch 1 begins: 1000 sectors.' }, { id: 2, ts: ago(60), kind: 'join', text: '|10mattf |07takes the helm of the |11Nightjar|07.' }],
    rankings: [{ name: 'Acid Burn', rank: 6, title: 'Leading Spacer', experience: 88, alignment: 30, netWorth: 90000 }, { name: 'mattf', rank: 5, title: 'Rigger', experience: 40, alignment: 12, netWorth: 50000 }] } } }
const doorPages = ['title', 'instructions', 'log', 'rankings', 'game'] as const

const rgb = (n: number) => `${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}`
const screens: Screen[] = ['matrix', 'apply', 'logon', 'main', 'oneliners', 'rumors', 'callers', 'who', 'stats', 'bases', 'threads', 'read', 'editor', 'newscan', 'vote', 'poll', 'top', 'goodbye', 'doors']
const extra: Partial<Record<Screen, object>> = {
  apply: { input: { purpose: 'handle', value: 'Zer' } },
  threads: { base: 'general' },
  read: { reader: { slug: 'general', thread: 3, scroll: 0, fromScan: false } },
  editor: { editor: { step: 'body', slug: 'general', subject: 'Re: what are you building?', to: 'Acid Burn', replyTo: 96, back: 'read', lines: ['ha. it does now. one poll at a time,', 'sysop only, results as bars.'], cur: 'next up: privat' } },
  poll: { poll: 2 },
}
for (const screen of screens) {
  const state = { ...initialState(), screen, ...extra[screen] } as ReturnType<typeof initialState>
  if (process.argv.includes('--pipe')) {
    // Raw pipe-coded lines, for scripts/shot.ts.
    for (const line of draw({ ...state, onBoard: true, loggedAt: now - 18 * 60_000 }, screen === 'apply' ? { ...view, phase: 'new', me: undefined } : view, width, height, now)) console.log(line)
    console.log('')
    continue
  }
  console.log(`\n--- ${screen} ---`)
  for (const line of draw(state, screen === 'apply' ? { ...view, phase: 'new', me: undefined } : view, width, height, now)) {
    console.log(parsePipe(line, {}, 7, 0, THEME).map(c => `\x1b[38;2;${rgb(c.fg)};48;2;${rgb(c.bg)}m${c.ch}`).join('') + '\x1b[0m')
  }
}
for (const page of doorPages) {
  const state = { ...initialState(), screen: 'door' as const, onBoard: true, door: { page, prompt: { kind: 'command' as const }, buf: '', scratch: [] } }
  if (process.argv.includes('--pipe')) {
    for (const line of draw({ ...state, loggedAt: now - 18 * 60_000 }, doorView, width, height, now)) console.log(line)
    console.log('')
    continue
  }
  console.log(`\n--- door: ${page} ---`)
  for (const line of draw(state, doorView, width, height, now)) {
    console.log(parsePipe(line, {}, 7, 0, THEME).map(c => `\x1b[38;2;${rgb(c.fg)};48;2;${rgb(c.bg)}m${c.ch}`).join('') + '\x1b[0m')
  }
}
