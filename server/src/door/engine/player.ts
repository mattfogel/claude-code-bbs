// Characters: creation, experience and ranks, net worth, the snapshot.

import { SHIPS, START_SHIP, rankOf, rankTitle, shipCost, type DoorConfig } from '../../../../plugin/shared/door/data'
import type { DoorEvent, Equipment, PlayerSnapshot } from '../../../../plugin/shared/door/protocol'
import type { PlayerRec } from './types'

export function emptyEquipment(): Equipment {
  return { contactMines: 0, limpets: 0, beacons: 0, seeds: 0, crackers: 0, deadman: 0, cloaks: 0, probes: 0, disruptors: 0, photons: 0, scanner: 'none', planetScanner: false, lens: false, jump: 0 }
}

/** A new trader in sector 1: a Freetrader, starting credits, holds and fighters, full turns. */
export function newPlayer(id: number, name: string, shipName: string, config: DoorConfig, now: number): PlayerRec {
  const spec = SHIPS[START_SHIP]
  return {
    id,
    name,
    sector: 1,
    prevSector: 1,
    turns: config.turnsPerDay,
    turnsAt: now,
    credits: config.startCredits,
    bank: 0,
    exp: 0,
    align: 0,
    timesBlownUp: 0,
    commissioned: false,
    ship: {
      type: START_SHIP,
      name: shipName,
      holds: Math.min(spec.maxHolds, config.startHolds),
      cargo: [0, 0, 0],
      colonists: 0,
      fighters: Math.min(spec.maxFighters, config.startFighters),
      shields: 0,
      equipment: emptyEquipment(),
    },
    avoids: [],
    lastSeenLog: 0,
    actions: 0,
    lastDay: Math.floor(now / 86_400_000),
    createdAt: now,
  }
}

/** Adds experience and alignment (floored at 0 experience), reporting a new rank. */
export function gainXp(p: PlayerRec, exp: number, align: number, reason: string, events: DoorEvent[]) {
  if (!exp && !align) return
  const before = rankTitle(p.exp, p.align)
  const beforeRank = rankOf(p.exp)
  p.exp = Math.max(0, p.exp + exp)
  p.align += align
  events.push({ kind: 'xp', exp, align, reason })
  if (rankOf(p.exp) !== beforeRank || rankTitle(p.exp, p.align) !== before) events.push({ kind: 'rank', title: rankTitle(p.exp, p.align) })
}

/** Credits on hand and in the bank plus the hull's price. */
export function netWorth(p: Pick<PlayerRec, 'credits' | 'bank' | 'ship'>): number {
  return p.credits + p.bank + shipCost(SHIPS[p.ship.type] ?? SHIPS[START_SHIP])
}

export function toSnapshot(p: PlayerRec, season: string, config: DoorConfig, requestsToday: number): PlayerSnapshot {
  return {
    v: 1,
    season,
    id: p.id,
    name: p.name,
    sector: p.sector,
    prevSector: p.prevSector,
    turns: p.turns,
    turnsMax: config.turnsPerDay,
    credits: p.credits,
    bank: p.bank,
    experience: p.exp,
    alignment: p.align,
    timesBlownUp: p.timesBlownUp,
    commissioned: p.commissioned,
    ship: p.ship,
    avoids: p.avoids,
    lastSeenLog: p.lastSeenLog,
    requestsToday,
  }
}
