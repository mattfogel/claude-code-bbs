import type { Board } from './board'
import type { Universe } from './door/universe'
import type { Hub } from './hub'

export interface Env {
  HUB: DurableObjectNamespace<Hub>
  BOARD: DurableObjectNamespace<Board>
  /** HYPERPLANE: one per season, named by its id ("s1"). */
  UNIVERSE: DurableObjectNamespace<Universe>
  DB: D1Database
  FEED: R2Bucket
  /** "1" serves GET /feed/* from R2 through the Worker (dev and tests). */
  SERVE_FEED: string
  POW_BITS: string
  /** The door's current season ("s1", ...); a new Epoch is a new Big Bang under a new name. */
  CURRENT_SEASON?: string
}

/** The account a request acts as, as the Hub sees it. */
export type Caller = { id: number; handle: string; location: string }

export type UserRow = {
  id: number
  handle: string
  location: string
  role: 'user' | 'mod' | 'sysop'
  created_at: number
  banned: number
  muted_until: number
}
