import { describe, expect, it } from 'vitest'

import { VGA, fitPipe, isCellChar, parsePipe, sanitizeUserText, stripPipe, visibleLength } from '../plugin/shared/pipe'
import { checkPow, decodeStatus, encodeStatus, isValidHandle, leadingZeroBits, normalizeHandle } from '../plugin/shared/protocol'

const ESC = String.fromCharCode(0x1b)
const RLO = String.fromCharCode(0x202e)
const ZWSP = String.fromCharCode(0x200b)

describe('parsePipe', () => {
  it('applies foreground and background codes', () => {
    const cells = parsePipe('|15a|04|17b')
    expect(cells).toEqual([
      { ch: 'a', fg: VGA[15], bg: VGA[0] },
      { ch: 'b', fg: VGA[4], bg: VGA[1] },
    ])
  })

  it('fills MCI fields without parsing what they hold', () => {
    const text = parsePipe('hi %UN @ %LO %ZZ', { UN: '|15mattf', LO: 'NYC' }).map(c => c.ch).join('')
    expect(text).toBe('hi |15mattf @ NYC %ZZ')
  })

  it('draws anything not one cell wide as ?', () => {
    expect(parsePipe('a\u{1F600}中' + ZWSP).map(c => c.ch).join('')).toBe('a???')
    expect(isCellChar('█')).toBe(true)
    expect(isCellChar('́')).toBe(false)
  })
})

describe('sanitizeUserText', () => {
  it('removes escapes, controls and bidi overrides', () => {
    expect(sanitizeUserText(`${ESC}[2Jhi${ESC}[31m there${RLO}!\u0007`, 70)).toBe('hi there !')
  })

  it('keeps |01-|15 only and drops MCI fields', () => {
    expect(sanitizeUserText('|00a|01b|15c|16d|99e|MNf %UN g 100%', 70)).toBe('a|01b|15cdef g 100%')
  })

  it('cuts to the visible length and drops trailing codes', () => {
    const s = sanitizeUserText('|11' + 'x'.repeat(100) + '|12', 70)
    expect(visibleLength(s)).toBe(70)
    expect(s.endsWith('x')).toBe(true)
    expect(sanitizeUserText('|11|12   ', 70)).toBe('')
  })

  it('normalizes to NFC', () => {
    expect(sanitizeUserText('é', 10)).toBe('é')
  })
})

describe('fitPipe', () => {
  it('pads and cuts by visible cells', () => {
    expect(fitPipe('|15ab', 4)).toBe('|15ab  ')
    expect(stripPipe(fitPipe('|15abc|07def', 4))).toBe('abcd')
  })
})

describe('protocol', () => {
  it('validates handles', () => {
    expect(isValidHandle(normalizeHandle('  Zero   Cool '))).toBe(true)
    expect(isValidHandle('x')).toBe(false)
    expect(isValidHandle('-dash')).toBe(false)
    expect(isValidHandle('a'.repeat(17))).toBe(false)
    expect(isValidHandle('ok|15')).toBe(false)
  })

  it('keeps presence coarse', () => {
    expect(encodeStatus({ state: 'tool', tool: 'Bash' })).toBe('tool:Bash')
    expect(encodeStatus({ state: 'tool', tool: 'mcp__acme-internal__deploy' })).toBe('tool')
    expect(decodeStatus('tool:Bash')).toEqual({ state: 'tool', tool: 'Bash' })
    expect(decodeStatus('tool:rm -rf /')).toBeUndefined()
    expect(decodeStatus('working on secret.ts')).toBeUndefined()
  })

  it('counts leading zero bits and checks proof of work', async () => {
    expect(leadingZeroBits(Uint8Array.of(0, 0x10))).toBe(11)
    expect(leadingZeroBits(Uint8Array.of(0x80))).toBe(0)
    let n = 0
    while (!(await checkPow('handle', n.toString(36), 8))) n++
    expect(await checkPow('handle', n.toString(36), 8)).toBe(true)
    expect(await checkPow('handle', 'NOT-VALID', 0)).toBe(false)
  })
})
