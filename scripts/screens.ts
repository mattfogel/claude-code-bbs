// Prints every BBS screen in truecolor ANSI, for eyeballing the art without
// a Claude Code session: `bun scripts/screens.ts [width] [height]`.

import type { Feed, View } from '../plugin/types'
import { draw, initialState, type Screen } from '../plugin/client/app'
import { parsePipe } from '../plugin/shared/pipe'

const width = Number(process.argv[2] ?? 80)
const height = Number(process.argv[3] ?? 24)
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
  stats: { users: 31, callsToday: 12, callsTotal: 512, onelinersTotal: 88 },
}
const view: View = { phase: 'ready', busy: false, claude: 'running Bash…', feed, me: { handle: 'mattf', location: 'Toronto', node: 2 } }

const rgb = (n: number) => `${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}`
const screens: Screen[] = ['matrix', 'apply', 'logon', 'main', 'oneliners', 'rumors', 'callers', 'who', 'stats', 'goodbye']
for (const screen of screens) {
  const state = { ...initialState(), screen, ...(screen === 'apply' ? { input: { purpose: 'handle' as const, value: 'Zer' } } : {}) }
  console.log(`\n--- ${screen} ---`)
  for (const line of draw(state, screen === 'apply' ? { ...view, phase: 'new', me: undefined } : view, width, height, now)) {
    console.log(parsePipe(line).map(c => `\x1b[38;2;${rgb(c.fg)};48;2;${rgb(c.bg)}m${c.ch}`).join('') + '\x1b[0m')
  }
}
