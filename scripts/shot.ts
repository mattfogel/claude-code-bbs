// Renders pipe-coded lines (stdin, one per line) to an HTML page in the
// board palette, for screenshots: `bun scripts/shot.ts < lines > out.html`.

import { parsePipe } from '../plugin/shared/pipe'
import { THEME } from '../plugin/client/theme'

const hex = (n: number) => '#' + n.toString(16).padStart(6, '0')
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
const input = await new Response(Bun.stdin.stream()).text()
const body = input
  .replace(/\n$/, '')
  .split('\n')
  .map(line => parsePipe(line, {}, 7, 0, THEME).map(c => `<span style="color:${hex(c.fg)};background:${hex(c.bg)}">${esc(c.ch)}</span>`).join(''))
  .join('\n')
console.log(`<!doctype html><meta charset="utf-8"><body style="margin:0;background:#000"><pre style="margin:0;padding:12px;font:16px/1 'DejaVu Sans Mono',monospace;display:inline-block">${body}</pre>`)
