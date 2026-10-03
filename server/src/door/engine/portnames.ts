// Port names. Drawn without replacement from the original list in
// plugin/shared/door/names.ts, shuffled by the seed. A universe with more
// ports than the list (5000 sectors) tops up with names built from syllables.

import { PORT_NAMES } from '../../../../plugin/shared/door/names'
import { rng } from '../../../../plugin/shared/door/nav'

const FIRST = ['Ar', 'Bel', 'Cor', 'Dal', 'Ess', 'Fen', 'Gal', 'Hal', 'Ist', 'Jor', 'Kel', 'Lum', 'Mar', 'Nor', 'Ost', 'Pel', 'Quor', 'Ras', 'Sel', 'Tor', 'Ul', 'Vey', 'Wen', 'Yar', 'Zan']
const MIDDLE = ['a', 'e', 'i', 'o', 'u', 'ae', 'ia', 'or', 'en', 'ul']
const LAST = ['dris', 'mere', 'thos', 'van', 'rek', 'lin', 'cyr', 'dun', 'gate', 'holm', 'mont', 'reach', 'vale', 'wick', 'ford', 'stead']
const SUFFIX = ['', '', '', ' Station', ' Depot', ' Exchange', ' Post', ' Yard', ' Market', ' Relay', ' Spindle', ' Hub']

/** A deterministic pool of `count` distinct names: the list first, then generated ones. */
export function portNamePool(count: number, seed: number): string[] {
  const next = rng(seed)
  // Fisher-Yates over a copy of the list; take what we need.
  const list = [...PORT_NAMES]
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1))
    ;[list[i], list[j]] = [list[j], list[i]]
  }
  const out = list.slice(0, Math.max(0, count))
  if (out.length >= count) return out

  const seen = new Set(PORT_NAMES)
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)]
  for (let tries = 0; out.length < count && tries < count * 50; tries++) {
    const name = pick(FIRST) + pick(MIDDLE) + pick(LAST) + pick(SUFFIX)
    if (seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  // Last resort for very large universes: numbered names stay distinct.
  for (let i = 1; out.length < count; i++) {
    const name = `Outpost ${i}`
    if (!seen.has(name)) out.push(name)
  }
  return out
}
