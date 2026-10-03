import { describe, expect, it } from 'vitest'

import { PROSE, allProse, fill } from '../../plugin/shared/door/prose'
import { visibleLength } from '../../plugin/shared/pipe'

// The source game's names must never appear in prose.
const FORBIDDEN = /federation|fedspace|ferrengi|stardock|underground|trade ?wars|zyrain|clausewitz|nelson|grimy/i

describe('server prose', () => {
  const lines = allProse()

  it('has lines', () => {
    expect(lines.length).toBeGreaterThan(40)
  })

  it('fits 78 columns as typed', () => {
    for (const l of lines) expect(visibleLength(l), l).toBeLessThanOrEqual(78)
  })

  it('still fits when every field is filled with a long name or number', () => {
    for (const l of lines) {
      const filled = fill(l, new Proxy({}, { get: (_, k) => (k === 'ship' ? 'x'.repeat(30) : /^(name|by|marshal|owner|password|alias|class)$/.test(String(k)) ? 'Wintermute-Zero1' : /^[cdw]$/.test(String(k)) ? '250' : '99,999,999') }) as Record<string, string>)
      expect(visibleLength(filled), l).toBeLessThanOrEqual(78)
    }
  })

  it('keeps to pipe codes 01-15 and never names the source game', () => {
    for (const l of lines) {
      for (const m of l.matchAll(/\|(\d\d)/g)) expect(Number(m[1])).toBeLessThanOrEqual(15)
      expect(l).not.toMatch(FORBIDDEN)
    }
  })

  it('fills fields', () => {
    expect(fill(PROSE.beaconSet, { sector: 12 })).toContain('12')
  })
})
