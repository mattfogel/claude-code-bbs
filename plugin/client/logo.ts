// The matrix-screen logo: "LATENT SPACE" in a 4x5 pixel font drawn with
// half blocks (two pixel rows per text row), colored as a vertical gradient.
// Original art, generated rather than stored so it can never drift.

const FONT: Record<string, string[]> = {
  L: ['#...', '#...', '#...', '#...', '####'],
  A: ['.##.', '#..#', '####', '#..#', '#..#'],
  T: ['####', '.##.', '.##.', '.##.', '.##.'],
  E: ['####', '#...', '###.', '#...', '####'],
  N: ['#..#', '##.#', '#.##', '#..#', '#..#'],
  S: ['.###', '#...', '.##.', '...#', '###.'],
  P: ['###.', '#..#', '###.', '#...', '#...'],
  C: ['.###', '#...', '#...', '#...', '.###'],
  ' ': ['..', '..', '..', '..', '..'],
}

/** Pixel rows for `word`, letters one pixel apart. */
function pixels(word: string): string[] {
  const rows = ['', '', '', '', '']
  ;[...word].forEach((ch, i) => {
    const glyph = FONT[ch] ?? FONT[' ']
    for (let r = 0; r < 5; r++) rows[r] += (i ? '.' : '') + glyph[r]
  })
  return rows
}

/** Text rows of half blocks for two pixel rows each. */
function halfBlocks(px: string[]): string[] {
  const out: string[] = []
  for (let r = 0; r < px.length; r += 2) {
    const top = px[r]
    const bottom = px[r + 1] ?? ''
    let line = ''
    for (let c = 0; c < top.length; c++) {
      const t = top[c] === '#'
      const b = bottom[c] === '#'
      line += t && b ? '█' : t ? '▀' : b ? '▄' : ' '
    }
    out.push(line)
  }
  return out
}

/** Gradient colors for the logo's rows, top first. */
export const LOGO_GRADIENT = ['|15', '|13', '|05']

/** The logo as pipe-coded lines, `null` when it is wider than `width`. */
export function logo(width: number): string[] | null {
  const rows = halfBlocks(pixels('LATENT SPACE'))
  if (rows[0].length > width) return null
  return rows.map((row, i) => LOGO_GRADIENT[i] + row)
}

/** Width of the full logo in cells. */
export const LOGO_WIDTH = halfBlocks(pixels('LATENT SPACE'))[0].length
