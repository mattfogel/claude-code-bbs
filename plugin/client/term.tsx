// The Client surface module: holds the BBS's local state, takes raw keys and
// draws app.ts's pipe-coded lines as colored Text runs. It has no `$`; the
// actions it posts are carried out by hooks/register.tsx.

import type { ClientModule } from 'claude-code'

import type { View } from '../types'
import { parsePipe, type Cell } from '../shared/pipe'
import { draw, initialState, press, type AppState } from './app'
import { cps, inkCount, reveal } from './reveal'
import { THEME } from './theme'

/** `baud`: the draw-in speed, 0 for none. */
export type TermProps = { view: View; columns: number; rows: number; baud?: number }
/** `revealKey` names the screen being drawn in; `revealAt` is when it started (0: shown whole). */
type Local = { app: AppState; now: number; revealKey: string; revealAt: number }

const FRAME_MS = 33

/** What counts as a new screen for the draw-in: moving a lightbar or typing does not. */
const screenKey = (app: AppState, view: View) => [app.screen, app.base, app.reader?.thread, view.thread?.focus, app.poll].join('|')

const hex = (n: number) => '#' + n.toString(16).padStart(6, '0')

/** Consecutive cells of one color pair, as one string. */
export function runs(cells: Cell[]): { text: string; fg: number; bg: number }[] {
  const out: { text: string; fg: number; bg: number }[] = []
  for (const cell of cells) {
    const last = out[out.length - 1]
    if (last && last.fg === cell.fg && last.bg === cell.bg) last.text += cell.ch
    else out.push({ text: cell.ch, fg: cell.fg, bg: cell.bg })
  }
  return out
}

// The newest props, for the key listener registered on the first call.
let latest: TermProps | undefined
// Whether the last frame drawn was still mid draw-in, for the frame clock and keys.
let drawingIn = false

const Term: ClientModule<TermProps, Local> = (props, surface) => {
  const { Box, Text } = surface.elements
  latest = props
  let local = surface.state
  if (!local) {
    local = { app: initialState(Math.floor(Math.random() * 1e6)), now: Date.now(), revealKey: '', revealAt: 0 }
    surface.setState(local)
    surface.every(FRAME_MS, () => {
      const cur = surface.state
      if (cur && drawingIn) surface.setState({ ...cur })
    })
    surface.every(10_000, () => {
      const cur = surface.state
      if (cur && Math.floor(Date.now() / 60_000) !== Math.floor(cur.now / 60_000)) surface.setState({ ...cur, now: Date.now() })
    })
    surface.onKey(key => {
      const cur = surface.state
      if (!cur || !latest) return
      // A key during the draw-in finishes it, as hitting a key skipped an ANSI.
      if (drawingIn) return surface.setState({ ...cur, revealAt: 0 })
      const step = press(cur.app, key, latest.view, Math.random, surface.columns || latest.columns, Date.now())
      surface.setState({ ...cur, app: step.state, now: Date.now() })
      if (step.action) surface.post(step.action)
    })
  }

  const columns = surface.columns || props.columns
  const rows = surface.rows || props.rows
  const lines = draw(local.app, props.view, columns, rows, local.now)
  let cells = lines.map(line => parsePipe(line, {}, 7, 0, THEME))

  const baud = props.baud ?? 0
  const key = screenKey(local.app, props.view)
  if (key !== local.revealKey) {
    local = { ...local, revealKey: key, revealAt: baud > 0 ? Date.now() : 0 }
    surface.setState(local)
  }
  const sent = local.revealAt ? ((Date.now() - local.revealAt) / 1000) * cps(baud) : Infinity
  drawingIn = sent < inkCount(cells, THEME[0])
  if (drawingIn) cells = reveal(cells, sent, THEME[0], THEME[7])

  return (
    <Box flexDirection="column">
      {cells.map(row => (
        <Text wrap="truncate">
          {runs(row).map(r => (
            <Text color={hex(r.fg)} backgroundColor={hex(r.bg)}>
              {r.text}
            </Text>
          ))}
        </Text>
      ))}
    </Box>
  )
}

export default Term
