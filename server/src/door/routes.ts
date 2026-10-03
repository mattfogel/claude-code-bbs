// HYPERPLANE's write API under /v1/door, plus the sysop's Big Bang. The
// Worker authenticates, sanitizes user text and picks the season; the
// Universe DO does the rest in one call per request.

import type { Context, Hono } from 'hono'

import { stripPipe, sanitizeUserText } from '../../../plugin/shared/pipe'
import { MARSHALS } from '../../../plugin/shared/door/data'
import { DOOR_BUILT_PHASE, DOOR_COMMAND_PHASE, DOOR_LIMITS, SEASON_RE, isDoorCommand } from '../../../plugin/shared/door/protocol'
import { LIMITS, type ApiError, type ErrorCode } from '../../../plugin/shared/protocol'
import type { Env, UserRow } from '../env'
import type { DoorUser } from './universe'

type App = { Bindings: Env; Variables: { user: UserRow } }

/** What index.ts lends the door routes, so error codes and parsing stay in one place. */
export type DoorHelpers = {
  fail: (c: Context, code: ErrorCode, message: string) => Response
  body: <T>(c: Context) => Promise<Partial<T> | undefined>
  writeBlock: (c: Context<App>) => Response | undefined
  modlog: (c: Context<App>, action: string, target: string, detail?: string) => Promise<void>
}

/** The season players are in: the CURRENT_SEASON var, default "s1". */
export function currentSeason(env: Env): string {
  const s = env.CURRENT_SEASON ?? ''
  return SEASON_RE.test(s) ? s : 's1'
}

export const universe = (env: Env, season: string) => env.UNIVERSE.get(env.UNIVERSE.idFromName(season))

const shipName = (raw: unknown) => stripPipe(sanitizeUserText(typeof raw === 'string' ? raw : '', DOOR_LIMITS.shipName))
/** A name or password typed by a player: no pipe codes, trimmed, capped. */
const word = (raw: unknown, max: number) => stripPipe(sanitizeUserText(typeof raw === 'string' ? raw : '', max))
/** The longest thing a player can attack by name: a Marshal. */
const MARSHAL_NAME_MAX = Math.max(LIMITS.handleMax, ...MARSHALS.map(m => m.name.length))
const isError = (r: unknown): r is ApiError => !!r && typeof r === 'object' && 'error' in r

export function mountDoor(app: Hono<App>, h: DoorHelpers) {
  const send = (c: Context<App>, r: object) => (isError(r) ? h.fail(c, r.error.code, r.error.message) : c.json(r))
  const doorUser = (c: Context<App>): DoorUser => ({ id: c.get('user').id, handle: c.get('user').handle })
  const muted = (c: Context<App>) => (c.get('user').muted_until > Math.floor(Date.now() / 1000) ? h.fail(c, 'muted', 'You are muted for now.') : undefined)

  app.get('/v1/door/state', async c => send(c, await universe(c.env, currentSeason(c.env)).state(doorUser(c))))

  app.post('/v1/door/:command', async c => {
    const cmd = c.req.param('command')
    if (!isDoorCommand(cmd)) return h.fail(c, 'not_found', 'No such door command.')
    if (DOOR_COMMAND_PHASE[cmd] > DOOR_BUILT_PHASE) return h.fail(c, 'invalid', 'Not yet.')
    const req = await h.body<Record<string, unknown>>(c)
    if (!req) return h.fail(c, 'invalid', 'Expected a JSON object.')
    // User text: sanitized here, never trusted from the client.
    if (cmd === 'create') {
      const blocked = muted(c)
      if (blocked) return blocked
      req.shipName = shipName(req.shipName)
    } else if (cmd === 'shipwright' && (req.op === 'buy' || req.op === 'rename')) {
      const blocked = muted(c)
      if (blocked) return blocked
      req.name = shipName(req.name)
    } else if (cmd === 'announce') {
      const blocked = h.writeBlock(c)
      if (blocked) return blocked
      req.text = sanitizeUserText(typeof req.text === 'string' ? req.text : '', DOOR_LIMITS.announce)
    } else if (cmd === 'bank' && req.op === 'transfer') {
      req.to = word(req.to, LIMITS.handleMax)
    } else if (cmd === 'beacon') {
      const blocked = h.writeBlock(c)
      if (blocked) return blocked
      req.text = sanitizeUserText(typeof req.text === 'string' ? req.text : '', DOOR_LIMITS.beacon)
    } else if (cmd === 'attack') {
      // Long enough for the Marshals' names ("High Marshal Teague") and `*fighters`.
      req.target = word(req.target, MARSHAL_NAME_MAX)
    } else if (cmd === 'sal') {
      req.target = word(req.target, LIMITS.handleMax)
    } else if (cmd === 'marshal') {
      if (req.op === 'reward') req.target = word(req.target, LIMITS.handleMax)
    } else if (cmd === 'backroom') {
      req.password = word(req.password, 40)
      if (req.op === 'hit') req.target = word(req.target, LIMITS.handleMax)
      if (req.op === 'alias') {
        const blocked = muted(c)
        if (blocked) return blocked
        req.alias = word(req.alias, DOOR_LIMITS.alias)
      }
    }
    return send(c, await universe(c.env, currentSeason(c.env)).command(doorUser(c), cmd, req))
  })

  // Sysop: start a new Epoch. It runs in steps; the door answers 'busy' until it is done.
  app.post('/v1/mod/door/bigbang', async c => {
    if (c.get('user').role !== 'sysop') return h.fail(c, 'forbidden', 'Sysop only.')
    const req = await h.body<{ season: string; seed: number; sectors: number }>(c)
    if (!req || typeof req.season !== 'string' || !SEASON_RE.test(req.season)) return h.fail(c, 'invalid', 'Expected {season: "s1", seed?, sectors?}.')
    const seed = Number.isInteger(req.seed) ? req.seed : undefined
    const sectors = Number.isInteger(req.sectors) ? req.sectors : undefined
    const r = await universe(c.env, req.season).bigBang({ season: req.season, seed, sectors })
    if (!isError(r)) await h.modlog(c, 'door-bigbang', req.season, `${r.sectors} sectors, seed ${r.seed}`)
    return send(c, r)
  })
}
