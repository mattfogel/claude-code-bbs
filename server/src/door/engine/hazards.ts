// What happens when a ship enters a sector (research 02 §4.1, §4.2): NavHaz,
// a limpet, contact mines, then fighters (offensive, defensive or toll). Also
// the toll and surrender rules for a ship held by sector fighters.

import { COMBAT, SHIPS } from '../../../../plugin/shared/door/data'
import { PROSE, fill } from '../../../../plugin/shared/door/prose'
import type { DoorEvent, StopReason } from '../../../../plugin/shared/door/protocol'
import { applyDamage, destroyShip, offensiveSend, resolveAttack, type DeathResult } from './combat'
import type { Deploy, MailDraft, PlayerRec } from './types'

/** A sector's hazards as stored: NavHaz % and the deploy rows there. */
export type SectorHazards = { sector: number; concord: boolean; navhaz: number; deploys: Deploy[] }

export type EnterResult = {
  events: DoorEvent[]
  stop?: StopReason
  /** Set when the ship was destroyed. */
  death?: DeathResult
  /** Reports for the owners of what the ship ran into. */
  mail: MailDraft[]
  /** Deploy rows whose count or toll changed (count 0 means delete). */
  changed: Deploy[]
}

const iso = (ms: number) => new Date(ms).toISOString()

/** The fighter stack in a deploy list, if any. */
export const fightersOf = (deploys: readonly Deploy[]): Deploy | undefined => deploys.find(d => d.kind === 'fighters' && d.count > 0)

/** True if another owner's fighters hold the ship in `sector` (a paid toll, or a surrender, lets it go). */
export function heldBy(p: Pick<PlayerRec, 'id' | 'paid'>, stack: Deploy | undefined, sector: number): boolean {
  return !!stack && stack.count > 0 && stack.ownerId !== p.id && p.paid !== sector
}

/** Credits a toll stack asks of a ship passing through. */
export const tollOf = (stack: Pick<Deploy, 'count'>) => stack.count * COMBAT.tollPerFighter

/** The events for a ship that was destroyed, `by` killing it if anyone did. */
export function deathEvents(p: Pick<PlayerRec, 'sector'>, d: DeathResult, deadUntil: number | undefined, by?: string): DoorEvent[] {
  if (d.fatal) return [{ kind: 'dead', until: iso(deadUntil ?? 0), ...(by ? { by } : {}) }]
  return [{ kind: 'podded', sector: p.sector, ...(by ? { by } : {}) }]
}

/**
 * Applies a sector's entry hazards to `p`, who has just arrived (`p.sector`
 * is the sector, `p.prevSector` where the ship came from). Mutates the ship,
 * the deploy rows and `p.limpet`/`p.paid`. Stops at the first reason to stop;
 * a destroyed ship is turned into a pod (or out for the day) here.
 */
export function enterSector(p: PlayerRec, h: SectorHazards, rand: () => number, now: number): EnterResult {
  const r: EnterResult = { events: [], mail: [], changed: [] }
  const touch = (d: Deploy) => {
    if (!r.changed.includes(d)) r.changed.push(d)
  }
  const mail = (playerId: number, text: string) => r.mail.push({ playerId, from: PROSE.mail.fightersFrom, text })
  const sector = h.sector
  const stops = new Set<StopReason>()
  p.paid = undefined

  const destroyed = (by?: string) => {
    const death = destroyShip(p, { now, podTo: p.prevSector })
    r.death = death
    r.events.push(...deathEvents(p, death, p.deadUntil, by))
    return r
  }
  const finish = () => {
    // The most telling reason wins.
    for (const s of ['fighters', 'toll', 'mines', 'navhaz'] as const) {
      if (stops.has(s)) {
        r.stop = s
        break
      }
    }
    return r
  }

  // 1. NavHaz: hits with chance haz%, for 10 × haz% damage. Never in Concord Space.
  if (!h.concord && h.navhaz > 0 && rand() * 100 < h.navhaz) {
    const damage = COMBAT.navhazDamagePerPct * h.navhaz
    r.events.push({ kind: 'navhaz', damage })
    stops.add('navhaz')
    if (applyDamage(p.ship, damage).destroyed) {
      r.stop = 'navhaz'
      return destroyed()
    }
  }

  // 2. A limpet clamps on (it replaces any earlier one).
  const limpets = h.deploys.find(d => d.kind === 'limpet' && d.count > 0 && d.ownerId !== p.id)
  if (limpets) {
    limpets.count--
    touch(limpets)
    p.limpet = { id: limpets.ownerId, name: limpets.ownerName }
    r.events.push({ kind: 'limpet' })
    r.mail.push({ playerId: limpets.ownerId, from: PROSE.mail.fightersFrom, text: fill(PROSE.mail.limpet, { name: p.name, sector }) })
    stops.add('mines')
  }

  // 3. Contact mines: half of each foreign stack goes off (rounded down), 20 damage apiece.
  let detonated = 0
  for (const d of h.deploys) {
    if (d.kind !== 'contact' || d.count < 1 || d.ownerId === p.id) continue
    const n = Math.floor(d.count * COMBAT.mineDetonate)
    if (!n) continue
    d.count -= n
    touch(d)
    detonated += n
    r.mail.push({ playerId: d.ownerId, from: PROSE.mail.fightersFrom, text: fill(PROSE.mail.minesHit, { n, name: p.name, sector }) })
  }
  if (detonated) {
    const damage = detonated * COMBAT.contactMineDamage
    r.events.push({ kind: 'mines', detonated, damage })
    stops.add('mines')
    if (applyDamage(p.ship, damage).destroyed) {
      r.stop = 'mines'
      return destroyed()
    }
  }

  // 4. Fighters.
  const stack = fightersOf(h.deploys)
  if (!stack || stack.ownerId === p.id) return finish()
  const encounter = stack.count
  r.events.push({ kind: 'fightersEncounter', count: encounter, owner: stack.ownerName, mode: stack.mode })
  if (stack.mode === 'toll') {
    const fee = tollOf(stack)
    if (p.credits >= fee) {
      p.credits -= fee
      stack.toll += fee
      p.paid = sector
      touch(stack)
      r.events.push({ kind: 'toll', amount: fee, paid: true })
      mail(stack.ownerId, fill(PROSE.mail.intruderToll, { name: p.name, n: fee, sector }))
      stops.add('toll')
    } else {
      r.events.push({ kind: 'toll', amount: fee, paid: false })
      mail(stack.ownerId, fill(PROSE.mail.intruderHeld, { name: p.name, sector }))
      stops.add('fighters')
    }
    return finish()
  }
  if (stack.mode === 'defensive') {
    mail(stack.ownerId, fill(PROSE.mail.intruder, { name: p.name, sector }))
    stops.add('fighters')
    return finish()
  }
  // Offensive: sends 1.25 × (max fighters + max shields) at 1:1; the rest, and the survivors, hold the sector.
  stops.add('fighters')
  const sent = offensiveSend(stack.count, p.ship.type)
  const res = resolveAttack(sent, COMBAT.sectorFighterOdds, { fighters: p.ship.fighters, shields: p.ship.shields, odds: SHIPS[p.ship.type].defense }, rand)
  p.ship.shields -= res.shieldsLost
  p.ship.fighters -= res.killed
  stack.count -= res.lost
  touch(stack)
  r.events.push({ kind: 'attacked', by: `${stack.ownerName}'s fighters`, damage: res.shieldsLost + res.killed, lost: res.killed })
  if (res.destroyed) {
    mail(stack.ownerId, fill(PROSE.mail.fightersWon, { name: p.name, sector }))
    destroyed(`${stack.ownerName}'s fighters`)
    return finish()
  }
  mail(stack.ownerId, fill(PROSE.mail.fightersHit, { by: p.name, sector, n: res.lost }))
  return finish()
}

/** Surrender to the fighters holding the sector: a toll stack takes the credits (up to the toll), any other the whole cargo. */
export function surrender(p: PlayerRec, stack: Deploy): { events: DoorEvent[]; mail: MailDraft } {
  const events: DoorEvent[] = []
  if (stack.mode === 'toll') {
    const take = Math.min(p.credits, tollOf(stack))
    p.credits -= take
    stack.toll += take
    events.push({ kind: 'toll', amount: take, paid: true })
    if (take > 0) events.push({ kind: 'text', text: fill(PROSE.surrenderCredits, { n: take }) })
  } else {
    p.ship.cargo = [0, 0, 0]
    events.push({ kind: 'text', text: PROSE.surrenderCargo })
  }
  p.paid = stack.sector
  return { events, mail: { playerId: stack.ownerId, from: PROSE.mail.fightersFrom, text: fill(PROSE.mail.surrendered, { name: p.name, sector: stack.sector }) } }
}
