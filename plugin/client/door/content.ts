// Where the door screens get their art and prose: shared/door/art.ts and
// text.ts, picked to fit the pane. The one place to change if those move.

import { visibleLength } from '../../shared/pipe'
import { TITLE, TITLE_NARROW } from '../../shared/door/art'
import { HELP as MENU_HELP, INSTRUCTIONS as PAGES, INTRO } from '../../shared/door/text'
import { GAME } from '../../shared/door/data'

const widest = (lines: readonly string[]) => Math.max(0, ...lines.map(visibleLength))

/** The title art that fits `width`, else the name in plain text. */
export function titleArt(width: number): string[] {
  if (widest(TITLE) <= width) return [...TITLE]
  if (widest(TITLE_NARROW) <= width) return [...TITLE_NARROW]
  return [`|11${GAME.title}`]
}

/** The main prompt's ? screen, the computer's, and the Drydock's. */
export const HELP: string[] = [...(MENU_HELP.command ?? [])]
export const COMPUTER_HELP: string[] = [...(MENU_HELP.computer ?? [])]
export const DRYDOCK_HELP: string[] = [...(MENU_HELP.drydock ?? [])]

/** The title's Instructions, as pages: the intro, then the manual. */
export const INSTRUCTION_PAGES: string[][] = [[...INTRO], ...PAGES.map(p => [...p])]
