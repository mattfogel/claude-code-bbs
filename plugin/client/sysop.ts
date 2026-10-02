// The sysop menu: conferences, the voting booth, the message of the day and
// callers. It is reached by the hidden `*` key on the main menu, and only
// for accounts the server says are sysop or mod; every other screen looks
// the same for everyone. The server checks the role again on each change.

import type { AppState, ClientKey, Screen, Step } from './app'
import type { Conference, SysopOp, View } from '../types'
import { fitPipe, sanitizeUserText, stripPipe } from '../shared/pipe'
import { LIMITS, SLUG_RE, isValidHandle, normalizeHandle } from '../shared/protocol'
import { LIGHTBAR, footer, header, pad, panel, panelItem, plain, windowOf, type Item } from './ui'

export const SYSOP_SCREENS = ['sysop', 'sysConfs', 'sysPolls', 'sysForm'] as const
export type SysopScreen = (typeof SYSOP_SCREENS)[number]
export const isSysopScreen = (s: Screen): s is SysopScreen => (SYSOP_SCREENS as readonly string[]).includes(s)

export const isSysop = (view: View) => view.me?.role === 'sysop' || view.me?.role === 'mod'

export const SYSOP_MENU: (Item & { to: 'sysConfs' | 'sysPolls' | 'motd' | 'user' | 'back' })[] = [
  { key: 'c', label: 'Conferences', to: 'sysConfs' },
  { key: 'p', label: 'Polls', to: 'sysPolls' },
  { key: 'm', label: 'Message of the Day', to: 'motd' },
  { key: 'u', label: 'Ban / Unban / Mute', to: 'user' },
  { key: 'q', label: 'Back to Main', to: 'back' },
]

type FormKind = 'conference' | 'poll' | 'motd' | 'user'
type Field = { label: string; value: string; max: number }

/** A form being filled in: one field at a time, Enter moves on, the last asks to save. */
export type Form = {
  kind: FormKind
  title: string
  fields: Field[]
  at: number
  /** The slug when editing an existing conference (its slug is fixed). */
  editing?: string
  back: SysopScreen
}

/** A Y/N question standing between a key and its change. */
export type Confirm = { prompt: string; op: SysopOp; back: SysopScreen }

const lower = (k: ClientKey) => k.key.toLowerCase()
const isEnter = (k: ClientKey) => k.key === 'return' || k.key === 'enter'
const isBack = (k: ClientKey) => k.key === 'q' || k.key === 'left' || k.key === 'backspace'
const isChar = (k: ClientKey) => !k.ctrl && !k.meta && (k.key.length === 1 || k.key === 'space')
const charOf = (k: ClientKey) => (k.key === 'space' ? ' ' : k.key)

function move(sel: number, key: ClientKey, count: number): number {
  const d = ({ down: 1, up: -1, pagedown: 10, pageup: -10 } as Record<string, number>)[key.key]
  if (d === undefined || count === 0) return sel
  return Math.max(0, Math.min(count - 1, sel + d))
}

const field = (label: string, max: number, value = ''): Field => ({ label, value, max })

function conferenceForm(c?: Conference): Form {
  const fields = [
    field('Name', LIMITS.conferenceNameMax, c?.name),
    field('Sponsor', LIMITS.handleMax, c?.sponsor),
    field('Description', LIMITS.motdMax, c?.description),
    field('Number', 2, c ? String(c.n) : ''),
  ]
  if (!c) fields.unshift(field('Slug', LIMITS.conferenceSlugMax))
  return { kind: 'conference', title: c ? `Edit ${c.name}` : 'New Conference', fields, at: 0, editing: c?.slug, back: 'sysConfs' }
}

function pollForm(): Form {
  const options = Array.from({ length: LIMITS.pollOptionsMax }, (_, i) => field(`Option ${i + 1}`, LIMITS.pollOptionMax))
  return { kind: 'poll', title: 'New Poll', fields: [field('Question', LIMITS.pollQuestionMax), ...options], at: 0, back: 'sysPolls' }
}

const motdForm = (view: View): Form => ({ kind: 'motd', title: 'Message of the Day', fields: [field('Message', LIMITS.motdMax, view.feed?.motd ?? '')], at: 0, back: 'sysop' })

const userForm = (): Form => ({
  kind: 'user',
  title: 'Callers',
  fields: [field('Handle', LIMITS.handleMax), field('Ban, Unban or Mute', 5, 'mute'), field('Minutes (mute)', 5, '60')],
  at: 0,
  back: 'sysop',
})

/** The form's values as a change, or why they don't make one. */
function formOp(form: Form): SysopOp | string {
  const v = form.fields.map(f => f.value.trim())
  switch (form.kind) {
    case 'conference': {
      const [slug, name, sponsor, description, n] = form.editing ? [form.editing, ...v] : v
      if (!SLUG_RE.test(slug)) return 'Slug: lowercase letters, digits and -, up to 16.'
      if (!name) return 'A conference needs a name.'
      if (n && !/^[1-9][0-9]?$/.test(n)) return 'Number: 1 to 99, or blank for the next free one.'
      return { kind: 'conference', slug, name, sponsor, description, n: n ? Number(n) : undefined }
    }
    case 'poll': {
      const [question, ...options] = v
      const kept = options.filter(Boolean)
      if (!question) return 'A poll needs a question.'
      if (kept.length < LIMITS.pollOptionsMin) return `At least ${LIMITS.pollOptionsMin} options.`
      return { kind: 'poll', question, options: kept }
    }
    case 'motd':
      return { kind: 'motd', text: sanitizeUserText(v[0], LIMITS.motdMax) }
    case 'user': {
      const handle = normalizeHandle(v[0])
      const actions: Record<string, 'ban' | 'unban' | 'mute' | undefined> = { b: 'ban', ban: 'ban', u: 'unban', unban: 'unban', m: 'mute', mute: 'mute' }
      const action = actions[v[1].toLowerCase()]
      if (!isValidHandle(handle)) return 'Not a handle.'
      if (!action) return 'Ban, unban or mute.'
      const minutes = Number(v[2]) || 60
      return { kind: 'user', action, handle, minutes: action === 'mute' ? minutes : undefined }
    }
  }
}

function describe(op: SysopOp): string {
  switch (op.kind) {
    case 'conference':
      return op.remove ? `Remove conference ${op.slug}? Its posts stay on the Board` : `Save conference ${op.slug} (${op.name})?`
    case 'poll':
      return `Open poll "${op.question}" with ${op.options.length} options?`
    case 'closePoll':
      return 'Close this poll? No more votes after that'
    case 'motd':
      return op.text ? 'Set the message of the day?' : 'Clear the message of the day?'
    case 'user':
      return op.action === 'mute' ? `Mute ${op.handle} for ${op.minutes} min?` : `${op.action === 'ban' ? 'Ban' : 'Unban'} ${op.handle}?${op.action === 'ban' ? ' Their posts are hidden' : ''}`
  }
}

// ---------------------------------------------------------------------------
// Keys

export function pressSysop(s: AppState, key: ClientKey, view: View): Step {
  if (!isSysop(view)) return { state: { ...s, screen: 'main', form: undefined, confirm: undefined } }

  if (s.confirm) {
    const c = s.confirm
    if (lower(key) === 'y') return { state: { ...s, screen: c.back, confirm: undefined, form: undefined, msg: 'Saving...' }, action: { type: 'sysop', op: c.op } }
    if (lower(key) === 'n' || isBack(key)) return { state: { ...s, confirm: undefined, msg: 'Cancelled.' } }
    return { state: s }
  }

  switch (s.screen as SysopScreen) {
    case 'sysop': {
      const hot = SYSOP_MENU.findIndex(i => i.key === lower(key))
      const at = hot >= 0 ? hot : isEnter(key) ? s.list : -1
      if (at < 0) return { state: { ...s, list: move(s.list, key, SYSOP_MENU.length) } }
      switch (SYSOP_MENU[at].to) {
        case 'sysConfs':
          return { state: { ...s, screen: 'sysConfs', list: 0 } }
        case 'sysPolls':
          return { state: { ...s, screen: 'sysPolls', list: 0 } }
        case 'motd':
          return { state: { ...s, screen: 'sysForm', form: motdForm(view) } }
        case 'user':
          return { state: { ...s, screen: 'sysForm', form: userForm() } }
        case 'back':
          return { state: { ...s, screen: 'main', list: 0 } }
      }
      return { state: s }
    }

    case 'sysConfs': {
      const all = view.feed?.conferences ?? []
      const c = all[s.list]
      if (lower(key) === 'a') return { state: { ...s, screen: 'sysForm', form: conferenceForm() } }
      if ((isEnter(key) || lower(key) === 'e') && c) return { state: { ...s, screen: 'sysForm', form: conferenceForm(c) } }
      if (lower(key) === 'd' && c) {
        const op: SysopOp = { kind: 'conference', slug: c.slug, name: c.name, sponsor: c.sponsor, description: c.description, remove: true }
        return { state: { ...s, confirm: { prompt: describe(op), op, back: 'sysConfs' } } }
      }
      if (isBack(key)) return { state: { ...s, screen: 'sysop', list: 0 } }
      return { state: { ...s, list: move(s.list, key, all.length) } }
    }

    case 'sysPolls': {
      const polls = view.feed?.polls ?? []
      const p = polls[s.list]
      if (lower(key) === 'n') return { state: { ...s, screen: 'sysForm', form: pollForm() } }
      if (lower(key) === 'c' && p) {
        if (p.closed) return { state: { ...s, msg: 'That poll is already closed.' } }
        const op: SysopOp = { kind: 'closePoll', id: p.id }
        return { state: { ...s, confirm: { prompt: `${describe(op)}: "${plain(p.question, LIMITS.pollQuestionMax)}"`, op, back: 'sysPolls' } } }
      }
      if (isBack(key)) return { state: { ...s, screen: 'sysop', list: 1 } }
      return { state: { ...s, list: move(s.list, key, polls.length) } }
    }

    case 'sysForm':
      return filling(s, key)
  }
}

function filling(s: AppState, key: ClientKey): Step {
  const form = s.form
  if (!form) return { state: { ...s, screen: 'sysop' } }
  const f = form.fields[form.at]
  const set = (next: Partial<Form>) => ({ state: { ...s, form: { ...form, ...next } } })
  const setValue = (value: string) => set({ fields: form.fields.map((x, i) => (i === form.at ? { ...x, value } : x)) })

  if (isEnter(key)) {
    // A blank poll option after the second ends the list early.
    const pollDone = form.kind === 'poll' && form.at > LIMITS.pollOptionsMin && !f.value.trim()
    if (form.at < form.fields.length - 1 && !pollDone) return set({ at: form.at + 1 })
    const op = formOp(form)
    if (typeof op === 'string') return { state: { ...s, msg: op } }
    return { state: { ...s, confirm: { prompt: describe(op), op, back: form.back } } }
  }
  if (key.key === 'up') return set({ at: Math.max(0, form.at - 1) })
  if (key.key === 'down' || key.key === 'tab') return set({ at: Math.min(form.fields.length - 1, form.at + 1) })
  if (key.key === 'backspace' || key.key === 'delete') {
    if (!f.value && form.at === 0) return { state: { ...s, screen: form.back, form: undefined, msg: 'Cancelled.' } }
    return setValue([...f.value].slice(0, -1).join(''))
  }
  if (key.ctrl && key.key === 'u') return setValue('')
  if (isChar(key) && [...f.value].length < f.max) return setValue(f.value + charOf(key))
  return { state: s }
}

// ---------------------------------------------------------------------------
// Drawing

export function drawSysop(s: AppState, view: View, w: number, h: number): string[] {
  const lines = sysopLines(s, view, w, h)
  const tail = s.confirm ? `|14${s.confirm.prompt} |15(Y/N)` : footer(keysFor(s), w)
  return [...pad(lines, h - 1).slice(0, h - 1), tail]
}

function keysFor(s: AppState): string {
  switch (s.screen as SysopScreen) {
    case 'sysop':
      return '|07Command|08: |15' + (SYSOP_MENU[s.list]?.label ?? '')
    case 'sysConfs':
      return '|08[|15A|08]|07dd  |08[|15E|08]|07dit  |08[|15D|08]|07elete  |08[|15Q|08]|07uit'
    case 'sysPolls':
      return '|08[|15N|08]|07ew poll  |08[|15C|08]|07lose  |08[|15Q|08]|07uit'
    case 'sysForm':
      return '|07Enter|08 next  |07Up|08 back  |07Backspace|08 on empty first field cancels'
  }
}

function sysopLines(s: AppState, view: View, w: number, h: number): string[] {
  switch (s.screen as SysopScreen) {
    case 'sysop': {
      const lines = [...header('Sysop', w)]
      const pw = Math.min(44, w - 2)
      const rows = SYSOP_MENU.map((item, i) => panelItem(item, s.list === i, pw - 2))
      lines.push(...panel(view.me?.role === 'mod' ? 'Moderator' : 'Sysop Menu', rows, pw).map(l => ` ${l}`))
      lines.push('', `|08Signed on as |15${plain(view.me?.handle, LIMITS.handleMax)}|08, ${view.me?.role ?? 'user'}. Changes reach the feed in a few seconds.`)
      return lines
    }

    case 'sysConfs': {
      const all = view.feed?.conferences ?? []
      const lines = [...header('Conferences', w), `|13${' #'.padEnd(4)}${'Slug'.padEnd(14)}${'Name'.padEnd(26)}Sponsor`]
      if (!all.length) lines.push('|08No conferences yet. |15A|08dd one.')
      const [top, end] = windowOf(all.length, s.list, h - 6)
      for (let i = top; i < end; i++) {
        const c = all[i]
        const row = `${String(c.n).padStart(2)}  ${c.slug.padEnd(14)}${plain(c.name, LIMITS.conferenceNameMax).padEnd(26)}${plain(c.sponsor, LIMITS.handleMax)}`
        lines.push(i === s.list ? `${LIGHTBAR}${fitPipe(row, w - 1)}|16` : `|07${row}`)
      }
      return lines
    }

    case 'sysPolls': {
      const polls = view.feed?.polls ?? []
      const lines = [...header('Polls', w)]
      if (!polls.length) lines.push('|08No polls. |15N|08ew one.')
      polls.forEach((p, i) => {
        const row = `${p.closed ? 'closed' : 'open  '}  ${String(p.total).padStart(4)} votes  ${plain(p.question, LIMITS.pollQuestionMax)}`
        lines.push(i === s.list ? `${LIGHTBAR}${fitPipe(row, w - 1)}|16` : `${p.closed ? '|08' : '|07'}${row}`)
      })
      lines.push('', '|08The feed lists open polls first, then the newest closed ones.')
      return lines
    }

    case 'sysForm': {
      const form = s.form
      if (!form) return []
      const labelW = Math.max(...form.fields.map(f => f.label.length)) + 1
      const valueW = Math.max(10, Math.min(w - labelW - 8, 60))
      const [top, end] = windowOf(form.fields.length, form.at, h - 8)
      const rows = form.fields.slice(top, end).map((f, j) => {
        const i = top + j
        const value = i === form.at ? `|15${f.value}|13▄` : `|07${f.value}`
        return ` |13${f.label.padStart(labelW)}|08: ${fitPipe(value, valueW)}`
      })
      const lines = [...header('Sysop', w), ...panel(form.title, rows, Math.min(w - 2, labelW + valueW + 6)).map(l => ` ${l}`)]
      if (form.kind === 'poll') lines.push('', '|08Leave an option blank to stop adding them.')
      if (form.kind === 'conference' && form.editing) lines.push('', `|08The slug |07${form.editing}|08 can't change.`)
      if (form.kind === 'user') lines.push('', '|08Banning hides everything they posted. Sysops cannot be banned.')
      return lines.map(l => (stripPipe(l).length > w ? fitPipe(l, w) : l))
    }
  }
}
