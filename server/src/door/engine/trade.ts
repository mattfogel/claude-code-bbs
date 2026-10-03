// A dock at a standard port: the commerce report, the order of trades, and
// each offer of the haggle (research 01 §4.1 to §4.4).

import { COMMODITIES, type Commodity } from '../../../../plugin/shared/door/data'
import { hashSeed, rng } from '../../../../plugin/shared/door/nav'
import type { DoorEvent, PendingTrade, TradeStep } from '../../../../plugin/shared/door/protocol'
import { gainXp } from './player'
import { bid, dayVar, fillOf, openNegotiation, openingUnit, type PriceInput } from './prices'
import type { PlayerRec, PortRec, TradeSession } from './types'

export type TradeCtx = { port: PortRec; player: PlayerRec; seed: number; day: number; now: number }

/** Lines a port ends a haggle with. Original text. */
export const REFUSALS = [
  'We\'re not interested.',
  'Take your business elsewhere, spacer.',
  'Is that a joke? We\'re done here.',
  'Come back when you can count.',
  'Our clerk laughed so hard he had to sit down. No deal.',
  'Leave now, while we\'re still being polite.',
] as const

export const INSULT = 'That offer is an insult. Try again.'

export function priceInput(ctx: TradeCtx, c: Commodity): PriceInput {
  return { c, mcic: ctx.port.mcic[c], fill: fillOf(ctx.port, c), exp: ctx.player.exp, dayVar: dayVar(ctx.seed, ctx.day, c) }
}

export const freeHolds = (p: PlayerRec) => p.ship.holds - p.ship.cargo[0] - p.ship.cargo[1] - p.ship.cargo[2] - p.ship.colonists

/** Opens a dock: first what the port buys and the player carries, then what it sells. */
export function openDock(port: PortRec, player: PlayerRec, seq: number, now: number): TradeSession {
  const todo: TradeSession['todo'] = []
  for (const c of [0, 1, 2] as const) if (port.mcic[c] < 0 && player.ship.cargo[c] > 0) todo.push({ commodity: c, side: 'sell' })
  for (const c of [0, 1, 2] as const) if (port.mcic[c] > 0) todo.push({ commodity: c, side: 'buy' })
  return { sector: port.sector, at: now, seq, todo }
}

/** The steps still open, with fresh maxima, defaults and opening prices; steps with nothing to trade drop out. */
export function stepsOf(s: TradeSession, ctx: TradeCtx): TradeStep[] {
  const { port, player } = ctx
  const steps: TradeStep[] = []
  for (const t of s.todo) {
    const c = t.commodity
    const unitOffer = openingUnit(priceInput(ctx, c))
    // Mid-haggle the quantity is fixed: the step carries it as max and default.
    if (s.active?.commodity === c) {
      steps.push({ commodity: c, side: t.side, max: s.active.qty, defaultQty: s.active.qty, unitOffer })
      continue
    }
    if (t.side === 'sell') {
      const max = Math.min(player.ship.cargo[c], port.amount[c])
      if (max > 0) steps.push({ commodity: c, side: 'sell', max, defaultQty: max, unitOffer })
    } else {
      const max = Math.min(port.amount[c], freeHolds(player))
      if (max > 0) steps.push({ commodity: c, side: 'buy', max, defaultQty: Math.max(0, Math.min(max, Math.floor(player.credits / unitOffer))), unitOffer })
    }
  }
  return steps
}

export function pendingOf(s: TradeSession, ctx: TradeCtx): PendingTrade | undefined {
  const steps = stepsOf(s, ctx)
  if (!steps.length) return undefined
  return { sector: s.sector, steps, at: s.at, round: s.active?.n ?? 0 }
}

/** The haggle in progress as a counter event, so a reloaded client can resume at the port's current figure. */
export function activeEvent(s: TradeSession | undefined): DoorEvent | undefined {
  const a = s?.active
  return a ? { kind: 'counter', commodity: a.commodity, price: a.offer, final: a.final } : undefined
}

export type OfferResult = { ok: true; events: DoorEvent[]; done: boolean } | { ok: false; message: string }

const drop = (s: TradeSession, c: Commodity) => {
  s.todo = s.todo.filter(t => t.commodity !== c)
  s.active = undefined
}

/** One offer. qty 0 passes on the commodity. Mutates the session, port and player. */
export function offer(s: TradeSession, ctx: TradeCtx, req: { commodity: Commodity; qty: number; price: number }): OfferResult {
  const { port, player } = ctx
  const c = req.commodity
  const step = stepsOf(s, ctx).find(t => t.commodity === c)
  if (!step) return { ok: false, message: `There is no ${COMMODITIES[c] ?? 'such cargo'} to trade here now.` }
  if (s.active && s.active.commodity !== c) return { ok: false, message: `Finish the haggle over ${COMMODITIES[s.active.commodity]} first.` }
  const events: DoorEvent[] = []
  s.at = ctx.now
  if (req.qty === 0) {
    drop(s, c)
    return { ok: true, events, done: stepsOf(s, ctx).length === 0 }
  }
  if (!Number.isInteger(req.qty) || req.qty < 0 || req.qty > step.max) return { ok: false, message: `You can trade up to ${step.max}.` }
  if (s.active && s.active.qty !== req.qty) return { ok: false, message: `We're haggling over ${s.active.qty} units.` }
  if (!Number.isInteger(req.price) || req.price < 1) return { ok: false, message: 'Name a price.' }
  const neg = s.active ?? openNegotiation(priceInput(ctx, c), req.qty, hashSeed(ctx.seed, player.id, s.seq, c))
  const r = bid(neg, port.mcic[c], req.price)
  if (r.kind === 'accept') {
    if (step.side === 'buy' && r.price > player.credits) return { ok: false, message: 'You don\'t have enough credits.' }
    const qty = neg.qty
    if (step.side === 'sell') {
      player.ship.cargo[c] -= qty
      player.credits += r.price
      port.credits = Math.max(0, port.credits - r.price)
    } else {
      player.ship.cargo[c] += qty
      player.credits -= r.price
      port.credits += r.price
    }
    port.amount[c] -= qty
    const ev: Extract<DoorEvent, { kind: 'trade' }> = { kind: 'trade', commodity: c, side: step.side, qty, price: r.price, xp: r.xp }
    if (player.ship.equipment.lens && r.best > 0) ev.pctOfBest = Math.round(step.side === 'sell' ? (100 * r.price) / r.best : (100 * r.best) / r.price)
    events.push(ev)
    gainXp(player, r.xp, 0, 'trade', events)
    drop(s, c)
  } else if (r.kind === 'counter') {
    s.active = neg
    events.push({ kind: 'counter', commodity: c, price: r.price, final: r.final })
  } else if (r.kind === 'insult') {
    s.active = neg
    events.push({ kind: 'text', text: INSULT }, { kind: 'counter', commodity: c, price: r.price, final: neg.final })
  } else {
    const line = REFUSALS[Math.floor(rng(hashSeed(ctx.seed, player.id, s.seq, c, 'no'))() * REFUSALS.length)]
    events.push({ kind: 'refused', commodity: c, line })
    drop(s, c)
  }
  return { ok: true, events, done: stepsOf(s, ctx).length === 0 }
}
