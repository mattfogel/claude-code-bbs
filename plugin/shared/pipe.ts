// Pipe-code and MCI handling shared by the mod and the server.
//
// Colors follow Obv/2 / Renegade: |00-|15 set the foreground, |16-|23 set the
// background (16 + n), and |24-|31 the bright "iCE color" backgrounds the
// system's own art uses. %XX fields are MCI substitutions (%UN handle, ...).
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
 * `palette` maps the 16 color numbers to RGB (the board's theme).
 */
export function parsePipe(text: string, ctx: MciContext = {}, fg = 7, bg = 0, palette: readonly number[] = VGA): Cell[] {
  const out: Cell[] = []
  const push = (s: string) => {
    for (const ch of s) out.push({ ch: isCellChar(ch) ? ch : '?', fg: palette[fg], bg: palette[bg] })
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
        else if (n <= 31) bg = n - 16 // |16-|23 classic, |24-|31 iCE (bright) backgrounds
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
  let s = cleanCodes(String(raw).normalize('NFC'))
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

/** The rules every piece of user text goes through, whitespace aside. */
function cleanCodes(s: string): string {
  // Removing one code can join the characters around it into another (`||Ab00` -> `|00`), so go until nothing changes.
  for (let prev = ''; prev !== s; ) {
    prev = s
    s = cleanCodesOnce(s)
  }
  return s
}

function cleanCodesOnce(s: string): string {
  s = s.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '') // CSI sequences, before ESC itself goes
  s = s.replace(FORBIDDEN, ' ')
  s = s.replace(/\|([0-9]{2})/g, (m, n) => (Number(n) >= 1 && Number(n) <= 15 ? m : ''))
  s = s.replace(/\|[A-Za-z][A-Za-z0-9]/g, '') // |MN, |U1 and other prompt MCIs
  return s.replace(/%[A-Z]{2}/g, '')
}

/**
 * Cleans a multi-line post body by the same rules as sanitizeUserText, but
 * keeps each line's own spacing (ASCII art, quotes, indentation). Trailing
 * spaces go, runs of blank lines fold to one, and the body is cut to
 * `maxLines` lines and `maxChars` characters. Returns '' when nothing is visible.
 */
export function sanitizeUserBody(raw: string, maxChars: number, maxLines: number): string {
  const lines = String(raw)
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '  ')
    .split('\n')
    .map(line => cleanCodes(line).replace(/(\|[0-9]{2})+\s*$/, '').trimEnd())
  const out: string[] = []
  for (const line of lines) {
    const blank = stripPipe(line).trim() === ''
    if (blank && (out.length === 0 || out[out.length - 1] === '')) continue
    out.push(blank ? '' : line)
  }
  while (out.length && out[out.length - 1] === '') out.pop()
  let body = out.slice(0, maxLines).join('\n')
  if (body.length > maxChars) body = body.slice(0, maxChars).replace(/\|[0-9]?$/, '').trimEnd()
  return stripPipe(body).trim() ? body : ''
}

/**
 * Word-wraps one pipe-coded line to `width` cells. Each continuation line
 * starts with the color code in force where it begins, so lines can be
 * drawn on their own. Words longer than `width` are split.
 */
export function wrapPipe(line: string, width: number): string[] {
  const w = Math.max(1, width)
  const out: string[] = []
  let cur = ''
  let curLen = 0
  let color = ''
  let lineColor = ''
  let breakAt = -1 // index in `cur` just after the last space
  let breakLen = 0
  let breakColor = ''
  const emit = (text: string) => out.push(/^\|[0-9]{2}/.test(text) ? text : lineColor + text)
  for (let i = 0; i < line.length; ) {
    const code = /^\|[0-9]{2}/.exec(line.slice(i, i + 3))
    if (code) {
      cur += code[0]
      color = code[0]
      i += 3
      continue
    }
    const ch = String.fromCodePoint(line.codePointAt(i)!)
    i += ch.length
    if (curLen === w) {
      if (ch === ' ') {
        emit(cur)
        lineColor = color
        cur = ''
        curLen = 0
        breakAt = -1
        continue
      }
      if (breakAt > 0) {
        emit(cur.slice(0, breakAt).trimEnd())
        const rest = cur.slice(breakAt)
        lineColor = breakColor
        cur = rest
        curLen = curLen - breakLen
      } else {
        emit(cur)
        lineColor = color
        cur = ''
        curLen = 0
      }
      breakAt = -1
    }
    cur += ch
    curLen++
    if (ch === ' ') {
      breakAt = cur.length
      breakLen = curLen
      breakColor = color
    }
  }
  emit(cur)
  return out
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
