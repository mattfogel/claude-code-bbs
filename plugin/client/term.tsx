// The Client surface module: holds the BBS's local state, takes raw keys and
// draws app.ts's pipe-coded lines as colored Text runs. It has no `$`; the
// actions it posts are carried out by hooks/register.tsx.

import type { ClientModule } from 'claude-code'

import type { View } from '../types'
import { parsePipe } from '../shared/pipe'
import { draw, initialState, press, type AppState } from './app'

export type TermProps = { view: View; columns: number; rows: number }
type Local = { app: AppState; now: number }

const hex = (n: number) => '#' + n.toString(16).padStart(6, '0')

/** Consecutive cells of one color pair, as one string. */
export function runs(line: string): { text: string; fg: number; bg: number }[] {
  const out: { text: string; fg: number; bg: number }[] = []
  for (const cell of parsePipe(line)) {
    const last = out[out.length - 1]
    if (last && last.fg === cell.fg && last.bg === cell.bg) last.text += cell.ch
    else out.push({ text: cell.ch, fg: cell.fg, bg: cell.bg })
  }
  return out
}

// The newest props, for the key listener registered on the first call.
let latest: TermProps | undefined

const Term: ClientModule<TermProps, Local> = (props, surface) => {
  const { Box, Text } = surface.elements
  latest = props
  let local = surface.state
  if (!local) {
    local = { app: initialState(Math.floor(Math.random() * 1e6)), now: Date.now() }
    surface.setState(local)
    surface.every(10_000, () => {
      const cur = surface.state
      if (cur && Math.floor(Date.now() / 60_000) !== Math.floor(cur.now / 60_000)) surface.setState({ ...cur, now: Date.now() })
    })
    surface.onKey(key => {
      const cur = surface.state
      if (!cur || !latest) return
      const step = press(cur.app, key, latest.view, Math.random, surface.columns || latest.columns)
      surface.setState({ app: step.state, now: Date.now() })
      if (step.action) surface.post(step.action)
    })
  }

  const columns = surface.columns || props.columns
  const rows = surface.rows || props.rows
  const lines = draw(local.app, props.view, columns, rows, local.now)

  return (
    <Box flexDirection="column">
      {lines.map(line => (
        <Text wrap="truncate">
          {runs(line).map(r => (
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
