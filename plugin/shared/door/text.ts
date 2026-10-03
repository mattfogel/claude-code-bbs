// HYPERPLANE: the game's prose. Haggle lines, Old Sal, death notices, the
// intro, the instructions, per-menu help and the daily-log templates. All
// original. Pipe codes allowed; every line is at most 78 visible columns.
//
// Colors follow the door's convention: |10 green labels, |11 cyan data,
// |14 yellow numbers, |12 red for danger, |03/|09 for the ice trim, |08 for
// asides and things that come later.
//
// Templates use {name} {ship} {sector} {n} and friends; fill them with fill().

/** Replaces `{key}` with `vars[key]`; unknown keys are left as typed. */
export function fill(template: string, vars: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{([a-zA-Z]+)\}/g, (m, k: string) => (vars[k] === undefined ? m : String(vars[k])))
}

// ---------------------------------------------------------------------------
// The haggle

/** The port walks away from the deal. */
export const REFUSALS: readonly string[] = [
  'We\'re not interested. Close the hatch on your way out.',
  'Not at that price. Not at any price, now.',
  'You\'re wasting both our turns. Good day.',
  'The broker laughs, then stops laughing. Deal\'s off.',
  'That number is an insult to my ancestors and my accountant.',
  'No. Try the next port. Try it soon.',
  'Our model rates that offer as noise. We decline.',
  'The comm goes quiet. Then: "No." Then nothing at all.',
  'Come back when you\'ve learned to count.',
  'We\'ve had better offers from the Hallucinations.',
]

/** Lead-ins to the port's last word; the client appends the price. */
export const FINAL_OFFER: readonly string[] = [
  'Fine. Our final offer is',
  'Last time, so listen. We\'ll do',
  'This is where it ends. Take it or leave it:',
]

/** Lead-ins to a counter-offer; the client appends the price. */
export const COUNTER: readonly string[] = [
  'We were thinking more like',
  'Interesting. How about',
  'Hm. We could stretch to',
]

/** Trade experience earned: {n} is the experience. */
export const TRADE_XP_LINES: Readonly<{ good: string; great: string; excellent: string }> = {
  good: '|10Not bad. |07The broker nods once. You earn |14{n}|07 experience.',
  great: '|10Sharp work. |07The broker frowns at a ledger. |14{n}|07 experience.',
  excellent: '|11Perfect. |07You found the very edge of the deal. |14{n}|07 experience.',
}

/** Haggle Lens verdicts, worst to best (index by how close you came). */
export const APPRAISALS: readonly string[] = [
  'You were robbed, and you said thank you.',
  'A gift to the port. They\'ll name a bench after you.',
  'Generous. Very generous. Too generous.',
  'You paid the tourist rate.',
  'Middling. The broker didn\'t even look up.',
  'Fair, in the way weather is fair.',
  'Respectable. Your mother would approve.',
  'Tight. The broker checked the figures twice.',
  'Nearly flawless. A rounding error away.',
  'Optimal. Gradient zero. Nothing left on the table.',
]

// ---------------------------------------------------------------------------
// The Last Light: Old Sal

export const OLD_SAL: Readonly<{
  greeting: readonly string[]
  rude: readonly string[]
  traceSold: string
  passwordSold: string
  fortunes: readonly string[]
}> = {
  greeting: [
    '|07In the back booth, under the only lamp that works, sits |11Old Sal|07.',
    '|07Sal has been drinking the same glass since before the lanes opened.',
    '|03"Sit if you\'re buying. Stand if you\'re not. Leave if you\'re a Marshal."',
  ],
  rude: [
    '|07Sal sets the glass down very slowly. |03"Say that again. Go on."',
    '|07The booth goes cold. You feel a little less |12honest|07 than you did.',
  ],
  traceSold: '|03"|11{name}|03? Last I heard, sector |14{sector}|03. Don\'t say who told you."',
  passwordSold: '|03"The Back Room door. Knock twice, say |14{password}|03. Then forget me."',
  fortunes: [
    'The cheap cargo is cheap for a reason. So is the dear one.',
    'Every port wants something. Most of them want it from you.',
    'A ship full of Weights is a ship somebody else wants.',
    'Never trust a captain whose name you can\'t look up.',
    'The shortest lane is the one everybody waits on.',
    'Holds are cheaper today than tomorrow. They always are.',
    'If a deal looks perfect, check whose hands are on the scale.',
    'The Concord keeps the peace. It keeps the receipts, too.',
    'Out past the core, the stars stop agreeing with each other.',
    'You\'ll make your fortune in pairs. Two ports. Back and forth.',
  ],
}

// ---------------------------------------------------------------------------
// Death

export const DEATH: Readonly<{ podded: readonly string[]; destroyed: readonly string[]; outForTheDay: readonly string[] }> = {
  podded: [
    '|12Your hull splits. |07The escape pod fires before you can think about it.',
    '|07You tumble away in a can the size of a closet, holding what you had on.',
    '|07Cargo, fighters and pocket money are stardust now. |10Your bank is safe.',
  ],
  destroyed: [
    '|12The |11{ship}|12 comes apart around you.',
    '|07There is a moment of very bright light, and then a lot of quiet.',
    '|07Somewhere a clerk files the paperwork. Experience lost: |14{n}|07.',
  ],
  outForTheDay: [
    '|12You are in no shape to fly.',
    '|07The medics at Haven want you in a bed until tomorrow, UTC.',
    '|08Come back after midnight. The lanes will still be here. Probably.',
  ],
}

// ---------------------------------------------------------------------------
// Intro and instructions

export const INTRO: readonly string[] = [
  '|07Somewhere past the last survey beacon, space folds over on itself like',
  '|07a crumpled sheet. Ten thousand light years become a handful of hops.',
  '|07Along the folds runs the |11trade lattice|07: sectors joined by warp lanes,',
  '|07ports strung along them, each one buying cheap and selling dear.',
  '',
  '|07The cargo is |11Compute|07, |11Data|07 and |11Weights|07. Everyone needs it.',
  '|07Nobody has enough of it in the right place.',
  '',
  '|07In the core the |11Concord|07 keeps order, and its |11Marshals|07 keep the Concord.',
  '|07Out at the edges, the |12Hallucinations|07 raid anything that looks real.',
  '',
  '|07You start at |11Haven|07, sector |141|07, in a secondhand |11Freetrader|07 with',
  '|14300|07 credits and a tank of optimism. The rest is up to you.',
]

/** About six pages of at most 18 lines each. */
export const INSTRUCTIONS: readonly (readonly string[])[] = [
  [
    '|11MOVING',
    '',
    '|07Type a sector number at the |10Command|07 prompt to go there. If it is next',
    '|07door, you warp straight in. If not, the ship plots the shortest course',
    '|07and asks whether to engage the |11autopilot|07:',
    '',
    '|08  [Y]es    stop for anything interesting along the way',
    '|08  [N]o     never mind',
    '|08  [E]xpress  fly straight through, stopping only for trouble',
    '',
    '|07Each warp costs your ship\'s |11turns per warp|07. Bigger ships are slower.',
    '|07Lanes are mostly two-way. A few are not. The plotter knows the difference.',
    '',
    '|07The |10C|07omputer (|10C|07, then |10F|07) plots a course without flying it.',
    '|07Mark sectors to |10avoid|07 and the plotter will route around them.',
  ],
  [
    '|11THE SECTOR DISPLAY',
    '',
    '|07Every time you arrive, the display shows:',
    '',
    '|10  Sector  |07its number, and its region if it has one',
    '|10  Beacon  |07any message left hanging here',
    '|10  Ports   |07the port, its name and its class',
    '|10  Planets |07worlds in orbit',
    '|10  Ships   |07other traders, Drifters, worse',
    '|10  Fighters|07 and |10Mines|07, if someone has claimed the place',
    '|10  Warps   |07where you can go next',
    '',
    '|07Warps you have never visited show in |12(parentheses)|07. Press |10D|07 any',
    '|07time to see the display again. It costs nothing.',
  ],
  [
    '|11PORTS AND TRADING',
    '',
    '|07Every port deals in all three cargoes, buying some and selling others.',
    '|07Its |10class|07 is a code of three letters, one per cargo, in order:',
    '|11Compute|07, |11Data|07, |11Weights|07. |10B|07 means it buys, |10S|07 means it sells.',
    '',
    '|08  Class 1 BBS   Class 2 BSB   Class 3 SBB   Class 4 SSB',
    '|08  Class 5 SBS   Class 6 BSS   Class 7 SSS   Class 8 BBB',
    '',
    '|07The trick is the |11pair|07: two ports next to each other that want',
    '|07opposite things. Buy where it sells, sell where it buys, warp back,',
    '|07repeat. A good pair is worth more than a good ship.',
    '',
    '|07Docking costs one turn. Prices drop as a port\'s stock runs down, and',
    '|07stock comes back slowly, about five percent a day.',
  ],
  [
    '|11HAGGLING',
    '',
    '|07When you dock, the port names a price. You can take it, or name your own.',
    '|07Push too hard and the broker walks away; the turn is gone either way.',
    '',
    '|07Each counter-offer moves the port a little toward you. After a round or',
    '|07two it makes a |11final offer|07. Miss that and the deal is off.',
    '',
    '|07Land close to the best price the port would ever have taken and you earn',
    '|11experience|07: a little for close, more for very close, a lot for exact.',
    '|07A |10Haggle Lens|07 from the Outfitter tells you how close you came.',
    '',
    '|07Brokers are tougher on newcomers. Experience buys you better numbers.',
  ],
  [
    '|11HAVEN AND THE DRYDOCK',
    '',
    '|07|11Haven|07 (sector 1) and the other class 0 ports, |11Meridian|07 and',
    '|11Tycho Reach|07, sell |10cargo holds|07, |10fighters|07 and |10shields|07. Each hold costs',
    '|0720 credits more than the one before it, so buy early.',
    '',
    '|07The |11Drydock|07 (class 9) is the big station. Inside:',
    '',
    '|10  Shipwright     |07new hulls, trade-ins, renames',
    '|10  Outfitter      |07scanners, probes, the Haggle Lens, and later worse',
    '|10  Exchange Bank  |07money that survives you',
    '|10  Marshal\'s Office|07 bounties and commissions (later)',
    '|10  The Last Light |07drinks, announcements, and Old Sal',
    '',
    '|07Press |10V|07 to see where the Drydock is, if the sysop allows it.',
  ],
  [
    '|11SCANNERS, TURNS AND STANDING',
    '',
    '|07A |10density scanner|07 reads the mass next door for free. A |10holo scanner|07',
    '|07shows every neighboring sector in full, for one turn. A |10Ghost Probe|07 flies',
    '|07a course ahead of you and reports back, unless something eats it.',
    '',
    '|07|11Turns|07 come back steadily through the day, up to a cap. Looking around,',
    '|07the computer and help are always free.',
    '',
    '|07|11Experience|07 sets your rank: each rank needs twice the last. |11Alignment',
    '|07sets which ladder you climb. Honest trade and Concord service raise it;',
    '|07theft and murder sink it.',
    '',
    '|07|11Concord Space|07 is sectors 1 to 10 and the Drydock. There, new and honest',
    '|07pilots are protected. The Marshals do not ask twice.',
  ],
]

// ---------------------------------------------------------------------------
// Per-menu help. Each line is one key and what it does.

const k = (key: string, text: string, later = false) =>
  `|08<|11${key}|08> ${later ? '|08' : '|07'}${text}${later ? ' (later)' : ''}`

export const HELP: Readonly<Record<string, readonly string[]>> = {
  command: [
    k('#', 'Type a sector number to warp there (autopilot if far)'),
    k('M', 'Move to a sector'),
    k('D', 'Redisplay the current sector'),
    k('P', 'Dock at the port here and trade'),
    k('S', 'Scan neighboring sectors (density or holo)'),
    k('C', 'Onboard computer: courses, port reports, the map'),
    k('I', 'Your trader and ship, in full'),
    k('/', 'Quick stats'),
    k('V', 'Epoch status, rankings and the daily log'),
    k('E', 'Launch a Ghost Probe'),
    k('L', 'Land on a planet', true),
    k('A', 'Attack a ship in this sector', true),
    k('F', 'Deploy or collect fighters', true),
    k('H', 'Deploy or collect mines', true),
    k('U', 'Fire a Seed Torpedo', true),
    k('T', 'Corporation menu', true),
    k('Q', 'Quit to the BBS (your ship waits where it is)'),
    k('?', 'This list'),
  ],
  computer: [
    k('F', 'Plot a course between two sectors'),
    k('I', 'List the warps out of a sector'),
    k('K', 'Your known universe: sectors explored'),
    k('R', 'Port report from your last visit'),
    k('V', 'Avoid a sector when plotting'),
    k('X', 'List or clear your avoids'),
    k('L', 'Ship catalog: every hull and its numbers'),
    k('G', 'The ranks of the good'),
    k('E', 'The ranks of the other kind'),
    k('Q', 'Leave the computer'),
  ],
  port: [
    k('T', 'Trade: the port offers what it buys, then what it sells'),
    k('Y', 'Accept the offer on the table'),
    k('#', 'Type your own price to counter'),
    k('0', 'Skip this cargo'),
    k('R', 'Rob the port\'s credits', true),
    k('S', 'Steal cargo from the port', true),
    k('U', 'Upgrade the port', true),
    k('Q', 'Undock'),
  ],
  class0: [
    k('H', 'Buy cargo holds (each costs 20 more than the last)'),
    k('F', 'Buy fighters'),
    k('S', 'Buy shield points'),
    k('L', 'Remove a limpet from your hull', true),
    k('Q', 'Undock'),
  ],
  drydock: [
    k('S', 'The Shipwright: hulls, trade-ins, renames'),
    k('O', 'The Outfitter: equipment and devices'),
    k('B', 'The Exchange Bank'),
    k('M', 'The Marshal\'s Office', true),
    k('T', 'The Last Light'),
    k('Q', 'Leave the Drydock'),
  ],
  outfitter: [
    k('G', 'Ghost Probe: flies ahead and reports'),
    k('N', 'Density Scanner: free look next door'),
    k('O', 'Holo Scanner: the full picture, one turn'),
    k('H', 'Haggle Lens: how close you came'),
    k('B', 'Marker Beacon', true),
    k('M', 'Contact Mine', true),
    k('L', 'Limpet Mine', true),
    k('S', 'Seed Torpedo', true),
    k('Q', 'Leave the Outfitter'),
  ],
  shipwright: [
    k('B', 'Buy a ship (your current one is taken in trade)'),
    k('S', 'Sell a spare ship docked here'),
    k('R', 'Rename your ship (5,000 credits)'),
    k('L', 'Ship catalog'),
    k('Q', 'Leave the Shipwright'),
  ],
  bank: [
    k('D', 'Deposit credits'),
    k('W', 'Withdraw credits'),
    k('T', 'Transfer credits to another trader'),
    k('E', 'Examine your balance'),
    k('Q', 'Leave the bank'),
  ],
  tavern: [
    k('A', 'Make an announcement (100 credits, goes in the daily log)'),
    k('S', 'Talk to Old Sal'),
    k('G', 'Read or write on the graffiti wall', true),
    k('B', 'The Back Room', true),
    k('Q', 'Leave The Last Light'),
  ],
}

// ---------------------------------------------------------------------------
// The daily log

export const LOG_TEMPLATES: Readonly<{
  join: string
  announce: string
  epoch: string
  newDay: string
  commission: string
  destroyed: string
  podded: string
  planetCreated: string
  planetCracked: string
  portDestroyed: string
  raid: string
}> = {
  join: '|10{name} |07signs on as captain of the |11{ship}|07.',
  announce: '|14{name}|07: {text}',
  epoch: '|11Epoch {n} begins. |07The lattice unfolds: |14{sectors}|07 sectors.',
  newDay: '|08-=-=- {date} -=-=-',
  commission: '|10{name} |07takes delivery of the |11{ship}|07, a new {class}.',
  destroyed: '|12{name}|07\'s |11{ship}|07 was destroyed in sector |14{sector}|07.',
  podded: '|12{name}|07 was podded in sector |14{sector}|07 and lived to complain.',
  planetCreated: '|10{name} |07seeded a new world, |11{planet}|07, in sector |14{sector}|07.',
  planetCracked: '|12{name} |07cracked |11{planet}|07 in sector |14{sector}|07. Pieces everywhere.',
  portDestroyed: '|12{port}|07 in sector |14{sector}|07 is gone. |08Forwarding address unknown.',
  raid: '|12The Hallucinations|07 hit sector |14{sector}|07 with |14{n}|07 ships.',
}
