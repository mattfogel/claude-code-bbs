// Draw-in at modem speed: a new screen arrives the way ANSI did over a
// 14.4k line, left to right and top to bottom, with the cursor at the front.
// Blank cells cost nothing (ANSI moved the cursor past them), so art-heavy
// rows take longer than empty ones.

import type { Cell } from '../shared/pipe'

/** Characters per second at a modem speed: 10 bits per byte on the wire. */
export const cps = (baud: number) => baud / 10

/** The modem speeds the config offers; 0 is off. */
export const BAUD_RATES = [2400, 9600, 14400, 28800, 57600] as const

const isInk = (c: Cell, black: number) => c.ch !== ' ' || c.bg !== black

/** Cells that take time to send. */
export function inkCount(rows: Cell[][], black: number): number {
  let n = 0
  for (const row of rows) for (const c of row) if (isInk(c, black)) n++
  return n
}

/**
 * The screen as it looks once `sent` ink cells have arrived: the rest
 * blank, and the cursor (a lower half block) on the next cell to come.
 */
export function reveal(rows: Cell[][], sent: number, black: number, cursor: number): Cell[][] {
  let left = Math.max(0, Math.floor(sent))
  let cursorPlaced = false
  return rows.map(row =>
    row.map(c => {
      if (left > 0) {
        if (isInk(c, black)) left--
        return c
      }
      if (!cursorPlaced && isInk(c, black)) {
        cursorPlaced = true
        return { ch: '▄', fg: cursor, bg: black }
      }
      return { ch: ' ', fg: c.fg, bg: black }
    }),
  )
}
