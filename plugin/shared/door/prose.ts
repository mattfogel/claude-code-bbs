// HYPERPLANE: prose the SERVER writes into events and mail (the Marshal's
// Office, Old Sal, the Back Room, Marshal punishments, salvage, reports for
// absent pilots). All original. Pipe codes allowed; every line is at most 78
// visible columns once its {fields} are filled with names of up to 16
// characters (test/door/prose.test.ts checks that).
//
// Keep to the door's colors: |10 green labels, |11 cyan data, |14 yellow
// numbers, |12 red for danger, |07 body text, |08 asides, |03 for speech.

import { fill } from './text'

export { fill }

export const PROSE = {
  // ---- Concord Law ---------------------------------------------------------
  /** Attacking a Marshal or a protected trader in Concord Space. */
  concordPunish: [
    '|12{marshal}|07 drops out of the glare without a word.',
    '|07One volley. Your |11{ship}|07 stops being a ship.',
    '|07Concord Law is not a suggestion. |12-10|07 alignment, |12-{exp}|07 experience.',
  ],
  /** An evil pilot flying a Marshal's Cruiser meets a patrol that knows better. */
  turncoat: [
    '|12{marshal}|07 hails you on the open channel. |03"Return that hull."',
    '|07You do not. The Concord reclaims it with considerable enthusiasm.',
  ],
  /** Concord Space forbids it. */
  noDeployInConcord: 'Concord Law forbids fighters and mines in Concord Space and on the lanes.',
  noBeaconInConcord: 'Concord Law forbids beacons in Concord Space.',

  // ---- Fights --------------------------------------------------------------
  deadman: '|12The wreck was wired! |14{n}|12 points of damage rip into your ship.',
  salvage: '|07You scoop up |14{c}|07 Compute, |14{d}|07 Data and |14{w}|07 Weights from the wreck.',
  overkill: '|08You hit it so hard there was nothing left to salvage.',
  tollTaken: '|07You collect the |14{n}|07 credits the fighters had taken in tolls.',
  surrenderCargo: '|07You hand over your whole cargo. The fighters let you go.',
  surrenderCredits: '|07You hand over |14{n}|07 credits. The fighters let you go.',
  beaconCancel: '|07The two beacons find each other and cancel out. One is spent.',
  beaconSet: '|07Your beacon blinks on in sector |14{sector}|07.',
  /** Waking after a day out. */
  respawn: [
    '|07You wake in the infirmary at Haven, patched up and a little poorer.',
    '|07The clerk hands you the keys to a standard-issue Freetrader.',
  ],

  // ---- Mail for pilots who were not there ----------------------------------
  mail: {
    fightersFrom: 'Fighters',
    concordFrom: 'Concord',
    attacked: '|11{by}|07 hit you in sector |14{sector}|07. Lost |14{n}|07 fighters.',
    fled: '|11{by}|07 hit you in sector |14{sector}|07. You slipped away to |14{to}|07.',
    podded: '|11{by}|07 destroyed your ship in sector |14{sector}|07. Pod to |14{to}|07.',
    killed: '|11{by}|07 killed you in sector |14{sector}|07. Out until tomorrow.',
    intruder: '|11{name}|07 entered sector |14{sector}|07 past your fighters.',
    intruderToll: '|11{name}|07 paid |14{n}|07 credits at sector |14{sector}|07.',
    intruderHeld: '|11{name}|07 is stopped by your fighters in sector |14{sector}|07.',
    fightersHit: '|11{by}|07 attacked your fighters in sector |14{sector}|07. Lost |14{n}|07.',
    fightersWon: 'Your fighters in sector |14{sector}|07 destroyed |11{name}|07\'s ship.',
    minesHit: '|14{n}|07 of your mines went off in sector |14{sector}|07 on |11{name}|07.',
    limpet: 'Your limpet clamped onto |11{name}|07 in sector |14{sector}|07.',
    surrendered: '|11{name}|07 surrendered to your fighters in sector |14{sector}|07.',
    disrupted: '|11{by}|07 disrupted |14{n}|07 of your mines in sector |14{sector}|07.',
    rewardPaid: 'Concord pays |14{n}|07 credits for |11{name}|07.',
    beaten: '|11{name}|07 was thrown out of the Back Room and lost a tooth.',
  },

  // ---- The Marshal's Office ------------------------------------------------
  office: {
    tooRisky: [
      '|07The desk sergeant looks at your record, then at the door.',
      '|03"Too risky to show your face in here. Come back when you\'ve cleaned up."',
    ],
    commissionGranted: [
      '|07The sergeant stamps a form, then another, then a third.',
      '|10Commission granted.|07 Your alignment is set to |14{align}|07.',
      '|07The Shipwright will sell you a Marshal\'s Cruiser now.',
    ],
    commissionHeld: '|07You already hold a commission. Wear it well.',
    /** By alignment gap: far, close. */
    commissionDenied: [
      '|03"A commission? You? Come back with a few hundred honest runs behind you."',
      '|03"Close. Get your alignment to |14500|03 and we\'ll talk."',
    ],
    rewardPosted: '|07Reward posted: |14{amount}|07 on |11{name}|07. Alignment |10+{align}|07.',
    rewardNotEvil: 'The Marshals only post rewards on evil traders.',
    claimPaid: '|07The clerk counts out |14{amount}|07 credits for |14{n}|07 successful hunts.',
    claimNone: '|07Nothing to claim. Rewards are paid for kills, not for effort.',
    wantedHeader: '|10The Marshals\' most wanted',
    wantedNone: '|07The board is empty. Somebody has been busy, or nobody has.',
  },

  // ---- The Last Light: Old Sal ---------------------------------------------
  sal: {
    swearToday: '|08Sal has heard it today. He just stares.',
    swearPenalty: '|07Your standing takes a hit: |12-1|07 experience, |12-1|07 alignment.',
    traceUnknown: '|03"Never heard of them."|07 Sal pockets the credits anyway.',
    nothingToSell: '|03"Not today."',
  },

  // ---- The Back Room -------------------------------------------------------
  backRoom: {
    barred: [
      '|07The doorman looks you up and down.',
      '|03"We don\'t want your kind in here."',
    ],
    /** Wrong password: strikes 1..4 of the day. */
    strikes: [
      ['|07The slot in the door slams shut. |03"Wrong. Get lost."', '|07You are thrown out on your ear.'],
      ['|07The door opens just wide enough for two large hands.', '|12You are beaten and robbed of the credits you carried.'],
      ['|07Three of them this time. When you wake, half of what you knew is gone.', '|12Your experience is cut in half.'],
      ['|07You are not seen again at the Drydock. Your ship is, in pieces.', '|12The doorman does not tolerate fools.'],
    ],
    hitPosted: '|07Hit placed: |14{amount}|07 on |11{name}|07. Alignment |12-{align}|07.',
    hitCollected: '|07A man in a gray coat counts out |14{amount}|07 credits for |14{n}|07 jobs.',
    hitNone: '|07No contracts of yours have come due.',
    aliasQuote: '|07The forger charges |14{cost}|07 credits for a new name.',
    aliasDone: '|07Done. You are now |11{name}|07. Nobody saw anything.',
    aliasTaken: 'That name is taken.',
  },
} as const

/** Every line of prose, flattened (for the width test). */
export function allProse(): string[] {
  const out: string[] = []
  const walk = (v: unknown) => {
    if (typeof v === 'string') out.push(v)
    else if (Array.isArray(v)) v.forEach(walk)
    else if (v && typeof v === 'object') Object.values(v).forEach(walk)
  }
  walk(PROSE)
  return out
}
