import { describe, expect, it } from 'vitest'

import {
  ALIGN_WORDS, CITADEL_COSTS, COMMODITIES, ITEMS, PLANET_CLASSES, PLANET_CLASS_KEYS, PORT_CLASSES, RANKS_EVIL, RANKS_GOOD, SHIPS, START_SHIP,
  alignWord, class0Price, holdsCost, itemMax, rankOf, rankTitle, shipCost, tradeXp,
} from '../../plugin/shared/door/data'
import { DOOR_COMMANDS, DOOR_COMMAND_PHASE, doorMapKey, doorNewsKey } from '../../plugin/shared/door/protocol'
import { courseTurns, hashSeed, isAdjacent, plotCourse, randInt, rng } from '../../plugin/shared/door/nav'

// Research 02 §1: base cost by ship id.
const COSTS: Record<number, number> = {
  1: 41_300, 2: 15_950, 3: 100_800, 4: 88_500, 5: 163_500, 6: 63_600, 7: 51_950, 8: 33_400,
  9: 329_000, 10: 79_000, 11: 61_300, 12: 72_500, 13: 42_250, 14: 47_500, 15: 63_600, 16: 539_000,
  17: 31_900, 18: 67_100, 19: 139_000,
}

describe('ships', () => {
  it('prices every hull at the sum of its parts, matching the research', () => {
    expect(shipCost(SHIPS[START_SHIP])).toBe(41_300)
    for (const [id, cost] of Object.entries(COSTS)) expect(shipCost(SHIPS[Number(id)])).toBe(cost)
  })

  it('indexes ships by id and keeps the pod and raiders off the market', () => {
    SHIPS.forEach((s, i) => expect(s.id).toBe(i))
    expect(SHIPS).toHaveLength(20)
    expect(SHIPS.filter(s => s.buyable).map(s => s.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])
    for (const s of SHIPS) expect(s.defense).toBe(s.offense)
  })

  it('limits items by hull', () => {
    const holo = ITEMS.find(i => i.id === 'holo')!
    const photon = ITEMS.find(i => i.id === 'photon')!
    expect(itemMax(holo, SHIPS[1])).toBe(1)
    expect(itemMax(holo, SHIPS[3])).toBe(0)
    expect(itemMax(photon, SHIPS[3])).toBe(10)
    expect(itemMax(photon, SHIPS[1])).toBe(0)
    expect(new Set(ITEMS.map(i => i.key)).size).toBe(ITEMS.length)
  })
})

describe('tables', () => {
  it('has the right shapes', () => {
    expect(COMMODITIES).toEqual(['Compute', 'Data', 'Weights'])
    expect(Object.values(PORT_CLASSES).reduce((a, c) => a + c.share, 0)).toBe(100)
    expect(PLANET_CLASS_KEYS.reduce((a, k) => a + PLANET_CLASSES[k].genesisWeight, 0)).toBe(100)
    for (const k of PLANET_CLASS_KEYS) expect(CITADEL_COSTS[k]).toHaveLength(6)
    expect(CITADEL_COSTS.T.reduce((a, l) => a + l.days, 0)).toBe(43)
    expect(DOOR_COMMANDS.every(c => DOOR_COMMAND_PHASE[c])).toBe(true)
    expect(doorMapKey('s1')).toBe('door/s1/map.json')
    expect(doorNewsKey('s1')).toBe('door/s1/news.json')
  })

  it('prices holds and the Class 0 cycle', () => {
    // Research 02 §2.2: 20 → 75 holds at B = 173 costs 61,215.
    expect(holdsCost(173, 20, 55)).toBe(61_215)
    expect(class0Price([151, 249], 0)).toBe(151)
    expect(class0Price([151, 249], 9)).toBe(249)
    expect(class0Price([151, 249], 18)).toBe(151)
  })

  it('awards trade experience by tier', () => {
    expect(tradeXp(0)).toBe(5)
    expect(tradeXp(0.005)).toBe(2)
    expect(tradeXp(0.015)).toBe(1)
    expect(tradeXp(0.05)).toBe(0)
  })
})

describe('ranks and alignment', () => {
  it('ranks at powers of two', () => {
    expect(RANKS_GOOD).toHaveLength(23)
    expect(RANKS_EVIL).toHaveLength(23)
    expect(rankOf(0)).toBe(0)
    expect(rankOf(1)).toBe(0)
    expect(rankOf(2)).toBe(1)
    expect(rankOf(3)).toBe(1)
    expect(rankOf(1024)).toBe(10)
    expect(rankOf(4_194_303)).toBe(21)
    expect(rankOf(4_194_304)).toBe(22)
    expect(rankOf(1e12)).toBe(22)
    expect(rankTitle(0, 0)).toBe(RANKS_GOOD[0])
    expect(rankTitle(4, -1)).toBe(RANKS_EVIL[2])
  })

  it('names alignment in bands of 125', () => {
    expect(ALIGN_WORDS).toHaveLength(16)
    expect(alignWord(0)).toBe('Neutral')
    expect(alignWord(124)).toBe('Neutral')
    expect(alignWord(-124)).toBe('Neutral')
    expect(alignWord(125)).toBe(ALIGN_WORDS[8])
    expect(alignWord(-125)).toBe(ALIGN_WORDS[6])
    expect(alignWord(1000)).toBe(ALIGN_WORDS[15])
    expect(alignWord(99_999)).toBe(ALIGN_WORDS[15])
    expect(alignWord(-875)).toBe(ALIGN_WORDS[0])
    expect(alignWord(-99_999)).toBe(ALIGN_WORDS[0])
  })
})

describe('plotCourse', () => {
  // 1 → 2 → 3 → 4, 1 → 5 → 4, 4 → 1 one-way back, 6 isolated, 3 ↔ 2.
  const warps = [[], [2, 5], [3], [2, 4], [1], [4], []]

  it('finds the shortest path over directed warps', () => {
    expect(plotCourse(warps, 1, 4)).toEqual([1, 5, 4])
    expect(plotCourse(warps, 4, 3)).toEqual([4, 1, 2, 3])
    expect(plotCourse(warps, 2, 2)).toEqual([2])
    expect(plotCourse({ v: 1, season: 's1', sectors: 6, warps, concord: [], lanes: [], generatedAt: '' }, 1, 4)).toEqual([1, 5, 4])
  })

  it('respects one-way warps', () => {
    expect(isAdjacent(warps, 4, 1)).toBe(true)
    expect(isAdjacent(warps, 1, 4)).toBe(false)
    expect(plotCourse(warps, 5, 1)).toEqual([5, 4, 1])
  })

  it('routes around avoids, and gives null when they block every route', () => {
    expect(plotCourse(warps, 1, 4, [5])).toEqual([1, 2, 3, 4])
    expect(plotCourse(warps, 1, 4, [5, 3])).toBeNull()
    expect(plotCourse(warps, 1, 5, [5])).toEqual([1, 5])
  })

  it('gives null when unreachable or too far', () => {
    expect(plotCourse(warps, 1, 6)).toBeNull()
    expect(plotCourse(warps, 1, 99)).toBeNull()
    expect(plotCourse(warps, 4, 3, [], 2)).toBeNull()
    expect(plotCourse(warps, 4, 3, [], 3)).toEqual([4, 1, 2, 3])
  })

  it('counts turns', () => {
    expect(courseTurns([1, 5, 4], 3)).toBe(6)
    expect(courseTurns([1], 3)).toBe(0)
  })
})

describe('rng', () => {
  it('is deterministic and in range', () => {
    const a = rng(hashSeed('s1', 7, 42))
    const b = rng(hashSeed('s1', 7, 42))
    const xs = Array.from({ length: 100 }, a)
    expect(Array.from({ length: 100 }, b)).toEqual(xs)
    expect(xs.every(x => x >= 0 && x < 1)).toBe(true)
    expect(rng(hashSeed('s1', 7, 43))()).not.toBe(xs[0])
    expect(hashSeed('a', 1)).not.toBe(hashSeed('a1'))
    const r = rng(1)
    for (let i = 0; i < 200; i++) {
      const n = randInt(r, 3, 5)
      expect(n >= 3 && n <= 5 && Number.isInteger(n)).toBe(true)
    }
  })
})
