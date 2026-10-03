import { describe, expect, it } from 'vitest'
import { bigText } from '../../plugin/client/font'
import { DRYDOCK, HAVEN, TITLE, TITLE_NARROW } from '../../plugin/shared/door/art'
import { RANKS_EVIL } from '../../plugin/shared/door/data'
import { DRIFTER_NAMES, HALLUCINATION_NAMES, PORT_NAMES, SHIP_NAME_IDEAS } from '../../plugin/shared/door/names'
import {
  APPRAISALS, COUNTER, DEATH, fill, FINAL_OFFER, HELP, INSTRUCTIONS, INTRO, LOG_TEMPLATES, OLD_SAL, REFUSALS, TRADE_XP_LINES,
} from '../../plugin/shared/door/text'
import { visibleLength } from '../../plugin/shared/pipe'
import { portNamePool } from '../../server/src/door/engine/portnames'

const SPECIALS = ['Haven', 'Meridian', 'Tycho Reach', 'Drydock Anchorage', 'Terra', 'Overfit Prime']

describe('names', () => {
  it('has at least 620 unique, short, plain port names', () => {
    expect(PORT_NAMES.length).toBeGreaterThanOrEqual(620)
    expect(new Set(PORT_NAMES.map(n => n.toLowerCase())).size).toBe(PORT_NAMES.length)
    for (const n of PORT_NAMES) {
      expect(n.length, n).toBeLessThanOrEqual(18)
      expect(n, n).toMatch(/^[A-Za-z][A-Za-z' -]*[A-Za-z']$/)
    }
  })

  it('keeps the special names out of the port list', () => {
    const lower = new Set(PORT_NAMES.map(n => n.toLowerCase()))
    for (const s of SPECIALS) expect(lower.has(s.toLowerCase()), s).toBe(false)
  })

  it('has the NPC and ship-name lists', () => {
    for (const [list, n] of [[DRIFTER_NAMES, 60], [HALLUCINATION_NAMES, 40], [SHIP_NAME_IDEAS, 40]] as const) {
      expect(list.length).toBe(n)
      expect(new Set(list).size).toBe(n)
    }
  })

  it('draws ports from the list without replacement, deterministically', () => {
    const a = portNamePool(400, 7)
    expect(a).toEqual(portNamePool(400, 7))
    expect(a).not.toEqual(portNamePool(400, 8))
    expect(new Set(a).size).toBe(400)
    for (const n of a) expect(PORT_NAMES).toContain(n)
  })

  it('tops up with generated names when the list runs out', () => {
    const big = portNamePool(1900, 3)
    expect(big.length).toBe(1900)
    expect(new Set(big).size).toBe(1900)
    expect(new Set(big.slice(0, PORT_NAMES.length))).toEqual(new Set(PORT_NAMES))
  })
})

describe('text', () => {
  const lines: [string, string][] = []
  const add = (where: string, xs: readonly string[]) => xs.forEach((l, i) => lines.push([`${where}[${i}]`, l]))
  add('REFUSALS', REFUSALS)
  add('FINAL_OFFER', FINAL_OFFER)
  add('COUNTER', COUNTER)
  add('TRADE_XP_LINES', Object.values(TRADE_XP_LINES).map(l => fill(l, { n: 5 })))
  add('APPRAISALS', APPRAISALS)
  add('OLD_SAL.greeting', OLD_SAL.greeting)
  add('OLD_SAL.rude', OLD_SAL.rude)
  add('OLD_SAL.fortunes', OLD_SAL.fortunes)
  add('OLD_SAL.sold', [
    fill(OLD_SAL.traceSold, { name: 'X'.repeat(20), sector: 5000 }),
    fill(OLD_SAL.passwordSold, { password: 'X'.repeat(12) }),
  ])
  add('DEATH.podded', DEATH.podded)
  add('DEATH.destroyed', DEATH.destroyed.map(l => fill(l, { ship: 'X'.repeat(30), n: 999_999 })))
  add('DEATH.outForTheDay', DEATH.outForTheDay)
  add('INTRO', INTRO)
  INSTRUCTIONS.forEach((page, i) => add(`INSTRUCTIONS[${i}]`, page))
  for (const [menu, help] of Object.entries(HELP)) add(`HELP.${menu}`, help)

  it('keeps every line within 78 columns', () => {
    for (const [where, l] of lines) expect(visibleLength(l), where).toBeLessThanOrEqual(78)
  })

  it('has enough of each kind', () => {
    expect(REFUSALS.length).toBeGreaterThanOrEqual(8)
    expect(FINAL_OFFER.length).toBe(3)
    expect(COUNTER.length).toBe(3)
    expect(APPRAISALS.length).toBe(10)
    expect(OLD_SAL.fortunes.length).toBe(10)
    expect(INSTRUCTIONS.length).toBeGreaterThanOrEqual(6)
    for (const page of INSTRUCTIONS) expect(page.length).toBeLessThanOrEqual(18)
  })

  it('has help for every menu', () => {
    for (const menu of ['command', 'computer', 'port', 'class0', 'drydock', 'outfitter', 'shipwright', 'bank', 'tavern', 'marshal', 'sal', 'backroom', 'fighters', 'mines']) {
      expect(HELP[menu]?.length, menu).toBeGreaterThan(0)
    }
    const keys = (menu: string) => HELP[menu].map(l => /<\|11(.)\|08>/.exec(l)?.[1])
    expect(keys('command')).toEqual(expect.arrayContaining(['M', 'D', 'P', 'S', 'C', 'I', '/', 'V', 'E', 'L', 'A', 'F', 'H', 'U', 'T', 'Q', '?']))
    expect(keys('command')).toEqual(expect.arrayContaining(['B', 'R', 'Y']))
    expect(keys('computer')).toEqual(['F', 'I', 'K', 'R', 'V', 'X', 'L', 'G', 'E', 'T', 'Q'])
    expect(keys('drydock')).toEqual(['S', 'O', 'B', 'M', 'T', 'L', 'Q'])
    expect(keys('port')).toEqual(expect.arrayContaining(['T', 'R', 'S', 'Q']))
    expect(keys('outfitter')).toEqual(expect.arrayContaining(['B', 'D', 'M', 'L', 'R']))
    expect(keys('marshal')).toEqual(['A', 'P', 'W', 'C', 'Q'])
    expect(keys('sal')).toEqual(['T', 'P', 'F', 'S', 'Q'])
    expect(keys('backroom')).toEqual(['H', 'C', 'A', 'Q'])
    expect(keys('fighters')).toEqual(['D', 'T', 'Q'])
    expect(keys('mines')).toEqual(['C', 'D', 'T', 'S', 'Q'])
  })

  it('has the phase 2 keys live, not marked later', () => {
    const later = (menu: string, key: string) => HELP[menu].find(l => l.includes(`<|11${key}|08>`))?.includes('(later)')
    for (const key of ['A', 'F', 'H', 'B', 'R', 'Y']) expect(later('command', key), key).toBe(false)
    for (const key of ['R', 'S']) expect(later('port', key), key).toBe(false)
    expect(later('class0', 'L')).toBe(false)
    expect(later('drydock', 'M')).toBe(false)
    for (const key of ['S', 'B']) expect(later('tavern', key), key).toBe(false)
    // The planets and corporations are still to come.
    for (const key of ['L', 'U', 'T']) expect(later('command', key), key).toBe(true)
  })

  it('writes the conflict pages and drops the "later" asides', () => {
    expect(INSTRUCTIONS.length).toBeGreaterThanOrEqual(8)
    const all = INSTRUCTIONS.flat().map(l => l.replace(/\|[0-9]{2}/g, '')).join('\n')
    for (const word of ['FIGHTING', 'FIGHTERS, MINES AND BEACONS', 'CONCORD SPACE AND THE LAW', 'Marshal', 'Old Sal', 'Back Room']) expect(all, word).toContain(word)
    expect(all).not.toContain('(later)')
    expect(all).not.toContain('and later worse')
  })

  it('fills log templates', () => {
    expect(fill(LOG_TEMPLATES.announce, { name: 'Case', text: 'hi {name}' })).toBe('|14Case|07: hi {name}')
    expect(fill(LOG_TEMPLATES.raid, { sector: 12, n: 3 })).not.toMatch(/\{/)
    const long = { name: 'X'.repeat(20), ship: 'X'.repeat(30), sector: 5000, n: 40, planet: 'X'.repeat(20), port: 'X'.repeat(18), sectors: 5000, date: '2326-10-02', class: 'X'.repeat(20) }
    for (const [k, t] of Object.entries(LOG_TEMPLATES)) {
      if (k === 'announce') continue
      expect(fill(t, long), k).not.toMatch(/\{[a-z]+\}/i)
    }
  })

  it('never gives the evil ladder a faction\'s name', () => {
    expect(RANKS_EVIL[0]).not.toBe('Drifter')
  })
})

describe('art', () => {
  const within = (art: readonly string[], cols: number, rows: number) => {
    expect(art.length).toBeLessThanOrEqual(rows)
    for (const l of art) expect(visibleLength(l)).toBeLessThanOrEqual(cols)
  }

  it('fits its boxes', () => {
    within(TITLE, 78, 12)
    within(TITLE_NARROW, 40, 12)
    within(DRYDOCK, 78, 5)
    within(HAVEN, 78, 3)
  })

  it('matches the board font', () => {
    const has = (art: readonly string[], word: string) => {
      for (const row of bigText(word)) expect(art.some(l => l.includes(row)), word).toBe(true)
    }
    has(TITLE, 'HYPERPLANE')
    has(TITLE_NARROW, 'HYPER')
    has(TITLE_NARROW, 'PLANE')
    has(DRYDOCK, 'DRYDOCK')
    has(HAVEN, 'HAVEN')
  })
})
