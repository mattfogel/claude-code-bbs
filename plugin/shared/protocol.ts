// The wire contract between the mod and the server: the public feed, the
// write API, and the limits both sides enforce.

export const PROTOCOL_VERSION = 1

export const LIMITS = {
  handleMin: 2,
  handleMax: 16,
  locationMax: 24,
  onelinerMax: 70,
  rumorMax: 70,
  reportReasonMax: 140,
  motdMax: 120,
  feedOneliners: 15,
  feedRumors: 50,
  feedLastCallers: 10,
  /** Seconds between one-liners (and between rumors) from one user. */
  postCooldownSec: 60,
  postsPerDay: 20,
  /** Accounts younger than this may read, log on and set presence, not post. */
  newAccountQuietSec: 600,
  registrationsPerIpPerDay: 3,
  /** New accounts per day across the whole board, so rotating addresses cannot mass-register. */
  registrationsPerDay: 200,
  /** Reports per user per day. */
  reportsPerDay: 10,
  /** A user's logon is recorded in last callers at most this often. */
  callCooldownSec: 300,
  presenceTtlSec: 600,
  /** Leading zero bits the registration proof of work needs. */
  powBits: 16,

  // Message bases (phase 2)
  subjectMax: 40,
  /** Characters in a post body, newlines included. */
  bodyMax: 4000,
  bodyLines: 100,
  /** Cells per body line; longer lines are wrapped by the editor and the reader. */
  bodyWidth: 76,
  /** Seconds between posts from one user, across all conferences. */
  messageCooldownSec: 30,
  messagesPerDay: 20,
  /** Threads listed in a conference's index.json, most recently active first. */
  indexThreads: 60,
  /** Posts kept in one thread file; a longer thread keeps its newest. */
  threadPosts: 200,
  conferenceSlugMax: 16,
  conferenceNameMax: 24,

  // Voting booth
  pollQuestionMax: 70,
  pollOptionMax: 40,
  pollOptionsMin: 2,
  pollOptionsMax: 8,
  /** Polls in hub.json: every open one, then the newest closed ones up to this. */
  feedPolls: 6,
  /** Newest posts across all conferences in hub.json, so a client can spot replies to its handle. */
  feedRecent: 30,
  topTen: 10,
} as const

/** Handles: letters, digits, space, `_`, `-`, `.`; must start with a letter or digit. */
export const HANDLE_RE = /^[A-Za-z0-9][A-Za-z0-9 _.\-]{1,15}$/

/** Handles nobody may take: the sysop's title and names that read as the board or its makers. */
const RESERVED_HANDLES = new Set(['sysop', 'admin', 'administrator', 'moderator', 'mod', 'system', 'root', 'staff', 'anthropic', 'claude', 'all', 'everyone', 'anonymous'])

/** A handle with case, separators and look-alike characters folded away. */
export function handleSkeleton(handle: string): string {
  return handle
    .toLowerCase()
    .replace(/[ _.\-]/g, '')
    .replace(/rn/g, 'm')
    .replace(/0/g, 'o')
    .replace(/[1|]/g, 'l')
}

export function isReservedHandle(handle: string): boolean {
  return RESERVED_HANDLES.has(handleSkeleton(handle))
}

export function normalizeHandle(raw: string): string {
  return String(raw).normalize('NFC').replace(/\s+/g, ' ').trim()
}

export function isValidHandle(handle: string): boolean {
  return HANDLE_RE.test(handle) && !/ {2}/.test(handle) && !handle.endsWith(' ')
}

// ---------------------------------------------------------------------------
// Presence status: what "my Claude is doing", coarse by construction. Only a
// state and a built-in tool name ever leave the machine.

export type ClaudeStatus = { state: 'idle' } | { state: 'thinking' } | { state: 'tool'; tool?: string }

const TOOL_RE = /^[A-Z][A-Za-z]{1,23}$/

/** Encodes a status for the wire; unknown or MCP tool names collapse to "tool". */
export function encodeStatus(s: ClaudeStatus): string {
  if (s.state === 'tool') return s.tool && TOOL_RE.test(s.tool) ? `tool:${s.tool}` : 'tool'
  return s.state
}

/** Decodes a wire status, or undefined for anything malformed. */
export function decodeStatus(wire: unknown): ClaudeStatus | undefined {
  if (wire === 'idle' || wire === 'thinking') return { state: wire }
  if (wire === 'tool') return { state: 'tool' }
  if (typeof wire === 'string' && wire.startsWith('tool:') && TOOL_RE.test(wire.slice(5))) {
    return { state: 'tool', tool: wire.slice(5) }
  }
  return undefined
}

export function describeStatus(s: ClaudeStatus | undefined): string {
  if (!s || s.state === 'idle') return 'idle'
  if (s.state === 'thinking') return 'Claude is thinking…'
  return s.tool ? `Claude is running ${s.tool}…` : 'Claude is using a tool…'
}

// ---------------------------------------------------------------------------
// The feed: hub.json, published to R2 by the Hub Durable Object.

export type FeedOneliner = { id: number; handle: string; text: string; ts: string }
export type FeedRumor = { id: number; text: string; ts: string }
export type FeedCaller = { handle: string; location: string; ts: string; node: number }
export type FeedNode = { node: number; handle: string; status: string; since: string }

export type HubFeed = {
  v: typeof PROTOCOL_VERSION
  seq: number
  generatedAt: string
  motd: string
  oneliners: FeedOneliner[]
  rumors: FeedRumor[]
  lastCallers: FeedCaller[]
  nodes: FeedNode[]
  stats: { users: number; callsToday: number; callsTotal: number; onelinersTotal: number; postsTotal: number }
  conferences: FeedConference[]
  polls: FeedPoll[]
  top: TopTen
  /** The newest posts board-wide, newest first: headers only, never bodies. */
  recent: FeedRecentPost[]
}

/** A post's header as hub.json lists it in `recent`. `to` is a handle or "All". */
export type FeedRecentPost = { slug: string; thread: number; id: number; handle: string; to: string; subject: string; ts: string }

/** A message base. `n` is its number on the base-change screen. */
export type FeedConference = {
  n: number
  slug: string
  name: string
  sponsor: string
  description: string
  posts: number
  /** The newest post's id in this conference (ids grow per conference), 0 when empty. */
  lastPostId: number
  lastPostAt: string | null
}

export type FeedPoll = { id: number; question: string; options: { text: string; votes: number }[]; total: number; closed: boolean; createdAt: string }

export type TopEntry = { handle: string; n: number }
export type TopTen = { posters: TopEntry[]; callers: TopEntry[]; oneliners: TopEntry[] }

// ---------------------------------------------------------------------------
// Message bases: boards/<slug>/index.json and boards/<slug>/threads/<id>.json,
// published to R2 by each conference's Board Durable Object.

export type BoardThread = {
  id: number
  subject: string
  handle: string
  createdAt: string
  posts: number
  lastPostId: number
  lastPostAt: string
  lastHandle: string
}

export type BoardIndex = {
  v: typeof PROTOCOL_VERSION
  slug: string
  seq: number
  generatedAt: string
  /** Most recently active first, at most LIMITS.indexThreads. */
  threads: BoardThread[]
  threadsTotal: number
}

export type BoardPost = {
  id: number
  /** 1-based position in the thread: "Msg n of posts". */
  n: number
  handle: string
  to: string
  subject: string
  body: string
  ts: string
  replyTo: number | null
}

export type BoardThreadFile = {
  v: typeof PROTOCOL_VERSION
  slug: string
  id: number
  subject: string
  /** Posts in the whole thread; `posts` holds the newest LIMITS.threadPosts. */
  total: number
  posts: BoardPost[]
}

export const boardIndexKey = (slug: string) => `boards/${slug}/index.json`
export const boardThreadKey = (slug: string, id: number) => `boards/${slug}/threads/${id}.json`
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,15}$/

// ---------------------------------------------------------------------------
// The write API.

export type RegisterRequest = { handle: string; location?: string; nonce: string }
export type RegisterResponse = { handle: string; secret: string }
export type CallResponse = { node: number }
export type PresenceRequest = { status: string }
export type TextRequest = { text: string }
export type ItemKind = 'oneliner' | 'rumor' | 'post'
export type ReportRequest = { kind: ItemKind; id: number; conference?: string; reason?: string }
export type ModDeleteRequest = { kind: ItemKind; id: number; conference?: string }
export type ModUserRequest = { handle: string; minutes?: number }
export type ModMotdRequest = { text: string }
export type PostRequest = { conference: string; subject?: string; to?: string; body: string; replyTo?: number; thread?: number }
export type PostResponse = { id: number; thread: number }
export type VoteRequest = { poll: number; option: number }
export type ModPollRequest = { question: string; options: string[] }
export type ModConferenceRequest = { slug: string; name: string; sponsor?: string; description?: string; n?: number; remove?: boolean }
export type MeResponse = { handle: string; location: string; role: Role; createdAt: string }

export type Role = 'user' | 'mod' | 'sysop'

export type ErrorCode = 'rate_limited' | 'banned' | 'muted' | 'cooldown' | 'invalid' | 'taken' | 'unauthorized' | 'forbidden' | 'not_found' | 'busy' | 'closed'
export type ApiError = { error: { code: ErrorCode; message: string } }

// ---------------------------------------------------------------------------
// Registration proof of work: sha256(`${handle.toLowerCase()}:${nonce}`) must
// start with LIMITS.powBits zero bits. One hash to check, ~2^bits to find.

export function powInput(handle: string, nonce: string): Uint8Array {
  return new TextEncoder().encode(`${handle.toLowerCase()}:${nonce}`)
}

export function leadingZeroBits(bytes: Uint8Array): number {
  let n = 0
  for (const b of bytes) {
    if (b === 0) {
      n += 8
      continue
    }
    return n + Math.clz32(b) - 24
  }
  return n
}

export async function checkPow(handle: string, nonce: string, bits: number = LIMITS.powBits): Promise<boolean> {
  if (!/^[0-9a-z]{1,16}$/.test(nonce)) return false
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', powInput(handle, nonce)))
  return leadingZeroBits(digest) >= bits
}
