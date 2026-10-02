// Big block text, TheDraw style: a 5-pixel-tall font drawn with half blocks,
// two pixel rows per text row. Every cell carries a foreground and a
// background color, so each pixel row gets its own step of the gradient and
// the letters cast a one-pixel drop shadow down and to the right.
// Original glyphs; every heading and the logo come from here.

const GLYPHS: Record<string, string[]> = {
  A: ['.##.', '#..#', '####', '#..#', '#..#'],
  B: ['###.', '#..#', '###.', '#..#', '###.'],
  C: ['.###', '#...', '#...', '#...', '.###'],
  D: ['###.', '#..#', '#..#', '#..#', '###.'],
  E: ['####', '#...', '###.', '#...', '####'],
  F: ['####', '#...', '###.', '#...', '#...'],
  G: ['.###', '#...', '#.##', '#..#', '.###'],
  H: ['#..#', '#..#', '####', '#..#', '#..#'],
  I: ['###', '.#.', '.#.', '.#.', '###'],
  J: ['..##', '...#', '...#', '#..#', '.##.'],
  K: ['#..#', '#.#.', '##..', '#.#.', '#..#'],
  L: ['#...', '#...', '#...', '#...', '####'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#'],
  N: ['#..#', '##.#', '#.##', '#..#', '#..#'],
  O: ['.##.', '#..#', '#..#', '#..#', '.##.'],
  P: ['###.', '#..#', '###.', '#...', '#...'],
  Q: ['.##.', '#..#', '#..#', '#.#.', '.#.#'],
  R: ['###.', '#..#', '###.', '#.#.', '#..#'],
  S: ['.###', '#...', '.##.', '...#', '###.'],
  T: ['####', '.##.', '.##.', '.##.', '.##.'],
  U: ['#..#', '#..#', '#..#', '#..#', '.##.'],
  V: ['#..#', '#..#', '#..#', '.##.', '.##.'],
  W: ['#...#', '#...#', '#.#.#', '##.##', '#...#'],
  X: ['#..#', '#..#', '.##.', '#..#', '#..#'],
  Y: ['#..#', '#..#', '.##.', '.##.', '.##.'],
  Z: ['####', '...#', '.##.', '#...', '####'],
  '0': ['.##.', '#.##', '##.#', '#..#', '.##.'],
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['###.', '...#', '.##.', '#...', '####'],
  '3': ['###.', '...#', '.##.', '...#', '###.'],
  '4': ['#..#', '#..#', '####', '...#', '...#'],
  '5': ['####', '#...', '###.', '...#', '###.'],
  '6': ['.##.', '#...', '###.', '#..#', '.##.'],
  '7': ['####', '...#', '..#.', '.#..', '.#..'],
  '8': ['.##.', '#..#', '.##.', '#..#', '.##.'],
  '9': ['.##.', '#..#', '.###', '...#', '.##.'],
  ' ': ['..', '..', '..', '..', '..'],
  "'": ['#', '#', '.', '.', '.'],
  '!': ['#', '#', '#', '.', '#'],
  '?': ['###.', '...#', '.##.', '....', '.#..'],
  '-': ['...', '...', '###', '...', '...'],
  '.': ['.', '.', '.', '.', '#'],
  ':': ['.', '#', '.', '#', '.'],
  '&': ['.#..', '#.#.', '.#..', '#.#.', '.#.#'],
  '/': ['...#', '..#.', '.#..', '#...', '#...'],
}

/** Gradient steps, one per pixel row (5) top to bottom, as color numbers. */
export type Gradient = readonly [number, number, number, number, number]

/** ACiD-style ice ramp: white, cyan, sky, blue, deep blue. */
export const ICE_RAMP: Gradient = [15, 13, 11, 9, 1]
const SHADOW = 8

/** Pixel rows of `text`, letters one pixel apart; unknown characters are blank. */
function pixels(text: string): string[] {
  const rows = ['', '', '', '', '']
  ;[...text.toUpperCase()].forEach((ch, i) => {
    const glyph = GLYPHS[ch] ?? GLYPHS[' ']
    for (let r = 0; r < 5; r++) rows[r] += (i ? '.' : '') + glyph[r]
  })
  return rows
}

/** Cells across `text` takes as big text, shadow included. */
export function bigWidth(text: string): number {
  return pixels(text)[0].length + 1
}

/**
 * `text` as three rows of pipe-coded big text: letters in `gradient`, a drop
 * shadow one pixel down and right. Uses bright backgrounds (|24-|31).
 */
export function bigText(text: string, gradient: Gradient = ICE_RAMP): string[] {
  const px = pixels(text)
  const w = px[0].length + 1
  // Color of each pixel (6 rows: the shadow reaches one row below), -1 for none.
  const color = (r: number, c: number): number => {
    if (r < 5 && px[r][c] === '#') return gradient[r]
    if (r > 0 && c > 0 && px[r - 1]?.[c - 1] === '#') return SHADOW
    return -1
  }
  const out: string[] = []
  for (let row = 0; row < 3; row++) {
    let line = ''
    let last = ''
    for (let c = 0; c < w; c++) {
      const top = color(row * 2, c)
      const bot = color(row * 2 + 1, c)
      let cell: string
      if (top < 0 && bot < 0) cell = '|16 '
      else if (bot < 0) cell = `|${pad2(top)}|16▀`
      else if (top < 0) cell = `|${pad2(bot)}|16▄`
      else if (top === bot) cell = `|${pad2(top)}|16█`
      else cell = `|${pad2(top)}|${pad2(16 + bot)}▀`
      // Drop codes that repeat the previous cell's.
      const codes = cell.slice(0, -1)
      line += codes === last ? cell.slice(-1) : cell
      last = codes
    }
    out.push(line + '|16')
  }
  return out
}

const pad2 = (n: number) => String(n).padStart(2, '0')
