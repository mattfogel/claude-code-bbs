// Port prices (research 01 §3.1), the haggle (§4.2, §4.3), stock
// regeneration (§2.3) and Class 0 goods (§3.2).

import {
  CAPACITY_PER_PRODUCTIVITY, CLASS0, DAY_VAR_MAX, HAGGLE_DRIFT, HAGGLE_FRIVOLOUS, HAGGLE_MAX_MIDDLE, HAGGLE_TOLERANCE, OFFER_MCIC_DIVISOR,
  PORT_REGEN_MAX_PER_VISIT, PRICE_BASE, PRICE_EXP_DIVISOR, PRICE_EXP_FLOOR, PRICE_FACTOR, PRICE_MIN_UNIT, class0Price, holdsCost, tradeXp,
  type Commodity,
} from '../../../../plugin/shared/door/data'
import { hashSeed, randInt, rng } from '../../../../plugin/shared/door/nav'
import type { Negotiation, PortRec } from './types'

export const DAY_MS = 86_400_000

/** Whole UTC days since the Unix epoch. */
export const dayNumber = (ms: number) => Math.floor(ms / DAY_MS)

/** The seeded daily price swing, 0..DAY_VAR_MAX, per commodity. */
export function dayVar(seed: number, day: number, c: Commodity): number {
  return randInt(rng(hashSeed(seed, 'dayvar', day, c)), 0, DAY_VAR_MAX)
}

export const capacity = (port: PortRec, c: Commodity) => port.prod[c] * CAPACITY_PER_PRODUCTIVITY

/** The fraction of capacity in the "Trading" column. */
export const fillOf = (port: PortRec, c: Commodity) => {
  const cap = capacity(port, c)
  return cap > 0 ? port.amount[c] / cap : 0
}

export type PriceInput = { c: Commodity; mcic: number; fill: number; exp: number; dayVar: number }

/**
 * The hidden true price per unit:
 * unit = base + s·dayVar − expAdj − MCIC·F·fill, s = +1 when the port buys.
 */
export function unitPrice(p: PriceInput): number {
  const s = p.mcic < 0 ? 1 : -1
  const expAdj = p.exp >= PRICE_EXP_FLOOR ? 0 : (s * (PRICE_EXP_FLOOR - p.exp)) / PRICE_EXP_DIVISOR
  let unit = PRICE_BASE[p.c] + s * p.dayVar - expAdj - p.mcic * PRICE_FACTOR[p.c] * p.fill
  while (unit < PRICE_MIN_UNIT) unit += 1
  return unit
}

/** The opening offer per unit: (1 + MCIC/1000) × unit. The figure for q units is round(unitOffer × q). */
export function openingUnit(p: PriceInput): number {
  return (1 + p.mcic / OFFER_MCIC_DIVISOR) * unitPrice(p)
}

export const tolerance = (mcic: number, n: number) => Math.abs(mcic) / HAGGLE_TOLERANCE / n

/** Starts a haggle for qty units at the opening figure. */
export function openNegotiation(p: PriceInput, qty: number, middleSeed: number): Negotiation {
  return {
    commodity: p.c,
    side: p.mcic < 0 ? 'sell' : 'buy',
    qty,
    basis: unitPrice(p) * qty,
    offer: Math.round(openingUnit(p) * qty),
    n: 0,
    middle: randInt(rng(middleSeed), 0, HAGGLE_MAX_MIDDLE),
    used: 0,
    final: false,
  }
}

export type BidResult =
  /** Done: trade qty at `price`. `best` is what the port would have settled for. */
  | { kind: 'accept'; price: number; best: number; xp: number }
  | { kind: 'counter'; price: number; final: boolean }
  /** A frivolous bid on a selling port: re-prompt, nothing changes. */
  | { kind: 'insult'; price: number }
  | { kind: 'refused' }

/** How far `price` landed from `best`, as a fraction (0 = the best the port would take). */
export function offBest(side: 'sell' | 'buy', price: number, best: number): number {
  if (best <= 0) return 0
  return side === 'sell' ? Math.max(0, (best - price) / best) : Math.max(0, (price - best) / best)
}

/**
 * One bid in a haggle; mutates `neg`. `side` is the player's: 'sell' means the
 * port buys (the player wants more), 'buy' means it sells (the player wants less).
 */
export function bid(neg: Negotiation, mcic: number, price: number): BidResult {
  const selling = neg.side === 'sell'
  const accept = (p: number): BidResult => ({ kind: 'accept', price: p, best: Math.round(neg.basis), xp: tradeXp(offBest(neg.side, p, Math.round(neg.basis))) })
  // Taking the port's figure, or asking less than it (paying more), closes at once.
  if (selling ? price <= neg.offer : price >= neg.offer) return accept(price)
  if (!selling && neg.n === 0 && price < neg.basis / HAGGLE_FRIVOLOUS) return { kind: 'insult', price: neg.offer }
  const n = neg.n + 1
  const tol = tolerance(mcic, n)
  if (selling ? price > neg.basis * (1 + tol) : price < neg.basis * (1 - tol)) return { kind: 'refused' }
  // Within the port's real price: done at the bid.
  if (selling ? price <= neg.basis : price >= neg.basis) return accept(price)
  if (neg.final) return { kind: 'refused' }
  neg.n = n
  neg.basis = (1 - HAGGLE_DRIFT) * neg.basis + HAGGLE_DRIFT * price
  // The port moves halfway from its last figure toward its (drifted) price.
  neg.offer = Math.round(neg.offer + (neg.basis - neg.offer) / 2)
  if (neg.used < neg.middle) neg.used++
  else neg.final = true
  return { kind: 'counter', price: neg.offer, final: neg.final }
}

/** Settles lazy regeneration up to `now`: portRegenPct of capacity a day, capped per visit. Mutates and returns the port. */
export function regenPort(port: PortRec, now: number, regenPct: number): PortRec {
  const days = (now - port.updatedAt) / DAY_MS
  if (days <= 0) return port
  for (const c of [0, 1, 2] as const) {
    const cap = capacity(port, c)
    if (!cap) continue
    const add = Math.min((cap * regenPct * days) / 100, (cap * PORT_REGEN_MAX_PER_VISIT) / 100)
    port.amount[c] = Math.min(cap, Math.floor(port.amount[c] + add))
  }
  port.updatedAt = now
  return port
}

/** Class 0 prices on a UTC day. */
export function class0Prices(day: number): { holdBase: number; fighter: number; shield: number } {
  return { holdBase: class0Price(CLASS0.holdBase, day), fighter: class0Price(CLASS0.fighter, day), shield: class0Price(CLASS0.shield, day) }
}

/** The next hold's price (what the Class 0 screen shows). */
export function nextHoldPrice(day: number, current: number): number {
  return holdsCost(class0Prices(day).holdBase, current, 1)
}
