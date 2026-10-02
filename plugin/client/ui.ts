// Drawing helpers every screen shares: frames, lightbar items, feed-text
// cleaning and relative times. Pipe-coded strings in, pipe-coded strings out.

import { sanitizeUserText, stripPipe, visibleLength } from '../shared/pipe'

export type Item = { key: string; label: string }

export const center = (text: string, width: number) => ' '.repeat(Math.max(0, Math.floor((width - visibleLength(text)) / 2))) + text

/** Text from the feed, sanitized again before it is drawn (never trust the wire). */
export const clean = (text: unknown, max: number) => sanitizeUserText(String(text ?? ''), max)
export const plain = (text: unknown, max: number) => stripPipe(clean(text, max))

export function header(title: string, width: number): string[] {
  const label = `|05▒▓|13█|16|15 ${title} |13█|05▓▒`
  const rule = '─'.repeat(Math.max(0, width - visibleLength(label) - 1))
  return [`${label} |08${rule}`, '']
}

export function footer(keys: string, width: number): string {
  return `|08${'─'.repeat(2)} ${keys} |08${'─'.repeat(Math.max(0, width - visibleLength(keys) - 4))}`
}

export const hotkey = (item: Item, isSel: boolean) =>
  isSel ? `|21|15 ${item.label} |16` : `|08[|15${item.label[0]}|08]|07${item.label.slice(1)}`

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
