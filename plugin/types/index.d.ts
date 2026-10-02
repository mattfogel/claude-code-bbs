// lATENT sPACE: the values the hooks module keeps in $.state, and the data
// the Client module (client/term.tsx) receives as props and posts back.

export type FeedOneliner = { id: number; handle: string; text: string; ts: string }
export type FeedRumor = { id: number; text: string; ts: string }
export type FeedCaller = { handle: string; location: string; ts: string; node: number }
export type FeedNode = { node: number; handle: string; status: string; since: string }

/** hub.json as published by the server (shared/protocol.ts HubFeed). */
export type Feed = {
  v: number
  seq: number
  generatedAt: string
  motd: string
  oneliners: FeedOneliner[]
  rumors: FeedRumor[]
  lastCallers: FeedCaller[]
  nodes: FeedNode[]
  stats: { users: number; callsToday: number; callsTotal: number; onelinersTotal: number }
}

export type Me = { handle: string; location: string; node?: number }

export type Notice = { id: number; text: string; isError?: boolean }

/** Everything the BBS screen draws from, owned by the hooks module. */
export type View = {
  /** `new` until this machine holds an account. */
  phase: 'new' | 'ready'
  me?: Me
  feed?: Feed
  /** Why the last feed fetch failed, while it keeps failing. */
  feedError?: string
  /** True after a write failed with "busy"; cleared by the next success. */
  busy: boolean
  /** What this session's Claude is doing, already worded for the status bar. */
  claude: string
  /** The outcome of the latest action, newest id wins. */
  notice?: Notice
  /** Proof-of-work progress while an application is being sent, 0..1. */
  registering?: { progress: number }
}

/** What the Client module posts to the hooks module. */
export type Action =
  | { type: 'register'; handle: string; location: string }
  | { type: 'call' }
  | { type: 'post'; kind: 'oneliner' | 'rumor'; text: string }
  | { type: 'logoff' }
  | { type: 'refresh' }

/** Bookkeeping for the presence updates sent to the server. */
export type Presence = { sent: string; sentAt: number; wanted: string }

/** The account this machine holds, kept in $.store under "account". */
export type Account = { handle: string; location: string; secret: string }

declare module 'claude-code' {
  interface PluginState {
    'latent-space': {
      view: View
      isOpen: boolean
      etag: string
      presence: Presence
    }
  }
}
