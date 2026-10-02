// Pipe-code and MCI handling shared by the mod and the server.
//
// Colors follow Obv/2 / Renegade: |00-|15 set the foreground, |16-|23 set the
// background (16 + n). %XX fields are MCI substitutions (%UN handle, ...).
// User text may carry |01-|15 only; everything else is stripped by
// sanitizeUserText on both sides of the wire.

/** The VGA text-mode palette as 0xRRGGBB. */
export const VGA = [
  0x000000, 0x0000aa, 0x00aa00, 0x00aaaa, 0xaa0000, 0xaa00aa, 0xaa5500, 0xaaaaaa,
  0x555555, 0x5555ff, 0x55ff55, 0x55ffff, 0xff5555, 0xff55ff, 0xffff55, 0xffffff,
] as const

export type Cell = { ch: string; fg: number; bg: number }

export type MciContext = Record<string, string | number | undefined>

const PIPE = /\|([0-9]{2})/y
const MCI = /%([A-Z]{2})/y

/**
 * True for a character that occupies exactly one terminal cell: a printable,
 * non-combining, non-wide code point in the BMP.
 */
export function isCellChar(ch: string): boolean {
  if (ch.length !== 1) return false
  const c = ch.charCodeAt(0)
  if (c < 0x20 || (c >= 0x7f && c < 0xa0)) return false
  if (c >= 0xd800 && c <= 0xdfff) return false // surrogate halves
  if (c === 0xad) return false // soft hyphen
  if ((c >= 0x0300 && c <= 0x036f) || (c >= 0x1ab0 && c <= 0x1aff) || (c >= 0x1dc0 && c <= 0x1dff) || (c >= 0x20d0 && c <= 0x20ff) || (c >= 0xfe20 && c <= 0xfe2f)) return false // combining marks
  if ((c >= 0x200b && c <= 0x200f) || (c >= 0x2028 && c <= 0x202e) || (c >= 0x2060 && c <= 0x206f) || c === 0xfeff) return false // zero-width, bidi
  if (c >= 0xfe00 && c <= 0xfe0f) return false // variation selectors
  if (isWide(c)) return false
  return true
}

function isWide(c: number): boolean {
  return (
    (c >= 0x1100 && c <= 0x115f) ||
    (c >= 0x2e80 && c <= 0x303e) ||
    (c >= 0x3041 && c <= 0x33ff) ||
    (c >= 0x3400 && c <= 0x4dbf) ||
    (c >= 0x4e00 && c <= 0x9fff) ||
    (c >= 0xa000 && c <= 0xa4cf) ||
    (c >= 0xac00 && c <= 0xd7a3) ||
    (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0xfe30 && c <= 0xfe4f) ||
    (c >= 0xff00 && c <= 0xff60) ||
    (c >= 0xffe0 && c <= 0xffe6)
  )
}

/**
 * Parses pipe-coded text into cells. `%XX` fields are replaced from `ctx`
 * (unknown fields are kept literally); substituted values are not themselves
 * parsed for codes. Characters that are not one cell wide become `?`.
 */
export function parsePipe(text: string, ctx: MciContext = {}, fg = 7, bg = 0): Cell[] {
  const out: Cell[] = []
  const push = (s: string) => {
    for (const ch of s) out.push({ ch: isCellChar(ch) ? ch : '?', fg: VGA[fg], bg: VGA[bg] })
  }
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (ch === '|') {
      PIPE.lastIndex = i
      const m = PIPE.exec(text)
      if (m) {
        const n = Number(m[1])
        if (n <= 15) fg = n
        else if (n <= 23) bg = n - 16
        i += 3
        continue
      }
    } else if (ch === '%') {
      MCI.lastIndex = i
      const m = MCI.exec(text)
      if (m && ctx[m[1]] !== undefined) {
        push(String(ctx[m[1]]))
        i += 3
        continue
      }
    }
    const cp = text.codePointAt(i)!
    const s = String.fromCodePoint(cp)
    push(s)
    i += s.length
  }
  return out
}

/** Text with every pipe code removed (MCI fields left as typed). */
export function stripPipe(text: string): string {
  return text.replace(/\|[0-9]{2}/g, '')
}

/** How many cells `text` draws as, ignoring pipe codes. */
export function visibleLength(text: string): number {
  return [...stripPipe(text)].length
}

// C0, DEL, C1, bidi controls and isolates, zero-width characters, BOM, line/paragraph separators.
const FORBIDDEN = charClass([0x00, 0x1f], [0x7f, 0x9f], [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x206f], [0xfeff, 0xfeff])

function charClass(...ranges: [number, number][]): RegExp {
  const esc = (n: number) => '\\u' + n.toString(16).padStart(4, '0')
  return new RegExp('[' + ranges.map(([a, b]) => esc(a) + '-' + esc(b)).join('') + ']', 'g')
}

/**
 * Cleans a line of user text: NFC, no control or bidi characters, no ESC
 * sequences, color codes |01-|15 only, no MCI fields, whitespace collapsed.
 * Returns '' when nothing visible remains.
 */
export function sanitizeUserText(raw: string, maxVisible: number): string {
  let s = String(raw).normalize('NFC')
  s = s.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '') // CSI sequences, before ESC itself goes
  s = s.replace(FORBIDDEN, ' ')
  s = s.replace(/\|([0-9]{2})/g, (m, n) => (Number(n) >= 1 && Number(n) <= 15 ? m : ''))
  s = s.replace(/\|[A-Za-z][A-Za-z0-9]/g, '') // |MN, |U1 and other prompt MCIs
  s = s.replace(/%[A-Z]{2}/g, '')
  s = s.replace(/\s+/g, ' ').trim()
  // Cut to maxVisible cells, keeping codes that precede kept characters.
  let out = ''
  let seen = 0
  for (let i = 0; i < s.length && seen < maxVisible; ) {
    if (s[i] === '|' && /^\|[0-9]{2}/.test(s.slice(i, i + 3))) {
      out += s.slice(i, i + 3)
      i += 3
      continue
    }
    const cp = s.codePointAt(i)!
    const ch = String.fromCodePoint(cp)
    out += ch
    seen++
    i += ch.length
  }
  out = out.replace(/(\|[0-9]{2})+$/, '').trim()
  return visibleLength(out) === 0 ? '' : out
}

/** Pads or cuts pipe-coded text to exactly `width` visible cells. */
export function fitPipe(text: string, width: number): string {
  const len = visibleLength(text)
  if (len <= width) return text + ' '.repeat(width - len)
  let out = ''
  let seen = 0
  for (let i = 0; i < text.length && seen < width; ) {
    if (text[i] === '|' && /^\|[0-9]{2}/.test(text.slice(i, i + 3))) {
      out += text.slice(i, i + 3)
      i += 3
      continue
    }
    const ch = String.fromCodePoint(text.codePointAt(i)!)
    out += ch
    seen++
    i += ch.length
  }
  return out
}
