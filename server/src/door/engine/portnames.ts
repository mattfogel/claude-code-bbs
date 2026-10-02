// Port names. The plan is an original list of about 600 in
// plugin/shared/door/names.ts; until that lands, names are built from
// syllables here. Swap `portNamePool` for the list when it exists.

import { rng } from '../../../../plugin/shared/door/nav'

const FIRST = ['Ar', 'Bel', 'Cor', 'Dal', 'Ess', 'Fen', 'Gal', 'Hal', 'Ist', 'Jor', 'Kel', 'Lum', 'Mar', 'Nor', 'Ost', 'Pel', 'Quor', 'Ras', 'Sel', 'Tor', 'Ul', 'Vey', 'Wen', 'Yar', 'Zan']
const MIDDLE = ['a', 'e', 'i', 'o', 'u', 'ae', 'ia', 'or', 'en', 'ul']
const LAST = ['dris', 'mere', 'thos', 'van', 'rek', 'lin', 'cyr', 'dun', 'gate', 'holm', 'mont', 'reach', 'vale', 'wick', 'ford', 'stead']
const SUFFIX = ['', '', '', ' Station', ' Depot', ' Exchange', ' Post', ' Yard', ' Market', ' Relay', ' Spindle', ' Hub']

/** A deterministic pool of distinct names, at least `count` long. */
export function portNamePool(count: number, seed: number): string[] {
  const next = rng(seed)
  const seen = new Set<string>()
  const out: string[] = []
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)]
  for (let tries = 0; out.length < count && tries < count * 50; tries++) {
    const name = pick(FIRST) + pick(MIDDLE) + pick(LAST) + pick(SUFFIX)
    if (seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  // Fallback for very large universes: numbered names stay distinct.
  for (let i = 1; out.length < count; i++) out.push(`Outpost ${i}`)
  return out
}
