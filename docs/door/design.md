# HYPERPLANE: a space-trading door for lATENT sPACE

A faithful mechanical replication of TradeWars 2002 as a door game on the board. Same universe shape, port economy, haggling, ships, combat, planets, citadels, corporations and NPC raiders. Every name, every line of text and all art are original. Research and sources: [research/](research/) (01 universe and economy, 02 ships and combat, 03 planets, corps and NPCs, 04 UI, licensing and clones).

The name and a light ML reskin fit the board's name. The cargo is Compute, Data and Weights, seasons are called Epochs, and the raiders are the Hallucinations. Ships, stations and the space setting stay as they are. The title is one constant, `GAME.title`, in `plugin/shared/door/data.ts`.

## Goals

- **The real game, not a homage.** Players who knew TW2002 should recognize the rules: port classes and B/S letters, pair-port trading, the haggle, holds that cost 20 more each, 2^n ranks, fighters left in sectors, toll fighters, mines, Genesis-style planets, citadel levels 1 to 6, quasar-style cannons, corps, raiders with grudges. Where a formula is known, use it. Where it is reconstructed, make it a tunable constant in `data.ts`.
- **Plays in short bursts while Claude works.** A turn is a single keypress, read-only commands cost nothing, and nothing needs two players online at once.
- **Fits the free tier.** One HTTP write per player intent, never per keystroke. Whatever is static or public is read from the R2 feed through the cache.
- **Original expression.** "TRADE WARS" is a live registered trademark (US Reg. 2894858, John Pritchett). We copy mechanics (not copyrightable), never names, text or art. See the rename table.

## Non-goals (for now)

- Real-time anything: photon "waves" measured in seconds, live chat inside the game, the Tri-Cron gambling mini-game, the Cineplex.
- Exact prompt-for-prompt compatibility with TWX Proxy scripts.
- Gold-only features: bubbles, custom races, and per-ship editors beyond `data.ts` constants.

## Renames

| TW2002 | HYPERPLANE |
|---|---|
| Trade Wars / TW2002 | HYPERPLANE |
| Fuel Ore / Organics / Equipment | Compute / Data / Weights (same price tiers and order) |
| A game (BigBang to BigBang) | an Epoch (`season` in code) |
| The Federation, FedSpace, FedLaw, the Feds | The Concord, Concord Space, Concord Law, the Marshals |
| Captain Zyrain / Admiral Nelson / Fleet Admiral Clausewitz | Marshal Ostrander / Commodore Vale / High Marshal Teague |
| StarDock (Class 9), "Stargate Alpha I" | Drydock (Class 9), "Drydock Anchorage" |
| Sol / Rylos / Alpha Centauri (Class 0) | Haven / Meridian / Tycho Reach |
| Terra | Terra (generic) |
| Hardware Emporium / Shipyards / Police HQ / Bank / Tavern / Underground / Grimy Trader | Outfitter / Shipwright / Marshal's Office / Exchange Bank / The Last Light / the Back Room / Old Sal |
| Ferrengi, Ferrengal; Assault Trader / Battle Cruiser / Dreadnought | the Hallucinations, Overfit Prime; Glitch / Phantom / Confabulator |
| Alien Traders | Drifters |
| Genesis Torpedo / Atomic Detonator / Corbomite / TransWarp | Seed Torpedo / Cracker Charge / Deadman Charge / Jump Drive |
| Ether Probe / Psychic Probe / Armid mine / Quasar Cannon | Ghost Probe / Haggle Lens / Contact mine / Mass Driver |
| Planet classes M K O L C H U | T Terran, D Desert, O Oceanic, H Highland, G Glacial, V Volcanic, J Jovian |
| Ship names, rank titles, all help, story and log text | Original (see `data.ts`) |

Generic terms we keep: sector, warp, port, holds, fighters, shields, limpet, beacon, planet, citadel, colonists, corporation, CEO, turns, autopilot, density and holo scanners, interdictor, photon missile, cloak, tow, escape pod.

## Architecture

```
 Claude Code mod
   ├─ client/door/*.ts      pure: door screens, prompts, transcript rendering (no $)
   ├─ shared/door/*.ts      pure, shared with the server: protocol, data tables, nav, formatting
   └─ hooks/register.tsx    glue: runs door commands (local or remote), keeps the door view in $.state
        │ reads  GET feed/door/<season>/map.json      the warp graph (static per season; cached)
        │        GET feed/door/<season>/news.json     daily log, rankings, game status (V screen)
        │ writes POST bbs/v1/door/<command>           one per intent; the reply carries the new private state
        ▼
 Worker (server/src/index.ts → server/src/door/routes.ts): auth, validation
   └─ Universe Durable Object (server/src/door/universe.ts), one per season ("s1", ...)
        SQLite: sectors, warps, ports, players, ships, deployments, planets, corps, npcs, log, meta
        engine (server/src/door/engine/*.ts): pure functions over plain records, unit-tested under Node
        alarm: publish news.json when dirty (≥ 30 s apart); NPC steps; daily maintenance ("extern")
```

- **One Durable Object for the whole universe.** It is single-threaded, so trades, combat and NPC moves never race. A season is a DO name. A new season is a new Big Bang under a new name, so old seasons stay readable.
- **The engine is pure.** `server/src/door/engine/` takes and returns plain records: no SQL, no `cloudflare:` imports. Its tests live in `test/door/` and run under the root vitest (Node). The DO loads the rows a command needs, calls the engine, and writes back what changed. Every random draw comes from a PRNG seeded by `(season seed, player id, action counter)`, so results are reproducible.
- **CPU.** The free plan gives a Worker 10 ms of CPU per request. A Big Bang of 1000 sectors runs in steps on the DO's alarm (sectors, then warps, then the connectivity fix, then ports, then specials), storing progress in `meta`, so no step comes near the limit. Per-command work is small: a move walks at most 45 hops, and the course plot is a BFS over 1000 nodes.

### What the client holds

- **The map (public, static per season):** `map.json` = `{ season, sectors: N, warps: number[][] }`, about 15 KB. Hooks fetch it once per session into `$.state`. TW's ships plot over the whole graph, unexplored sectors included, so the course plotter (`shared/door/nav.ts`, BFS with avoids) runs locally for free. The map never goes into the Client's props.
- **Private state:** `PlayerSnapshot` is the ship, cargo, credits, turns, alignment, experience, equipment, known ports (last-seen port reports), avoids and the current `SectorView`. `GET /v1/door/state` returns it once per session (one request), and every write's reply returns the new snapshot. Hooks keep it in `$.state`.
- **The transcript:** the game is a scrolling terminal, as TW was. Hooks keep the last 300 pipe-coded lines in `view.door.transcript`. Each command appends its echo (`Command [T=187]:[3554] ? : M`) and its output lines, formatted by `shared/door/format.ts` from the server's events. The Client draws the tail of the transcript above the live prompt and a one-line quick-stats bar.
- **Local commands** (`D` redisplay, `I` info, `/` quick stats, the computer's plotter, port reports from memory, known universe, avoids, `V` status from `news.json`, help) cost no request. The Client posts them like any other action. Hooks run them against `$.state` and append to the transcript.

## Request budget

| Intent | Requests |
|---|---|
| Enter the game (state) | 1 |
| Move: any distance, autopilot or express, stopping at the first interrupt | 1 |
| Dock at a port: costs a turn, returns the commerce report and opening offers | 1 |
| Each haggle offer (accept, counter, final, or "not interested") | 1 (TW allows at most 4 per commodity; most trades take 1 or 2) |
| Buy at Haven or the Drydock, deploy fighters or mines, scans, attack, land, planet commands | 1 each |

A typical 30-minute session runs 40 to 80 requests, so 30 daily players cost about 2,400 a day. A per-player limit (60 door requests a minute) and a daily cap (2,000) keep a script from eating the board's budget. Trade-route macros come later; they turn a pair-trading loop into one request.

## Turns and time

- **Turns regenerate continuously:** `turnsPerDay / 24` an hour, capped at `turnsPerDay` (default 250). This is lazy: the DO stores `turns` and `turnsAt` and settles the regeneration on each request. A daily reset would punish someone who plays between Claude turns. A sysop flag (`turnModel: 'daily'`) restores TW's midnight reset.
- **The game date** is real UTC time with the year moved forward (`GAME.yearOffset`, default +300). One real day is one game day.
- **Extern** (daily maintenance) runs lazily, on the first request after 00:00 UTC, in steps on the alarm. It handles Concord towing, repossessing empty ships in Concord Space, clearing the space lanes, planet production and growth, citadel construction, treasury interest, Terra's colonist regrowth, Hallucination regeneration, cloak failure, clearing busts, decaying radiation and deleting inactive players. Ports regenerate lazily per port, as in the research (5% of capacity a day, capped per visit).

## Rules (by area)

Formulas and tables come from the research. `data.ts` holds every constant. "Research §" points at the file and section.

### Universe (research 01 §1)
- **Size and density:** 1000 sectors (100 to 5000 configurable). Ports in 40% × 95% of sectors, planets up to 20%. Two-way warps 30% of sectors, one-way warps 3%. 1 to 6 outgoing warps per sector, maximum course length 45.
- **Generator:** research 01 §1.2.
  1. Make sectors 1 to 10 a dense Concord Space cluster.
  2. Add a random spanning structure so the graph is strongly connected.
  3. Add the random two-way links, then the one-way links.
  4. Cap every sector at 6 outgoing warps.
  5. Repair until every sector is within 45 hops of sector 1.
  6. Sort each warp list.
- **Sector 1:** Haven (Class 0) and Terra (Terran planet, the colonist source, up to 100,000 groups, regrowing 1,500 a day).
- **Specials:** the Drydock (Class 9), Meridian and Tycho Reach (Class 0) sit in random 6-warp sectors outside 1 to 10. Concord Space is sectors 1 to 10 plus the Drydock's sector.
- **Space lanes:** the shortest paths Haven ↔ Drydock ↔ Meridian ↔ Tycho Reach are Concord-patrolled. Extern clears deployables from them.
- **Port classes 1 to 8:** shares 20/20/20/10/10/10/5/5 %. Port names are drawn from an original list of about 600 in `shared/door/names.ts`.

### Ports and trading (research 01 §2 to §4)
- **Port record:** productivity per commodity (30 to 300; capacity = 10 × productivity) and a signed MCIC per commodity. Positive means the port sells, negative means it buys. Magnitudes are Ore 40–90, Organics 30–75, Equipment 20–65. Stock regenerates 5% of capacity a day.
- **Price:** research 01 §3.1.
  - `unit = base ± dayVar − expAdj − MCIC × F × fill`, with base 25.5/50.5/90.5 and F 0.25/0.5/0.9.
  - `dayVar` is a seeded daily value from 0 to 18.
  - `expAdj` applies below 1000 experience.
  - The opening offer is `(1 + MCIC/1000) × unit × qty`.
- **Haggle:** research 01 §4.2 and §4.3.
  - In round n, the port accepts a bid within `exact × (1 ± |MCIC|/250/n)`.
  - After each counter its hidden basis drifts: `exact' = 0.7·exact + 0.3·bid`.
  - The port allows 0 to 2 middle rounds (seeded per dock), then makes its final offer.
  - A bid outside tolerance ends the trade ("not interested"). The turn spent docking is not refunded.
  - Trade experience is +1/+2/+5 for landing within 2%/1%/exactly at the best price the port would have taken. The Haggle Lens shows the percentage of best price achieved.
  - The negotiation state lives in the DO per player and expires after 10 minutes or at the next move.
- **Order of a dock:** the port first offers to buy what it buys and you carry, then to sell what it sells. Default quantities follow research 01 §4.1. Docking costs 1 turn. Trading costs no further turns.
- **Haven and the other Class 0 ports** sell holds, fighters and shields.
  - Hold cost is `B + 20 × currentHolds` per hold, where `B` runs from 151 to 249 over an 18-day triangle cycle.
  - Fighters cost 160–239 each and shields 110–189 a point, on the same cycle.
- **Rob and steal** (alignment ≤ −100): research 01 §4.6.
  - Safe amounts are EXP/30 holds (steal) and 3 × EXP credits (rob).
  - At or under the safe amount the bust chance is 1 in 50, rising steeply above it.
  - A bust costs 10% of experience plus holds. Each port remembers its last buster for 7 days, and a second attempt there always busts.
- **Port building and upgrades** (research 01 §2.4):
  - Upgrades cost 250/500/900 credits per 10 units.
  - Construction needs a planet in the sector to supply materials, plus a fee and build days by class.

### Movement and navigation (research 01 §5)
- **Turn costs:** a warp costs the ship's turns-per-warp (TPW). Docking and a holo scan cost 1 turn; a density scan, the computer and course plots cost nothing.
- **Move:** typing a sector number or `M` moves you. An adjacent target is one hop.
  - Otherwise the client plots locally and shows `The shortest path (7 hops, 21 turns) from sector 123 to 456 is: …`, then asks `Engage the autopilot? (Y/N/Express) [Y]`.
  - The move request carries the whole path and a mode.
  - The server walks it hop by hop and stops at the first interrupt: hostile fighters, mines, a toll, NavHaz damage, a Mass Driver, a Hallucination, out of turns, or (Alert mode) a port, planet or trader.
  - The reply lists every hop's events for the client to print as the classic scrolling autopilot.
- **Hostile sector entry order:** NavHaz, limpet, contact mines (50% of a sector's mines detonate, 20 damage each), planet Mass Drivers (sector shot), then fighters (offensive, defensive or toll).
- **Scanners:**
  - Density costs 0 turns and lists adjacent sectors with density, warp count, NavHaz and anomaly. Density weights are in research 01 §5.4.
  - Holo costs 1 turn and gives a sector display of every adjacent sector.
- **Ghost Probes** follow the shortest path, report each sector, and die on enemy fighters, telling the fighters' owner who sent them.
- **Known universe:** a sector becomes explored when you enter it or holo-scan it. Port reports are what you saw last. Unexplored warps show in parentheses, in red.

### Ships and the Drydock (research 02 §1, §2)
- **Ships:** the 16 TW hulls with their exact mechanical stats (cost = holds + drive + computer + hull, holds, fighters, fighters per attack, shields, TPW, odds, mines, beacons, seeds, jump drive, scanners, photon, transport range) under original names, plus the Escape Pod (5 holds, 50 fighters, 50 shields, 6 TPW, 0.6 odds).
- **New characters** start in sector 1 in a Freetrader (the Merchant Cruiser) with 300 credits, 20 holds, 30 fighters and full turns.
- **Shipwright:**
  - Buy a ship: you trade in your current one, valued at 65% of its four components times a condition factor, plus 35% of carried equipment.
  - Sell extra ships docked at the Drydock.
  - Rename for 5,000.
  - The Consortium Flagship requires a CEO. The Marshal's Cruiser (ISS) requires a commission.
- **Outfitter:** every item with the research 02 §2.1 price and per-ship maximum.
  - Contact mine 1,000; limpet 10,000; Seed Torpedo 20,000; Cracker Charge 15,000; Deadman Charge 1,000; cloak 25,000.
  - Ghost Probe 3,000; planet scanner 30,000; Haggle Lens 10,000; density scanner 2,000; holo scanner 25,000.
  - Jump Drive I 50,000, II 80,000; photon missile 40,000; mine disruptor 6,000; beacon 100.
- **Exchange Bank:** a personal account with deposit, withdraw and transfer, holding up to 500,000.
- **Marshal's Office:**
  - Commission: apply at alignment ≥ +500, which sets it to +1,000.
  - Post rewards on evil traders (+1 alignment per 1,000 credits).
  - The ten most wanted.
  - Claim rewards.
- **The Last Light (tavern):**
  - Announcements (100 credits; they go in the daily log).
  - Old Sal, who sells traces on a named trader and the Back Room password.
  - A graffiti wall.
- **The Back Room** (alignment ≤ +100, password from Old Sal): post hits (−1 alignment per 250 credits), collect hits, change your alias.

### Combat and deployables (research 02 §3, §4)
- **Ship vs ship:** `A` picks a target in the sector, then you choose how many fighters to send, up to the ship's fighters per attack. Resolution (reconstructed model, research 02 §3.1):
  - Attack power = `sent × attOdds × rand(0.95–1.05)`.
  - The defender's shields absorb first, then its fighters fall at `defOdds`.
  - The attacker loses `(shieldsLost + fightersLost) × defOdds / attOdds`, capped at the number sent.
  - Zero fighters and zero shields means the ship is destroyed. An empty ship is captured instead, except a Skiff or an Escape Pod.
  - The defender flees if `sent > 1.25 × (its fighters + shields)` and nothing interdicts.
  - Salvage is credits and cargo, nothing on overkill. A Deadman Charge deals 20 damage per device to the killer.
- **Losing a ship:**
  - The Escape Pod goes to the previous sector after a self-inflicted death, or 3 to 20 hops along a safe path after a kill.
  - You lose cargo, fighters, shields, equipment and credits on hand. Bank credits are kept.
  - Being podded costs 10% of experience. A third death in a day, or dying in a pod or a Skiff, keeps you out until tomorrow and costs 50% of experience.
- **Sector fighters:**
  - Deploy with `F`, personal or corporate, in one of three modes:
    - **Defensive:** blocks entry, fights at 1:1.
    - **Offensive:** attacks on entry with `1.25 × (target's max fighters + max shields)`.
    - **Toll:** 5 credits per fighter.
  - `G` lists your deployments. Fighters report intruders to their owner, which shows in the next state reply as "Deployed fighters report …".
- **Mines:**
  - Contact mines: half of a sector's mines detonate on entry, 20 damage each, at most 250 per sector, and they never hit their owner's corp.
  - Limpets: one attaches on entry and shows your position to its owner. Removal at a Class 0 port or the Drydock costs 5,000.
  - Mine disruptors.
- **Concord Space:**
  - Players with alignment ≥ 0, experience < 1,000 and < 50 fighters are protected there. Attacking one brings Marshal Ostrander (150,000 damage, −10 alignment, −10% experience).
  - Concord Space forbids mines and fighters, photons, towing out and cargo dumping. Extern tows ships with 100 or more fighters and limits each sector to 5 parked ships.
- **Experience and alignment:** the table in research 02 §5.2 (kills, podding, Concord rewards, hits, taxes, swearing at Old Sal).
- **Ranks:** rank n at 2^n experience. There are two ladders of 23 original titles, chosen by the sign of alignment, plus alignment words in bands of 125.

### Planets and citadels (research 03 §1 to §6)
- **Creating a planet:** a Seed Torpedo (`U`) makes one. The class roll uses weights T 30, H 15, O 15, D 15, V 10, G 7, J 8, shifting toward J as a sector fills. A sector holds at most 5 planets. Creating one gives +25 experience and ±10 alignment.
- **Colonists:** groups of 1,000 come from Terra (1 hold per group).
- **Production:** per class, `colonists / ratio` per line, peaking at 50% of the line's cap. Fighters per day = `(ore + organics + equipment produced) / F`. The table is in research 03 §3. Landing can kill colonists at the class's death rate.
- **Planet menu:** take all, take or leave product, colonists, military (leaving fighters claims the planet), claim ownership, display, destroy (Cracker Charge).
- **Citadels, levels 1 to 6,** with the per-class costs and build days in research 03 §5:
  1. Treasury at 2% a day.
  2. Combat computer and military reaction %.
  3. Mass Driver: a sector shot of ore used / 3, and an atmospheric shot of `ore × A%` using half that ore.
  4. Planetary jump: 400 ore per sector, to sectors holding your fighters.
  5. Planetary shields: 10 ship shields make 1 planetary shield, fought at 20:1; 200 or more stop photons.
  6. Interdictor: 500 ore per escape attempt.
- **Planetary transporter:** 50,000 plus 25,000 per extra hop.
- **Remaining overnight** in a citadel protects you.
- **Invading:** the landing order follows research 03 §6. Rewards for cracking a planet are in the research 03 table.
- **Planetary trade:** sell a planet's stock to a port in its sector at 60% of normal offers.

### Corporations (research 03 §7)
- **Make and join:** `T` opens the corp menu. Make a corp, or join one with its password. A corp has at most 5 members.
- **Shared assets:** members share fighters, mines and planets marked corporate, and can transfer credits, fighters, mines and shields to each other in the same sector.
- **CEO powers:** memo, password, dropping a member. The Consortium Flagship is limited to one per corp.
- **Dissolution:** if the CEO leaves, the corp dissolves and its fighters become rogue mercenaries.
- **Rankings:** corps are ranked by experience.

### NPCs (research 03 §8)
- **The Hallucinations** (raiders):
  - Up to 40 ships (Raider / Reaver / Warhulk by population slot), home Overfit Prime in a dead end.
  - They move on the alarm: one step each per tick while any player was active in the last hour, and one step per player command with chance 1 in 20.
  - They demand surrender. Surrendering costs cargo or credits and buys peace for the day. Fighting back creates a grudge (3 per Hallucination ship).
  - They size their attack to your fighter count, rob ports and trade pairs, and regenerate from Overfit Prime unless you hold its sector.
- **Drifters:** up to 50 traders with experience and alignment who trade port pairs. Killing one is like killing a player.
- **The Marshals:** three indestructible patrol ships. They won't enter sectors with fighters, defend protected players, and destroy an evil pilot flying the Marshal's Cruiser.

### Communications and the daily log (research 03 §9)
- **The daily log** (`news.json`, 800 lines): announcements, ships destroyed and podded, planets created, cracked or captured, ports destroyed or built, corps formed, Hallucination raids, extern events. Players see the lines since their last visit on entry.
- **Messages:**
  - Hails (private messages, delivered to a mailbox in the DO, shown in the next state reply).
  - A Concord comm channel (public, carried in `news.json` with the last 50 lines).
  - Corp memos.
- **Rankings and the V screen** (`news.json`): top traders by experience and by net worth, top corps, and game status (age, sectors, ports, planets, traders and % good, Hallucination count, and the Drydock sector if `config.showDrydock`).

## Screens (client/door)

- **Title:** original block-letter art for the title, a starfield, and `[E]nter the lanes  [I]nstructions  [L]og (today)  [R]ankings  [Q]uit`. It is reached from the main menu's new `[D]oors` entry, which lists doors with HYPERPLANE first.
- **New character:** ship name (30 characters). The trader name is the BBS handle.
- **Main view:** the transcript scrolls. The bottom three rows are the prompt `Command [T=187]:[3554] (?=Help)? :`, a quick-stats bar (`Sect 3554│Turns 187│Creds 2,412│Figs 30│Shlds 0│Hlds 20│Ore 0│Org 20│Equ 0`) and the BBS status bar. Colors follow the TW convention: green labels, cyan data, yellow numbers, red for danger and unknown.
- **Sub-prompts:** the computer, a port dock, the Drydock and each of its venues, a planet, a citadel and the corp menu each have their own prompt line and keymap, like the original.
- **Pending writes:** while a write is in flight the prompt shows `(…)` and further keys wait, apart from Esc.

## Phases

1. **Core (this build):** Big Bang; `map.json`; state; movement and autopilot; the sector display; density and holo scans; the computer (plotter, port reports, known universe, avoids, ship catalog, rank tables); docking, the haggle and trade experience; Class 0 purchases; the Drydock Shipwright, Outfitter (scanners, probes, beacons), Exchange Bank and Last Light announcements; turns; ranks and alignment; the daily log and rankings; the V screen; the title and new character screens; and the door entry on the main menu.
2. **Conflict:** ship vs ship combat, pods and death, fighters and modes, contact mines and limpets, mine disruptors, Concord Space protection and the Marshals, rob and steal, the Marshal's Office and the Back Room, bounties, Deadman Charges, beacons.
3. **Planets:** Seed Torpedoes, Terra colonists, production, citadels 1 to 6, Mass Drivers, planetary shields, interdictor, transporter, planetary jump, Cracker Charges, invading, planetary trade, port construction and upgrades.
4. **Society and NPCs:** corporations, the Hallucinations, Drifters, hails, mail and comm, photons, cloaks, Jump Drives, tow, the Haggle Lens, inactive deletion.
5. **Seasons:** tournament settings, a season end and hall of fame, trade-route macros, and an optional Claude tie-in (a few capped bonus turns per day for finished Claude turns, sending only a count).

## Phase 2 build notes (Conflict)

Decisions for the Conflict build, on top of the rules above. The wire types are in `shared/door/protocol.ts` (phase-2 commands, events and the snapshot's `limpet` and `blocked` flags), the constants in `data.ts` (`COMBAT`, `AWARDS`, `ROB`, `BACKROOM`, `MARSHAL_PATROL_MS`).

### Storage
- `deploys (id, sector, owner_id, kind 'fighters'|'contact'|'limpet', count, mode, toll)`: one fighter stack per sector, and one stack per owner per mine kind. `toll` is credits collected by toll fighters.
- `bounties (id, kind 'reward'|'hit', target_id, poster_id, amount, killer_id, ts)`: `killer_id` is set when the target dies to a player; claiming pays and deletes the row.
- `busts (sector, player_id, ts)`: the last trader a port busted; ignored after `ROB.bustClearDays`.
- `mail (id, player_id, ts, type, from_name, text)`: reports for players who were not there (attacked, fighters report, limpet attached, bounty paid). Delivered as `message` events on the player's next reply, then deleted.
- `PlayerRec` gains optional fields (old rows read as defaults): `deaths`/`deathDay`, `deadUntil`, `limpet` (the owner id and name), `paid` (the sector whose toll you paid), `strikes`/`strikeDay` (Back Room passwords), `swearDay`, `sensed`.

### Combat
- `A` attacks a trader in the sector (target by name), the hostile sector fighters (`*fighters`), or a Marshal. Attacking costs no turns. The engine uses the reconstructed model in Combat and deployables. A defender that is overwhelmed flees with `COMBAT.fleeChance` to a random adjacent sector, unless it is a pod. Attackers must have at least one fighter, may send up to `fightersPerAttack`, and cannot attack themselves.
- **Capture is deferred** (it needs ships a player owns but does not fly, a phase 3 or 4 feature). A ship with 0 fighters and 0 shields that takes any damage is destroyed, with salvage.
- **Deaths:** the pod rules in Losing a ship. A pod hit again, a Skiff, or a third death in a UTC day (`COMBAT.maxDeathsPerDay`) is fatal: `deadUntil` is the next 00:00 UTC, experience and alignment drop by half, and every command but `state` answers that the pilot is in no shape to fly. The first request after `deadUntil` restores the starting ship, credits and fighters at sector 1 (the bank, experience and alignment stay).
- **Safe pod path:** a random walk of 3 to 20 hops over sectors without hostile fighters, stopping at the first unsafe sector. Self-inflicted deaths (mines, NavHaz, offensive fighters, Marshals) go to the previous sector.
- **Experience and alignment:** the research 02 §5.2 rows for fighting (opposite, same and neutral alignment) and podding, once the victim has 10 experience. Wrecks add `COMBAT.navhazPerWreck` NavHaz outside Concord Space.
- **Deadman Charges** hit the killer for `COMBAT.deadmanDamage` per device (shields, fighters, then the ship).
- **Concord Space:** a protected trader cannot be attacked there. Trying, or attacking a Marshal anywhere, destroys the attacker: 150,000 damage, −10 alignment, −10% experience, pod to the previous sector. Fighters, mines and offensive deployments are refused in Concord Space and on the space lanes, and extern clears them from the lanes.
- **Marshals** have no stored position. Each sits in a Concord sector picked by seed from `floor(now / MARSHAL_PATROL_MS)`. They show in the sector display and read as density 489, 462 and 512. An evil pilot in a Marshal's Cruiser who ends a move in a sector holding Commodore Vale or High Marshal Teague loses the ship to 50,000 damage.

### Deployables and entering sectors
- Entry order: NavHaz, limpet, contact mines, fighters. A walk stops at the first sector that hurts you, at hostile fighters, or when you die.
- **Fighters:** `F` deploys (personal only until corps exist) in Defensive, Offensive or Toll mode, and takes them back (`collect`). Refused in Concord Space, on the lanes, over `COMBAT.maxFightersWithPlanet` with a planet, over another owner's fighters, and **while another non-corp trader is in the sector** (so nobody can trap a sleeping ship).
- **Hostile fighters** are another owner's, defensive or offensive, or toll fighters you have not paid. Offensive fighters attack on entry with `1.25 × (target max fighters + max shields)` and the survivors fall back to defend. Toll fighters take `count × COMBAT.tollPerFighter` credits when you can pay (`paid` is set to the sector and you may move on), and otherwise hold you. While hostile fighters hold you, `blocked` is true: `move` is refused, and you can `attack` them, `retreat` (1 turn, works at 0 turns, no hazards, to the previous sector) or `surrender`.
- **Surrender** to sector fighters: a toll stack takes all the credits you have up to the toll, a defensive stack takes your whole cargo. Either way you may move on.
- **Fighters** report each intruder to their owner through the mailbox. A kill pays the attacker the toll the stack was holding.
- **Mines:** 50% of a sector's contact mines (rounded down) detonate, 20 damage each, absorbed by shields, then fighters, then the ship. Mines spare their owner. A sector holds at most `COMBAT.maxMinesPerSector`. Limpets clamp one onto your hull (it replaces any earlier one) and the owner learns it through the mailbox. The activated limpet scan (`scan` kind `limpet`) lists ships carrying your limpets. A Class 0 port or the Drydock removes a limpet for `CLASS0.limpetRemoval`.
- **Mine Disruptor:** `disrupt` fires one into an adjacent sector and destroys up to `COMBAT.disruptorMines` mines and limpets there (limpets last), whoever owns them. Needs one in stock.
- **Beacon:** `beacon` leaves up to 41 characters in a sector. A second beacon cancels the first and is used up too. Not in Concord Space.
- **Density:** fighters 5 each, contact mines 10 each, limpets 2 each with the anomaly flag, Marshals by name.

### Crime
- At a class 1 to 8 port, alignment ≤ −100 opens `<R>ob / <S>teal` before trading. `rob` and `steal` cost 1 turn and need no dock. Safe amounts, bust odds, bust penalties and the repeat-bust rule are `ROB`. A port with `credits` below the request lets you ask for more but busts nobody; a rob takes at most what the port holds. Port credits only grow through players' trades. A bust never takes holds below `ROB.minHolds`.

### The Marshal's Office and the Back Room
- **Marshal's Office** (alignment ≥ `AWARDS.marshalOfficeMinAlign`): `commission` at alignment ≥ 500 sets alignment to 1,000 and issues the commission; `reward` posts credits on an evil trader (alignment < 0) for +1 alignment per 1,000; `wanted` lists the top ten by total reward; `claim` pays rewards on traders you have killed.
- **The Last Light:** Old Sal sells a trace (credits, the target's sector), the Back Room password (per-player, `adjective noun` from `BACKROOM`), a fortune, and takes a swear once a day (−1 experience, −1 alignment).
- **Back Room** (alignment ≤ `AWARDS.backRoomMaxAlign`, with the password): `hit` posts credits on anyone (−1 alignment per 250), `collect` pays hits on traders you killed, `alias` renames you for `BACKROOM.aliasBase + aliasPerExp × experience`. A wrong password strikes: thrown out, beaten (credits on hand), half your experience, then the ship.
- Marshal rewards and hits are separate pools. Both are claimed by killing the target (a pod counts).

### Extern (lazy, first request after 00:00 UTC)
Clears fighters, mines and beacons from the space lanes and Concord Space, and takes `COMBAT.navhazDecay` points off every sector's NavHaz.

### Not in this phase
Capture, ships you own but do not fly, towing, photon missiles, cloaks and corporate deployments (`owner: 'corp'` is refused until corps exist), and the Hallucinations' use of `surrender`.

## Testing

- **Engine** (`test/door/*.test.ts`, Node): Big Bang invariants (connected, ≤ 6 warps, Concord cluster, specials in 6-warp sectors, max course length), the price formula against research 01's measured table (within 2%), haggle tolerances against the measured counter-offer limits, hold cost against research 02's B = 173 checks, path walking and interrupts, ranks, turn regeneration, combat outcomes against the safety ratings.
- **Server** (`server/test/door.test.ts`, Miniflare): the full HTTP flow of create, state, move, dock, haggle and buy holds, plus publishing `map.json` and `news.json`, auth, and the request caps.
- **Mod** (`plugin/test/door.test.tsx` and `test/door-screens.test.ts`): screens from fixtures, key flows (title → new character → move → dock → haggle), and local commands costing no requests.

## Open questions

1. **Turns.** Continuous regeneration (default, 250 a day, capped) or TW's daily reset?
2. **Universe size for Epoch 1.** 1000 sectors (TW default) or smaller (500) while the player base is small?
3. **Showing the Drydock's sector on the V screen.** TW's default is to show it; hiding it makes finding it part of the game.
