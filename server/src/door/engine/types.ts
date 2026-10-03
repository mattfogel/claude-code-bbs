// Plain records the engine works on. The Universe DO loads them from SQLite,
// hands them to the engine, and writes back what changed.

import type { Commodity, PortClassId } from '../../../../plugin/shared/door/data'
import type { ShipState } from '../../../../plugin/shared/door/protocol'

export type Triple = [number, number, number]

/** A port. `amount` is the "Trading" column: stock on hand for what it sells, room left for what it buys. */
export type PortRec = {
  sector: number
  name: string
  class: PortClassId
  /** Productivity per commodity; capacity = 10 × productivity. 0 for specials. */
  prod: Triple
  /** Signed: + the port sells, − it buys. */
  mcic: Triple
  amount: Triple
  credits: number
  /** ms of the last regeneration settlement. */
  updatedAt: number
}

export type PlayerRec = {
  id: number
  name: string
  sector: number
  prevSector: number
  turns: number
  /** ms the turn count was last settled at. */
  turnsAt: number
  credits: number
  bank: number
  exp: number
  align: number
  timesBlownUp: number
  commissioned: boolean
  ship: ShipState
  avoids: number[]
  lastSeenLog: number
  /** Bumped on every write; seeds the PRNG with (season seed, id, actions). */
  actions: number
  /** UTC day number of the last daily-login award. */
  lastDay: number
  createdAt: number
}

/** One commodity's haggle in progress. */
export type Negotiation = {
  commodity: Commodity
  side: 'sell' | 'buy'
  qty: number
  /** The hidden true price for qty units; drifts toward the bids. */
  basis: number
  /** The port's current figure. */
  offer: number
  /** Counters the player has made. */
  n: number
  /** Middle rounds this port allows before its final offer. */
  middle: number
  /** Middle rounds used. */
  used: number
  final: boolean
}

/** A dock: what is left to trade, in order, and the haggle in progress. */
export type TradeSession = {
  sector: number
  /** ms of the last activity; the session expires HAGGLE_TTL_MS after it. */
  at: number
  /** The player's action counter at the dock, for seeding. */
  seq: number
  todo: { commodity: Commodity; side: 'sell' | 'buy' }[]
  active?: Negotiation
}
