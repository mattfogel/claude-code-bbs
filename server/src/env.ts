import type { Board } from './board'
import type { Hub } from './hub'

export interface Env {
  HUB: DurableObjectNamespace<Hub>
  BOARD: DurableObjectNamespace<Board>
  DB: D1Database
  FEED: R2Bucket
  /** "1" serves GET /feed/* from R2 through the Worker (dev and tests). */
  SERVE_FEED: string
  POW_BITS: string
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
