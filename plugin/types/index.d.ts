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
  stats: { users: number; callsToday: number; callsTotal: number; onelinersTotal: number; postsTotal?: number }
  /** Phase 2; absent from a phase 1 server's feed. */
  conferences?: Conference[]
  polls?: Poll[]
  top?: { posters: TopEntry[]; callers: TopEntry[]; oneliners: TopEntry[] }
}

export type Conference = { n: number; slug: string; name: string; sponsor: string; description: string; posts: number; lastPostId: number; lastPostAt: string | null }
export type Poll = { id: number; question: string; options: { text: string; votes: number }[]; total: number; closed: boolean; createdAt: string }
export type TopEntry = { handle: string; n: number }

/** boards/<slug>/index.json (shared/protocol.ts BoardIndex). */
export type BoardThread = { id: number; subject: string; handle: string; createdAt: string; posts: number; lastPostId: number; lastPostAt: string; lastHandle: string }
export type BoardIndex = { v: number; slug: string; seq: number; generatedAt: string; threads: BoardThread[]; threadsTotal: number }

/** boards/<slug>/threads/<id>.json (shared/protocol.ts BoardThreadFile). */
export type BoardPost = { id: number; n: number; handle: string; to: string; subject: string; body: string; ts: string; replyTo: number | null }
export type BoardThreadFile = { v: number; slug: string; id: number; subject: string; total: number; posts: BoardPost[] }

/**
 * The thread being read, as the screen gets it: every post's header, but
 * bodies only near the focused post, so the Client's props stay small.
 */
export type ThreadView = {
  slug: string
  id: number
  subject: string
  total: number
  posts: (Omit<BoardPost, 'body'> & { body?: string })[]
  /** The post the reader is on. */
  focus: number
  loading?: boolean
  missing?: boolean
}

/** One thread with unread posts, as newscan found it. */
export type ScanItem = { slug: string; conference: string; thread: number; subject: string; unread: number }

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
  /** The conference on screen and its thread list (absent until fetched). */
  board?: { slug: string; index?: BoardIndex; loading?: boolean; missing?: boolean }
  thread?: ThreadView
  /** The newest post id read, per conference. */
  lastRead: Record<string, number>
  newscan?: { scanning: boolean; items: ScanItem[] }
  /** Poll id → the option this account voted for. */
  votes: Record<string, number>
}

/** What the Client module posts to the hooks module. */
export type Action =
  | { type: 'register'; handle: string; location: string }
  | { type: 'call' }
  | { type: 'post'; kind: 'oneliner' | 'rumor'; text: string }
  | { type: 'logoff' }
  | { type: 'refresh' }
  | { type: 'board'; slug: string }
  | { type: 'read'; slug: string; thread: number; post?: number }
  | { type: 'message'; conference: string; subject: string; to: string; body: string; replyTo?: number; thread?: number }
  | { type: 'newscan' }
  | { type: 'markAllRead' }
  | { type: 'vote'; poll: number; option: number }

/** Bookkeeping for the presence updates sent to the server. */
export type Presence = { sent: string; sentAt: number; wanted: string }

/** The account this machine holds, kept in $.store under "account". */
export type Account = { handle: string; location: string; secret: string }

declare module 'claude-code' {
  interface PluginState {
    'latent-space': {
      view: View
      isOpen: boolean
      etags: Record<string, string>
      threads: Record<string, BoardThreadFile>
      presence: Presence
    }
  }
}
