// Drawing helpers every screen shares: frames, lightbar items, feed-text
// cleaning and relative times. Pipe-coded strings in, pipe-coded strings out.

import { fitPipe, sanitizeUserText, stripPipe, visibleLength } from '../shared/pipe'
import { bigText, bigWidth } from './font'

export type Item = { key: string; label: string }

export const center = (text: string, width: number) => ' '.repeat(Math.max(0, Math.floor((width - visibleLength(text)) / 2))) + text

/** Text from the feed, sanitized again before it is drawn (never trust the wire). */
export const clean = (text: unknown, max: number) => sanitizeUserText(String(text ?? ''), max)
export const plain = (text: unknown, max: number) => stripPipe(clean(text, max))

/**
 * What every screen's frame shows besides its own content, set by draw()
 * before it draws a screen: the room it has and who is calling.
 */
export const frame: { w: number; h: number; handle?: string; menu: string; minsLeft?: number } = { w: 80, h: 24, menu: 'Main' }

/** The lightbar: the selected item of any menu or list. */
export const LIGHTBAR = '|29|00'

/** Rows a screen needs before its header is drawn as big block text. */
const BIG_HEADER_MIN_ROWS = 20

/**
 * A screen's title: big gradient block text when the screen has room, else
 * a one-line bar. Ends with a blank line unless `tight`.
 */
export function header(title: string, width: number, tight = false, allowBig = true): string[] {
  const gap = tight ? [] : ['']
  if (allowBig && frame.h >= BIG_HEADER_MIN_ROWS && bigWidth(title) + 1 <= width) return [...bigText(title).map(l => ` ${l}`), ...gap]
  const label = `|01\u2591|09\u2592|11\u2593|16|15 ${title} |11\u2593|09\u2592|01\u2591`
  const rule = '\u2500'.repeat(Math.max(0, width - visibleLength(label) - 1))
  return [`${label} |08${rule}`, ...gap]
}

/**
 * The command prompt at the foot of a screen, Obv/2 style:
 * (handle)─(Menu)─(42 mins)─(keys). Parts drop off, handle first, until it fits.
 */
export function footer(keys: string, width: number, menu: string = frame.menu): string {
  const k = keys.replace(/\|08\[\|15([^|]+)\|08\]\|07/g, '|15$1|07').replace(/\s+$/, '')
  const parts = [
    frame.handle ? `|08(|15${frame.handle}|08)` : '',
    `|08(|13${menu}|08)`,
    frame.minsLeft !== undefined ? `|08(|11${frame.minsLeft} mins|08)` : '',
    `|08(${k}|08)`,
  ]
  const join = (p: string[]) => p.filter(Boolean).join('|08\u2500')
  for (const drop of [[], [0], [0, 2], [0, 1, 2]]) {
    const line = join(parts.map((x, i) => (drop.includes(i) ? '' : x)))
    if (visibleLength(line) <= width) return line
  }
  return join([parts[3]])
}

/**
 * A double-lined box: a title in its top edge (and `right` at its far end),
 * `rows` inside, and a drop shadow unless `shadow` is false.
 */
export function panel(title: string, rows: string[], width: number, opts: { right?: string; shadow?: boolean } = {}): string[] {
  const inner = width - 2
  const shadow = opts.shadow !== false
  const label = `|09\u2561|15 ${title} |09\u255e`
  const right = opts.right ? `|09\u2561|07 ${opts.right} |09\u255e\u2550` : ''
  const fill = Math.max(0, inner - visibleLength(label) - visibleLength(right) - 1)
  const top = `|09\u2554\u2550${label}${'\u2550'.repeat(fill)}${right}\u2557`
  const edge = shadow ? '|08\u2592' : ''
  const body = rows.map(r => `|09\u2551|07${fitPipe(r, inner)}|16|09\u2551${edge}`)
  const bottom = `|09\u255a${'\u2550'.repeat(inner)}\u255d${edge}`
  return shadow ? [top + ' ', ...body, bottom, ` |08${'\u2592'.repeat(width)}`] : [top, ...body, bottom]
}

/** One main-menu entry inside a panel, `width` cells, lit when selected. */
export function panelItem(item: Item, isSel: boolean, width: number): string {
  if (isSel) return fitPipe(`${LIGHTBAR} ${item.key.toUpperCase()}  ${item.label}`, width) + '|16'
  return fitPipe(` |01\u2590|17|15${item.key.toUpperCase()}|16|01\u258c |07${item.label}`, width)
}

export const hotkey = (item: Item, isSel: boolean) =>
  isSel ? `${LIGHTBAR} ${item.label} |16|07` : `|08[|15${item.label[0]}|08]|07${item.label.slice(1)}`

export function ago(ts: string, now: number): string {
  const s = Math.max(0, Math.floor((now - Date.parse(ts)) / 1000))
  if (!Number.isFinite(s)) return '?'
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}


export function pad(lines: string[], n: number): string[] {
  return lines.length >= n ? lines : [...lines, ...Array.from({ length: n - lines.length }, () => '')]
}

/** A bar of `width` cells, `frac` of it solid. */
export function bar(frac: number, width: number): string {
  const n = Math.max(0, Math.min(width, Math.round(frac * width)))
  return `|13${'█'.repeat(n)}|08${'░'.repeat(width - n)}`
}

/** `2026-10-02 18:04` in local time. */
export function stamp(ts: string): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return '?'
  const two = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`
}

/** The lines of a list of `count` rows that fit in `room`, keeping `sel` in view. */
export function windowOf(count: number, sel: number, room: number): [number, number] {
  const r = Math.max(1, room)
  const top = Math.max(0, Math.min(sel - Math.floor(r / 2), count - r))
  return [top, Math.min(count, top + r)]
}
