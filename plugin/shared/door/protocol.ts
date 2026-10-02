// HYPERPLANE's wire contract: the public feed files, the private state the
// server returns, the events it reports, and one request body per command.
//
// A `season` is one universe from Big Bang to Big Bang. Players see it as an
// "Epoch" ("s1" is Epoch 1); code keeps the name season.

import type { ApiError } from '../protocol'
import type { Commodity, ItemId, PortClassId, ScannerKind } from './data'

export const DOOR_PROTOCOL_VERSION = 1

export const DOOR_LIMITS = {
  shipName: 30,
  announce: 155,
  beacon: 41,
  alias: 16,
  /** Sectors on the avoid list. */
  avoids: 100,
  /** Lines kept in news.json's log, newest last. */
  log: 800,
  /** Comm lines kept in news.json. */
  comm: 50,
  /** Traders in news.json's rankings. */
  rankings: 20,
  /** Door requests per player per minute (the daily cap is DoorConfig.dailyRequestCap). */
  perMinute: 60,
} as const

/** Season ids: "s1", "s2", ... */
export const SEASON_RE = /^s[0-9]{1,4}$/

// ---------------------------------------------------------------------------
// The public feed (R2, cached).

export const doorMapKey = (season: string) => `door/${season}/map.json`
export const doorNewsKey = (season: string) => `door/${season}/news.json`

/** The warp graph; static for a season. */
export type DoorMap = {
  v: 1
  season: string
  sectors: number
  /** Outgoing warps, ascending; index = sector id, warps[0] = []. */
  warps: number[][]
  /** Concord Space sector ids (1..10 plus the Drydock's). */
  concord: number[]
  /** Space-lane sectors (Concord-patrolled, cleared at extern). */
  lanes: number[]
  generatedAt: string
}

export type GameStatus = {
  title: string
  season: string
  startedAt: string
  ageDays: number
  sectors: number
  ports: number
  planets: number
  traders: number
  /** % of traders with alignment ≥ 0. */
  goodPct: number
  /** Hallucination ships alive. */
  hallucinations: number
  drifters: number
  turnsPerDay: number
  /** The Drydock's sector, only when config.showDrydock. */
  drydock?: number
}

/** A daily-log line. `text` is server-authored and may carry pipe codes |01-|15. */
export type LogEntry = { id: number; ts: string; kind: string; text: string }
export type CommLine = { id: number; ts: string; from: string; text: string }

export type TraderRanking = { name: string; rank: number; title: string; experience: number; alignment: number; corp?: string; netWorth: number }
export type CorpRanking = { id: number; name: string; ceo: string; members: number; experience: number }

export type DoorNews = {
  v: 1
  season: string
  seq: number
  generatedAt: string
  status: GameStatus
  /** Newest last, at most DOOR_LIMITS.log. */
  log: LogEntry[]
  /** The last DOOR_LIMITS.comm lines of the Concord channel. */
  comm: CommLine[]
  rankings: { traders: TraderRanking[]; corps: CorpRanking[] }
}

// ---------------------------------------------------------------------------
// Private state.

export type Equipment = {
  contactMines: number
  limpets: number
  beacons: number
  seeds: number
  crackers: number
  deadman: number
  cloaks: number
  probes: number
  disruptors: number
  photons: number
  scanner: ScannerKind
  planetScanner: boolean
  lens: boolean
  jump: 0 | 1 | 2
}

export type ShipState = {
  /** SHIPS id. */
  type: number
  name: string
  holds: number
  /** [Compute, Data, Weights]. */
  cargo: [number, number, number]
  colonists: number
  fighters: number
  shields: number
  equipment: Equipment
}

export type PlayerSnapshot = {
  v: 1
  season: string
  id: number
  /** Trader name: the BBS handle, or a Back Room alias. */
  name: string
  sector: number
  prevSector: number
  turns: number
  turnsMax: number
  credits: number
  bank: number
  experience: number
  alignment: number
  timesBlownUp: number
  /** ISO time; set while the player is dead until then. */
  deadUntil?: string
  commissioned: boolean
  corp?: { id: number; name: string; isCeo: boolean }
  ship: ShipState
  avoids: number[]
  /** Id of the last log entry the player has seen. */
  lastSeenLog: number
  requestsToday: number
}

export type PortSighting = { name: string; class: PortClassId; destroyed?: boolean; buildingDays?: number }
export type FighterMode = 'defensive' | 'offensive' | 'toll'
export type MineKind = 'contact' | 'limpet'

/** What a sector looks like right now (the D display). */
export type SectorView = {
  id: number
  region: 'concord' | 'uncharted'
  beacon?: string
  port?: PortSighting
  planets: { id: number; name: string; class: string; owner?: string; shielded?: boolean }[]
  traders: { name: string; ship: string; shipType: number; fighters: number; corp?: string }[]
  /** Unmanned ships. */
  ships: { name: string; owner: string; shipType: number; fighters: number }[]
  fighters?: { count: number; owner: string; isYours: boolean; isCorp: boolean; mode: FighterMode }
  /** % (0..100). */
  navhaz: number
  mines: { kind: MineKind; count: number; owner: string; isYours: boolean }[]
  hallucinations: { name: string; shipType: number; fighters: number }[]
  marshals: string[]
  warps: number[]
}

export type PortItem = { status: 'buying' | 'selling'; trading: number; pct: number }

/** A commerce report as last seen. Items are [Compute, Data, Weights]. */
export type PortReport = { sector: number; name: string; class: PortClassId; seenAt: string; items: [PortItem, PortItem, PortItem] }

/** What the player knows of the universe: explored sectors and last-seen port reports. */
export type KnownDelta = { explored: number[]; ports: PortReport[] }

// ---------------------------------------------------------------------------
// Events: what happened during a command, in order. The client formats them
// into transcript lines.

export type StopReason =
  | 'arrived' | 'port' | 'planet' | 'trader' | 'fighters' | 'mines' | 'toll' | 'navhaz'
  | 'turns' | 'hallucination' | 'blocked' | 'interdicted' | 'dead'

/** One commodity's turn at a dock; `side` is from the player's view. */
export type TradeStep = {
  commodity: Commodity
  side: 'sell' | 'buy'
  max: number
  defaultQty: number
  /** Opening per-unit offer; the client shows round(unitOffer × qty). */
  unitOffer: number
}

export type DensityRow = { sector: number; density: number; warps: number; navhaz: number; anomaly: boolean }

export type DoorEvent =
  | { kind: 'warp'; from: number; to: number; turns: number }
  | { kind: 'stop'; sector: number; reason: StopReason }
  | { kind: 'navhaz'; damage: number }
  | { kind: 'mines'; detonated: number; damage: number }
  | { kind: 'limpet' }
  | { kind: 'toll'; amount: number; paid: boolean }
  | { kind: 'fightersEncounter'; count: number; owner: string; mode: FighterMode }
  | { kind: 'dock'; report: PortReport; turnsLeft: number; steps: TradeStep[] }
  | { kind: 'counter'; commodity: Commodity; price: number; final: boolean }
  | { kind: 'trade'; commodity: Commodity; side: 'sell' | 'buy'; qty: number; price: number; xp: number; pctOfBest?: number }
  | { kind: 'refused'; commodity: Commodity; line: string }
  | { kind: 'class0'; holdPrice: number; fighterPrice: number; shieldPrice: number }
  | { kind: 'bought'; what: string; qty: number; cost: number }
  | { kind: 'density'; rows: DensityRow[] }
  | { kind: 'holo'; sectors: SectorView[] }
  | { kind: 'probe'; path: number[]; sectors: SectorView[]; destroyedAt?: number }
  | { kind: 'attack'; target: string; sent: number; lost: number; killed: number; shieldsLost: number; destroyed: boolean; captured: boolean; fled: boolean; salvageCredits?: number }
  | { kind: 'attacked'; by: string; damage: number; lost: number }
  | { kind: 'podded'; sector: number; by?: string }
  | { kind: 'deployed'; what: string; count: number; mode?: FighterMode }
  | { kind: 'busted'; expLost: number; holdsLost: number }
  | { kind: 'robbed'; credits: number }
  | { kind: 'stolen'; commodity: Commodity; qty: number }
  | { kind: 'xp'; exp: number; align: number; reason: string }
  | { kind: 'rank'; title: string }
  /** A hail, a corp memo, or a report from deployed fighters (`type`, since `kind` is the tag). */
  | { kind: 'message'; from: string; text: string; type: 'hail' | 'memo' | 'report' }
  | { kind: 'text'; text: string }

export type DoorEventKind = DoorEvent['kind']

// ---------------------------------------------------------------------------
// Replies.

/** An open negotiation, so the client can resume the haggle prompts. */
export type PendingTrade = { sector: number; steps: TradeStep[]; at: number; round: number }

export type DoorReply = {
  ok: true
  snapshot: PlayerSnapshot
  here: SectorView
  events: DoorEvent[]
  /** What became known during this command. */
  known: KnownDelta
  pending?: PendingTrade
}

/** GET /v1/door/state. `known` is complete; with created=false there is no character yet. */
export type DoorStateReply =
  | (DoorReply & { created: true })
  | { ok: true; created: false; snapshot?: undefined; here?: undefined; events: DoorEvent[]; known: KnownDelta; pending?: undefined }

export type DoorResult = DoorReply | ApiError

// ---------------------------------------------------------------------------
// Requests: POST /v1/door/<command> with the matching body.

export type CreateRequest = { shipName: string }
/** `path` excludes the current sector. */
export type MoveRequest = { path: number[]; mode: 'alert' | 'express' }
export type DockRequest = Record<string, never>
/** `price` is the bid for `qty` units; equal to the port's figure means accept. */
export type OfferRequest = { commodity: Commodity; qty: number; price: number }
/** Skip the remaining trade steps and undock. */
export type SkipRequest = Record<string, never>
export type Class0Request = { holds?: number; fighters?: number; shields?: number; removeLimpet?: boolean }
export type OutfitRequest = { item: ItemId; qty: number }
export type ShipwrightRequest =
  | { op: 'buy'; ship: number; name: string }
  | { op: 'sell'; shipId: number }
  | { op: 'rename'; name: string }
export type BankRequest =
  | { op: 'deposit' | 'withdraw'; amount: number }
  | { op: 'transfer'; amount: number; to: string }
export type AnnounceRequest = { text: string }
export type ScanRequest = { kind: 'density' | 'holo' }
/** `path` excludes the current sector. */
export type ProbeRequest = { path: number[] }
export type AvoidsRequest = { set: number[] }

// Phase 2
export type AttackRequest = { target: string; fighters: number }
export type RetreatRequest = Record<string, never>
export type SurrenderRequest = Record<string, never>
export type DeployRequest =
  | { kind: 'fighters'; count: number; owner: 'personal' | 'corp'; mode: FighterMode }
  | { kind: MineKind; count: number; owner: 'personal' | 'corp' }
export type CollectRequest = { kind: 'fighters' | MineKind; count: number }
export type RobRequest = { credits: number }
export type StealRequest = { commodity: Commodity; qty: number }
export type MarshalRequest =
  | { op: 'commission' }
  | { op: 'reward'; target: string; amount: number }
  | { op: 'claim' }
export type BackroomRequest = { password?: string; op: 'hit' | 'collect' | 'alias'; target?: string; amount?: number; alias?: string }
export type BeaconRequest = { text: string }

/** Request body by command. */
export type DoorRequests = {
  create: CreateRequest
  move: MoveRequest
  dock: DockRequest
  offer: OfferRequest
  skip: SkipRequest
  class0: Class0Request
  outfit: OutfitRequest
  shipwright: ShipwrightRequest
  bank: BankRequest
  announce: AnnounceRequest
  scan: ScanRequest
  probe: ProbeRequest
  avoids: AvoidsRequest
  attack: AttackRequest
  retreat: RetreatRequest
  surrender: SurrenderRequest
  deploy: DeployRequest
  collect: CollectRequest
  rob: RobRequest
  steal: StealRequest
  marshal: MarshalRequest
  backroom: BackroomRequest
  beacon: BeaconRequest
}

export type DoorCommand = keyof DoorRequests

export const DOOR_COMMANDS = [
  'create', 'move', 'dock', 'offer', 'skip', 'class0', 'outfit', 'shipwright', 'bank', 'announce', 'scan', 'probe', 'avoids',
  'attack', 'retreat', 'surrender', 'deploy', 'collect', 'rob', 'steal', 'marshal', 'backroom', 'beacon',
] as const satisfies readonly DoorCommand[]

/** The build phase each command belongs to. */
export const DOOR_COMMAND_PHASE: Readonly<Record<DoorCommand, 1 | 2>> = {
  create: 1, move: 1, dock: 1, offer: 1, skip: 1, class0: 1, outfit: 1, shipwright: 1, bank: 1, announce: 1, scan: 1, probe: 1, avoids: 1,
  attack: 2, retreat: 2, surrender: 2, deploy: 2, collect: 2, rob: 2, steal: 2, marshal: 2, backroom: 2, beacon: 2,
}

export function isDoorCommand(s: string): s is DoorCommand {
  return (DOOR_COMMANDS as readonly string[]).includes(s)
}
