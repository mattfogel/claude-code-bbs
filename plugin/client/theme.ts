// The board's palette: the 16 VGA color registers reprogrammed, the way a
// DOS board set its colors. Screens keep writing |05, |13 and friends; this
// table decides what they look like, users' own pipe colors included.
//
// Roles the screens give the numbers: 5 dark accent and lightbar background,
// 13 accent, 15 bright, 7 text, 8 frames and rules, 11 handles, 10 success,
// 12 new and errors, 14 warnings. `bun scripts/palettes.ts` compares others.

import { VGA } from '../shared/pipe'

const reprogram = (registers: Record<number, number>): readonly number[] => VGA.map((rgb, i) => registers[i] ?? rgb)

/** ACiD Ice: cyan and deep blue on black. */
export const ACID_ICE = reprogram({ 5: 0x0000aa, 13: 0x55ffff, 11: 0x55aaff, 8: 0x3a4a6a })

export const THEME = ACID_ICE
