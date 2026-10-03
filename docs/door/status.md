# HYPERPLANE: build status and handoff

What exists, how it actually behaves beyond the contract, what's missing, and how to build the next phase. The rules live in [design.md](design.md). Formulas and sources are in [research/](research/).

## Phase 1: built (PR #10)

| Area | Where |
|---|---|
| Contract: constants, wire types, plotter, PRNG | `plugin/shared/door/{data,protocol,nav}.ts` |
| Content: port names, text, art | `plugin/shared/door/{names,text,art}.ts` |
| Engine (pure, tested under Node) | `server/src/door/engine/*.ts`, tests in `test/door/*.test.ts` |
| Universe Durable Object, one per Epoch | `server/src/door/universe.ts` |
| Routes | `server/src/door/routes.ts` (`mountDoor`), HTTP tests in `server/test/door.test.ts` |
| Formatters | `plugin/shared/door/format.ts` |
| Screens and planner | `plugin/client/door/{screen,session,content}.ts` |
| Glue | `plugin/hooks/register.tsx`: the atoms `doorMap`, `doorKnown`, `doorNews` and the top-level `door()` |
| Mod tests | `test/door-screens.test.ts`, `plugin/test/door.test.tsx` |

### Running an Epoch
- `CURRENT_SEASON` in `server/wrangler.jsonc` (default `s1`) names the live Epoch.
- A sysop starts one with `POST /v1/mod/door/bigbang {season, seed?, sectors?}`. Sectors are clamped to 100–5000. Re-banging a season answers `taken`.
- The bang runs in steps on the Durable Object's alarm. Commands answer `busy` until `door/<season>/map.json` is published.
- For a new Epoch, bang a new season id, change `CURRENT_SEASON`, then redeploy.

### Server behaviour beyond the contract
- **Errors:**

  | Code | Status | Meaning |
  |---|---|---|
  | `closed` | 409 | No Big Bang yet. The client shows "The lanes are dark." |
  | `busy` | 503 | The bang is in progress. |
  | `not_found` | 404 | No character yet, or an unknown trader. |
  | `taken` | 409 | A second character. |
  | `rate_limited` | 429 | 60 a minute or 2,000 a day. GET state counts. |
  | `muted` | 403 | |
  | `cooldown` | 429 | |
  | `invalid` | 400 | A bad body, any game refusal, or a phase 2+ command ("Not yet."). |

- **Where commands work:** Class 0 buys work in any Class 0 sector. The Outfitter, Shipwright, bank and announcements work in the Drydock's sector. None of them needs a dock first.
- **Docking** costs 1 turn.
  - At Class 0 it returns a `class0` event.
  - At the Drydock it returns a `text` event.
  - At a standard port it returns `dock` plus `pending`.
- **Haggle sessions:**
  - Steps are recomputed on every reply: sells first, then buys. Steps with max 0 are dropped.
  - The port's figure is `round(unitOffer × qty)`.
  - The first offer on a commodity fixes its quantity. `qty: 0` passes on that commodity.
  - A bid at or better than the port's figure is accepted at the bid.
  - You can't switch commodity mid-haggle.
  - The session ends when its steps run out, on `skip`, on a move, or after 10 minutes idle.
  - GET state re-sends the current figure as a `counter`.
  - A bid out of tolerance gets `refused` and closes that commodity.
  - A frivolous lowball gets a `text` insult and a repeated `counter`, without spending a round.
- **Moves:** a path must follow the warps and be at most `maxCourse` long, or it's refused before any turn is spent. Running out of turns stops the move with reason `turns`.
- **Known universe:** sectors you pass through, holo-scan or probe become explored, with port reports. `known` is a delta in write replies and complete in GET state.
- **Daily log:**
  - `snapshot.lastSeenLog` in GET state is the value from before the visit.
  - The first command of a UTC day gives +1 XP and +1 alignment.
- **Feeds:** `map.json` is cached for an hour (`max-age=3600`). `news.json` is cached for 30 s (`max-age=30`) and republished at most every 30 s.

### Client shape
- **`view.door`:** `{season, phase: 'title'|'loading'|'new'|'ready', rev, transcript (≤300 lines), snapshot?, here?, busy, board?, ask?}`.
- **`ask`** is one of `engage {path}`, `trade {…}`, `class0 {prices}` or `drydock`.
- **The action:** `{type:'door', echo?: string[], cmd, …}`. The planner in `session.ts` turns a command into transcript lines plus at most one request.
- **Mirrored types:** the wire types are copied into `plugin/types/index.d.ts`, because the validator rejects a types file with imports. A compile-time check in `session.ts` fails if the copies drift from `protocol.ts`.
- **Map and known universe:** the map and known universe stay in the hooks atoms and never go into the Client's props.

### Known gaps in phase 1
- **Unused content:** the haggle wording ignores `REFUSALS`, `COUNTER` and `FINAL_OFFER` from `text.ts`. The client prints its own "We'll buy/sell them for N", and refusals show the server's text.
- **Drydock:** there's no ship selling (a player owns only one ship) and no Old Sal. The tavern only takes announcements.
- **Placeholders:** port credits start at 0 (robbing needs them). The `hallucinations`/`drifters` counts are 0, and `comm` and the corp rankings are empty. `removeLimpet` always refuses.
- **Trade-in** uses a condition factor of 1.
- **Map shape:** at the default settings, the max-course repair never triggers (the diameter is about 13–14 hops), so the map is fairly small-world.
- **Typecheck:** the root `test/door/*.ts` files aren't in any tsconfig.
- **Transcript size:** at 300 lines the transcript is about 30–50 KB of the Client's props. Lower the cap if renders get heavy.
- **Untested:** it hasn't been played in a real session against the deployed server.

## Phase 2: conflict (next)

The rules are in design.md "Combat and deployables" and "Ships and the Drydock" (Marshal's Office, Back Room). The formulas are in research 02 §3–§5. The constants are in `data.ts` (`COMBAT`, `AWARDS`, `ROB`, `ITEMS` with `phase: 2`). The protocol already has the request and event types: `attack`, `retreat`, `surrender`, `deploy`, `collect`, `rob`, `steal`, `marshal`, `backroom`, `beacon`, and the `attack`/`attacked`/`podded`/`deployed`/`busted`/`robbed`/`stolen` events (`DOOR_COMMAND_PHASE` marks them 2).

Checklist:
- **Engine:**
  - Ship vs ship resolution, using the reconstructed model in design.md, tuned against research 02's safety ratings.
  - Fleeing, capture, salvage and Deadman Charges.
  - Pods: where they go, their losses, and the daily death limit.
- **Sector deployables:**
  - Fighters (defensive, offensive, toll; personal or corp).
  - Contact mines and limpets, and mine disruptors.
  - The order of events on entering a hostile sector, wired into `move.ts` interrupts (the `fighters`/`mines`/`toll`/`navhaz` stops already exist).
- **Concord Space:** the protection rule, the Marshals (whose density is in data), towing at extern, and the space-lane clearing.
- **Rob and steal:** the safe amounts, bust odds and port memory. Ports need starting credits.
- **Drydock venues:**
  - The Marshal's Office: commission, rewards, the ten most wanted.
  - The Back Room: password from Old Sal, hits, alias.
  - Old Sal himself: traces and the password. His text is in `text.ts` `OLD_SAL`.
- **Beacons.**
- **Log lines:** use `LOG_TEMPLATES.destroyed`/`podded` in `text.ts`.
- **Client:** the A/F/G/H/K/R keys and the Marshal's Office and Back Room venues, plus formatters for the new events. The client currently prints "That system comes online in a later Epoch" for these keys.
- **Tests:** combat outcomes against the safety ratings; offline defence (fighters fight when their owner is away); fleeing; podding; rob busts; HTTP flows; mod flows.

Phases 3–5 (planets, society and NPCs, seasons) follow design.md "Phases".

## Building it: what we learned

- **Ownership:** split the work by file so parallel agents never touch the same module. Phase 1 used one agent for the server (engine plus Durable Object plus routes), one for the client (screens plus hooks glue plus formatters) and one for content.
- **Auto mode and `plugin/`:** the auto-mode classifier returned "no verdict" for Write and Edit calls under `plugin/` (the live mod this session loads) while edits elsewhere went through. Build the mod side in a mode that accepts edits, and never route a refused edit through the shell.
- **The mod validator:** `$` is followed only into functions declared at the top level of `register.tsx`. `$.state` writes must name an atom directly. Types files can't import. Keep logic pure, in `shared/` or `client/`, and keep `register.tsx` as glue.
- **Checks to run:** `npm run typecheck`, `npx vitest run`, `npm --prefix server test`, `claude plugin test plugin`, `claude plugin validate plugin`, and `bun scripts/screens.ts 80 24` to eyeball the screens.
