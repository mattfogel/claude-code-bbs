// The Marshal's Office, Old Sal and the Back Room (research 02 §2.4, §2.6,
// §2.7): commissions, rewards, hits, passwords, strikes and aliases.

import { AWARDS, BACKROOM, LAST_LIGHT } from '../../../../plugin/shared/door/data'
import { hashSeed, rng } from '../../../../plugin/shared/door/nav'
import { PROSE, fill } from '../../../../plugin/shared/door/prose'
import type { DoorEvent } from '../../../../plugin/shared/door/protocol'
import { OLD_SAL } from '../../../../plugin/shared/door/text'
import { destroyShip } from './combat'
import { deathEvents } from './hazards'
import { gainXp } from './player'
import type { Outcome } from './shop'
import type { PlayerRec } from './types'

const no = (message: string): Outcome => ({ ok: false, message })
const text = (line: string): DoorEvent => ({ kind: 'text', text: line })
const num = (n: number) => n.toLocaleString('en-US')

/** The Marshal's Office admits alignment ≥ -50. */
export const officeOpen = (p: Pick<PlayerRec, 'align'>) => p.align >= AWARDS.marshalOfficeMinAlign
/** The Back Room admits alignment ≤ +100. */
export const backRoomOpen = (p: Pick<PlayerRec, 'align'>) => p.align <= AWARDS.backRoomMaxAlign

/** Applies for a commission: alignment 500 or better sets alignment to 1,000. */
export function applyCommission(p: PlayerRec): Outcome {
  if (!officeOpen(p)) return { ok: true, events: PROSE.office.tooRisky.map(text) }
  if (p.commissioned) return { ok: true, events: [text(PROSE.office.commissionHeld)] }
  if (p.align < AWARDS.commissionApply) {
    return { ok: true, events: [text(PROSE.office.commissionDenied[p.align >= AWARDS.commissionApply / 2 ? 1 : 0])] }
  }
  p.commissioned = true
  p.align = AWARDS.commissionGrant
  return { ok: true, events: PROSE.office.commissionGranted.map(l => text(fill(l, { align: num(p.align) }))) }
}

/** The alignment a reward of `amount` earns (+1 per 1,000), or a hit costs (−1 per 250). */
export const rewardAlign = (amount: number) => Math.floor(amount / AWARDS.rewardAlignPer)
export const hitAlign = (amount: number) => Math.floor(amount / AWARDS.hitAlignPer)

/** Posts a Marshal's reward on an evil trader. Takes the credits and pays the alignment. */
export function postReward(p: PlayerRec, target: Pick<PlayerRec, 'id' | 'name' | 'align'>, amount: number): Outcome {
  if (!officeOpen(p)) return { ok: true, events: PROSE.office.tooRisky.map(text) }
  if (target.id === p.id) return no('You can\'t post a reward on yourself.')
  if (target.align >= 0) return no(PROSE.office.rewardNotEvil)
  if (!Number.isInteger(amount) || amount < BACKROOM.rewardMin) return no(`The least the Marshals will post is ${num(BACKROOM.rewardMin)} credits.`)
  if (amount > p.credits) return no(`You only have ${num(p.credits)} credits on hand.`)
  p.credits -= amount
  const align = rewardAlign(amount)
  p.align += align
  return { ok: true, events: [text(fill(PROSE.office.rewardPosted, { amount: num(amount), name: target.name, align }))] }
}

/** Posts a Back Room hit on anyone. */
export function postHit(p: PlayerRec, target: Pick<PlayerRec, 'id' | 'name'>, amount: number): Outcome {
  if (target.id === p.id) return no('Hire someone else for that.')
  if (!Number.isInteger(amount) || amount < BACKROOM.hitMin) return no(`The least anyone will take a job for is ${num(BACKROOM.hitMin)} credits.`)
  if (amount > p.credits) return no(`You only have ${num(p.credits)} credits on hand.`)
  p.credits -= amount
  const align = hitAlign(amount)
  p.align -= align
  return { ok: true, events: [text(fill(PROSE.backRoom.hitPosted, { amount: num(amount), name: target.name, align }))] }
}

// ---------------------------------------------------------------------------
// Passwords and aliases

/** The Back Room password Old Sal sells a pilot: `adjective noun`, picked by seed per player. */
export function backRoomPassword(seed: number, playerId: number): string {
  const next = rng(hashSeed(seed, 'backroom', playerId))
  const adj = BACKROOM.adjectives[Math.floor(next() * BACKROOM.adjectives.length)]
  const noun = BACKROOM.nouns[Math.floor(next() * BACKROOM.nouns.length)]
  return `${adj} ${noun}`
}

/** Case and spacing do not matter. */
export const passwordMatches = (given: unknown, seed: number, playerId: number) =>
  typeof given === 'string' && given.trim().toLowerCase().replace(/\s+/g, ' ') === backRoomPassword(seed, playerId)

/** A new name costs 1,000 + 10 per experience point, capped. */
export const aliasCost = (exp: number) => Math.min(BACKROOM.aliasMax, BACKROOM.aliasBase + BACKROOM.aliasPerExp * Math.max(0, exp))

/**
 * A wrong password. Strike 1 throws you out, 2 beats you and takes the credits
 * on hand, 3 halves your experience, 4 and up costs you the ship. Strikes
 * count per UTC day. Mutates `p`.
 */
export function strike(p: PlayerRec, day: number, now: number): DoorEvent[] {
  p.strikes = p.strikeDay === day ? (p.strikes ?? 0) + 1 : 1
  p.strikeDay = day
  const n = Math.min(p.strikes, BACKROOM.strikes)
  const events = PROSE.backRoom.strikes[n - 1].map(text)
  if (n === 2) p.credits = 0
  else if (n === 3) p.exp = Math.floor(p.exp / 2)
  else if (n >= 4) {
    const death = destroyShip(p, { now, podTo: p.prevSector })
    events.push(...deathEvents(p, death, p.deadUntil))
  }
  return events
}

// ---------------------------------------------------------------------------
// Old Sal

/** A trace on a trader: costs LAST_LIGHT.traceCost. */
export function trace(p: PlayerRec, target: Pick<PlayerRec, 'name' | 'sector'> | undefined, name: string): Outcome {
  if (p.credits < LAST_LIGHT.traceCost) return no(`Sal wants ${num(LAST_LIGHT.traceCost)} credits for that.`)
  p.credits -= LAST_LIGHT.traceCost
  if (!target) return { ok: true, events: [{ kind: 'bought', what: 'trace', qty: 1, cost: LAST_LIGHT.traceCost }, text(PROSE.sal.traceUnknown)] }
  return {
    ok: true,
    events: [{ kind: 'bought', what: 'trace', qty: 1, cost: LAST_LIGHT.traceCost }, text(fill(OLD_SAL.traceSold, { name: target.name || name, sector: target.sector }))],
  }
}

/** Buying the Back Room password. */
export function buyPassword(p: PlayerRec, seed: number): Outcome {
  if (p.credits < LAST_LIGHT.passwordCost) return no(`Sal wants ${num(LAST_LIGHT.passwordCost)} credits for that.`)
  p.credits -= LAST_LIGHT.passwordCost
  return {
    ok: true,
    events: [{ kind: 'bought', what: 'password', qty: 1, cost: LAST_LIGHT.passwordCost }, text(fill(OLD_SAL.passwordSold, { password: backRoomPassword(seed, p.id) }))],
  }
}

/** Swearing at Sal costs 1 experience and 1 alignment, once a UTC day. */
export function swear(p: PlayerRec, day: number, pick: () => number): DoorEvent[] {
  const events: DoorEvent[] = [text(OLD_SAL.rude[Math.floor(pick() * OLD_SAL.rude.length)])]
  if (p.swearDay === day) {
    events.push(text(PROSE.sal.swearToday))
    return events
  }
  p.swearDay = day
  gainXp(p, AWARDS.swear.exp, AWARDS.swear.align, 'swear', events)
  events.push(text(PROSE.sal.swearPenalty))
  return events
}
