// The matrix-screen logo: "LATENT SPACE" in the big block font, ice
// gradient and drop shadow. Generated rather than stored so it can never drift.

import { bigText, bigWidth } from './font'

const WORD = 'LATENT SPACE'

/** Width of the full logo in cells. */
export const LOGO_WIDTH = bigWidth(WORD)

/** The logo as pipe-coded lines, `null` when it is wider than `width`. */
export function logo(width: number): string[] | null {
  return LOGO_WIDTH > width ? null : bigText(WORD)
}
