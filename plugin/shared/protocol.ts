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
  presenceTtlSec: 600,
  /** Leading zero bits the registration proof of work needs. */
  powBits: 16,
} as const

/** Handles: letters, digits, space, `_`, `-`, `.`; must start with a letter or digit. */
export const HANDLE_RE = /^[A-Za-z0-9][A-Za-z0-9 _.\-]{1,15}$/

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
  stats: { users: number; callsToday: number; callsTotal: number; onelinersTotal: number }
}

// ---------------------------------------------------------------------------
// The write API.

export type RegisterRequest = { handle: string; location?: string; nonce: string }
export type RegisterResponse = { handle: string; secret: string }
export type CallResponse = { node: number }
export type PresenceRequest = { status: string }
export type TextRequest = { text: string }
export type ReportRequest = { kind: 'oneliner' | 'rumor'; id: number; reason?: string }
export type ModDeleteRequest = { kind: 'oneliner' | 'rumor'; id: number }
export type ModUserRequest = { handle: string; minutes?: number }
export type ModMotdRequest = { text: string }
export type MeResponse = { handle: string; location: string; role: Role; createdAt: string }

export type Role = 'user' | 'mod' | 'sysop'

export type ErrorCode = 'rate_limited' | 'banned' | 'muted' | 'cooldown' | 'invalid' | 'taken' | 'unauthorized' | 'forbidden' | 'not_found' | 'busy'
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
