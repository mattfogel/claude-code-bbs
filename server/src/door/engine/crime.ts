// Robbing and stealing at ports (research 01 §4.6), and busts.

import { ROB, TURN_COSTS, portSells, type Commodity, type PortClass } from '../../../../plugin/shared/door/data'
import type { DoorEvent } from '../../../../plugin/shared/door/protocol'
import { freeHolds } from './trade'
import type { PlayerRec, PortRec } from './types'

export type CrimeOutcome = { ok: true; events: DoorEvent[]; busted: boolean } | { ok: false; message: string }

const no = (message: string): CrimeOutcome => ({ ok: false, message })

/** Credits you can rob without raising the odds: 3 × experience. */
export const safeRob = (exp: number) => ROB.robExpMult * exp
/** Holds you can steal without raising the odds: experience / 30. */
export const safeSteal = (exp: number) => Math.floor(exp / ROB.stealExpDiv)

/**
 * The chance of a bust: 1 in 50 at or under the safe amount, then +10% for
 * each hold (steal) or each 1,000 credits (rob) over it, to a certainty.
 */
export function bustOdds(kind: 'rob' | 'steal', amount: number, exp: number): number {
  const over = Math.max(0, amount - (kind === 'rob' ? safeRob(exp) : safeSteal(exp)))
  if (over <= 0) return ROB.bustChance
  return Math.min(1, ROB.bustChance + ROB.bustRamp * (over / (kind === 'rob' ? ROB.robRampCredits : 1)))
}

/** Whether a port still remembers `ts` as a bust (ms): it forgets after ROB.bustClearDays. */
export const bustRemembered = (ts: number, now: number) => now - ts < ROB.bustClearDays * 86_400_000

/** Holds lost to a bust, before the floor. */
export function bustHolds(kind: 'rob' | 'steal', amount: number, holds: number, repeat: boolean): number {
  if (repeat) return Math.floor(holds * ROB.repeatBustHolds)
  return kind === 'steal' ? Math.max(1, Math.ceil(amount * ROB.stealBustHolds)) : Math.floor(amount / ROB.robBustCreditsPerHold)
}

/** Takes holds off the ship (never below ROB.minHolds), shedding cargo that no longer fits. Returns the holds lost. */
function loseHolds(p: PlayerRec, n: number): number {
  const before = p.ship.holds
  p.ship.holds = Math.max(ROB.minHolds, before - Math.max(0, n))
  let over = p.ship.cargo[0] + p.ship.cargo[1] + p.ship.cargo[2] + p.ship.colonists - p.ship.holds
  for (const i of [2, 1, 0] as const) {
    const cut = Math.min(Math.max(0, over), p.ship.cargo[i])
    p.ship.cargo[i] -= cut
    over -= cut
  }
  if (over > 0) p.ship.colonists = Math.max(0, p.ship.colonists - over)
  return before - p.ship.holds
}

function bust(p: PlayerRec, kind: 'rob' | 'steal', amount: number, repeat: boolean, events: DoorEvent[]): CrimeOutcome {
  const expLost = Math.floor(p.exp * ROB.bustExpLoss)
  p.exp -= expLost
  if (repeat) p.align += ROB.repeatBustAlign
  const holdsLost = loseHolds(p, bustHolds(kind, amount, p.ship.holds, repeat))
  events.push({ kind: 'busted', expLost, holdsLost })
  return { ok: true, events, busted: true }
}

function check(p: PlayerRec, port: PortRec | undefined): CrimeOutcome | undefined {
  if (p.align > ROB.maxAlign) return no('You haven\'t the stomach for it. Only the truly crooked rob ports.')
  if (!port || port.class < 1 || port.class > 8) return no('There is no ordinary port in this sector to rob.')
  if (p.turns < TURN_COSTS.rob) return no('You don\'t have any turns left.')
  return undefined
}

/**
 * Robs a port for `credits`. Costs a turn. Over what the port holds you get
 * what is there and nobody is busted; otherwise the bust odds apply. `repeat`
 * is true when this port's last buster was you, within the memory window: that
 * always busts. Mutates `p` and `port`; the caller records busts.
 */
export function rob(p: PlayerRec, port: PortRec | undefined, credits: number, repeat: boolean, rand: () => number): CrimeOutcome {
  const bad = check(p, port)
  if (bad) return bad
  if (!Number.isInteger(credits) || credits < 1) return no('Rob how much?')
  p.turns -= TURN_COSTS.rob
  const events: DoorEvent[] = []
  if (repeat) return bust(p, 'rob', credits, true, events)
  if (credits > port!.credits) {
    const take = port!.credits
    port!.credits = 0
    p.credits += take
    events.push({ kind: 'robbed', credits: take })
    return { ok: true, events, busted: false }
  }
  if (rand() < bustOdds('rob', credits, p.exp)) return bust(p, 'rob', credits, false, events)
  port!.credits -= credits
  p.credits += credits
  events.push({ kind: 'robbed', credits })
  return { ok: true, events, busted: false }
}

/** Steals product the port is selling ("on dock"). Same rules as `rob`. */
export function steal(p: PlayerRec, port: PortRec | undefined, commodity: Commodity, qty: number, repeat: boolean, rand: () => number): CrimeOutcome {
  const bad = check(p, port)
  if (bad) return bad
  if (![0, 1, 2].includes(commodity)) return no('Steal what?')
  if (!Number.isInteger(qty) || qty < 1) return no('Steal how much?')
  if (!portSells(port!.class as PortClass, commodity)) return no('That port has none of that on its dock.')
  const room = freeHolds(p)
  if (room < 1) return no('Your holds are full.')
  if (qty > room) return no(`You only have room for ${room}.`)
  p.turns -= TURN_COSTS.steal
  const events: DoorEvent[] = []
  if (repeat) return bust(p, 'steal', qty, true, events)
  const stock = port!.amount[commodity]
  if (qty > stock) {
    port!.amount[commodity] = 0
    p.ship.cargo[commodity] += stock
    events.push({ kind: 'stolen', commodity, qty: stock })
    return { ok: true, events, busted: false }
  }
  if (rand() < bustOdds('steal', qty, p.exp)) return bust(p, 'steal', qty, false, events)
  port!.amount[commodity] -= qty
  p.ship.cargo[commodity] += qty
  events.push({ kind: 'stolen', commodity, qty })
  return { ok: true, events, busted: false }
}
