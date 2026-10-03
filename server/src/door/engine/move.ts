// Movement (research 01 §5.2) and turns (design §Turns and time).

import type { DoorConfig } from '../../../../plugin/shared/door/data'
import { isAdjacent } from '../../../../plugin/shared/door/nav'
import type { DoorEvent, StopReason } from '../../../../plugin/shared/door/protocol'
import { DAY_MS, dayNumber } from './prices'

const HOUR_MS = 3_600_000

/** Settles turns at `now`; returns the new count and the time it is settled to. */
export function settleTurns(turns: number, turnsAt: number, now: number, config: Pick<DoorConfig, 'turnsPerDay' | 'turnModel'>): { turns: number; turnsAt: number } {
  const max = config.turnsPerDay
  if (turns >= max) return { turns, turnsAt: now }
  if (config.turnModel === 'daily') return dayNumber(now) > dayNumber(turnsAt) ? { turns: max, turnsAt: now } : { turns, turnsAt }
  // Continuous: turnsPerDay/24 an hour. Only whole turns are granted; the
  // clock advances by exactly the time they took, so fractions carry over.
  const msPerTurn = DAY_MS / max
  const gained = Math.floor((now - turnsAt) / msPerTurn)
  if (gained <= 0) return { turns, turnsAt }
  if (turns + gained >= max) return { turns: max, turnsAt: now }
  return { turns: turns + gained, turnsAt: turnsAt + gained * msPerTurn }
}

/** Turns regained per hour under the continuous model. */
export const turnsPerHour = (turnsPerDay: number) => (turnsPerDay * HOUR_MS) / DAY_MS

/** What can stop an alert-mode autopilot in a sector. */
export type SectorFlags = { port?: boolean; planet?: boolean; trader?: boolean }

export type WalkInput = {
  warps: number[][]
  from: number
  /** Excludes `from`. */
  path: number[]
  mode: 'alert' | 'express'
  turns: number
  turnsPerWarp: number
  /** Alert-mode interrupts by sector. */
  flags?: (sector: number) => SectorFlags | undefined
  /** Phase 2+: hazards on entry (fighters, mines, NavHaz...). Returns events and a stop reason, if any. */
  onEnter?: (sector: number) => { events: DoorEvent[]; stop?: StopReason } | undefined
}

export type WalkResult = { sector: number; prev: number; turnsUsed: number; visited: number[]; events: DoorEvent[]; reason: StopReason }

/** True if every hop of `path` (from `from`) is a warp. */
export function validPath(warps: number[][], from: number, path: readonly number[]): boolean {
  let at = from
  for (const s of path) {
    if (!isAdjacent(warps, at, s)) return false
    at = s
  }
  return true
}

/** Walks a path hop by hop, stopping at the first interrupt. The path must already be valid. */
export function walk(w: WalkInput): WalkResult {
  const events: DoorEvent[] = []
  let sector = w.from
  let prev = w.from
  let turns = w.turns
  const visited: number[] = []
  let reason: StopReason = 'arrived'
  for (let i = 0; i < w.path.length; i++) {
    const to = w.path[i]
    if (turns < w.turnsPerWarp) {
      reason = 'turns'
      break
    }
    turns -= w.turnsPerWarp
    events.push({ kind: 'warp', from: sector, to, turns: w.turnsPerWarp })
    prev = sector
    sector = to
    visited.push(to)
    const hit = w.onEnter?.(to)
    if (hit) {
      events.push(...hit.events)
      if (hit.stop) {
        reason = hit.stop
        break
      }
    }
    if (i === w.path.length - 1) break
    if (w.mode === 'alert') {
      const f = w.flags?.(to)
      const stop: StopReason | undefined = f?.port ? 'port' : f?.planet ? 'planet' : f?.trader ? 'trader' : undefined
      if (stop) {
        reason = stop
        break
      }
    }
  }
  events.push({ kind: 'stop', sector, reason })
  return { sector, prev, turnsUsed: w.turns - turns, visited, events, reason }
}
