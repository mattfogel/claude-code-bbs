// The door screens: the Doors list, HYPERPLANE's title pages, the new
// character prompt and the game view (a scrolling transcript, the live
// prompt and a quick-stats bar). Same contract as app.ts: pure functions of
// state, key and View. The screen keeps only its local prompt and what is
// typed; every command goes to the hooks module as one `door` Action carrying
// the lines typed for it, and keys wait until view.door.rev moves past it.

import type { AppState, ClientKey, Screen, Step } from '../app'
import type { Action, DoorAsk, DoorCmd, DoorView, PlayerSnapshot, View } from '../../types'
import { AWARDS, BACKROOM, CLASS0, COMMODITIES, GAME, ITEMS, LAST_LIGHT, ROB, SHIPS, holdsCost, type Commodity, type ItemId } from '../../shared/door/data'
import { DOOR_LIMITS, type FighterMode, type MineKind, type SectorView } from '../../shared/door/protocol'
import { OLD_SAL } from '../../shared/door/text'
import {
  bare, commandPrompt, counterLine, holdsFree, num, openingFigure, outfitterLines, quickStats, rankingLines, shipCatalogLines, logLines, warpList,
} from '../../shared/door/format'
import { LIMITS } from '../../shared/protocol'
import { fitPipe, visibleLength } from '../../shared/pipe'
import { LIGHTBAR, center, footer, header, pad } from '../ui'
import { newDoorView } from './session'
import { DRYDOCK_HELP, INSTRUCTION_PAGES, menuHelp, titleArt } from './content'

export const DOOR_SCREENS = ['doors', 'door'] as const
export type DoorScreen = (typeof DOOR_SCREENS)[number]
export const isDoorScreen = (s: Screen): s is DoorScreen => (DOOR_SCREENS as readonly string[]).includes(s)

/** The doors on the Games menu. */
export const DOORS = [{ key: '1', title: GAME.title, blurb: 'Trade, haggle and explore across a thousand sectors.' }]

export type DoorPage = 'title' | 'instructions' | 'log' | 'rankings' | 'game'

type Venue = 'top' | 'yard' | 'outfit' | 'bank' | 'tavern' | 'marshal' | 'sal'

/** Something A can shoot at: a trader, the fighters that hold the sector (`*fighters`), or a Marshal. */
export type AttackTarget = { name: string; label: string; marshal?: boolean }

/** The prompt on screen. Kinds tied to a hooks-set question (trade, class0, drydock) only apply while it is open. */
export type DoorPrompt =
  | { kind: 'command' }
  | { kind: 'move'; quick?: boolean }
  | { kind: 'quit' }
  | { kind: 'computer' }
  | { kind: 'cplot' }
  | { kind: 'cwarps' }
  | { kind: 'cport' }
  | { kind: 'cavoid' }
  | { kind: 'scan' }
  | { kind: 'probe' }
  | { kind: 'engage' }
  | { kind: 'shipName' }
  | { kind: 'tradeQty' }
  /** `rev`: the view it was made for; a newer reply replaces it. */
  | { kind: 'offer'; rev: number; commodity: Commodity; qty: number; figure: number; final?: boolean }
  | { kind: 'class0'; field: 0 | 1 | 2; buy: [number, number, number] }
  | { kind: 'dock'; venue: Venue }
  | { kind: 'yardShip' }
  | { kind: 'yardName'; ship: number }
  | { kind: 'rename' }
  | { kind: 'outfitQty'; item: ItemId }
  | { kind: 'bankTo' }
  | { kind: 'bankAmt'; op: 'deposit' | 'withdraw' | 'transfer'; to?: string }
  | { kind: 'announce' }
  // Phase 2: combat, deployables, crime, the Marshal's Office, Old Sal and the Back Room.
  | { kind: 'attackWho'; targets: AttackTarget[] }
  | { kind: 'attackSure'; target: AttackTarget }
  | { kind: 'attackFighters'; target: AttackTarget; max: number }
  | { kind: 'fighters' }
  | { kind: 'fDeployQty'; max: number }
  | { kind: 'fDeployMode'; count: number }
  | { kind: 'fTakeQty'; max: number }
  | { kind: 'mines' }
  | { kind: 'mineOp'; mine: MineKind }
  | { kind: 'mineQty'; mine: MineKind; op: 'deploy' | 'take'; max: number }
  | { kind: 'disrupt' }
  | { kind: 'beaconText' }
  | { kind: 'yield' }
  | { kind: 'portMenu' }
  | { kind: 'robAmt' }
  | { kind: 'stealWhat' }
  | { kind: 'stealQty'; commodity: Commodity; max: number }
  | { kind: 'rewardTarget' }
  | { kind: 'rewardAmt'; target: string }
  | { kind: 'salTarget' }
  | { kind: 'brPass' }
  /** Inside the Back Room: `pw` is kept here and sent with every request, as the server holds no "inside" state. */
  | { kind: 'back'; pw: string }
  | { kind: 'brTarget'; pw: string }
  | { kind: 'brAmt'; pw: string; target: string }
  | { kind: 'brAlias'; pw: string }

export type DoorLocal = {
  page: DoorPage
  prompt: DoorPrompt
  /** What is typed at the prompt. */
  buf: string
  /** Lines of local exchanges (menus, prompts answered) not yet sent; they go out as the next action's echo. */
  scratch: string[]
  /** The last action posted: keys wait until view.door.rev passes `rev`; `lines` show meanwhile. */
  wait?: { rev: number; at: number; lines: string[] }
  /** The Instructions page being read. */
  leaf?: number
}

/** Keys stop waiting on a lost action after this long. */
const WAIT_MS = 20_000
const SCRATCH_MAX = 120
const CMD: DoorPrompt = { kind: 'command' }
const DRYDOCK_KINDS = ['dock', 'yardShip', 'yardName', 'rename', 'outfitQty', 'bankTo', 'bankAmt', 'announce', 'rewardTarget', 'rewardAmt', 'salTarget', 'brPass', 'back', 'brTarget', 'brAmt', 'brAlias']
/** Later systems' keys: answered, not ignored. */
const LATER = 'gjklnotuwxz'

export const initialDoor = (): DoorLocal => ({ page: 'title', prompt: CMD, buf: '', scratch: [] })

const lower = (k: ClientKey) => k.key.toLowerCase()
const isEnter = (k: ClientKey) => k.key === 'return' || k.key === 'enter'
const isBack = (k: ClientKey) => k.key === 'backspace' || k.key === 'delete'
const isChar = (k: ClientKey) => !k.ctrl && !k.meta && (k.key.length === 1 || k.key === 'space')
const charOf = (k: ClientKey) => (k.key === 'space' ? ' ' : k.key)
const red = (s: string) => `|12${s}`

const doorView = (view: View): DoorView => view.door ?? newDoorView()

/** True while the last action has not come back. */
export function isWaiting(d: DoorLocal | undefined, dv: DoorView, now: number): boolean {
  return !!d?.wait && dv.rev <= d.wait.rev && now - d.wait.at < WAIT_MS
}

/** The game view draws its own foot, so app.ts leaves the message line alone. */
export function doorOwnsFoot(s: AppState, view: View): boolean {
  return s.screen === 'door' && s.door?.page === 'game' && doorView(view).phase !== 'title'
}

// ---------------------------------------------------------------------------
// Prompts: what each one shows, given the open question.

/** The prompt in force: a hooks-set question wins over the local one. */
export function effectivePrompt(d: DoorLocal, dv: DoorView): DoorPrompt {
  const ask = dv.ask
  const p = d.prompt
  if (dv.phase === 'new') return { kind: 'shipName' }
  if (ask?.kind === 'engage') return { kind: 'engage' }
  if (ask?.kind === 'trade') {
    if (p.kind === 'offer' && p.rev === dv.rev) return p
    if (ask.qty !== undefined && ask.ask !== undefined && ask.commodity !== undefined) {
      return { kind: 'offer', rev: dv.rev, commodity: ask.commodity, qty: ask.qty, figure: ask.ask, final: ask.final }
    }
    return { kind: 'tradeQty' }
  }
  if (ask?.kind === 'class0') return p.kind === 'class0' ? p : { kind: 'class0', field: 0, buy: [0, 0, 0] }
  if (ask?.kind === 'drydock') return DRYDOCK_KINDS.includes(p.kind) ? p : { kind: 'dock', venue: 'top' }
  if (['engage', 'tradeQty', 'offer', 'class0', 'shipName', ...DRYDOCK_KINDS].includes(p.kind)) return CMD
  return p
}

/** What A can shoot at here: traders, hostile sector fighters, then any Marshals. */
export function attackTargets(here: SectorView | undefined, me: string): AttackTarget[] {
  if (!here) return []
  const out: AttackTarget[] = here.traders.filter(t => t.name !== me).map(t => ({ name: t.name, label: `|11${bare(t.name)}|10, ${num(t.fighters)} ftrs, ${bare(t.ship)}` }))
  const f = here.fighters
  if (f && !f.isYours && !f.isCorp) out.push({ name: '*fighters', label: `|12The sector fighters|10 (${num(f.count)} of ${bare(f.owner)})` })
  for (const m of here.marshals) out.push({ name: m, label: `|12${bare(m)}|10, a Marshal`, marshal: true })
  return out
}

/** The most fighters one attack can send: those aboard, up to the hull's limit. */
export const attackMax = (s: PlayerSnapshot) => Math.min(s.ship.fighters, SHIPS[s.ship.type]?.fightersPerAttack ?? s.ship.fighters)

const MINE_NAME: Record<MineKind, string> = { contact: 'Contact Mines', limpet: 'Limpet Mines' }
const aboard = (s: PlayerSnapshot, m: MineKind) => (m === 'contact' ? s.ship.equipment.contactMines : s.ship.equipment.limpets)

type Shown = { lead: string[]; label: string; max: number; digits?: boolean; text?: boolean }

const CLASS0_WHAT = ['cargo holds', 'fighters', 'shield points'] as const

/** How many of each Class 0 good the player can still take, after `buy`. */
export function class0Max(dv: DoorView, ask: Extract<DoorAsk, { kind: 'class0' }>, buy: readonly number[], field: 0 | 1 | 2): number {
  const s = dv.snapshot
  if (!s) return 0
  const spec = SHIPS[s.ship.type]
  const base = ask.prices.hold - 20 * s.ship.holds
  let left = s.credits - (buy[0] ? holdsCost(base, s.ship.holds, buy[0]) : 0) - buy[1] * ask.prices.fighter - buy[2] * ask.prices.shield
  if (field === 0) {
    let n = 0
    while (s.ship.holds + n < spec.maxHolds && holdsCost(base, s.ship.holds, n + 1) <= left) n++
    return n
  }
  if (field === 1) return Math.max(0, Math.min(spec.maxFighters - s.ship.fighters, Math.floor(left / ask.prices.fighter)))
  left = Math.max(0, left)
  return Math.max(0, Math.min(spec.maxShields - s.ship.shields, Math.floor(left / ask.prices.shield)))
}

export function shown(p: DoorPrompt, dv: DoorView): Shown {
  const s = dv.snapshot
  const at = { turns: s?.turns ?? 0, sector: s?.sector ?? 0 }
  // Defaults in brackets: `How many [20]? `; `Your offer [412] ? ` keeps its space.
  const q = (t: string, def?: string | number, end = '? ') => `|13${t}${def !== undefined ? ` |14[${def}]` : ''}|13${def !== undefined ? end : ` ${end}`}`
  switch (p.kind) {
    case 'command':
      return { lead: s?.blocked ? ['|12Hostile fighters hold this sector: (A)ttack, (R)etreat or (Y)ield.'] : [], label: commandPrompt(at), max: 1 }
    case 'move':
      return p.quick ? { lead: [], label: commandPrompt(at), max: 5, digits: true } : { lead: [], label: q('To which sector'), max: 5, digits: true }
    case 'quit':
      return { lead: [], label: q(`Leave ${GAME.title}? (Y/N)`, 'N'), max: 1 }
    case 'computer':
      return { lead: [], label: commandPrompt(at, 'Computer command'), max: 1 }
    case 'cplot':
      return { lead: [], label: q('Plot a course to which sector'), max: 5, digits: true }
    case 'cwarps':
      return { lead: [], label: q("Show which sector's warps", at.sector), max: 5, digits: true }
    case 'cport':
      return { lead: [], label: q('What sector is the port in', at.sector), max: 5, digits: true }
    case 'cavoid':
      return { lead: [], label: q('Avoid which sector (0 clears the list)'), max: 5, digits: true }
    case 'scan':
      return { lead: [], label: q('(D)ensity, (H)olo or (L)impet scan', 'D'), max: 1 }
    case 'probe':
      return { lead: [`|10You have |14${s?.ship.equipment.probes ?? 0}|10 Ghost Probes.`], label: q('Send the probe to which sector'), max: 5, digits: true }
    case 'engage':
      return { lead: [], label: q('Engage the autopilot? (Y/N/Express)', 'Y', ' '), max: 1 }
    case 'shipName':
      return { lead: [], label: q(`What do you want to name your ship? (${DOOR_LIMITS.shipName} letters)`).replace(/ \? $/, ': '), max: DOOR_LIMITS.shipName, text: true }
    case 'tradeQty': {
      const ask = dv.ask as Extract<DoorAsk, { kind: 'trade' }>
      const step = ask.steps[0]
      const c = step.commodity
      const trading = ask.trading?.[c] ?? step.max
      const side = step.side === 'sell' ? 'buying' : 'selling'
      return {
        lead: [`|10We are ${side} up to |14${num(trading)}|10.  You have |14${num(s?.ship.cargo[c] ?? 0)}|10 in your holds.`],
        label: q(`How many holds of |11${COMMODITIES[c]}|13 do you want to ${step.side}`, step.defaultQty),
        max: 6,
        digits: true,
      }
    }
    case 'offer':
      return { lead: [], label: q('Your offer', p.figure, ' ? '), max: 9, digits: true }
    case 'class0': {
      const ask = dv.ask as Extract<DoorAsk, { kind: 'class0' }>
      const most = class0Max(dv, ask, p.buy, p.field)
      const limpet = p.field === 0 && s?.limpet ? [`|12A limpet is clamped to your hull. Press L to have it removed for ${num(CLASS0.limpetRemoval)} credits.`] : []
      return { lead: [`|10You can take |14${num(most)}|10 more.`, ...limpet], label: q(`How many ${CLASS0_WHAT[p.field]} do you want to buy`, 0), max: 6, digits: true }
    }
    case 'dock': {
      const labels: Record<Venue, string> = {
        top: '<Drydock> Where to? (?=Help)',
        yard: '<Shipwright> (B)uy, (R)ename, (L)ist, (Q)uit',
        outfit: '<Outfitter> Which item? (Q to leave)',
        bank: '<Exchange Bank> (D)eposit, (W)ithdraw, (T)ransfer, (E)xamine, (Q)uit',
        tavern: '<The Last Light> (A)nnouncement, Old (S)al, (B)ack Room, (Q)uit',
        marshal: '<Marshal\'s Office> (A)pply, (P)ost reward, (W)anted, (C)laim, (Q)uit',
        sal: '<Old Sal> (T)race, (P)assword, (F)ortune, (S)wear, (Q)uit',
      }
      return { lead: [], label: q(labels[p.venue]), max: 1 }
    }
    case 'yardShip':
      return { lead: [], label: q('Which hull (number, 0 to cancel)'), max: 2, digits: true }
    case 'yardName':
      return { lead: [], label: q(`Name your new ${SHIPS[p.ship]?.name}`), max: DOOR_LIMITS.shipName, text: true }
    case 'rename':
      return { lead: [], label: q('New name for your ship (5,000 credits)'), max: DOOR_LIMITS.shipName, text: true }
    case 'outfitQty':
      return { lead: [], label: q(`How many ${ITEMS.find(i => i.id === p.item)?.name}s`, 1), max: 4, digits: true }
    case 'bankTo':
      return { lead: [], label: q('Transfer to which trader'), max: LIMITS.handleMax, text: true }
    case 'bankAmt':
      return { lead: [], label: q(`How much to ${p.op === 'transfer' ? `send to ${p.to}` : p.op}`), max: 7, digits: true }
    case 'announce':
      return { lead: ['|10Your announcement goes in the daily log for 100 credits.'], label: q('Announce'), max: DOOR_LIMITS.announce, text: true }
    case 'attackWho':
      return { lead: p.targets.map((t, i) => `|14${String(i + 1).padStart(3)} ${t.label}`), label: q('Attack which target (0 to cancel)'), max: 2, digits: true }
    case 'attackSure':
      return { lead: [], label: q(`Attack ${bare(p.target.name)}? Are you POSITIVE? (Y/N)`, 'N', ' '), max: 1 }
    case 'attackFighters':
      return { lead: [`|10Target: ${p.target.label}`], label: q(`How many fighters (0 to ${num(p.max)})`), max: 6, digits: true }
    case 'fighters':
      return { lead: [], label: q('<Fighters> (D)eploy, (T)ake back, (Q)uit'), max: 1 }
    case 'fDeployQty':
      return { lead: [`|10You have |14${num(s?.ship.fighters ?? 0)}|10 fighters aboard.`], label: q(`How many fighters to leave here (0 to ${num(p.max)})`), max: 6, digits: true }
    case 'fDeployMode':
      return { lead: [], label: q('Mode: (D)efensive, (O)ffensive or (T)oll', 'D', ' '), max: 1 }
    case 'fTakeQty':
      return { lead: [`|10Your fighters here: |14${num(dv.here?.fighters?.count ?? 0)}|10.`], label: q(`How many fighters to take back (0 to ${num(p.max)})`), max: 6, digits: true }
    case 'mines':
      return { lead: [], label: q('<Mines> (C)ontact, (L)impet, (Q)uit'), max: 1 }
    case 'mineOp':
      return { lead: [], label: q(`<${p.mine === 'contact' ? 'Contact' : 'Limpet'}> (D)eploy, (T)ake back, (S)weep, (Q)uit`), max: 1 }
    case 'mineQty':
      return { lead: [], label: q(`How many ${MINE_NAME[p.mine]} to ${p.op === 'deploy' ? 'deploy' : 'take back'} (0 to ${num(p.max)})`), max: 5, digits: true }
    case 'disrupt':
      return { lead: [`|10You have |14${s?.ship.equipment.disruptors ?? 0}|10 Mine Disruptors. Warps: ${warpList(dv.here?.warps ?? [], undefined)}`], label: q('Fire into which sector (0 to cancel)'), max: 5, digits: true }
    case 'beaconText':
      return { lead: [`|10Leave a message of up to ${DOOR_LIMITS.beacon} characters. A new beacon replaces the old.`], label: q('Beacon'), max: DOOR_LIMITS.beacon, text: true }
    case 'yield':
      return { lead: [], label: q(dv.here?.fighters?.mode === 'toll' ? 'Hand over the toll in credits? (Y/N)' : 'Hand over your cargo? (Y/N)', 'N', ' '), max: 1 }
    case 'portMenu':
      return { lead: [], label: q(`<${bare(dv.here?.port?.name ?? 'Port')}> (T)rade, (R)ob, (S)teal, (Q)uit`), max: 1 }
    case 'robAmt':
      return { lead: [`|10A safe take for you is about |14${num(ROB.robExpMult * (s?.experience ?? 0))}|10 credits. Past that, you may be busted.`], label: q('How many credits do you try to take (0 to cancel)'), max: 9, digits: true }
    case 'stealWhat':
      return { lead: [], label: q('Steal which cargo? (C)ompute, (D)ata, (W)eights, (Q)uit'), max: 1 }
    case 'stealQty':
      return { lead: [`|10You have |14${p.max}|10 empty holds. A safe take is about |14${Math.floor((s?.experience ?? 0) / ROB.stealExpDiv)}|10.`], label: q(`How many holds of |11${COMMODITIES[p.commodity]}|13 do you try to steal (0 to cancel)`), max: 5, digits: true }
    case 'rewardTarget':
      return { lead: [`|10A reward raises your alignment by 1 per ${num(AWARDS.rewardAlignPer)} credits. The least is ${num(BACKROOM.rewardMin)}.`], label: q('Post a reward on which trader'), max: LIMITS.handleMax, text: true }
    case 'rewardAmt':
      return { lead: [], label: q(`How many credits on ${p.target}`), max: 9, digits: true }
    case 'salTarget':
      return { lead: [`|10A trace costs |14${num(LAST_LIGHT.traceCost)}|10 credits.`], label: q('Trace which trader'), max: LIMITS.handleMax, text: true }
    case 'brPass':
      return { lead: [], label: q('Password'), max: 40, text: true }
    case 'back':
      return { lead: [], label: q('<Back Room> (H)it, (C)ollect, (A)lias, (Q)uit'), max: 1 }
    case 'brTarget':
      return { lead: [`|10A hit costs you 1 alignment per ${num(AWARDS.hitAlignPer)} credits. The least is ${num(BACKROOM.hitMin)}.`], label: q('A hit on which trader'), max: LIMITS.handleMax, text: true }
    case 'brAmt':
      return { lead: [], label: q(`How many credits on ${p.target}`), max: 9, digits: true }
    case 'brAlias':
      return { lead: [`|10A new alias costs |14${num(BACKROOM.aliasBase + BACKROOM.aliasPerExp * (s?.experience ?? 0))}|10 credits.`], label: q('New alias'), max: DOOR_LIMITS.alias, text: true }
  }
}

// ---------------------------------------------------------------------------
// Keys.

export function pressDoor(s: AppState, key: ClientKey, view: View, now: number): Step {
  const dv = doorView(view)
  if (s.screen === 'doors') {
    if (key.key === 'q' || key.key === 'left' || key.key === 'backspace') return { state: { ...s, screen: 'main' } }
    const pick = DOORS.findIndex(d => d.key === key.key)
    if (pick >= 0 || isEnter(key) || key.key === 'right') return { state: { ...s, screen: 'door', door: { ...initialDoor(), page: 'title' } } }
    return { state: s }
  }
  let d = s.door ?? initialDoor()
  if (d.wait) {
    if (key.key === 'escape' || !isWaiting(d, dv, now)) d = { ...d, wait: undefined }
    else return { state: s }
    if (key.key === 'escape') return { state: { ...s, door: d } }
  }
  // Refused at the door (no Epoch, say): back to the title.
  if (d.page === 'game' && dv.phase === 'title') d = { ...d, page: 'title', prompt: CMD, buf: '', scratch: [] }
  const x: X = { s, d, dv, now }

  switch (d.page) {
    case 'title': {
      const k = lower(key)
      if (k === 'e') return send({ ...x, d: { ...d, page: 'game', prompt: CMD, buf: '', scratch: [] } }, { cmd: 'enter' }, undefined)
      if (k === 'i') return { state: { ...s, door: { ...d, page: 'instructions', leaf: 0 } } }
      if (k === 'l' || k === 'r') return { state: { ...s, door: { ...d, page: k === 'l' ? 'log' : 'rankings' } }, action: { type: 'door', cmd: 'news' } }
      if (k === 'q' || key.key === 'backspace') return { state: { ...s, screen: 'doors', door: undefined } }
      return { state: { ...s, door: d } }
    }
    case 'instructions': {
      const leaf = (d.leaf ?? 0) + 1
      if (leaf < INSTRUCTION_PAGES.length && lower(key) !== 'q') return { state: { ...s, door: { ...d, leaf } } }
      return { state: { ...s, door: { ...d, page: 'title', leaf: undefined } } }
    }
    case 'log':
    case 'rankings':
      return { state: { ...s, door: { ...d, page: 'title' } } }
    case 'game':
      if (dv.phase === 'loading') return { state: { ...s, door: d } }
      return pressGame(x, key)
  }
}

type X = { s: AppState; d: DoorLocal; dv: DoorView; now: number }

const withDoor = (x: X, d: Partial<DoorLocal>): AppState => ({ ...x.s, door: { ...x.d, ...d } })

/** Posts a command; `answered` is the prompt line as answered, `extra` lines follow it. */
function send(x: X, cmd: DoorCmd, answered: string | undefined, next: DoorPrompt = CMD, extra: string[] = []): Step {
  const echo = [...x.d.scratch, ...(answered !== undefined ? [answered] : []), ...extra]
  const action = { type: 'door', echo, ...cmd } as Action
  return { state: withDoor(x, { prompt: next, buf: '', scratch: [], wait: { rev: x.dv.rev, at: x.now, lines: echo } }), action }
}

/** A local exchange: lines kept on screen until the next command carries them. */
function say(x: X, lines: string[], next: DoorPrompt = CMD): Step {
  return { state: withDoor(x, { prompt: next, buf: '', scratch: [...x.d.scratch, ...lines].slice(-SCRATCH_MAX) }) }
}

/** The prompt as it reads once answered with `value`. */
const answer = (sh: Shown, value: string) => [...sh.lead, `${sh.label}|15${value}`]

function pressGame(x: X, key: ClientKey): Step {
  const p = effectivePrompt(x.d, x.dv)
  const sh = shown(p, x.dv)
  // Typed answers: digits or text, ended by Enter.
  if (sh.digits || sh.text) {
    if (isBack(key)) {
      if (!x.d.buf && p.kind !== 'shipName' && !p.kind.startsWith('trade') && p.kind !== 'offer' && p.kind !== 'class0') return cancel(x, p, sh)
      return { state: withDoor(x, { prompt: p, buf: x.d.buf.slice(0, -1) }) }
    }
    if (key.key === 'escape') return cancel(x, p, sh)
    if (isEnter(key)) return submit(x, p, sh, x.d.buf.trim())
    if (sh.digits && /^[0-9]$/.test(key.key) && x.d.buf.length < sh.max) return { state: withDoor(x, { prompt: p, buf: x.d.buf + key.key }) }
    if (sh.text && isChar(key) && [...x.d.buf].length < sh.max) return { state: withDoor(x, { prompt: p, buf: x.d.buf + charOf(key) }) }
    // A letter at a number prompt: Q leaves the haggle or the trading post.
    if (sh.digits && p.kind === 'class0' && lower(key) === 'l') return removeLimpet(x, `${sh.label}|15L`, p)
    if (sh.digits && lower(key) === 'q') {
      if (p.kind === 'tradeQty' || p.kind === 'offer') return send(x, { cmd: 'skip' }, `${sh.label}|15Q`)
      if (p.kind === 'class0') return send(x, { cmd: 'class0', holds: 0, fighters: 0, shields: 0 }, `${sh.label}|15Q`)
      return cancel(x, p, sh)
    }
    return { state: withDoor(x, { prompt: p }) }
  }
  return pressKey(x, p, sh, key)
}

/** Backs out of a typed prompt without sending anything. */
function cancel(x: X, p: DoorPrompt, sh: Shown): Step {
  const lines = answer(sh, '')
  if (['cplot', 'cwarps', 'cport', 'cavoid'].includes(p.kind)) return say(x, lines, { kind: 'computer' })
  if (p.kind === 'yardShip' || p.kind === 'yardName' || p.kind === 'rename') return say(x, lines, { kind: 'dock', venue: 'yard' })
  if (p.kind === 'outfitQty') return say(x, lines, { kind: 'dock', venue: 'outfit' })
  if (p.kind === 'bankAmt' || p.kind === 'bankTo') return say(x, lines, { kind: 'dock', venue: 'bank' })
  if (p.kind === 'announce' || p.kind === 'brPass') return say(x, lines, { kind: 'dock', venue: 'tavern' })
  if (p.kind === 'rewardTarget' || p.kind === 'rewardAmt') return say(x, lines, { kind: 'dock', venue: 'marshal' })
  if (p.kind === 'salTarget') return say(x, lines, { kind: 'dock', venue: 'sal' })
  if (p.kind === 'brTarget' || p.kind === 'brAmt' || p.kind === 'brAlias') return say(x, lines, { kind: 'back', pw: p.pw })
  if (p.kind === 'shipName') return { state: withDoor(x, { page: 'title', buf: '', prompt: CMD }) }
  return say(x, lines)
}

function submit(x: X, p: DoorPrompt, sh: Shown, v: string): Step {
  const n = Number(v)
  const s = x.dv.snapshot
  switch (p.kind) {
    case 'move':
      if (!v) return say(x, answer(sh, ''))
      return send(x, { cmd: 'plot', to: n, engage: true }, undefined, CMD, answer(sh, v))
    case 'cplot':
      if (!v) return say(x, answer(sh, ''), { kind: 'computer' })
      return send(x, { cmd: 'plot', to: n, engage: false }, undefined, { kind: 'computer' }, answer(sh, v))
    case 'cwarps':
      return send(x, { cmd: 'local', key: 'CI', arg: v ? n : s?.sector }, undefined, { kind: 'computer' }, answer(sh, v))
    case 'cport':
      return send(x, { cmd: 'local', key: 'CR', arg: v ? n : s?.sector }, undefined, { kind: 'computer' }, answer(sh, v))
    case 'cavoid':
      if (!v) return say(x, answer(sh, ''), { kind: 'computer' })
      return send(x, { cmd: 'avoid', sector: n }, undefined, { kind: 'computer' }, answer(sh, v))
    case 'probe':
      if (!v) return say(x, answer(sh, ''))
      return send(x, { cmd: 'probe', to: n }, undefined, CMD, answer(sh, v))
    case 'shipName':
      if (!v) return { state: withDoor(x, { page: 'title', buf: '', prompt: CMD }) }
      return send(x, { cmd: 'create', shipName: v }, undefined, CMD, answer(sh, v))
    case 'tradeQty': {
      const ask = x.dv.ask as Extract<DoorAsk, { kind: 'trade' }>
      const step = ask.steps[0]
      const qty = v ? n : step.defaultQty
      if (qty > step.max) return { state: withDoor(x, { prompt: p, buf: '', scratch: [...x.d.scratch, ...answer(sh, v), red(`You can ${step.side} at most ${num(step.max)}.`)] }) }
      if (qty === 0) return send(x, { cmd: 'offer', commodity: step.commodity, qty: 0, price: 0 }, undefined, CMD, answer(sh, String(qty)))
      const figure = openingFigure(step, qty)
      return say(x, [...answer(sh, String(qty)), `|10Agreed, |14${num(qty)}|10 units.`, '', counterLine(figure, step.side, false)], { kind: 'offer', rev: x.dv.rev, commodity: step.commodity, qty, figure })
    }
    case 'offer': {
      if (p.kind !== 'offer') break
      const price = v ? n : p.figure
      return send(x, { cmd: 'offer', commodity: p.commodity, qty: p.qty, price }, undefined, CMD, answer(sh, String(price)))
    }
    case 'class0': {
      const ask = x.dv.ask as Extract<DoorAsk, { kind: 'class0' }>
      const qty = v ? n : 0
      const most = class0Max(x.dv, ask, p.buy, p.field)
      if (qty > most) return { state: withDoor(x, { prompt: p, buf: '', scratch: [...x.d.scratch, ...answer(sh, v), red(`You can take at most ${num(most)}.`)] }) }
      const buy = [...p.buy] as [number, number, number]
      buy[p.field] = qty
      if (p.field < 2) return say(x, answer(sh, String(qty)), { kind: 'class0', field: (p.field + 1) as 1 | 2, buy })
      return send(x, { cmd: 'class0', holds: buy[0], fighters: buy[1], shields: buy[2] }, undefined, CMD, answer(sh, String(qty)))
    }
    case 'yardShip': {
      if (!v || n === 0) return say(x, answer(sh, v), { kind: 'dock', venue: 'yard' })
      const spec = SHIPS[n]
      if (!spec?.buyable) return { state: withDoor(x, { prompt: p, buf: '', scratch: [...x.d.scratch, ...answer(sh, v), red('We don\'t build that one.')] }) }
      return say(x, answer(sh, v), { kind: 'yardName', ship: n })
    }
    case 'yardName':
      if (!v) return say(x, answer(sh, ''), { kind: 'dock', venue: 'yard' })
      return send(x, { cmd: 'shipwright', body: { op: 'buy', ship: p.ship, name: v } }, undefined, { kind: 'dock', venue: 'yard' }, answer(sh, v))
    case 'rename':
      if (!v) return say(x, answer(sh, ''), { kind: 'dock', venue: 'yard' })
      return send(x, { cmd: 'shipwright', body: { op: 'rename', name: v } }, undefined, { kind: 'dock', venue: 'yard' }, answer(sh, v))
    case 'outfitQty':
      return send(x, { cmd: 'outfit', item: p.item, qty: v ? n : 1 }, undefined, { kind: 'dock', venue: 'outfit' }, answer(sh, v || '1'))
    case 'bankTo':
      if (!v) return say(x, answer(sh, ''), { kind: 'dock', venue: 'bank' })
      return say(x, answer(sh, v), { kind: 'bankAmt', op: 'transfer', to: v })
    case 'bankAmt': {
      if (!v || n === 0) return say(x, answer(sh, v), { kind: 'dock', venue: 'bank' })
      const body = p.op === 'transfer' ? { op: 'transfer' as const, amount: n, to: p.to ?? '' } : { op: p.op, amount: n }
      return send(x, { cmd: 'bank', body }, undefined, { kind: 'dock', venue: 'bank' }, answer(sh, v))
    }
    case 'announce':
      if (!v) return say(x, answer(sh, ''), { kind: 'dock', venue: 'tavern' })
      return send(x, { cmd: 'announce', body: { text: v } }, undefined, { kind: 'dock', venue: 'tavern' }, answer(sh, v))
  }
  return submitMore(x, p, sh, v, n)
}

/** An answer that is refused locally: shown in red, the question stays. */
const again = (x: X, p: DoorPrompt, sh: Shown, v: string, why: string): Step =>
  ({ state: withDoor(x, { prompt: p, buf: '', scratch: [...x.d.scratch, ...answer(sh, v), red(why)] }) })

/** The Class 0 trading post's and the Drydock's limpet removal. */
function removeLimpet(x: X, echo: string, next: DoorPrompt): Step {
  if (!x.dv.snapshot?.limpet) return say(x, [echo, red('There is no limpet on your hull.')], next)
  return send(x, { cmd: 'removeLimpet' }, echo, next)
}

/** The phase 2 prompts that take a number or text. */
function submitMore(x: X, p: DoorPrompt, sh: Shown, v: string, n: number): Step {
  const s = x.dv.snapshot
  const marshal = { kind: 'dock', venue: 'marshal' } as const
  switch (p.kind) {
    case 'attackWho': {
      if (!v || n === 0) return say(x, answer(sh, v))
      const t = p.targets[n - 1]
      if (!t) return again(x, p, sh, v, `Choose 1 to ${p.targets.length}, or 0 to cancel.`)
      return say(x, answer(sh, v), t.marshal ? { kind: 'attackSure', target: t } : { kind: 'attackFighters', target: t, max: s ? attackMax(s) : 0 })
    }
    case 'attackFighters':
      if (!v || n === 0) return say(x, answer(sh, v))
      if (n > p.max) return again(x, p, sh, v, `You can send at most ${num(p.max)}.`)
      return send(x, { cmd: 'attack', target: p.target.name, fighters: n }, undefined, CMD, answer(sh, v))
    case 'fDeployQty':
      if (!v || n === 0) return say(x, answer(sh, v))
      if (n > p.max) return again(x, p, sh, v, `You can leave at most ${num(p.max)}.`)
      return say(x, answer(sh, v), { kind: 'fDeployMode', count: n })
    case 'fTakeQty':
      if (!v || n === 0) return say(x, answer(sh, v))
      if (n > p.max) return again(x, p, sh, v, `You can take back at most ${num(p.max)}.`)
      return send(x, { cmd: 'collect', body: { kind: 'fighters', count: n } }, undefined, CMD, answer(sh, v))
    case 'mineQty': {
      if (!v || n === 0) return say(x, answer(sh, v))
      if (n > p.max) return again(x, p, sh, v, `At most ${num(p.max)}.`)
      const cmd: DoorCmd = p.op === 'deploy' ? { cmd: 'deploy', body: { kind: p.mine, count: n, owner: 'personal' } } : { cmd: 'collect', body: { kind: p.mine, count: n } }
      return send(x, cmd, undefined, CMD, answer(sh, v))
    }
    case 'disrupt':
      if (!v || n === 0) return say(x, answer(sh, v))
      if (!x.dv.here?.warps.includes(n)) return again(x, p, sh, v, `Sector ${n} is not next door. The disruptor reaches only the warps from here.`)
      return send(x, { cmd: 'disrupt', sector: n }, undefined, CMD, answer(sh, v))
    case 'beaconText':
      if (!v) return say(x, answer(sh, ''))
      return send(x, { cmd: 'beacon', text: v }, undefined, CMD, answer(sh, v))
    case 'robAmt':
      if (!v || n === 0) return say(x, answer(sh, v))
      return send(x, { cmd: 'rob', credits: n }, undefined, CMD, answer(sh, v))
    case 'stealQty':
      if (!v || n === 0) return say(x, answer(sh, v))
      if (n > p.max) return again(x, p, sh, v, `You have room for ${num(p.max)}.`)
      return send(x, { cmd: 'steal', commodity: p.commodity, qty: n }, undefined, CMD, answer(sh, v))
    case 'rewardTarget':
      if (!v) return say(x, answer(sh, ''), marshal)
      return say(x, answer(sh, v), { kind: 'rewardAmt', target: v })
    case 'rewardAmt':
      if (!v || n === 0) return say(x, answer(sh, v), marshal)
      if (n < BACKROOM.rewardMin) return again(x, p, sh, v, `The Marshals post nothing under ${num(BACKROOM.rewardMin)} credits.`)
      return send(x, { cmd: 'marshal', body: { op: 'reward', target: p.target, amount: n } }, undefined, marshal, answer(sh, v))
    case 'salTarget':
      if (!v) return say(x, answer(sh, ''), { kind: 'dock', venue: 'sal' })
      return send(x, { cmd: 'sal', body: { op: 'trace', target: v } }, undefined, { kind: 'dock', venue: 'sal' }, answer(sh, v))
    case 'brPass':
      // The password never lands in the transcript.
      if (!v) return say(x, answer(sh, ''), { kind: 'dock', venue: 'tavern' })
      return say(x, [`${sh.label}|15${'*'.repeat([...v].length)}`, '|10<The Back Room>'], { kind: 'back', pw: v })
    case 'brTarget':
      if (!v) return say(x, answer(sh, ''), { kind: 'back', pw: p.pw })
      return say(x, answer(sh, v), { kind: 'brAmt', pw: p.pw, target: v })
    case 'brAmt':
      if (!v || n === 0) return say(x, answer(sh, v), { kind: 'back', pw: p.pw })
      if (n < BACKROOM.hitMin) return again(x, p, sh, v, `Nobody takes a hit under ${num(BACKROOM.hitMin)} credits.`)
      return send(x, { cmd: 'backroom', body: { password: p.pw, op: 'hit', target: p.target, amount: n } }, undefined, { kind: 'back', pw: p.pw }, answer(sh, v))
    case 'brAlias':
      if (!v) return say(x, answer(sh, ''), { kind: 'back', pw: p.pw })
      return send(x, { cmd: 'backroom', body: { password: p.pw, op: 'alias', alias: v } }, undefined, { kind: 'back', pw: p.pw }, answer(sh, v))
  }
  return { state: withDoor(x, { prompt: p }) }
}

/** Single-key prompts. */
function pressKey(x: X, p: DoorPrompt, sh: Shown, key: ClientKey): Step {
  const k = lower(key)
  const shownKey = isEnter(key) ? '' : key.key.length === 1 ? key.key.toUpperCase() : ''
  const echo = `${sh.label}|15${shownKey}`
  const dv = x.dv
  const s = dv.snapshot
  switch (p.kind) {
    case 'command': {
      if (/^[0-9]$/.test(key.key)) return { state: withDoor(x, { prompt: { kind: 'move', quick: true }, buf: key.key }) }
      if (!s) return { state: x.s }
      switch (k) {
        case 'm':
          return say(x, [echo, '|10<Move>', `|10Warps to Sector(s) |14:  ${warpList(dv.here?.warps ?? [], undefined)}`], { kind: 'move' })
        case 'd':
          return send(x, { cmd: 'local', key: 'D' }, echo)
        case 'p': {
          const port = dv.here?.port
          if (!port) return say(x, [echo, red('There is no port in this sector.')])
          // Outlaws get the crime menu at an ordinary port.
          if (s.alignment <= ROB.maxAlign && port.class >= 1 && port.class <= 8 && !port.destroyed) return say(x, [echo], { kind: 'portMenu' })
          return send(x, { cmd: 'dock' }, echo)
        }
        case 's': {
          const scanner = s.ship.equipment.scanner
          if (scanner === 'none') return say(x, [echo, red('You have no long range scanner. The Outfitter at the Drydock sells them.')])
          if (scanner === 'density') return send(x, { cmd: 'scan', kind: 'density' }, echo)
          return say(x, [echo], { kind: 'scan' })
        }
        case 'a': {
          if (s.ship.fighters < 1) return say(x, [echo, red('You have no fighters to send. Trading posts sell them.')])
          const targets = attackTargets(dv.here, s.name)
          if (!targets.length) return say(x, [echo, red('There is nobody here to attack.')])
          if (targets.length > 1) return say(x, [echo, '|10<Attack>'], { kind: 'attackWho', targets })
          const t = targets[0]
          return say(x, [echo, '|10<Attack>'], t.marshal ? { kind: 'attackSure', target: t } : { kind: 'attackFighters', target: t, max: attackMax(s) })
        }
        case 'f':
          return say(x, [echo, '|10<Fighters>'], { kind: 'fighters' })
        case 'h':
          return say(x, [echo, '|10<Mines>'], { kind: 'mines' })
        case 'b':
          if (s.ship.equipment.beacons < 1) return say(x, [echo, red('You have no Marker Beacons. The Outfitter sells them.')])
          if (dv.here?.region === 'concord') return say(x, [echo, red('Concord Space allows no beacons.')])
          return say(x, [echo], { kind: 'beaconText' })
        case 'r':
          if (!s.blocked) return say(x, [echo, red('There is nothing to retreat from.')])
          return send(x, { cmd: 'retreat' }, echo)
        case 'y':
          if (!s.blocked) return say(x, [echo, red('Nobody is holding you. There is nothing to yield to.')])
          return say(x, [echo], { kind: 'yield' })
        case 'c':
          return say(x, [echo, '|10<Computer activated>'], { kind: 'computer' })
        case 'i':
          return send(x, { cmd: 'local', key: 'I' }, echo)
        case '/':
          return send(x, { cmd: 'local', key: '/' }, echo)
        case 'v':
          return send(x, { cmd: 'local', key: 'V' }, echo)
        case '?':
          return send(x, { cmd: 'local', key: '?' }, echo)
        case 'e':
          if (!s.ship.equipment.probes) return say(x, [echo, red('You have no Ghost Probes. The Outfitter sells them.')])
          return say(x, [echo], { kind: 'probe' })
        case 'q':
          return say(x, [echo], { kind: 'quit' })
      }
      if (k.length === 1 && LATER.includes(k)) return say(x, [echo, '|08That system comes online in a later Epoch.'])
      return { state: x.s }
    }
    case 'quit':
      if (k === 'y') return send({ ...x, d: { ...x.d, page: 'title' } }, { cmd: 'leave' }, echo, CMD, ['|08You power down and return to the station.'])
      return say(x, [`${sh.label}|15N`])
    case 'computer': {
      const stay: DoorPrompt = { kind: 'computer' }
      const next: Record<string, DoorPrompt> = { f: { kind: 'cplot' }, i: { kind: 'cwarps' }, r: { kind: 'cport' }, v: { kind: 'cavoid' } }
      if (next[k]) return say(x, [echo], next[k])
      const locals: Record<string, 'CK' | 'CX' | 'CL' | 'CG' | 'CE' | 'C?'> = { k: 'CK', x: 'CX', l: 'CL', g: 'CG', e: 'CE', '?': 'C?' }
      if (locals[k]) return send(x, { cmd: 'local', key: locals[k] }, echo, stay)
      // The limpet scan is free but needs no scanner, so the computer carries it too.
      if (k === 't') return send(x, { cmd: 'scan', kind: 'limpet' }, echo, stay)
      if (k === 'q' || key.key === 'escape') return say(x, [echo, '|10<Computer deactivated>'])
      return { state: withDoor(x, { prompt: stay }) }
    }
    case 'scan':
      if (k === 'h') return send(x, { cmd: 'scan', kind: 'holo' }, echo)
      if (k === 'l') return send(x, { cmd: 'scan', kind: 'limpet' }, echo)
      if (k === 'd' || isEnter(key)) return send(x, { cmd: 'scan', kind: 'density' }, `${sh.label}|15D`)
      if (k === 'q' || key.key === 'escape') return say(x, [echo])
      return { state: withDoor(x, { prompt: p }) }
    case 'engage': {
      const ask = dv.ask as Extract<DoorAsk, { kind: 'engage' }>
      if (k === 'y' || isEnter(key)) return send(x, { cmd: 'move', path: ask.path.slice(1), mode: 'alert' }, `${sh.label}|15Y`, CMD, ['|10<Autopilot engaged>'])
      if (k === 'e') return send(x, { cmd: 'move', path: ask.path.slice(1), mode: 'express' }, echo, CMD, ['|10<Express autopilot engaged>'])
      if (k === 'n' || k === 'q' || key.key === 'escape') return send(x, { cmd: 'clear' }, `${sh.label}|15N`)
      return { state: x.s }
    }
    case 'dock':
      return pressDrydock(x, p.venue, sh, k, echo, key)
  }
  return pressMore(x, p, sh, key, echo)
}

/** The phase 2 single-key prompts. */
function pressMore(x: X, p: DoorPrompt, sh: Shown, key: ClientKey, echo: string): Step {
  const k = lower(key)
  const dv = x.dv
  const s = dv.snapshot
  const back = k === 'q' || key.key === 'escape'
  const stay = (): Step => ({ state: withDoor(x, { prompt: p }) })
  const no = (msg: string, next: DoorPrompt = CMD) => say(x, [echo, red(msg)], next)
  const concord = dv.here?.region === 'concord'
  switch (p.kind) {
    case 'attackSure':
      if (k === 'y') return say(x, [`${sh.label}|15Y`], { kind: 'attackFighters', target: p.target, max: s ? attackMax(s) : 0 })
      return say(x, [`${sh.label}|15N`])
    case 'fighters': {
      if (!s) return stay()
      if (k === 'd') {
        if (s.ship.fighters < 1) return no('You have no fighters aboard. Trading posts sell them.')
        if (concord) return no('Concord Space allows no fighters.')
        return say(x, [echo], { kind: 'fDeployQty', max: s.ship.fighters })
      }
      if (k === 't') {
        const f = dv.here?.fighters
        if (!f?.isYours) return no('You have no fighters in this sector.')
        const room = (SHIPS[s.ship.type]?.maxFighters ?? 0) - s.ship.fighters
        if (room < 1) return no('Your ship cannot carry any more fighters.')
        return say(x, [echo], { kind: 'fTakeQty', max: Math.min(f.count, room) })
      }
      return back ? say(x, [echo]) : stay()
    }
    case 'fDeployMode': {
      const modes: Record<string, FighterMode> = { d: 'defensive', o: 'offensive', t: 'toll' }
      const mode = isEnter(key) ? 'defensive' : modes[k]
      if (mode) return send(x, { cmd: 'deploy', body: { kind: 'fighters', count: p.count, owner: 'personal', mode } }, isEnter(key) ? `${sh.label}|15D` : echo)
      return back ? say(x, [echo]) : stay()
    }
    case 'mines':
      if (k === 'c' || k === 'l') return say(x, [echo], { kind: 'mineOp', mine: k === 'c' ? 'contact' : 'limpet' })
      return back ? say(x, [echo]) : stay()
    case 'mineOp': {
      if (!s) return stay()
      const name = MINE_NAME[p.mine]
      if (k === 'd') {
        if (aboard(s, p.mine) < 1) return no(`You have no ${name} aboard. The Outfitter sells them.`)
        if (concord) return no('Concord Space allows no mines.')
        return say(x, [echo], { kind: 'mineQty', mine: p.mine, op: 'deploy', max: aboard(s, p.mine) })
      }
      if (k === 't') {
        const here = dv.here?.mines.find(m => m.kind === p.mine && m.isYours)
        if (!here) return no(`You have no ${name} in this sector.`)
        const room = (SHIPS[s.ship.type]?.mines ?? 0) - aboard(s, p.mine)
        if (room < 1) return no(`Your ship cannot carry any more ${name}.`)
        return say(x, [echo], { kind: 'mineQty', mine: p.mine, op: 'take', max: Math.min(here.count, room) })
      }
      if (k === 's') {
        if (s.ship.equipment.disruptors < 1) return no('You have no Mine Disruptors. The Outfitter sells them.')
        return say(x, [echo], { kind: 'disrupt' })
      }
      return back ? say(x, [echo]) : stay()
    }
    case 'yield':
      if (k === 'y') return send(x, { cmd: 'surrender' }, `${sh.label}|15Y`)
      return say(x, [`${sh.label}|15N`])
    case 'portMenu':
      if (k === 't') return send(x, { cmd: 'dock' }, echo)
      if (k === 'r') return say(x, [echo], { kind: 'robAmt' })
      if (k === 's') {
        if (s && holdsFree(s) < 1) return no('Your holds are full. There is no room for stolen cargo.')
        return say(x, [echo], { kind: 'stealWhat' })
      }
      return back ? say(x, [echo]) : stay()
    case 'stealWhat': {
      const pick: Record<string, Commodity> = { c: 0, d: 1, w: 2 }
      if (k in pick && s) return say(x, [echo], { kind: 'stealQty', commodity: pick[k], max: holdsFree(s) })
      return back ? say(x, [echo]) : stay()
    }
    case 'back':
      if (k === 'h') return say(x, [echo], { kind: 'brTarget', pw: p.pw })
      if (k === 'c') return send(x, { cmd: 'backroom', body: { password: p.pw, op: 'collect' } }, echo, p)
      if (k === 'a') return say(x, [echo], { kind: 'brAlias', pw: p.pw })
      if (k === '?') return say(x, [echo, ...menuHelp('backroom')], p)
      return back ? say(x, [echo, '|08You slip out past the bouncer.'], { kind: 'dock', venue: 'tavern' }) : stay()
  }
  return { state: x.s }
}

function pressDrydock(x: X, venue: Venue, sh: Shown, k: string, echo: string, key: ClientKey): Step {
  const s = x.dv.snapshot
  const at = (v: Venue): DoorPrompt => ({ kind: 'dock', venue: v })
  const back = k === 'q' || key.key === 'escape'
  switch (venue) {
    case 'top':
      if (k === 's') return say(x, [echo, '|10<Shipwright>'], at('yard'))
      if (k === 'o' && s) return say(x, [echo, ...outfitterLines(s)], at('outfit'))
      if (k === 'b') return say(x, [echo, '|10<Exchange Bank>'], at('bank'))
      if (k === 't') return say(x, [echo, '|10<The Last Light> |08Smoke, low music, and a board of announcements by the door.'], at('tavern'))
      if (k === 'm') {
        if (s && s.alignment < AWARDS.marshalOfficeMinAlign) return say(x, [echo, red('The Marshals want nothing to do with you.')], at('top'))
        return say(x, [echo, '|10<Marshal\'s Office>'], at('marshal'))
      }
      if (k === 'l') return removeLimpet(x, echo, at('top'))
      if (k === '?') return say(x, [echo, ...DRYDOCK_HELP], at('top'))
      if (back) return send(x, { cmd: 'clear' }, echo, CMD, ['|08You cast off from the Drydock.', ''])
      return { state: withDoor(x, { prompt: at('top') }) }
    case 'yard':
      if (k === 'b') return say(x, [echo, ...shipCatalogLines()], { kind: 'yardShip' })
      if (k === 'l') return say(x, [echo, ...shipCatalogLines()], at('yard'))
      if (k === 'r') return say(x, [echo], { kind: 'rename' })
      if (back) return say(x, [echo], at('top'))
      return { state: withDoor(x, { prompt: at('yard') }) }
    case 'outfit': {
      const item = ITEMS.find(i => i.phase <= 2 && i.key.toLowerCase() === k)
      if (item) return say(x, [echo], { kind: 'outfitQty', item: item.id })
      if (back) return say(x, [echo], at('top'))
      return { state: withDoor(x, { prompt: at('outfit') }) }
    }
    case 'bank':
      if (k === 'd' || k === 'w') return say(x, [echo], { kind: 'bankAmt', op: k === 'd' ? 'deposit' : 'withdraw' })
      if (k === 't') return say(x, [echo], { kind: 'bankTo' })
      if (k === 'e') return say(x, [echo, `|10You have |14${num(s?.bank ?? 0)}|10 credits on deposit and |14${num(s?.credits ?? 0)}|10 on hand.`], at('bank'))
      if (back) return say(x, [echo], at('top'))
      return { state: withDoor(x, { prompt: at('bank') }) }
    case 'tavern':
      if (k === 'a') return say(x, [echo], { kind: 'announce' })
      if (k === 's') return say(x, [echo, ...OLD_SAL.greeting], at('sal'))
      if (k === 'b') {
        if (s && s.alignment > AWARDS.backRoomMaxAlign) return say(x, [echo, red('The bouncer looks you over, then shakes his head. Not your kind of room.')], at('tavern'))
        return say(x, [echo, '|08A heavy door at the back, with a slot at eye height.'], { kind: 'brPass' })
      }
      if (k === '?') return say(x, [echo, ...menuHelp('tavern')], at('tavern'))
      if (back) return say(x, [echo], at('top'))
      return { state: withDoor(x, { prompt: at('tavern') }) }
    case 'marshal':
      if (k === 'a') {
        if (s?.commissioned) return say(x, [echo, red('You already hold a commission.')], at('marshal'))
        if (s && s.alignment < AWARDS.commissionApply) return say(x, [echo, red(`A commission needs an alignment of ${AWARDS.commissionApply} or better.`)], at('marshal'))
        return send(x, { cmd: 'marshal', body: { op: 'commission' } }, echo, at('marshal'))
      }
      if (k === 'p') return say(x, [echo], { kind: 'rewardTarget' })
      if (k === 'w') return send(x, { cmd: 'marshal', body: { op: 'wanted' } }, echo, at('marshal'))
      if (k === 'c') return send(x, { cmd: 'marshal', body: { op: 'claim' } }, echo, at('marshal'))
      if (k === '?') return say(x, [echo, ...menuHelp('marshal')], at('marshal'))
      if (back) return say(x, [echo], at('top'))
      return { state: withDoor(x, { prompt: at('marshal') }) }
    case 'sal':
      if (k === 't') return say(x, [echo], { kind: 'salTarget' })
      if (k === 'p') return send(x, { cmd: 'sal', body: { op: 'password' } }, echo, at('sal'))
      if (k === 'f') return send(x, { cmd: 'sal', body: { op: 'fortune' } }, echo, at('sal'))
      if (k === 's') return send(x, { cmd: 'sal', body: { op: 'swear' } }, echo, at('sal'))
      if (k === '?') return say(x, [echo, ...menuHelp('sal')], at('sal'))
      if (back) return say(x, [echo], at('tavern'))
      return { state: withDoor(x, { prompt: at('sal') }) }
  }
}

// ---------------------------------------------------------------------------
// Drawing: at most `h` lines; app.ts pads and fits them.

export function drawDoor(s: AppState, view: View, w: number, h: number, now: number): string[] {
  const dv = doorView(view)
  if (s.screen === 'doors') {
    const lines = [...header('Games', w)]
    DOORS.forEach((d, i) => lines.push(`${i === 0 ? LIGHTBAR : '|07'} ${d.key} |16 |11${d.title.padEnd(12)} |07${d.blurb}`))
    lines.push('', '|08Games are BBS doors that run beside the board. Your progress is kept on the server.')
    return [...pad(lines, h - 1).slice(0, h - 1), footer('|08[|151|08]|07 Play  |08[|15Q|08]|07uit', w)]
  }
  const d = s.door ?? initialDoor()
  const waiting = isWaiting(d, dv, now)
  const page = d.page === 'game' && dv.phase === 'title' && !waiting ? 'title' : d.page
  switch (page) {
    case 'title':
      return drawTitle(dv, w, h)
    case 'instructions': {
      const leaf = Math.min(d.leaf ?? 0, INSTRUCTION_PAGES.length - 1)
      const more = INSTRUCTION_PAGES.length > 1 ? ` |08(page ${leaf + 1} of ${INSTRUCTION_PAGES.length}, Q to stop)` : ''
      return withKey([...header('Instructions', w, false, false), ...INSTRUCTION_PAGES[leaf].slice(0, Math.max(1, h - 4))], w, h, more)
    }
    case 'log': {
      const b = dv.board
      const body = !b ? ['|07Fetching the daily log...'] : b.missing ? ['|08No log yet. The lanes are quiet.'] : logLines(b.log)
      return withKey([...header('Daily Log', w, false, false), ...body.slice(-Math.max(1, h - 4))], w, h)
    }
    case 'rankings': {
      const b = dv.board
      const body = !b ? ['|07Fetching the rankings...'] : b.missing ? ['|08No rankings yet.'] : rankingLines(b.rankings)
      return withKey([...header('Rankings', w, false, false), ...body.slice(0, Math.max(1, h - 4))], w, h)
    }
    case 'game':
      return drawGame(d, dv, w, h, now, waiting)
  }
}

function withKey(lines: string[], w: number, h: number, more = ''): string[] {
  return [...pad(lines, h - 1).slice(0, h - 1), center(`|08[|15Hit a key|08]${more}`, w)]
}

function drawTitle(dv: DoorView, w: number, h: number): string[] {
  // Art drawn as a block: one left margin for every row, so its columns line up.
  const raw = h >= 16 ? titleArt(w) : [`|11${GAME.title}`]
  const margin = ' '.repeat(Math.max(0, Math.floor((w - Math.max(...raw.map(visibleLength))) / 2)))
  const epoch = `|08Epoch ${dv.season.replace(/^s/, '')}${dv.board?.status ? ` |08· |07${dv.board.status.traders} traders · day ${dv.board.status.ageDays + 1}` : ''}`
  const menu = '|08[|15E|08]|07nter the lanes  |08[|15I|08]|07nstructions  |08[|15L|08]|07og (today)  |08[|15R|08]|07ankings  |08[|15Q|08]|07uit'
  const block = [...raw.map(l => margin + l), '', center(epoch, w), '', center(menu, w)]
  const top = Math.max(0, Math.floor((h - block.length) / 2))
  return [...Array.from({ length: top }, () => ''), ...block]
}

function drawGame(d: DoorLocal, dv: DoorView, w: number, h: number, now: number, waiting: boolean): string[] {
  if (dv.phase === 'loading' || (waiting && dv.phase === 'title')) return ['', `|10Opening the lanes${'.'.repeat(1 + (Math.floor(now / 500) % 3))}`]
  const p = effectivePrompt(d, dv)
  const sh = shown(p, dv)
  if (dv.phase === 'new') {
    const lines = [...header(GAME.title, w, false, false), `|10There is no record of you in Epoch ${dv.season.replace(/^s/, '')}. Every trader starts somewhere:`,
      '|10a Freetrader, a few hundred credits, and sector 1.', '', ...dv.transcript.slice(-3), '']
    const input = waiting ? `${sh.label}|15${d.buf} |08(…)` : `${sh.label}|15${d.buf}|13▄`
    return [...lines, input, '', '|08Enter to launch. An empty name goes back.']
  }
  const rows = Math.max(1, h - 2)
  const pending = waiting ? (d.wait?.lines ?? []) : []
  const tail = [...dv.transcript, ...pending, ...d.scratch, ...(waiting ? [] : sh.lead)]
  const shownTail = tail.slice(-rows)
  const prompt = waiting ? `${sh.label}|08(…)` : `${sh.label}|15${d.buf}|13▄`
  const stats = dv.snapshot ? quickStats(dv.snapshot) : ''
  return [...pad(shownTail, rows), fitPipe(prompt, w), `|16${stats}`]
}
