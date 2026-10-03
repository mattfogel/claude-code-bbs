// lATENT sPACE: the values the hooks module keeps in $.state, and the data
// the Client module (client/term.tsx) receives as props and posts back.

export type FeedOneliner = { id: number; handle: string; text: string; ts: string }
export type FeedRumor = { id: number; text: string; ts: string }
export type FeedCaller = { handle: string; location: string; ts: string; node: number }
export type FeedNode = { node: number; handle: string; status: string; since: string }
export type FeedRecentPost = { slug: string; thread: number; id: number; handle: string; to: string; subject: string; ts: string }

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
  /** The newest post headers board-wide, newest first; absent from an older server's feed. */
  recent?: FeedRecentPost[]
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

export type Me = { handle: string; location: string; node?: number; role?: 'user' | 'mod' | 'sysop' }

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
  /** The busy came from the network, not the server, so a feed that loads again clears it too. */
  busyNet?: boolean
  /** The highest action seq run, per screen instance, so the screen can drop them from its outbox. */
  acks?: Record<string, number>
  /** Shown over the status bar while the pane has the keys and Claude wants them back. */
  alert?: string
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
  /** The door game on screen; absent until a door is opened. */
  door?: DoorView
}

// ---------------------------------------------------------------------------
// Doors: HYPERPLANE. The wire types are mirrored from shared/door/{data,protocol}.ts
// (a contract stands alone); client/door/session.ts checks they stay identical.

export type Commodity = 0 | 1 | 2
export type PortClassId = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
export type ScannerKind = 'none' | 'density' | 'holo'
export type ItemId =
  | 'cracker' | 'beacon' | 'deadman' | 'cloak' | 'probe' | 'planetScanner' | 'contact' | 'limpet'
  | 'photon' | 'density' | 'holo' | 'disruptor' | 'seed' | 'jump1' | 'jump2' | 'lens'

export type DoorMap = { v: 1; season: string; sectors: number; warps: number[][]; concord: number[]; lanes: number[]; generatedAt: string }

export type GameStatus = {
  title: string; season: string; startedAt: string; ageDays: number; sectors: number; ports: number; planets: number
  traders: number; goodPct: number; hallucinations: number; drifters: number; turnsPerDay: number; drydock?: number
}
export type LogEntry = { id: number; ts: string; kind: string; text: string }
export type CommLine = { id: number; ts: string; from: string; text: string }
export type TraderRanking = { name: string; rank: number; title: string; experience: number; alignment: number; corp?: string; netWorth: number }
export type CorpRanking = { id: number; name: string; ceo: string; members: number; experience: number }
export type DoorNews = {
  v: 1; season: string; seq: number; generatedAt: string; status: GameStatus; log: LogEntry[]; comm: CommLine[]
  rankings: { traders: TraderRanking[]; corps: CorpRanking[] }
}

export type Equipment = {
  contactMines: number; limpets: number; beacons: number; seeds: number; crackers: number; deadman: number; cloaks: number
  probes: number; disruptors: number; photons: number; scanner: ScannerKind; planetScanner: boolean; lens: boolean; jump: 0 | 1 | 2
}
export type ShipState = { type: number; name: string; holds: number; cargo: [number, number, number]; colonists: number; fighters: number; shields: number; equipment: Equipment }
export type PlayerSnapshot = {
  v: 1; season: string; id: number; name: string; sector: number; prevSector: number; turns: number; turnsMax: number
  credits: number; bank: number; experience: number; alignment: number; timesBlownUp: number; deadUntil?: string
  commissioned: boolean; corp?: { id: number; name: string; isCeo: boolean }; ship: ShipState; avoids: number[]
  lastSeenLog: number; requestsToday: number; limpet: boolean; blocked: boolean
}

export type PortSighting = { name: string; class: PortClassId; destroyed?: boolean; buildingDays?: number }
export type FighterMode = 'defensive' | 'offensive' | 'toll'
export type MineKind = 'contact' | 'limpet'
export type SectorView = {
  id: number
  region: 'concord' | 'uncharted'
  beacon?: string
  port?: PortSighting
  planets: { id: number; name: string; class: string; owner?: string; shielded?: boolean }[]
  traders: { name: string; ship: string; shipType: number; fighters: number; corp?: string }[]
  ships: { name: string; owner: string; shipType: number; fighters: number }[]
  fighters?: { count: number; owner: string; isYours: boolean; isCorp: boolean; mode: FighterMode }
  navhaz: number
  mines: { kind: MineKind; count: number; owner: string; isYours: boolean }[]
  hallucinations: { name: string; shipType: number; fighters: number }[]
  marshals: string[]
  warps: number[]
}
export type PortItem = { status: 'buying' | 'selling'; trading: number; pct: number }
export type PortReport = { sector: number; name: string; class: PortClassId; seenAt: string; items: [PortItem, PortItem, PortItem] }
export type TradeStep = { commodity: Commodity; side: 'sell' | 'buy'; max: number; defaultQty: number; unitOffer: number }

export type ShipwrightRequest = { op: 'buy'; ship: number; name: string } | { op: 'sell'; shipId: number } | { op: 'rename'; name: string }
export type BankRequest = { op: 'deposit' | 'withdraw'; amount: number } | { op: 'transfer'; amount: number; to: string }
export type AnnounceRequest = { text: string }
export type DeployRequest =
  | { kind: 'fighters'; count: number; owner: 'personal' | 'corp'; mode: FighterMode }
  | { kind: MineKind; count: number; owner: 'personal' | 'corp' }
export type CollectRequest = { kind: 'fighters' | MineKind; count: number }
export type MarshalRequest = { op: 'commission' } | { op: 'reward'; target: string; amount: number } | { op: 'claim' } | { op: 'wanted' }
export type BackroomRequest = { password: string; op: 'hit' | 'collect' | 'alias'; target?: string; amount?: number; alias?: string }
export type SalRequest = { op: 'trace'; target: string } | { op: 'password' } | { op: 'swear' } | { op: 'fortune' }

/**
 * A question the hooks module puts to the screen after a reply: a course to
 * engage, an open haggle, a trading post's prices, or the Drydock's menu.
 */
export type DoorAsk =
  | { kind: 'engage'; path: number[] }
  /** `commodity`, `qty`, `ask` and `final` are set mid-haggle: the port's current figure for the locked quantity. */
  | { kind: 'trade'; steps: TradeStep[]; at: number; round: number; commodity?: Commodity; qty?: number; ask?: number; final?: boolean; trading?: number[] }
  | { kind: 'class0'; prices: { hold: number; fighter: number; shield: number } }
  | { kind: 'drydock' }

/** news.json, cut down for the title's Log and Rankings pages. */
export type DoorBoard = { status?: GameStatus; log: LogEntry[]; rankings: TraderRanking[]; missing?: boolean }

/** The part of the door the screen sees. The star map and what the player knows stay in hooks atoms. */
export type DoorView = {
  /** The season ("s1" is Epoch 1). */
  season: string
  phase: 'title' | 'loading' | 'new' | 'ready'
  /** Bumped after every door action, so the screen knows its last one is done. */
  rev: number
  /** Pipe-coded lines, newest last, at most 300. */
  transcript: string[]
  snapshot?: PlayerSnapshot
  here?: SectorView
  /** A remote command is in flight. */
  busy: boolean
  board?: DoorBoard
  ask?: DoorAsk
}

/** What the player knows of the season: explored sectors and last-seen port reports by sector. */
export type DoorKnown = { season: string; explored: number[]; ports: Record<string, PortReport> }

/** Commands the game runs without a request. */
export type DoorLocalKey = 'D' | 'I' | '/' | '?' | 'V' | 'CI' | 'CK' | 'CR' | 'CX' | 'CL' | 'CG' | 'CE' | 'C?'

/** One door command; most are one request, the local ones none. */
export type DoorCmd =
  | { cmd: 'enter' }
  | { cmd: 'leave' }
  | { cmd: 'news' }
  | { cmd: 'create'; shipName: string }
  | { cmd: 'local'; key: DoorLocalKey; arg?: number }
  /** `engage`: offer the autopilot (M); otherwise only show the course (the computer's plotter). */
  | { cmd: 'plot'; to: number; engage: boolean }
  | { cmd: 'move'; path: number[]; mode: 'alert' | 'express' }
  | { cmd: 'dock' }
  | { cmd: 'offer'; commodity: Commodity; qty: number; price: number }
  | { cmd: 'skip' }
  | { cmd: 'class0'; holds: number; fighters: number; shields: number }
  | { cmd: 'outfit'; item: ItemId; qty: number }
  | { cmd: 'shipwright'; body: ShipwrightRequest }
  | { cmd: 'bank'; body: BankRequest }
  | { cmd: 'announce'; body: AnnounceRequest }
  | { cmd: 'scan'; kind: 'density' | 'holo' | 'limpet' }
  | { cmd: 'probe'; to: number }
  /** Toggles a sector on the avoid list; 0 clears it. */
  | { cmd: 'avoid'; sector: number }
  /** Phase 2. `target` is a trader's name, or '*fighters' for the sector fighters that hold you. */
  | { cmd: 'attack'; target: string; fighters: number }
  | { cmd: 'retreat' }
  | { cmd: 'surrender' }
  | { cmd: 'deploy'; body: DeployRequest }
  | { cmd: 'collect'; body: CollectRequest }
  | { cmd: 'rob'; credits: number }
  | { cmd: 'steal'; commodity: Commodity; qty: number }
  | { cmd: 'marshal'; body: MarshalRequest }
  | { cmd: 'backroom'; body: BackroomRequest }
  | { cmd: 'beacon'; text: string }
  | { cmd: 'disrupt'; sector: number }
  | { cmd: 'sal'; body: SalRequest }
  /** Removes a limpet at a Class 0 port or the Drydock. */
  | { cmd: 'removeLimpet' }
  /** Drops the open question (no request). */
  | { cmd: 'clear' }

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
  | { type: 'sysop'; op: SysopOp }
  | { type: 'report'; conference: string; id: number }
  /** A door command, with the lines typed for it (prompts and answers) to echo first. */
  | ({ type: 'door'; echo?: string[] } & DoorCmd)

/**
 * What the Client module posts: every action not yet acknowledged, numbered per screen
 * instance (`iid`), since a later post in the same frame replaces an undelivered one.
 */
export type Outbox = { type: 'batch'; iid: string; seq: number; actions: { seq: number; action: Action }[] }

/** What the sysop menu asks the server to do (the /v1/mod routes). */
export type SysopOp =
  | { kind: 'conference'; slug: string; name: string; sponsor: string; description: string; n?: number; remove?: boolean }
  | { kind: 'poll'; question: string; options: string[] }
  | { kind: 'closePoll'; id: number }
  | { kind: 'motd'; text: string }
  | { kind: 'user'; action: 'ban' | 'unban' | 'mute'; handle: string; minutes?: number }
  | { kind: 'deletePost'; conference: string; id: number; thread: number }

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
      /** What the prompt hint adds during a long turn ("" for nothing). */
      nudge: string
      /** The door's star map for the season, fetched once a session. */
      doorMap: { map?: DoorMap }
      doorKnown: DoorKnown
      /** The door's news.json, fetched on demand. */
      doorNews: { news?: DoorNews }
    }
  }
}
