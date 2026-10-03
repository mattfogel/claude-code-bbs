// Ship-vs-ship combat (research 02 §3), damage, death and the pod, experience
// and alignment for fighting, Concord protection and the Marshals' patrol.
// Pure functions over plain records; every draw comes from a seeded `rng`.

import {
  AWARDS, COMBAT, MARSHALS, MARSHAL_PATROL_MS, POD, SHIPS, type DoorConfig,
} from '../../../../plugin/shared/door/data'
import { hashSeed, randInt, rng } from '../../../../plugin/shared/door/nav'
import type { DoorEvent, ShipState } from '../../../../plugin/shared/door/protocol'
import { PROSE, fill } from '../../../../plugin/shared/door/prose'
import { DAY_MS } from './prices'
import { emptyEquipment, gainXp } from './player'
import type { PlayerRec } from './types'

// ---------------------------------------------------------------------------
// Resolution

export type Side = { fighters: number; shields: number; odds: number }

export type Resolution = {
  /** Attack power after the random factor. */
  power: number
  shieldsLost: number
  /** Defender fighters destroyed. */
  killed: number
  /** Attacker fighters lost. */
  lost: number
  /** True when the defender has nothing left and power remains. */
  destroyed: boolean
  /** True when the blow was so much bigger than needed that nothing can be salvaged. */
  overkill: boolean
}

/**
 * The reconstructed model (research 02 §3.1): power = sent × attOdds × rand
 * (0.95..1.05); the defender's shields absorb first, then its fighters fall at
 * defOdds; the attacker loses (shields + fighters destroyed) × defOdds /
 * attOdds, at most the number sent.
 */
export function resolveAttack(sent: number, attOdds: number, def: Side, rand: () => number): Resolution {
  const jitter = 1 + COMBAT.jitter * (2 * rand() - 1)
  const power = sent * attOdds * jitter
  const total = def.shields + def.fighters
  const shieldsLost = Math.min(def.shields, Math.floor(power / def.odds))
  const rest = power - shieldsLost * def.odds
  const killed = Math.min(def.fighters, Math.floor(rest / def.odds))
  const needed = total * def.odds
  const destroyed = power > needed
  const lost = Math.min(sent, Math.ceil(((shieldsLost + killed) * def.odds) / attOdds - 1e-9))
  // An empty target needs a single fighter's worth of power, so "enough" is relative to that.
  const overkill = destroyed && power > COMBAT.overkill * Math.max(needed, def.odds)
  return { power, shieldsLost, killed, lost, destroyed, overkill }
}

/** The defender flees when sent > fleeRatio × (fighters + shields). Strictly greater. */
export function wouldFlee(sent: number, def: Pick<Side, 'fighters' | 'shields'>): boolean {
  return sent > COMBAT.fleeRatio * (def.fighters + def.shields)
}

/** Fighters needed to be sure of destroying a fully loaded ship: (max fighters + max shields) × defOdds / attOdds. */
export function safetyRating(shipType: number): number {
  const s = SHIPS[shipType]
  return (s.maxFighters + s.maxShields) * s.defense
}

export type Damage = { shieldsLost: number; fightersLost: number; destroyed: boolean }

/** Applies damage to a ship: shields first, then fighters; anything left destroys the ship. Mutates `ship`. */
export function applyDamage(ship: Pick<ShipState, 'fighters' | 'shields'>, damage: number): Damage {
  const dmg = Math.max(0, Math.floor(damage))
  const shieldsLost = Math.min(ship.shields, dmg)
  ship.shields -= shieldsLost
  const left = dmg - shieldsLost
  const fightersLost = Math.min(ship.fighters, left)
  ship.fighters -= fightersLost
  return { shieldsLost, fightersLost, destroyed: left - fightersLost > 0 }
}

/** What an offensive stack sends at a ship: offensiveRatio × (its max fighters + max shields), at least 1, at most the stack. */
export function offensiveSend(stack: number, shipType: number): number {
  const s = SHIPS[shipType]
  return Math.max(1, Math.min(stack, Math.floor(COMBAT.offensiveRatio * (s.maxFighters + s.maxShields))))
}

// ---------------------------------------------------------------------------
// Experience and alignment for fighting (research 02 §5.2)

/** Victims under this much experience pay out nothing. */
export const MIN_VICTIM_EXP = 10

const sign = (n: number) => (n > 0 ? 1 : n < 0 ? -1 : 0)

/**
 * Experience and alignment for losing `lost` fighters against a ship or a
 * fighter stack whose owner has alignment `theirAlign`. Opposite alignment
 * (good vs evil) and neutral attackers: exp lost/15 (neutral: /25), alignment
 * moves toward "good kills evil". Same alignment: exp lost/35 and the penalty
 * of the same formula at half strength.
 */
export function fightAwards(myAlign: number, theirAlign: number, theirExp: number, lost: number): { exp: number; align: number } {
  if (lost <= 0 || theirExp < MIN_VICTIM_EXP) return { exp: 0, align: 0 }
  const same = sign(myAlign) !== 0 && sign(myAlign) === sign(theirAlign)
  const neutral = sign(myAlign) === 0
  const div = same ? AWARDS.figExpDivisor.same : neutral ? AWARDS.figExpDivisor.neutral : AWARDS.figExpDivisor.opposite
  const align = same ? -(theirAlign / 10_000) * lost : -(theirAlign / 5_000) * lost
  return { exp: Math.floor(lost / div), align: Math.trunc(align) }
}

/** Podding (or destroying) a trader: a share of the victim's experience, and of its alignment with the sign flipped. */
export function podAwards(victimExp: number, victimAlign: number): { exp: number; align: number } {
  if (victimExp < MIN_VICTIM_EXP) return { exp: 0, align: 0 }
  return { exp: Math.floor(AWARDS.podExpShare * victimExp), align: Math.trunc(-AWARDS.podAlignShare * victimAlign) }
}

// ---------------------------------------------------------------------------
// Death

const SKIFF = 2

export const nextMidnight = (now: number) => (Math.floor(now / DAY_MS) + 1) * DAY_MS

export type DeathResult = {
  /** Out of action until tomorrow. */
  fatal: boolean
  /** Credits on hand that were lost with the ship. */
  creditsLost: number
  expLost: number
  /** The destroyed ship's name. */
  shipName: string
}

/** A pod: 5 holds, nothing else. */
export function podShip(): ShipState {
  const equipment = emptyEquipment()
  equipment.scanner = 'density'
  return { type: POD, name: 'Escape Pod', holds: SHIPS[POD].initHolds, cargo: [0, 0, 0], colonists: 0, fighters: 0, shields: 0, equipment }
}

/** True if this death keeps the pilot out until tomorrow. */
export function isFatal(p: PlayerRec, today: number): boolean {
  const deaths = p.deathDay === today ? p.deaths ?? 0 : 0
  return p.ship.type === POD || p.ship.type === SKIFF || deaths >= COMBAT.maxDeathsPerDay
}

/**
 * The ship is destroyed. A pod goes to `podTo` and the pilot flies on (losing
 * 10% experience); dying in a pod or a Skiff, or a third death in a UTC day,
 * costs half the experience and alignment and keeps the pilot out until
 * 00:00 UTC. Cargo, fighters, shields, equipment, credits on hand and any
 * limpet are lost; the bank is kept. Mutates `p`.
 */
export function destroyShip(p: PlayerRec, o: { now: number; podTo: number; noExpLoss?: boolean }): DeathResult {
  const today = Math.floor(o.now / DAY_MS)
  const fatal = isFatal(p, today)
  const result: DeathResult = { fatal, creditsLost: p.credits, expLost: 0, shipName: p.ship.name }
  const from = p.sector
  p.deaths = (p.deathDay === today ? p.deaths ?? 0 : 0) + 1
  p.deathDay = today
  p.timesBlownUp++
  p.credits = 0
  p.limpet = undefined
  p.paid = undefined
  p.ship = podShip()
  if (fatal) {
    result.expLost = Math.floor(p.exp * COMBAT.deathExpLoss)
    p.exp -= result.expLost
    p.align -= Math.trunc(p.align * COMBAT.deathAlignLoss)
    p.deadUntil = nextMidnight(o.now)
    p.sector = 1
    p.prevSector = 1
  } else {
    result.expLost = o.noExpLoss ? 0 : Math.floor(p.exp * COMBAT.podExpLoss)
    p.exp -= result.expLost
    p.sector = o.podTo
    p.prevSector = from
  }
  return result
}

/**
 * Where an escape pod lands after a kill: a random walk of 3 to 20 hops that
 * never enters a sector `unsafe` says holds hostile fighters, stopping at the
 * first one it cannot avoid. Avoids are ignored.
 */
export function safePodPath(warps: number[][], from: number, unsafe: (sector: number) => boolean, rand: () => number): number {
  const hops = randInt(rand, COMBAT.podHops[0], COMBAT.podHops[1])
  let at = from
  for (let i = 0; i < hops; i++) {
    const options = (warps[at] ?? []).filter(s => !unsafe(s))
    if (!options.length) break
    at = options[Math.floor(rand() * options.length)]
  }
  return at
}

/** Where a fleeing ship lands: a random adjacent sector, or where it is when none leads out. */
export function fleeTo(warps: number[][], from: number, rand: () => number): number {
  const options = warps[from] ?? []
  return options.length ? options[Math.floor(rand() * options.length)] : from
}

// ---------------------------------------------------------------------------
// Concord Space and the Marshals

/** Protected: alignment ≥ 0, experience under concordMaxExp, fewer than the config's fighter limit. */
export function isProtected(p: Pick<PlayerRec, 'align' | 'exp' | 'ship'>, config: Pick<DoorConfig, 'concordFighterLimit'>): boolean {
  return p.align >= 0 && p.exp < COMBAT.concordMaxExp && p.ship.fighters < config.concordFighterLimit
}

/** Where each Marshal sits: a Concord sector picked by seed from the patrol slot (a pure function of seed and time). */
export function marshalSectors(seed: number, now: number, concord: readonly number[]): number[] {
  const slot = Math.floor(now / MARSHAL_PATROL_MS)
  return MARSHALS.map((_, i) => concord[randInt(rng(hashSeed(seed, 'marshal', slot, i)), 0, concord.length - 1)])
}

/** Indexes into MARSHALS of the ones in `sector`. */
export function marshalsAt(seed: number, now: number, concord: readonly number[], sector: number): number[] {
  const where = marshalSectors(seed, now, concord)
  const out: number[] = []
  where.forEach((s, i) => s === sector && out.push(i))
  return out
}

/** A pilot who crossed a Marshal or attacked in Concord Space: the ship is destroyed, −10 alignment, −10% experience. Mutates `p`. */
export function marshalPunish(p: PlayerRec, marshalName: string, now: number, events: DoorEvent[]): DeathResult {
  const exp = Math.floor(p.exp * COMBAT.marshalExpLoss)
  for (const line of PROSE.concordPunish) events.push({ kind: 'text', text: fill(line, { marshal: marshalName, ship: p.ship.name, exp }) })
  gainXp(p, -exp, -COMBAT.marshalAlignLoss, 'concord', events)
  return destroyShip(p, { now, podTo: p.prevSector, noExpLoss: true })
}

/** An evil pilot in a Marshal's Cruiser who ends a move where Commodore Vale or High Marshal Teague sit. Returns that Marshal's name. */
export function turncoatMarshal(p: Pick<PlayerRec, 'align' | 'ship'>, here: readonly number[]): string | undefined {
  if (p.ship.type !== 9 || p.align >= 0) return undefined
  const i = here.find(m => (COMBAT.turncoatMarshals as readonly number[]).includes(m))
  return i === undefined ? undefined : MARSHALS[i].name
}
