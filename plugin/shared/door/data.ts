// HYPERPLANE: every game constant in one place, shared by the mod and the
// server. Numbers come from docs/door/research (cited as "research 0N §x");
// anything marked RECON is a reconstruction and safe to tune.
//
// Names, titles and blurbs here are original. Never put the source game's
// names in strings (see the rename table in docs/door/design.md).

export const GAME = {
  title: 'HYPERPLANE',
  /** The game date is real UTC time with this many years added. */
  yearOffset: 300,
} as const

// ---------------------------------------------------------------------------
// Sysop configuration (per season; players see a season as an "Epoch").
// Research 01 §1.1, §7.

export type TurnModel = 'continuous' | 'daily'

export type DoorConfig = {
  sectors: number
  /** Max ports as a % of sectors. */
  portPct: number
  /** Ports built at the Big Bang as a % of max ports. */
  portBuiltPct: number
  /** Max planets as a % of sectors. */
  planetPct: number
  /** Two-way links as a % of sectors. */
  twoWayPct: number
  /** One-way links as a % of sectors. */
  oneWayPct: number
  /** Outgoing warps per sector. */
  maxWarps: number
  /** Every sector is within this many hops of sector 1; also the plotter's limit. */
  maxCourse: number
  turnsPerDay: number
  /** 'continuous': turnsPerDay/24 an hour, capped. 'daily': reset at 00:00 UTC. */
  turnModel: TurnModel
  startCredits: number
  startFighters: number
  startHolds: number
  /** Port stock regeneration, % of capacity a day. */
  portRegenPct: number
  maxBank: number
  maxPlanetsPerSector: number
  maxCorpMembers: number
  /** Parked ships allowed per Concord Space sector. */
  concordShipLimit: number
  /** Concord protection requires fewer fighters than this. */
  concordFighterLimit: number
  /** Players idle this long are deleted at extern. */
  inactiveDays: number
  /** Show the Drydock's sector on the V screen. */
  showDrydock: boolean
  /** Door requests per player per UTC day. */
  dailyRequestCap: number
}

export const DEFAULT_CONFIG: DoorConfig = {
  sectors: 1000,
  portPct: 40,
  portBuiltPct: 95,
  planetPct: 20,
  twoWayPct: 30,
  oneWayPct: 3,
  maxWarps: 6,
  maxCourse: 45,
  turnsPerDay: 250,
  turnModel: 'continuous',
  startCredits: 300,
  startFighters: 30,
  startHolds: 20,
  portRegenPct: 5,
  maxBank: 500_000,
  maxPlanetsPerSector: 5,
  maxCorpMembers: 5,
  concordShipLimit: 5,
  concordFighterLimit: 50,
  inactiveDays: 30,
  showDrydock: true,
  dailyRequestCap: 2000,
}

/** Sectors 1..CONCORD_CORE are the Concord cluster (plus the Drydock's sector). */
export const CONCORD_CORE = 10

/** Turn costs of non-move actions (a warp costs the ship's turnsPerWarp). Research 01 §5.1. */
export const TURN_COSTS = { dock: 1, holo: 1, density: 0, probe: 0, rob: 1, steal: 1, retreat: 1, attack: 0 } as const

// ---------------------------------------------------------------------------
// Commodities and the price model. Research 01 §2, §3.1, §4. The three
// cargoes keep the source game's price tiers in order: Compute is the cheap
// one, Weights the dear one.

export const COMMODITIES = ['Compute', 'Data', 'Weights'] as const
export const COMMODITY_SHORT = ['Cmp', 'Dat', 'Wgt'] as const
export type Commodity = 0 | 1 | 2
export const COMMODITY_IDS: readonly Commodity[] = [0, 1, 2]

/** unit = BASE ± dayVar − expAdj − MCIC × FACTOR × fill. */
export const PRICE_BASE = [25.5, 50.5, 90.5] as const
export const PRICE_FACTOR = [0.25, 0.5, 0.9] as const
/** |MCIC| is drawn uniformly from these; the sign says sell (+) or buy (−). */
export const MCIC_RANGE: readonly (readonly [number, number])[] = [[40, 90], [30, 75], [20, 65]]
/** Player-built ports get these MCICs. */
export const MCIC_BUILT = { sell: 50, buy: -60 } as const
/** Per-commodity productivity at the bang (RECON); capacity = 10 × productivity. */
export const PRODUCTIVITY_RANGE = [30, 300] as const
export const CAPACITY_PER_PRODUCTIVITY = 10
export const PRODUCTIVITY_MAX = 6553
/** dayVar: a seeded daily value in 0..DAY_VAR_MAX (RECON for the weekday term). */
export const DAY_VAR_MAX = 18
/** Below this experience, expAdj = s × (FLOOR − exp) / PRICE_EXP_DIVISOR. */
export const PRICE_EXP_FLOOR = 1000
export const PRICE_EXP_DIVISOR = 100
/** A unit price below this is raised to it. */
export const PRICE_MIN_UNIT = 4
/** Opening offer = (1 + MCIC / OFFER_MCIC_DIVISOR) × exact. */
export const OFFER_MCIC_DIVISOR = 1000
/** Port accepts within exact × (1 ± |MCIC| / HAGGLE_TOLERANCE / round). */
export const HAGGLE_TOLERANCE = 250
/** Middle rounds before the final offer: 0..HAGGLE_MAX_MIDDLE, seeded per dock. */
export const HAGGLE_MAX_MIDDLE = 2
/** After each counter: exact' = (1 − DRIFT) × exact + DRIFT × bid. */
export const HAGGLE_DRIFT = 0.3
/** Selling port, round 1: a bid under exact / this is an insult (re-prompt). */
export const HAGGLE_FRIVOLOUS = 1.5
/** An open negotiation expires after this long, or at the next move. */
export const HAGGLE_TTL_MS = 10 * 60_000
/** Experience for landing within `within` (fraction) of the best price; first match wins. */
export const TRADE_XP: readonly { within: number; xp: number }[] = [
  { within: 0, xp: 5 },
  { within: 0.01, xp: 2 },
  { within: 0.02, xp: 1 },
]
/** Planet stock sold to a port in its sector, as a share of a normal offer. Research 01 §3.3. */
export const PLANET_TRADE_PCT = 0.6
/** Regen applied in one visit is capped at this % of capacity. Research 01 §2.3. */
export const PORT_REGEN_MAX_PER_VISIT = 100
/** Port upgrade per commodity: credits per +1 productivity (+10 units), and the experience and alignment it earns. Research 01 §2.4. */
export const PORT_UPGRADE = {
  cost: [250, 500, 900],
  exp: [0.1, 0.2, 0.3],
  align: [0.05, 0.1, 0.15],
} as const

/** Experience for a trade that landed `off` (a fraction, 0 = exact) from the best price. */
export function tradeXp(off: number): number {
  for (const t of TRADE_XP) if (off <= t.within + 1e-9) return t.xp
  return 0
}

// ---------------------------------------------------------------------------
// Ports. Research 01 §1.4, §1.5, §3.2.

export type PortClass = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
/** 0 = Haven-type special, 9 = the Drydock. */
export type PortClassId = 0 | PortClass | 9

export type PortClassSpec = {
  /** Cmp/Dat/Wgt: B = the port buys (you sell), S = it sells. */
  code: string
  /** % of ports at the Big Bang. */
  share: number
  /** Days to build when player-made. */
  buildDays: number
  buildExp: number
  buildAlign: number
}

export const PORT_CLASSES: Readonly<Record<PortClass, PortClassSpec>> = {
  1: { code: 'BBS', share: 20, buildDays: 6, buildExp: 25, buildAlign: 12 },
  2: { code: 'BSB', share: 20, buildDays: 7, buildExp: 29, buildAlign: 14 },
  3: { code: 'SBB', share: 20, buildDays: 8, buildExp: 34, buildAlign: 16 },
  4: { code: 'SSB', share: 10, buildDays: 5, buildExp: 20, buildAlign: 10 },
  5: { code: 'SBS', share: 10, buildDays: 4, buildExp: 16, buildAlign: 8 },
  6: { code: 'BSS', share: 10, buildDays: 3, buildExp: 12, buildAlign: 6 },
  7: { code: 'SSS', share: 5, buildDays: 2, buildExp: 7, buildAlign: 4 },
  8: { code: 'BBB', share: 5, buildDays: 10, buildExp: 45, buildAlign: 20 },
}
export const STANDARD_CLASSES: readonly PortClass[] = [1, 2, 3, 4, 5, 6, 7, 8]
export const CLASS_SPECIAL = 0
export const CLASS_DRYDOCK = 9

/** True if a class 1..8 port sells this commodity (S in its code). */
export function portSells(cls: PortClass, c: Commodity): boolean {
  return PORT_CLASSES[cls].code[c] === 'S'
}

export const SPECIAL_PORTS = {
  haven: { name: 'Haven', class: 0 },
  meridian: { name: 'Meridian', class: 0 },
  tycho: { name: 'Tycho Reach', class: 0 },
  drydock: { name: 'Drydock Anchorage', class: 9 },
} as const

/** Haven-type ports sell holds, fighters and shields on an 18-day triangle cycle. Research 01 §3.2, research 02 §2.2. */
export const CLASS0 = {
  /** Each hold costs this much more than the last. */
  holdStep: 20,
  holdBase: [151, 249],
  fighter: [160, 239],
  shield: [110, 189],
  cycleDays: 18,
  limpetRemoval: 5000,
} as const

/** A Class 0 price on a day number (whole UTC days since the epoch): low to high over half the cycle, then back. */
export function class0Price(range: readonly number[], day: number): number {
  const cycle = CLASS0.cycleDays
  const half = cycle / 2
  const phase = ((day % cycle) + cycle) % cycle
  const t = phase <= half ? phase / half : (cycle - phase) / half
  return Math.round(range[0] + (range[1] - range[0]) * t)
}

/** Cost of `n` more holds on a ship that has `current`, at hold base `base`. */
export function holdsCost(base: number, current: number, n: number): number {
  return base * n + CLASS0.holdStep * (n * current + (n * (n - 1)) / 2)
}

/** Robbing and stealing (alignment ≤ maxAlign). Research 01 §4.6; the ramp is RECON. */
export const ROB = {
  maxAlign: -100,
  /** Safe rob = robExpMult × experience credits. */
  robExpMult: 3,
  /** Safe steal = experience / stealExpDiv holds. */
  stealExpDiv: 30,
  /** Bust chance at or under the safe amount. */
  bustChance: 1 / 50,
  /** Added bust chance per hold (steal) or per robRampCredits (rob) over the safe amount. */
  bustRamp: 0.1,
  robRampCredits: 1000,
  bustExpLoss: 0.1,
  /** Steal bust: lose this share of the holds you tried to steal. */
  stealBustHolds: 0.09,
  /** Rob bust: lose 1 hold per this many credits attempted. */
  robBustCreditsPerHold: 1000,
  /** A second attempt at the port that last busted you always busts and costs this share of holds. */
  repeatBustHolds: 0.2,
  repeatBustAlign: -5,
  minHolds: 1,
  bustClearDays: 7,
  /** Displayed port credits are this share of what it really holds. */
  creditsShown: 0.9,
} as const

// ---------------------------------------------------------------------------
// Ships. Research 02 §1.

export type ScannerKind = 'none' | 'density' | 'holo'

export type ShipSpec = {
  id: number
  name: string
  /** Component costs; the ship's price is their sum. */
  parts: { holds: number; drive: number; computer: number; hull: number }
  initHolds: number
  maxHolds: number
  maxFighters: number
  fightersPerAttack: number
  maxShields: number
  turnsPerWarp: number
  offense: number
  defense: number
  /** Max of each mine type (contact, limpet). */
  mines: number
  beacons: number
  seeds: number
  /** Can mount a Jump Drive. */
  jump: boolean
  /** Best long-range scanner the hull can mount ('density' on the pod is built in). */
  scanner: ScannerKind
  /** Can mount a Planet Scanner. */
  planetScanner: boolean
  /** Photon missile capacity (0 = none). */
  photon: number
  /** Planetary transporter range in hops. */
  transportRange: number
  requires?: 'ceo' | 'commission'
  buyable: boolean
  /** Defensive odds when over its owner's (or corp's) planet. */
  planetDefense?: number
  /** Carries an interdictor generator. */
  interdictor?: boolean
  blurb: string
}

type Row = [
  name: string,
  parts: [number, number, number, number],
  initHolds: number, maxHolds: number, maxFighters: number, fightersPerAttack: number, maxShields: number,
  turnsPerWarp: number, odds: number, mines: number, beacons: number, seeds: number,
  jump: boolean, scanner: ScannerKind, planetScanner: boolean, photon: number, transportRange: number,
  blurb: string,
]

function ship(id: number, r: Row, extra: Partial<ShipSpec> = {}): ShipSpec {
  const [name, [holds, drive, computer, hull], initHolds, maxHolds, maxFighters, fightersPerAttack, maxShields,
    turnsPerWarp, odds, mines, beacons, seeds, jump, scanner, planetScanner, photon, transportRange, blurb] = r
  return {
    id, name, parts: { holds, drive, computer, hull }, initHolds, maxHolds, maxFighters, fightersPerAttack, maxShields,
    turnsPerWarp, offense: odds, defense: odds, mines, beacons, seeds, jump, scanner, planetScanner, photon, transportRange,
    buyable: true, blurb, ...extra,
  }
}

/** Indexed by id: 0 the pod, 1..16 the Shipwright's hulls, 17..19 the Hallucinations'. */
export const SHIPS: readonly ShipSpec[] = [
  ship(0, ['Escape Pod', [0, 0, 0, 0], 5, 5, 50, 10, 50, 6, 0.6, 0, 0, 0, false, 'density', false, 0, 0,
    'A seat, a beacon and a prayer. It gets you home, slowly.'], { buyable: false }),
  ship(1, ['Freetrader', [10_000, 1_000, 20_300, 10_000], 20, 75, 2_500, 750, 400, 3, 1.0, 50, 50, 5, false, 'holo', true, 0, 5,
    'The honest workhorse of the lanes. Room to grow and nothing to apologize for.']),
  ship(2, ['Skiff', [5_000, 3_000, 5_200, 2_750], 10, 25, 250, 250, 100, 2, 2.0, 0, 10, 0, false, 'holo', true, 0, 0,
    'Quick, cheap and hard to hit. There is no pod aboard, so do not get caught.']),
  ship(3, ['Lancer Frigate', [6_000, 1_000, 82_800, 11_000], 12, 60, 5_000, 2_000, 400, 3, 1.3, 5, 5, 0, false, 'none', false, 10, 2,
    'A launch rail with an engine bolted on. Carries photon missiles.']),
  ship(4, ['Ironclad', [8_000, 1_000, 61_500, 18_000], 16, 80, 10_000, 3_000, 750, 4, 1.6, 25, 50, 1, false, 'holo', true, 0, 8,
    'Thick plating and a mean disposition. Slow to turn, slower to die.']),
  ship(5, ['Consortium Flagship', [10_000, 5_000, 120_000, 28_500], 20, 85, 20_000, 6_000, 1_500, 3, 1.2, 100, 100, 10, true, 'holo', true, 0, 10,
    'A corporation\'s pride, sold only to its chief. One to a corp.'], { requires: 'ceo' }),
  ship(6, ['Colony Barge', [27_000, 1_000, 10_400, 25_200], 50, 250, 200, 100, 500, 6, 0.6, 0, 10, 5, false, 'none', true, 0, 7,
    'A cavern of a hold for settlers and their goods. Do not pick fights in it.']),
  ship(7, ['Bulk Hauler', [27_000, 1_000, 11_050, 12_900], 50, 125, 400, 125, 1_000, 4, 0.8, 1, 20, 2, false, 'holo', true, 0, 5,
    'Big holds, heavy shields, modest guns. Built for the long haul.']),
  ship(8, ['Fast Freighter', [15_000, 2_000, 9_600, 6_800], 30, 65, 300, 100, 500, 2, 0.8, 2, 20, 2, false, 'holo', true, 0, 5,
    'Light on its feet with a decent hold. The pair trader\'s friend.']),
  ship(9, ['Marshal\'s Cruiser', [23_000, 10_000, 231_000, 65_000], 40, 150, 50_000, 10_000, 2_000, 4, 1.5, 125, 150, 10, true, 'holo', true, 5, 15,
    'The Concord\'s own design, issued to commissioned pilots. Turn your coat and it turns on you.'], { requires: 'commission' }),
  ship(10, ['Gunboat', [6_000, 10_000, 48_000, 15_000], 12, 50, 10_000, 1_000, 3_000, 3, 1.2, 5, 5, 1, true, 'holo', false, 0, 6,
    'Shields first, questions later. Mounts a Jump Drive.']),
  ship(11, ['Wayfarer', [10_000, 10_000, 29_000, 12_300], 20, 73, 5_000, 1_000, 2_000, 3, 1.4, 50, 50, 5, false, 'holo', true, 0, 3,
    'A well-balanced explorer that can hold its own in a scrap.']),
  ship(12, ['Corvette', [10_000, 10_000, 39_500, 13_000], 20, 80, 5_000, 2_000, 750, 3, 1.4, 25, 50, 2, false, 'holo', true, 0, 6,
    'A fighting ship that hits harder than its size suggests.']),
  ship(13, ['Courier', [15_000, 10_000, 10_500, 6_750], 30, 60, 750, 250, 750, 2, 1.1, 5, 20, 1, false, 'holo', true, 0, 3,
    'Fast and roomy for the price. Light on teeth.']),
  ship(14, ['Warden', [5_000, 10_000, 25_000, 7_500], 10, 50, 2_500, 800, 4_000, 4, 1.0, 50, 10, 1, false, 'holo', false, 0, 3,
    'A picket ship. Over its own planet it is a wall.'], { planetDefense: 4.0 }),
  ship(15, ['Packhorse', [28_000, 10_000, 10_300, 15_300], 50, 150, 300, 150, 600, 4, 0.5, 0, 20, 1, false, 'holo', true, 0, 5,
    'Carries anything, fights nothing. Bring friends.']),
  ship(16, ['Interdictor', [5_000, 50_000, 380_000, 104_000], 10, 40, 100_000, 15_000, 4_000, 15, 1.2, 200, 100, 20, false, 'holo', true, 0, 20,
    'A fortress that crawls. Nothing leaves its sector while it watches.'], { interdictor: true }),
  ship(17, ['Glitch', [0, 0, 0, 31_900], 12, 50, 3_000, 1_000, 200, 2, 1.0, 10, 0, 0, false, 'holo', false, 0, 0,
    'A flicker at the edge of the scope that turns out to be very real.'], { buyable: false }),
  ship(18, ['Phantom', [0, 0, 0, 67_100], 16, 75, 8_000, 2_000, 800, 3, 1.2, 25, 0, 3, false, 'holo', false, 0, 2,
    'It was not on the last scan. It is on this one, and it is hungry.'], { buyable: false }),
  ship(19, ['Confabulator', [0, 0, 0, 139_000], 20, 100, 15_000, 5_000, 1_000, 4, 1.4, 50, 0, 6, false, 'holo', false, 1, 5,
    'The Hallucinations\' heaviest hull. When one appears, the lane empties.'], { buyable: false }),
]

export const POD = 0
export const START_SHIP = 1
/** The Hallucinations' hulls by population slot (research 03 §8.2). */
export const HALLUCINATION_SHIPS = [17, 18, 19] as const
/** The Hallucinations' home planet. */
export const HALLUCINATION_HOME = 'Overfit Prime'

export function shipCost(spec: ShipSpec): number {
  const p = spec.parts
  return p.holds + p.drive + p.computer + p.hull
}

/** Trade-in: parts × condition factor × parts share, plus equipment value × equipment share. */
export const TRADE_IN = { parts: 0.65, equipment: 0.35 } as const
export const RENAME_COST = 5000

// ---------------------------------------------------------------------------
// The Outfitter. Research 02 §2.1.

export type ItemId =
  | 'cracker' | 'beacon' | 'deadman' | 'cloak' | 'probe' | 'planetScanner' | 'contact' | 'limpet'
  | 'photon' | 'density' | 'holo' | 'disruptor' | 'seed' | 'jump1' | 'jump2' | 'lens'

export type ItemSpec = {
  id: ItemId
  /** Menu key at the Outfitter. */
  key: string
  name: string
  price: number
  /** Per-ship maximum: a number, or the ship's own limit of that kind. */
  max: number | 'mines' | 'beacons' | 'seeds' | 'photon'
  /** Build phase that enables it. */
  phase: 1 | 2 | 3 | 4
  blurb: string
}

export const ITEMS: readonly ItemSpec[] = [
  { id: 'probe', key: 'G', name: 'Ghost Probe', price: 3_000, max: 25, phase: 1, blurb: 'Flies a course ahead of you and reports every sector it passes.' },
  { id: 'density', key: 'N', name: 'Density Scanner', price: 2_000, max: 1, phase: 1, blurb: 'Reads the mass in neighboring sectors. Costs no turns to use.' },
  { id: 'holo', key: 'O', name: 'Holo Scanner', price: 25_000, max: 1, phase: 1, blurb: 'A full picture of every neighboring sector, density readings included.' },
  { id: 'lens', key: 'H', name: 'Haggle Lens', price: 10_000, max: 1, phase: 1, blurb: 'Tells you after each deal how close you came to the best price.' },
  { id: 'beacon', key: 'B', name: 'Marker Beacon', price: 100, max: 'beacons', phase: 2, blurb: 'Leaves a short message hanging in a sector for all to read.' },
  { id: 'deadman', key: 'D', name: 'Deadman Charge', price: 1_000, max: 1_500, phase: 2, blurb: 'Hidden charges that make your killer pay for the privilege.' },
  { id: 'contact', key: 'M', name: 'Contact Mine', price: 1_000, max: 'mines', phase: 2, blurb: 'Sits quietly in a sector until a stranger bumps into it.' },
  { id: 'limpet', key: 'L', name: 'Limpet Mine', price: 10_000, max: 'mines', phase: 2, blurb: 'Clings to a passing hull and reports where it goes.' },
  { id: 'disruptor', key: 'R', name: 'Mine Disruptor', price: 6_000, max: 10, phase: 2, blurb: 'Fired into a neighboring sector to clear a path through its mines.' },
  { id: 'cracker', key: 'C', name: 'Cracker Charge', price: 15_000, max: 5, phase: 3, blurb: 'Enough to split a planet. Handle with great care.' },
  { id: 'planetScanner', key: 'P', name: 'Planet Scanner', price: 30_000, max: 1, phase: 3, blurb: 'Reads a planet\'s owner and defenses before you land.' },
  { id: 'seed', key: 'S', name: 'Seed Torpedo', price: 20_000, max: 'seeds', phase: 3, blurb: 'Fire it into empty space and a new world condenses.' },
  { id: 'cloak', key: 'K', name: 'Cloak', price: 25_000, max: 5, phase: 4, blurb: 'One use. Sit still and vanish from every scope for a while.' },
  { id: 'photon', key: 'X', name: 'Photon Missile', price: 40_000, max: 'photon', phase: 4, blurb: 'Blinds a sector\'s defenses for a moment. Launch racks only.' },
  { id: 'jump1', key: 'J', name: 'Jump Drive I', price: 50_000, max: 1, phase: 4, blurb: 'Skips the lanes entirely to any sector your fighters hold.' },
  { id: 'jump2', key: 'W', name: 'Jump Drive II', price: 80_000, max: 1, phase: 4, blurb: 'A Jump Drive with the power to bring a second ship along.' },
]

export const ITEM_BY_ID = Object.fromEntries(ITEMS.map(i => [i.id, i])) as Readonly<Record<ItemId, ItemSpec>>

/** The most of an item a ship can carry (0 when the hull cannot mount it). */
export function itemMax(item: ItemSpec, ship: ShipSpec): number {
  switch (item.id) {
    case 'density': return ship.scanner === 'none' ? 0 : 1
    case 'holo': return ship.scanner === 'holo' ? 1 : 0
    case 'planetScanner': return ship.planetScanner ? 1 : 0
    case 'jump1': case 'jump2': return ship.jump ? 1 : 0
  }
  return typeof item.max === 'number' ? item.max : ship[item.max]
}

// ---------------------------------------------------------------------------
// Scanners and combat. Research 01 §5.4, research 02 §3, §4.

/** Density scan weights; they add up. A cloaked ship adds 0 but sets the anomaly flag, as does a limpet. */
export const DENSITY = {
  empty: 0,
  beacon: 1,
  limpet: 2,
  fighter: 5,
  contactMine: 10,
  navhazPct: 21,
  unmannedShip: 38,
  mannedShip: 40,
  destroyedPort: 50,
  port: 100,
  /** A Glitch reads like a manned ship. */
  glitch: 40,
  /** Phantom and Confabulator. */
  hallucinationHeavy: 100,
  planet: 500,
} as const

/** The three Concord patrol ships: indestructible, with these densities. */
export const MARSHALS = [
  { name: 'Marshal Ostrander', density: 489 },
  { name: 'Commodore Vale', density: 462 },
  { name: 'High Marshal Teague', density: 512 },
] as const

export const COMBAT = {
  /** Attack power = sent × odds × (1 ± jitter). */
  jitter: 0.05,
  /** The defender flees if sent > fleeRatio × (its fighters + shields). */
  fleeRatio: 1.25,
  /** Damage beyond overkill × what was needed salvages nothing. */
  overkill: 2,
  deadmanDamage: 20,
  contactMineDamage: 20,
  /** Share of a sector's contact mines that detonate on entry (rounded down). */
  mineDetonate: 0.5,
  maxMinesPerSector: 250,
  tollPerFighter: 5,
  /** Offensive fighters send offensiveRatio × (target max fighters + max shields). */
  offensiveRatio: 1.25,
  /** NavHaz hits with chance = haz%, for navhazDamagePerPct × haz% damage. */
  navhazDamagePerPct: 10,
  /** NavHaz added per planet destroyed (%). */
  navhazPerPlanet: 10,
  /** Deaths in a day before the next one keeps you out until tomorrow. */
  maxDeathsPerDay: 2,
  podExpLoss: 0.1,
  deathExpLoss: 0.5,
  deathAlignLoss: 0.5,
  /** A pod escaping a kill runs this many hops (min, max) along a safe path. */
  podHops: [3, 20],
  /** Attacking a Marshal, or a protected trader in Concord Space. */
  marshalDamage: 150_000,
  marshalAlignLoss: 10,
  marshalExpLoss: 0.1,
  /** What an evil pilot in a Marshal's Cruiser meets. */
  turncoatDamage: 50_000,
  /** Concord protection needs experience under this (and alignment ≥ 0, fighters < config.concordFighterLimit). */
  concordMaxExp: 1000,
  /** Extern tows ships parked in Concord Space with at least this many fighters. */
  concordTowFighters: 100,
  /** Max fighters deployed in a sector that holds a planet. */
  maxFightersWithPlanet: 50_000,
  /** Mines one disruptor destroys, at most. */
  disruptorMines: 12,
  /** Odds sector fighters fight at (defensive and toll). */
  sectorFighterOdds: 1,
  /** Grudge points a Hallucination ship takes when fought (research 03 §8.2). */
  grudgePerShip: 3,
} as const

/** Experience and alignment awards. Research 02 §5.2. */
export const AWARDS = {
  dailyLogin: { exp: 1, align: 1 },
  createPlanet: { exp: 25, align: 10 },
  destroyPort: { exp: 50, align: -50 },
  /** Cracking a planet: exp by citadel level (0 = none), plus 1 per expColonists colonist groups. Research 03 §6. */
  destroyPlanet: { exp: [50, 100, 150, 200, 250, 300, 350], expColonists: 200, align: -1 },
  /** Fighters you lose fighting another's fighters, divided by this, is your experience. */
  figExpDivisor: { opposite: 15, same: 35, neutral: 25 },
  /** Podding a trader: this share of the victim's experience... */
  podExpShare: 0.1,
  /** ...and this share of its alignment, sign flipped. */
  podAlignShare: 0.5,
  /** Posting a Marshal's reward: +1 alignment per this many credits. */
  rewardAlignPer: 1000,
  /** Posting a Back Room hit: −1 alignment per this many credits. */
  hitAlignPer: 250,
  /** Alignment needed to apply for a commission, and what it is set to. */
  commissionApply: 500,
  commissionGrant: 1000,
  /** The Back Room admits alignment ≤ this. */
  backRoomMaxAlign: 100,
  /** The Marshal's Office admits alignment ≥ this. */
  marshalOfficeMinAlign: -50,
  /** Swearing at Old Sal, once a day. */
  swear: { exp: -1, align: -1 },
  /** Concord tax on good traders entering with credits on hand over the threshold, once a day. */
  tax: { threshold: 100_000, rate: 0.05, alignPer: 1500 },
} as const

/** The Last Light (tavern) and Old Sal. Prices besides the announcement are RECON. */
export const LAST_LIGHT = {
  announceCost: 100,
  traceCost: 1_000,
  passwordCost: 5_000,
} as const

// ---------------------------------------------------------------------------
// Ranks and alignment. Research 02 §5.1: rank n at 2^n experience.

export const RANKS_GOOD = [
  'Civilian', 'Deckhand', 'Spacer', 'Able Spacer', 'Rigger', 'Leading Spacer',
  'Petty Officer', 'Chief Petty Officer', 'Boatswain', 'Master Boatswain', 'Warrant Pilot',
  'Senior Pilot', 'Flight Officer', 'Second Mate', 'First Mate', 'Lane Captain',
  'Senior Captain', 'Wing Leader', 'Group Leader', 'Lane Warden', 'Concord Envoy',
  'Lord Marshal', 'High Marshal',
] as const

export const RANKS_EVIL = [
  'Drifter', 'Scrounger', 'Petty Thief', 'Pickpocket', 'Cutpurse', 'Grifter',
  'Fence', 'Runner', 'Gunrunner', 'Black Marketeer', 'Racketeer',
  'Hijacker', 'Brigand', 'Freebooter', 'Corsair', 'Marauder',
  'Warlord', 'Dread Corsair', 'Outlaw Baron', 'Concord\'s Bane', 'Void Tyrant',
  'Star Despot', 'Black Sun',
] as const

export const MAX_RANK = 22

/** Rank 0..22: rank n is reached at 2^n experience. */
export function rankOf(exp: number): number {
  let r = 0
  while (r < MAX_RANK && exp >= 2 ** (r + 1)) r++
  return r
}

/** Experience needed for rank n. */
export function rankExp(n: number): number {
  return n <= 0 ? 0 : 2 ** Math.min(n, MAX_RANK)
}

/** Title for the rank, from the evil ladder when alignment is negative. */
export function rankTitle(exp: number, align: number): string {
  return (align < 0 ? RANKS_EVIL : RANKS_GOOD)[rankOf(exp)]
}

/** Evil to good. ALIGN_NEUTRAL covers −124..124; each word out is ALIGN_BAND further, clamped at the ends (≤ −875, ≥ +1000). */
export const ALIGN_WORDS = [
  'Monstrous', 'Vicious', 'Ruthless', 'Treacherous', 'Crooked', 'Shifty', 'Surly',
  'Neutral',
  'Fair', 'Decent', 'Honest', 'Generous', 'Upright', 'Noble', 'Valiant', 'Exemplary',
] as const
export const ALIGN_BAND = 125
export const ALIGN_NEUTRAL = 7

export function alignWord(align: number): string {
  const i = ALIGN_NEUTRAL + Math.trunc(align / ALIGN_BAND)
  return ALIGN_WORDS[Math.max(0, Math.min(ALIGN_WORDS.length - 1, i))]
}

// ---------------------------------------------------------------------------
// Planets and citadels (phase 3). Research 03 §1 to §6. Colonists count in
// groups of 1,000 (one hold each).

export type PlanetClassKey = 'T' | 'D' | 'O' | 'H' | 'G' | 'V' | 'J'

export type PlanetClassSpec = {
  key: PlanetClassKey
  name: string
  /** Colonist groups per product unit, per line [cmp, dat, wgt] (0 = the line produces nothing). */
  ratio: readonly [number, number, number]
  /** Fighters a day = products made / fighterFactor (0 = none). */
  fighterFactor: number
  /** Colonist groups each line holds; production peaks at half. */
  maxColonists: number
  storage: readonly [number, number, number]
  /** On each landing: chance of losing deathPct of the colonists. */
  deathChance: number
  deathPct: number
  /** Seed Torpedo roll weight in an empty sector. */
  genesisWeight: number
  blurb: string
}

export const PLANET_CLASSES: Readonly<Record<PlanetClassKey, PlanetClassSpec>> = {
  T: { key: 'T', name: 'Terran', ratio: [3, 7, 13], fighterFactor: 10, maxColonists: 30_000, storage: [100_000, 100_000, 100_000], deathChance: 0, deathPct: 0, genesisWeight: 30, blurb: 'Mild and fertile. Good at everything, prone to crowding.' },
  D: { key: 'D', name: 'Desert', ratio: [2, 100, 500], fighterFactor: 15, maxColonists: 40_000, storage: [200_000, 50_000, 10_000], deathChance: 0.02, deathPct: 0.02, genesisWeight: 15, blurb: 'Dry and baking. Rich in the first line, little else.' },
  O: { key: 'O', name: 'Oceanic', ratio: [20, 2, 100], fighterFactor: 15, maxColonists: 200_000, storage: [100_000, 1_000_000, 50_000], deathChance: 0.02, deathPct: 0.02, genesisWeight: 15, blurb: 'One endless sea. The best second line anywhere.' },
  H: { key: 'H', name: 'Highland', ratio: [2, 5, 20], fighterFactor: 12, maxColonists: 40_000, storage: [200_000, 200_000, 100_000], deathChance: 0.03, deathPct: 0.02, genesisWeight: 15, blurb: 'Ridges and valleys. Strong in the first two lines.' },
  G: { key: 'G', name: 'Glacial', ratio: [50, 100, 500], fighterFactor: 25, maxColonists: 100_000, storage: [20_000, 50_000, 10_000], deathChance: 0.05, deathPct: 0.08, genesisWeight: 7, blurb: 'Ice to the core. Few would choose to live here.' },
  V: { key: 'V', name: 'Volcanic', ratio: [1, 0, 500], fighterFactor: 50, maxColonists: 100_000, storage: [1_000_000, 10_000, 100_000], deathChance: 0.07, deathPct: 0.1, genesisWeight: 10, blurb: 'No soil, all fire. Unmatched first line; colonists set to the second die.' },
  J: { key: 'J', name: 'Jovian', ratio: [0, 0, 0], fighterFactor: 0, maxColonists: 3_000, storage: [10_000, 10_000, 10_000], deathChance: 0.08, deathPct: 0.12, genesisWeight: 8, blurb: 'A gas giant. Nothing grows, but it makes a fine vault.' },
}
export const PLANET_CLASS_KEYS: readonly PlanetClassKey[] = ['T', 'D', 'O', 'H', 'G', 'V', 'J']
export const PLANET_MAX_FIGHTERS = 1_000_000
/** Daily growth below half a line's cap, and decline rate above it (RECON). */
export const PLANET_GROWTH = { grow: 0.015, decline: 0.02 } as const

export type CitadelLevelCost = { colonists: number; cmp: number; dat: number; wgt: number; days: number }

function levels(col: number[], cmp: number[], dat: number[], wgt: number[], days: number[]): CitadelLevelCost[] {
  return col.map((colonists, i) => ({ colonists, cmp: cmp[i], dat: dat[i], wgt: wgt[i], days: days[i] }))
}

/** Cost of citadel levels 1..6 (index 0 = level 1); colonists in groups. Research 03 §5 (D level 5 uses the v2 figure, 300). */
export const CITADEL_COSTS: Readonly<Record<PlanetClassKey, readonly CitadelLevelCost[]>> = {
  T: levels([1000, 2000, 4000, 6000, 6000, 6000], [300, 200, 500, 1000, 300, 1000], [200, 50, 250, 1200, 400, 1200], [250, 250, 500, 1000, 1000, 2000], [4, 4, 5, 10, 5, 15]),
  D: levels([1000, 2400, 4400, 7000, 8000, 7000], [400, 300, 600, 700, 300, 700], [300, 80, 400, 900, 400, 900], [600, 400, 650, 800, 1000, 1600], [6, 5, 8, 5, 4, 8]),
  O: levels([1400, 2400, 4400, 7000, 8000, 7000], [500, 200, 600, 700, 300, 700], [200, 50, 400, 900, 400, 900], [400, 300, 650, 800, 1000, 1600], [6, 5, 8, 5, 4, 8]),
  H: levels([400, 1400, 3600, 5600, 7000, 5600], [150, 200, 600, 1000, 300, 1000], [100, 50, 250, 1200, 400, 1200], [150, 250, 700, 1000, 1000, 2000], [2, 5, 5, 8, 5, 12]),
  G: levels([1000, 2400, 4400, 6600, 9000, 6600], [400, 300, 600, 700, 300, 700], [300, 80, 400, 900, 400, 900], [600, 400, 650, 700, 1000, 1400], [5, 5, 7, 5, 4, 8]),
  V: levels([800, 1600, 4400, 7000, 10000, 7000], [500, 300, 1200, 2000, 3000, 2000], [300, 100, 400, 2000, 1200, 2000], [600, 400, 1500, 2500, 2000, 5000], [4, 5, 8, 12, 5, 18]),
  J: levels([3000, 3000, 8000, 6000, 8000, 6000], [1200, 300, 500, 500, 200, 500], [400, 100, 500, 200, 200, 200], [2500, 400, 2000, 600, 600, 1200], [8, 4, 5, 5, 4, 8]),
}

/** What each citadel level adds, index 0 = level 1. */
export const CITADEL_LEVELS = ['Treasury', 'Combat Computer', 'Mass Driver', 'Planetary Jump', 'Planetary Shields', 'Interdictor'] as const

export const CITADEL = {
  /** Treasury interest a day. */
  interest: 0.02,
  /** Planetary jump: Compute per sector moved (the source game's fuel). */
  jumpOrePerSector: 400,
  /** Interdictor: Compute per escape attempt. */
  interdictOre: 500,
  transporterBase: 50_000,
  transporterPerHop: 25_000,
  /** Transporter use: planet Compute per sector. */
  transporterOrePerSector: 10,
  /** Ship shields per planetary shield. */
  shieldRatio: 10,
  /** Invaders fight planetary shields at this ratio. */
  shieldOdds: 20,
  /** Planetary shields at or above this stop photons. */
  photonProofShields: 200,
  /** Military reaction fighters attack at 2:1; the rest defend at 3:1. */
  reactionOdds: 2,
  defenseOdds: 3,
  /** Mass Driver sector shot: damage = Compute used / this. */
  sectorShotDivisor: 3,
  /** Atmospheric shot: damage = Compute × A%, using this share of it. */
  atmosphericOreShare: 0.5,
} as const

/** Terra, in sector 1: the colonist source. */
export const TERRA = { max: 100_000, start: 50_000, regenPerDay: 1500 } as const
