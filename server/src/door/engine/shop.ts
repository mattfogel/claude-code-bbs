// Buying things: Class 0 goods, the Outfitter, the Shipwright, the bank.
// Each function checks everything first and changes the player only on success.

import {
  ITEM_BY_ID, RENAME_COST, SHIPS, TRADE_IN, holdsCost, itemMax, shipCost, type DoorConfig, type ItemId,
} from '../../../../plugin/shared/door/data'
import type { DoorEvent, Equipment, ShipState } from '../../../../plugin/shared/door/protocol'
import { emptyEquipment } from './player'
import { class0Prices } from './prices'
import type { PlayerRec } from './types'

export type Outcome = { ok: true; events: DoorEvent[] } | { ok: false; message: string }

const no = (message: string): Outcome => ({ ok: false, message })
const isCount = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0

/** Holds, fighters and shields at a Class 0 port, at the day's prices; all or nothing. */
export function buyClass0(p: PlayerRec, req: { holds?: number; fighters?: number; shields?: number }, day: number): Outcome {
  const ship = p.ship
  const spec = SHIPS[ship.type]
  const prices = class0Prices(day)
  const holds = req.holds ?? 0
  const fighters = req.fighters ?? 0
  const shields = req.shields ?? 0
  if (!isCount(holds) || !isCount(fighters) || !isCount(shields) || holds + fighters + shields === 0) return no('Buy how many?')
  if (ship.holds + holds > spec.maxHolds) return no(`Your hull takes at most ${spec.maxHolds} holds.`)
  if (ship.fighters + fighters > spec.maxFighters) return no(`Your squadron is limited to ${spec.maxFighters} fighters.`)
  if (ship.shields + shields > spec.maxShields) return no(`Your ship is structurally limited to ${spec.maxShields} shield points.`)
  const lines = [
    { what: 'holds', qty: holds, cost: holds ? holdsCost(prices.holdBase, ship.holds, holds) : 0 },
    { what: 'fighters', qty: fighters, cost: fighters * prices.fighter },
    { what: 'shields', qty: shields, cost: shields * prices.shield },
  ].filter(l => l.qty > 0)
  const total = lines.reduce((a, l) => a + l.cost, 0)
  if (total > p.credits) return no(`That comes to ${total.toLocaleString('en-US')} credits; you have ${p.credits.toLocaleString('en-US')}.`)
  p.credits -= total
  ship.holds += holds
  ship.fighters += fighters
  ship.shields += shields
  return { ok: true, events: lines.map(l => ({ kind: 'bought', what: l.what, qty: l.qty, cost: l.cost })) }
}

/** How many of an item the ship carries now. */
export function itemCount(e: Equipment, id: ItemId): number {
  switch (id) {
    case 'probe': return e.probes
    case 'density': return e.scanner === 'none' ? 0 : 1
    case 'holo': return e.scanner === 'holo' ? 1 : 0
    case 'lens': return e.lens ? 1 : 0
    case 'beacon': return e.beacons
    case 'deadman': return e.deadman
    case 'contact': return e.contactMines
    case 'limpet': return e.limpets
    case 'disruptor': return e.disruptors
    case 'cracker': return e.crackers
    case 'planetScanner': return e.planetScanner ? 1 : 0
    case 'seed': return e.seeds
    case 'cloak': return e.cloaks
    case 'photon': return e.photons
    case 'jump1': return e.jump === 1 ? 1 : 0
    case 'jump2': return e.jump === 2 ? 1 : 0
  }
}

/** Phase 1 sells probes, scanners and the Haggle Lens. */
export function buyItem(p: PlayerRec, id: ItemId, qty: number, phase = 1): Outcome {
  const item = ITEM_BY_ID[id]
  if (!item) return no('We don\'t stock that.')
  if (item.phase > phase) return no('Not yet.')
  if (!Number.isInteger(qty) || qty < 1) return no('Buy how many?')
  const e = p.ship.equipment
  const max = itemMax(item, SHIPS[p.ship.type])
  if (max === 0) return no(`Your hull can't carry a ${item.name}.`)
  if (id === 'density' && e.scanner === 'holo') return no('Your Holo Scanner already reads density.')
  const have = itemCount(e, id)
  if (have + qty > max) return no(have >= max ? `You already carry the most you can (${max}).` : `You can carry ${max - have} more.`)
  const cost = item.price * qty
  if (cost > p.credits) return no(`That comes to ${cost.toLocaleString('en-US')} credits; you have ${p.credits.toLocaleString('en-US')}.`)
  p.credits -= cost
  if (id === 'probe') e.probes += qty
  else if (id === 'density') e.scanner = 'density'
  else if (id === 'holo') e.scanner = 'holo'
  else if (id === 'lens') e.lens = true
  return { ok: true, events: [{ kind: 'bought', what: item.name, qty, cost }] }
}

/** Outfitter value of what the ship carries, plus holds over the hull's initial count and fighters and shields at the day's Class 0 prices. */
export function equipmentValue(ship: ShipState, day: number): number {
  const e = ship.equipment
  const prices = class0Prices(day)
  let v = 0
  for (const id of Object.keys(ITEM_BY_ID) as ItemId[]) {
    // A holo scanner counts once, not also as a density scanner.
    if (id === 'density' && e.scanner === 'holo') continue
    v += itemCount(e, id) * ITEM_BY_ID[id].price
  }
  const spec = SHIPS[ship.type]
  const extra = Math.max(0, ship.holds - spec.initHolds)
  if (extra) v += holdsCost(prices.holdBase, spec.initHolds, extra)
  return v + ship.fighters * prices.fighter + ship.shields * prices.shield
}

/** Trade-in: 65% of the hull's four components (condition factor 1 in phase 1) plus 35% of its equipment. */
export function tradeInValue(ship: ShipState, day: number, condition = 1): number {
  if (ship.type === 0) return 0
  return Math.round(TRADE_IN.parts * shipCost(SHIPS[ship.type]) * condition + TRADE_IN.equipment * equipmentValue(ship, day))
}

/** Buys a new hull, trading the current one in. `isCeo` gates the Consortium Flagship. */
export function buyShip(p: PlayerRec, shipId: number, name: string, day: number, isCeo = false): Outcome {
  const spec = SHIPS[shipId]
  if (!spec || !spec.buyable) return no('We don\'t build that one.')
  if (spec.requires === 'ceo' && !isCeo) return no('Only a corporation\'s chief may buy this ship.')
  if (spec.requires === 'commission' && !p.commissioned) return no('Only commissioned pilots may buy this ship.')
  const tradeIn = tradeInValue(p.ship, day)
  const net = shipCost(spec) - tradeIn
  if (net > p.credits) return no(`After your trade-in of ${tradeIn.toLocaleString('en-US')}, that comes to ${net.toLocaleString('en-US')} credits; you have ${p.credits.toLocaleString('en-US')}.`)
  p.credits -= net
  // Cargo that fits comes along, cheapest first; the rest is lost with the old hull.
  let room = spec.initHolds
  const cargo = p.ship.cargo.map(q => {
    const keep = Math.min(q, room)
    room -= keep
    return keep
  }) as [number, number, number]
  p.ship = { type: shipId, name, holds: spec.initHolds, cargo, colonists: 0, fighters: 0, shields: 0, equipment: emptyEquipment() }
  return {
    ok: true,
    events: [
      { kind: 'text', text: `Your old ship is appraised at ${tradeIn.toLocaleString('en-US')} credits.` },
      { kind: 'bought', what: spec.name, qty: 1, cost: net },
    ],
  }
}

export function renameShip(p: PlayerRec, name: string): Outcome {
  if (p.credits < RENAME_COST) return no(`Registration costs ${RENAME_COST.toLocaleString('en-US')} credits.`)
  p.credits -= RENAME_COST
  p.ship.name = name
  return { ok: true, events: [{ kind: 'bought', what: 'registration', qty: 1, cost: RENAME_COST }] }
}

/** Deposit or withdraw at the Exchange Bank. */
export function bankMove(p: PlayerRec, op: 'deposit' | 'withdraw', amount: number, config: Pick<DoorConfig, 'maxBank'>): Outcome {
  if (!Number.isInteger(amount) || amount < 1) return no('How much?')
  if (op === 'deposit') {
    if (amount > p.credits) return no('You don\'t have that much on hand.')
    if (p.bank + amount > config.maxBank) return no(`No one may have more than ${config.maxBank.toLocaleString('en-US')} credits on deposit.`)
    p.credits -= amount
    p.bank += amount
  } else {
    if (amount > p.bank) return no('You don\'t have that much on deposit.')
    p.bank -= amount
    p.credits += amount
  }
  return { ok: true, events: [{ kind: 'text', text: `Your balance is ${p.bank.toLocaleString('en-US')} credits.` }] }
}
