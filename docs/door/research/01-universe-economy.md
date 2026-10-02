# TW2002 Research 01: Universe, Navigation and the Port Economy

Scope: universe generation, sectors and warps, FedSpace and the special ports, port classes and stock, price formulas, haggling, port robbing and stealing, movement and turns, the computer and scanners, and daily refresh.

Confidence tags used below:
- **[DOC]**: official docs (TWINSTR / TW v3 manual) or the TWGS BigBang/TEDIT screens.
- **[EMP]**: measured by players (tw-cabal formulas, Cherokee's haggle research, player utilities).
- **[RE]**: recovered by reverse-engineering the server (TWX Proxy 3.0 `NativeHaggleEngine.cs`, which quotes binary addresses).
- **[RECON]**: my own reconstruction or a judgment call. Treat these as tunable.

---

## 1. Universe generation (BigBang)

### 1.1 BigBang parameters (TWGS v2 / TW v3.27 BigBang screen) [DOC]

| Key | Setting | Default | Range / notes |
|---|---|---|---|
| R | Random seed | random | The same seed with the same settings gives an identical universe |
| A | Universe size in sectors | **1000** | 100 to 1000 classic. Gold raises the cap (20,000 in older docs; 30,000 shown on the TWGS 2.x screen) |
| B | Maximum course length | 45 (0 = auto) | 20 to 255. Long values give star-shaped maps, short values give round ones. The course plotter refuses longer routes |
| C | Max possible starports | **40% of sectors** | 10 to 80% |
| D | Initial starports built | **95% of max** | 10 to 100% |
| E | Max planets | 20% of sectors | 2 to 40% |
| F | Two-way warps | **30% of sectors** | 10 to 200%. A count of A<->B links |
| G | One-way warps | **3% of sectors** | 1 to 100% |
| H / I | Max players / ships | 200 / 4 x players (cap 2000) | |
| K-U | Bubbles, min/max size (100), min/max links (1-4), tunnel depth (0) | 0 bubbles | Gold only |
| X / Y | Standard / special starport power | 100% | 10 to 1000% firepower when attacked |
| J / P | Gold features / MBBS compatibility | | Version string shows `v3.xx`, `Gold`, `MBBS` |

A 1000-sector stock game therefore has max_ports = 400, max_planets = 200, and about 380 ports built at the bang. A live TEDIT capture confirms `max_sectors 1000, max_ports 400, max_planets 200` [DOC].

### 1.2 Graph shape [DOC/EMP]
- The universe is a **directed graph**. Each sector has **1 to 6 outgoing warps** ("Warps to Sector(s)" lists up to 6). Some warps are one-way. The return path can differ from the outbound path, and the docs warn about this.
- The bang guarantees a connected map: you can reach every sector from Sol. Max course length acts as the diameter bound.
- **Dead ends** are 1-warp sectors. **Tunnels** are chains of 2-warp sectors. **Bubbles** are groups of sectors reached through a single gateway sector. Natural bubbles come from the random graph. Gold "bubbles" are explicit pockets of at least 100 sectors joined by 1 to 4 links, optionally through tunnels of depth T to U.
- **Black holes** (a way in but no way out) never come from a normal bang. Only a sysop edit creates them.
- **[RECON] Suggested generator:** (1) Make sectors 1-10 a dense FedSpace cluster. (2) Add a random spanning structure so the graph is strongly connected. (3) Add `0.30 x N` random two-way links. (4) Add `0.03 x N` random one-way links. (5) Never let any sector exceed 6 outgoing warps. (6) BFS from sector 1 and add links until the eccentricity is at most the max course length. (7) Sort each sector's warp list in ascending order. TWX stores warps sorted, and the game prints them ascending.

### 1.3 FedSpace and Sol [DOC]
- **FedSpace = sectors 1-10 plus the StarDock sector.** Sectors 1-10 are interlinked. In a live capture, sector 1 warps to 2,3,4,5,6,7 and sector 2 warps to 1,3,7,8,9,10.
- Sector 1: nebula "**The Federation**", beacon "**FedSpace, FedLaw Enforced**". It holds the planet **Terra** (Class M, owned by the Federation, about 50k colonists, max 100,000, regen 1.5%/day) and the Class 0 port **Sol**.
- Other sectors show `in uncharted space.` unless a nebula name is set. Nebula names can be edited in TEDIT. [RECON] For a faithful clone, use "uncharted space" everywhere except FedSpace ("The Federation").
- FedLaw: no mines can be deployed in FedSpace, and fighters there get you hit by Captain Zyrain. Players are "fedsafe" while good-aligned with **experience below 1000**. The Feds defend fedsafe players and kill anyone who attacks a Fed. FedSpace ship limit per sector: 5 (default). Players are **towed out at Extern** if they hold more than 99 or 100 fighters while offline, or if a sector is over its limit. Empty ships in FedSpace are repossessed at Extern.

### 1.4 StarDock (Class 9), Rylos and Alpha Centauri (Class 0) [DOC/EMP]
- **1 Class 9 port (StarDock)**, sometimes named "Stargate Alpha I". It contains the Hardware Emporium, Shipyards, Tavern, Bank, Cineplex and Police HQ, plus the Underground. Its sector is placed at random and shown on the `V` (game status) screen when the sysop setting "Display StarDock" is on. Otherwise players have to find it.
- **3 Class 0 ports: Sol (sector 1), Rylos, Alpha Centauri.** They sell holds, fighters and shields. They also offer limpet removal (5,000 cr in older versions).
- Placement rule observed in the v1.03 BIGBANG: **StarDock and both remote Class 0 ports always sit in 6-warp sectors**, which almost always have at least one one-way outgoing warp. That means more ways out than ways in, so they are hard to find (TWUTIL/FINDSGA, 1992). A modern reimplementation (twarp) describes StarDock as "six warps out and seven or more in". The sources conflict here. [RECON] Use 6 out for all three; in-degree is free.
- **Major Space Lanes (MSL)** are the shortest paths Sol->StarDock, StarDock->Sol, SD<->Rylos, SD<->Alpha Centauri and Rylos<->AC. Rylos and AC are MSL sectors themselves. Extern clears player fighters and mines from the MSLs and drops planets there to citadel level 2.
- Destroyed Class 0/9 ports are rebuilt at Extern once radiation clears (radiation lifetime is 1 to 14 days, sysop-set). Each kill makes all special ports stronger.

### 1.5 Port population at the bang [EMP: Traitor bang statistics, 20 bangs]

| Class | Code (Ore/Org/Equ) | Share of ports | Build time if player-built (days) |
|---|---|---|---|
| 1 | BBS | ~20% | 6 |
| 2 | BSB | ~20% | 7 |
| 3 | SBB | ~20% | 8 |
| 4 | SSB | ~10% | 5 |
| 5 | SBS | ~10% | 4 |
| 6 | BSS | ~10% | 3 |
| 7 | SSS | ~5% | 2 |
| 8 | BBB | ~5% | 10 |
| 0 | Special (Sol/Rylos/AC) | 3 fixed | n/a |
| 9 | Special (StarDock) | 1 fixed | n/a |

Example: 1900 ports at 40%/95% on 5000 sectors gave classes 1/2/3 = 378/379/379, 4/5/6 = 189 each, 7 = 94, 8 = 99, plus the 4 specials. Port numbers are assigned to random sectors, so port #1522 is not in sector 1522. In TW a letter B means the **port Buys** (you sell to it) and S means the **port Sells**.

### 1.6 Port names
Ports get random flavor names (e.g. "Tarsus", "Cabal's Hideout"). twarp reports recovering **2,405 base names** from the original string table. The special ports are Sol, Rylos, Alpha Centauri and StarDock. [RECON] Ship a name list and draw from it without replacement.

---

## 2. Ports: stock, capacity, MCIC and regeneration

### 2.1 Internal port record (TEDIT port editor) [DOC/EMP]

```
Port number: 1484   Name: Cabal's Hideout   Class: 3
Ore: 2610  Org: 0  Equ: 0                  <- C/D/E "amount" fields
Productivity (units per day)  Ore: 261  Org: 95  Equ: 210
Maximum change in cost (percent) Ore: 61  Org: -60  Equ: -51   <- MCIC
Accumulated Trading Credits: 240 (scaled; see robbing)
Last ship to port / Last robbed by / Port firepower %
```

- **Capacity (max) = 10 x productivity.** The port above can sell 2610 ore and buy 950 organics and 2100 equipment.
- The amount field means **units on hand** for a commodity the port sells, and **units already bought (filled)** for one it buys. So 0 on a buy commodity means 100%: the port is ready to buy its full max. The port report's "Trading" column shows `max - filled` for buy commodities and `on hand` for sell commodities. "% of max" is that number divided by the max.
- **Max productivity: 6553 (65,530 units) in Gold/classic, and 3276 (32,760 units) in MBBS mode.**
- **MCIC (Maximum Change In Cost)** is signed. Positive means the port sells the commodity, negative means it buys, so MCIC doubles as the buy/sell flag. The range is -100 to 100. Values generated at the bang are uniform over:

| Commodity | Buy MCIC range | Sell MCIC range |
|---|---|---|
| Fuel Ore | -40 to -90 | +40 to +90 |
| Organics | -30 to -75 | +30 to +75 |
| Equipment | -20 to -65 | +20 to +65 |

Player-built ports always get +50 (sell) and -60 (buy). The bang's initial productivity values are not documented. Observed fresh ports run from a few hundred to about 3000 units per commodity (e.g. 820/970/1160, 2610/950/2100). [RECON] Draw productivity uniformly from about 30 to 300, so capacity runs 300 to 3000.

### 2.2 Port report (what the player sees) [DOC]

```
Commerce report for Tarsus: 02:01:48 PM Fri Aug 19, 2033

-=-=-        Docking Log        -=-=-
USS Enterprise docked 1 day(s) ago.

 Items     Status  Trading % of max OnBoard
 -----     ------  ------- -------- -------
Fuel Ore   Buying     820    100%       0
Organics   Buying     970    100%       0
Equipment  Selling   1160    100%       0

You have 300 credits and 20 empty cargo holds.
```

### 2.3 Regeneration [DOC]
- TEDIT "**Port Regeneration Rate**" is **5% of max per day** (live TWGS default capture). The rate is sysop-editable: one cabal MBBS game ran 1%/day.
- "**Max Regen Per Visit**" is 100% by default. It caps how much accumulated regen is applied in one go.
- Regen moves each commodity toward full: sell stock refills, and buy capacity empties back toward 100%.
- [RECON] Track `lastUpdate` per port. On visit or at Extern, add `rate% x max x elapsedDays` per commodity, cap the step at maxRegenPerVisit% of max, then clamp to [0, max]. twarp clamps each accrual at half of max.
- Port **credits** ("accumulated trading credits") grow when the port sells to players. They do not decay (tracked over 48 hours).

### 2.4 Player port construction and upgrade [DOC/EMP]
- `O` Starport Construction works only in a sector **without** a port. It needs a **planet in the sector** to supply materials, which must stay on the planet every day of the build or construction stalls. It also needs the fee and a free slot under the max-ports limit. Build times are in the class table above. Construction advances at Extern. The sector display shows `(Under Construction - N days left)`.
- XP and alignment for building a port: class 1 +25/+12, class 2 +29/+14, class 3 +34/+16, class 4 +20/+10, class 5 +16/+8, class 6 +12/+6, class 7 +7/+4, class 8 +45/+20.
- **Upgrade** (`O` in a sector that already has a port) works in steps of **+1 productivity, which is +10 units of capacity**. Cost per step: **Ore 250, Organics 500, Equipment 900 cr** (25/50/90 cr per unit). Gain per step: Ore +0.1 XP/+0.05 align, Org +0.2/+0.1, Equ +0.3/+0.15.
- Construction fee and per-class material amounts: **not found**. [RECON] Use roughly 10x one day's planet materials, scaled by build days.
- **Destroying a port**: -50 align, +50 XP. It leaves radiation (trading there or blind-warping in is fatal) and 25% NavHaz. A new port can't be built until the radiation clears. Fighters needed ≈ defensive value x (~22 / ship odds).

---

## 3. Prices

### 3.1 The port's price formula [RE, cross-checked against EMP tables]
TWX Proxy 3.0 inverts the server's offer to recover hidden port parameters. Its model:

```
s       = +1 if the PORT IS BUYING (you sell), -1 if the PORT IS SELLING (you buy)
Base    = 25.5 (Fuel Ore) | 50.5 (Organics) | 90.5 (Equipment)
F       = 0.25            | 0.5             | 0.9
pctFull = PortQty / (10 x productivity)   // the "% of max" fraction (Trading / max)
dayVar  = weekday term (empirical: Mon 0-5, Tue 7, Wed 10-15, Thu 9, Fri 11-12, Sat 11-18, Sun 10-12)
expAdj  = 0 if experience >= 1000, else s x (1000 - experience) / 100

unitTrue  = Base + s*dayVar - expAdj - MCIC * F * pctFull
            (if unitTrue < 4, add 1 until it is >= 4)
exact     = unitTrue x qty                          // the hidden "true price"
firstOffer= round( (1 + MCIC/1000 + v) x exact ),   v in [-0.003, +0.003]
```

What this means:
- **Buying port** (MCIC < 0). It pays most when it is empty (100% "Trading"). Each unit of MCIC adds F credits per unit at full demand, and the opening offer is shaded down by |MCIC|/1000.
- **Selling port** (MCIC > 0). It is cheapest when full and gets dearer as its stock runs down. The opening offer is marked up by MCIC/1000.
- **Experience** only matters below 1000 XP: at 0 XP you lose up to 10 cr/unit both ways. Alignment has no effect.

Validation against Traitor's measurements (250 holds of Equipment, port at 100%):

| Case | Model | Measured |
|---|---|---|
| -50 buy, 0 XP | (90.5+11-10+45) x 0.95 x 250 = **32.4k** | 32,405 |
| -50 buy, 1000+ XP | 146.5 x 0.95 x 250 = **34.8k** | 34,646 |
| +50 sell, 0 XP | (90.5-11+10-45) x 1.05 x 250 = **11.7k** | 11,760 |
| +50 sell, 1000+ XP | 34.5 x 1.05 x 250 = **9.06k** | 9,097 |

Reference opening offers for 250 holds at 0 XP, port at 100% [EMP]:

| Buy MCIC | Ore | Org | Equ |
|---|---|---|---|
| -90 / -75 / -65 | 10,678 | 20,144 | 34,647 |
| -50 | 8,791 | 17,712 | 31,910 |
| -30 / -20 | n/a | 15,634 | 26,380 (-20) |

| Sell MCIC | Ore | Org | Equ |
|---|---|---|---|
| 90 / 75 / 65 | 1,092 | 3,768 | 8,787 |
| 50 | 3,675 | 6,964 | 12,190 |
| 20 / 30 | n/a | 9,414 (30) | 18,725 (20) |

[RECON] The weekday term is empirical noise from one proxy author. A clone can replace it with a seeded daily random value in 0-18.

### 3.2 Class 0 / StarDock goods [DOC/EMP]

```
A  Cargo holds     :    594 credits / next hold
B  Fighters        :    237 credits per fighter
C  Shield Points   :    112 credits per point
```

- Holds cost `cost(H holds from 0) = B*H + 20*H*(H-1)/2`, so each hold costs 20 more than the last. B is a daily base between 151 and 249 on an **18-day cycle**: it climbs from 151 to 249 over 9 days, then falls back over 9 days.
- Fighter and shield prices also change at **midnight** (twarp calls this a "seven-day price cycle").

### 3.3 Planetary trade [DOC/EMP]
A port in a sector with a planet (citadel level 4 or higher, mobile) can buy a planet's entire stock in one turn. Offers are multiplied by **Planetary Trade %**: 60% by default, 100% in MBBS. Experience has no effect on planetary offers.

---

## 4. Trading and the haggle

### 4.1 Dialogue (exact strings from proxy parsers) [DOC/RE]

```
Command [TL=00:00:00]:[1995] (?=Help)? : P
<T> Trade at this Port   (evil: <R> Rob this Port, <A> Attack this Port, <Q> Quit)
Docking... One turn deducted, 249 turns left.
Commerce report for Cabal's Hideout: ...      (report as in 2.2)
We are buying up to 2100.  You have 50 in your holds.
How many holds of Equipment do you want to sell [50]?
Agreed, 50 units.

We'll buy them for 7,412 credits.            (or "We'll sell them for N credits.")
Your offer [7,412] ?
We'll buy them for 7,650 credits.            (port's counter = a "middle haggle")
Your offer [7,650] ?
Our final offer is 7,900 credits.            (final stage)
Your offer [7,900] ?
For your good trading you receive 1 experience point(s).   (tiers: good / great / excellent)
You have 3,459,312 credits and 50 empty cargo holds.
```

- Sell commodities are offered first in the order Ore, Org, Equ, then the port offers what it sells: `We are selling up to N.  You have M in your holds.` / `How many holds of X do you want to buy [default]?`
- The default quantity is `min(holds on board, port capacity)` when you sell. When you buy, it is `min(free holds, port stock, what you can afford)`.
- Pressing Enter at `Your offer [N] ?` accepts the port's figure.
- Rejection lines end the trade. The turn is already spent and the goods are not traded: "We're not interested.", "...go peddle your wares somewhere else", "...as stupid as you look, get lost", "Thats insane", "Get lost creep", "you'd better leave if you value your life". Planet trades accept with "...you drive a hard bargain, but we'll take them."

### 4.2 Acceptance rule [RE, matches Cherokee's measurements exactly]
Let `n` be the round number (1 for the first counter-offer) and `exact` the hidden true price from 3.1:

```
Port BUYING  (you sell): accepted if bid <= exact * (1 + |MCIC|/250 / n)
Port SELLING (you buy) : accepted if bid >= exact * (1 - MCIC/250 / n)
Hidden basis after each counter: exact' = 0.7*exact + 0.3*bid      (server @0x004594F5)
Selling port, round 1: a bid below exact/1.5 is a frivolous offer (insult, re-prompt)
```

Check: the largest first counter as a ratio of the opening offer is `(1+|MCIC|/250)/(1-|MCIC|/1000)`:
- -65 Equipment gives 134.8% (Cherokee measured **134.7%**).
- -20 gives 110.2% (measured 110.2%).
- -90 Ore gives 149.5% (measured **149.4%**).

The tolerance shrinks each round, because of the `/n` term, and the basis drifts toward your bids.

### 4.3 Number of rounds and the port's counters [EMP]
- Before the "final offer" a port allows a **random 0 to 2 or more "middle haggles"**. More middle haggles let you get more: at a -65 Equipment port the best result was 160/166/170 cr/unit with 0/1/2 middle haggles. Ore (-90) gave 51/54/56, Organics (-75) 94/99/102.
- Player heuristic: after each port counter, cut your own bid by about 60% of the port's increase (65% for MCIC -36 to -55, 75% for -20 to -35). At the final offer you must concede 300% (Ore), 270% (Org) or 250% (Equ) of its increase.
- [RECON] Server model for a clone:
  - Set `stages = rand(0..2)` middle haggles, then a final.
  - A bid outside tolerance ends the trade. On a middle stage, a bid inside tolerance but above the port's limit makes the port counter at `(its last offer + bid)/2`, shaded toward `exact`. On the final stage, a bid inside tolerance is accepted or ends the trade.
  - An accepted bid is paid as bid.

### 4.4 Experience from trading [DOC/EMP/RECON]
- The docs say: "You get experience points for making a good deal. The better the deal, the more points you get."
- The reward line has three tiers (good, great, excellent). The point values aren't published.
- Scripts offer a "blue haggle" mode that deliberately avoids gaining XP, so blues can stay fedsafe below 1000.
- [RECON] Award on accept by how close the bid was to the acceptance limit:
  - Under 50% of the way to the limit: 0 XP.
  - Good: 1 XP.
  - Great: 2 XP.
  - Excellent (within 2% of the limit): 3-5 XP.
- A **Psychic Probe** (Hardware Emporium) shows after the trade what percentage of the best possible price you got.

### 4.5 Strategy patterns the economy must support [DOC/EMP]
- **PPT (paired-port trading):** two adjacent ports with complementary goods. The classic pair is **BBS (1) next to SSB (4)**: buy Equipment at the BBS and sell it to the SSB, buy Organics at the SSB and sell them to the BBS. Valid class pairs: 1-2, 1-3, 1-4, 2-3, 2-5, 3-6, 4-6, 5-6. `<` returns to the previous sector, which makes pair trading quick.
- Run a pair down until the margins shrink, around 20% stock. Then come back after regen.
- Players rate a pair by **trading index** = holds / TPW x 10 (Merchant Freighter 325, ISS 375, Colonial Transport 417).

### 4.6 Robbing and stealing (evil only) [EMP]
- Requires alignment of **-100 or lower**. At a port, `R` opens `(R)ob this port, (S)teal product or (Q)uit`.
- **Steal**: take product from what is "On Dock". By default you can only steal from a buy port if "Steal from Buy Port" is on.
  - Safe amount = `EXP / (30 x StealFactor)` holds. Classic StealFactor is 100%, giving EXP/30. MBBS is 70%, giving EXP/21.
  - Success message: "...and you receive ...".
- **Rob**: take port credits.
  - Safe amount = `3 x EXP / RobFactor`. Classic gives 3 x EXP, MBBS (50%) gives 6 x EXP.
  - The port really holds displayed credits / 0.9 (the "+11%").
  - Asking for more than it holds costs a turn but does not bust.
- **Bust odds** are about **1 in 50** at or under the safe amount. They rise sharply for each hold or 1000 cr over the limit. Taking less than the limit does not improve the odds.
- **Bust** ("Suddenly you're Busted!", "For getting caught..."):
  - You lose **10% XP**.
  - Steal bust: you lose holds equal to about 9% of the holds you tried to steal.
  - Rob bust: you lose about 1 hold per 1,000 credits attempted (the source says "1%", but its own example means per 1,000).
  - Holds never fall below 1.
- A port remembers only its **last** buster. Busts clear every N days (default 7; 1 in MBBS).
- **Fake bust**: robbing or stealing at the same port twice in a row always busts, costing 20% of holds and 10% XP.
- **MegaRob** (MBBS bug, optional): a port holding 3.3M or more can be robbed for everything regardless of XP.
- Ferrengi/alien NPCs also trade port pairs and can rob.

---

## 5. Movement and navigation

### 5.1 Turn costs [DOC/EMP]

| Action | Turns |
|---|---|
| Warp one sector | ship **TPW** |
| Dock at a port (`P`) | 1 |
| Rob or steal attempt | 1 |
| Holo scan | 1 |
| Density scan | 0 |
| Computer, CIM, course plot | 0 |
| TransWarp jump | = TPW, plus fuel ore |
| Planet transporter | 1 (10 ore per sector, from the planet) |
| Tow | your TPW + extra by ship size (cabal: tower move + 2 x towed move) |
| Ether probe | 0 to 1 (sources differ) |

TPW by hull (v2 beta stats; v3 is similar):

| Hull | TPW |
|---|---|
| Scout, Merchant Freighter, T'Khasi Orion, Ferrengi Assault Trader | 2 |
| Merchant Cruiser, Missile Frigate, Corporate Flagship, Havoc Gunstar, StarMaster, Constellation, Ferrengi Battle Cruiser | 3 |
| BattleShip, Cargo Tran, ISS, Taurean Mule, Tholian Sentinel, Ferrengi Dreadnought | 4 |
| Colonial Transport, Escape Pod | 6 |
| Interdictor Cruiser | 15 |

### 5.2 Move, plot and autopilot [DOC]
- Typing a sector number at `Command` moves you. An adjacent sector warps you there at once.
- A non-adjacent sector plots a course:

```
The shortest path (7 hops, 21 turns) from sector 123 to sector 456 is:
123 > 1470 > 1170 > 1081 > 197 > 430 > 1093 > 456
Engage the Autopilot? (Y/N/Single step/Express) [Y]
```

- Failure: `*** Error - No route within 45 warps from sector 10 to sector 11`, followed by `Clear Avoids?`.
- Paths are **BFS shortest hops**, respecting avoids. Unexplored sectors still route, because the ship's nav unit knows the whole graph. That is what "zero-turn mapping" exploits.
- Autopilot modes:
  - **Alert** (default) stops in sectors with a port, planet, NavHaz or trader.
  - **Express** runs non-stop unless enemy forces appear.
  - **Single step** asks `Stop in this sector (Y,N,E,I,R,S,D,P,?) (?=Help) [N] ?` in each sector. The keys are Yes, No, Express, Info, port Report, Scan, Display, Port & trade.
  - If you retreat from enemies, the route is re-plotted to avoid that sector.
- NavPoints (`N`/`Y`): Terra, StarDock (if the sysop allows) and 4 user slots.

### 5.3 Sector display (`D`, and shown on arrival) [DOC/RE: TWX re-renders the game's own format]

```
Sector  : 1995 in uncharted space.
Beacon  : FedSpace, FedLaw Enforced
Ports   : Cabal's Hideout, Class 3 (SBB)
           (Under Construction - 4 days left)
Planets : (M) Terra
Traders : Kal Durak, w/ 1,200 ftrs,
           in Bloodlust (Corporate FlagShip)
Ships   : Hulk [Owned by] Someone, w/ 30 ftrs,
           (Merchant Cruiser)
Fighters: 1,000 (belong to your Corp) [Defensive]
NavHaz  : 25% (Space Debris/Asteroids)
Mines   : 10 (Type 1 Armid) (yours)
        : 1 (Type 2 Limpet) (yours)
Warps to Sector(s) :  952 - (2465) - 3301
```

- Labels are padded to 8 characters plus `: `. Empty lines are omitted.
- Class 0 and 9 ports show `(Special)`. Port lines can carry `<=-DANGER-=>` (port destroyed or radiation).
- With ANSI on, warps you have not visited show in red. [RECON] Plain text uses parentheses for them.
- Shielded planets show as `<<<< (M) Name >>>> (Shielded)`.
- The prompt is `Command [TL=hh:mm:ss]:[sector] (?=Help)? :`, where TL is time left.

### 5.4 Scanners [DOC/EMP]
**Density scanner** (`S`, then D): 0 turns. It lists every adjacent sector:

```
                          Relative Density Scan
-----------------------------------------------------------------------------
Sector  ( 952)  ==>            100  Warps : 3    NavHaz :     0%    Anom : No
Sector  (2465)  ==>            545  Warps : 2    NavHaz :     0%    Anom : Yes
```

Density weights add up:

| Item | Density |
|---|---|
| Empty sector | 0 |
| Beacon | 1 |
| Limpet mine (sets Anom) | 2 |
| Fighter (each) | 5 |
| Armid mine (each) | 10 |
| NavHaz (per 1%) | 21 |
| Unmanned ship | 38 |
| Manned ship | 40 |
| Destroyed port | 50 |
| Starport / Ferrengi Battle Cruiser / Ferrengi Dreadnought | 100 |
| Nelson / Zyrain / Clausewitz | 462 / 489 / 512 |
| Planet | 500 |

A cloaked ship adds 0 density but sets Anom.

**Holo scanner** (`S`, then H): costs 1 turn. It prints a full sector display (as in 5.3, without the warps-in data) for every adjacent sector. Hardware cost varies by version: density 500 to 2,000 cr, holo 6,250 to 25,000 cr (TEDIT defaults differ between versions).

### 5.5 Ether probes [DOC/EMP]
- `E` launches a probe to a target sector. It follows the **shortest path**, printing `Probe entering sector : N` and a sector display at each hop. Self-destruct at the destination prints `Probe Self Destructs`.
- The probe is destroyed by **any enemy fighters**, and the fighter owner learns who launched it. It has no shields.
- A ship carries at most 25. Cost was 3,000 to 12,000 cr depending on version.

### 5.6 Onboard computer (`C`) [DOC]

| Key | Function |
|---|---|
| F | Course Plotter: hops and turns between any two sectors |
| I | Inter-Sector Warps: the warps of any explored sector |
| K | Your Known Universe: % explored, lists of explored and unexplored sectors |
| R | Port Report: last-seen report for any explored port sector. Gives "no information" if enemy fighters jam it |
| V | Avoid Sectors |
| X | List Current Avoids |
| U | T-Warp Preference |
| A | Announcement (155 chars, goes in the daily log) |
| B | Self-destruct |
| N | Personal settings |
| Y | Your personal planets |
| Q | Exit |

- There is no single-avoid removal: you clear all avoids and re-enter them. If no route exists, all avoids are cleared.
- `^` enters **CIM** (Computer Interrogation Mode), whose prompt is `: `. It dumps raw sector, warp and port tables for helper programs.

---

## 6. Turns, time and Extern

- **Turns per day**: sysop-set. Values seen: 250 (twarp's default), 750 in Gypsy's game, and 65,520 (effectively unlimited) on a live test server. The `TL=` in the prompt is online time left, not turns. Turns reset at the day boundary. "Turn accumulation days" defaults to 1, so unused turns don't carry over. Self-destruct means no turns the next day.
- **New player** (sysop-set; values seen): 20 holds, 30 fighters, 300 to 1000 credits, Merchant Cruiser, start in sector 1.
- **Game time**: the game shows real clock time with a future year (e.g. "Wed Feb 03, 2038") and an "Age of game in days" counter. [RECON] Show `realDate + yearOffset` and treat each server day as one game day ("stardate").
- **Midnight**: dead players can re-enter. Class 0/9 hold, fighter and shield prices change.
- **Extern** (daily maintenance), in rough order:
  1. Clear NavHaz from FedSpace.
  2. Repossess empty ships in FedSpace.
  3. Tow players breaking FedSpace armament or crowding rules.
  4. Clear player fighters and mines from the MSLs.
  5. Resolve planet collisions.
  6. Rebuild destroyed Class 0/9 ports once radiation is gone.
  7. Advance port construction.
  8. Port regen.
  9. Clear busts on schedule.
  10. Apply the mixed-corp XP penalty.
  11. Check cloak failure (3% default).
  12. Charge FedSpace taxes.
- **Taxes** apply to good players carrying more than 100k cr (sometimes 50k): 5 to 10% on re-entry, once per Extern. Bank deposits are exempt; the bank max is 500k by default.

---

## 7. Implementation checklist (recommended defaults for the door)

| Parameter | Value |
|---|---|
| Sectors | 1000 |
| FedSpace | 1-10 plus SD |
| Ports | 40% x 95% ≈ 380 |
| Planets max | 200 |
| Two-way / one-way warps | 30% / 3% |
| Max warps per sector | 6 |
| Max course length | 45 |
| Specials | Sol #1; SD, Rylos, AC in random 6-warp sectors outside 1-10 |
| Port regen | 5%/day, max 100% per visit |
| Max port production | 65,530 |
| Upgrade cost | 250/500/900 cr per 10 units |
| Steal / rob factors | 100% (classic) |
| Bust clear | 7 days |
| Planet trade | 60% |
| Price model | §3.1 |
| Haggle | §4.2 tolerance plus §4.3 staged counters |
| Turns/day | 250 to 1000 (sysop) |

## Sources
- TradeWars Documentation Wiki, BigBang options: https://docs.classictw.com/index.php/Big_Bang (also Busted, Paired_Port_Trading, Exploring_the_Universe, Moving_to_a_Sector, CIM_Mode, Glossary)
- Traitor (tw-cabal), "TWGS Settings Explained", "Formulas", "Economy of Tradewars" Parts 1-2, and Cherokee's "Advanced Haggling Lessons": https://web.archive.org/web/2012/http://www.tw-cabal.com/formulas.html, …/strategy/economy2.html, …/strategy/hagglelessons.html, …/strategy/twgs_settings.html
- Official TW2002 v3 docs (Martin/Pritchett, EIS): https://pastebin.com/Rqgpp6VS and https://bearstrong.net/tekst97/data/spill/twinstr/
- TWX Proxy source (Pascal 2.x `Menu.pas`/`Process.pas`; C# 3.0 `NativeHaggleEngine.cs`, `MERCH_PORT_PRICE_FORMULAS.md`, `docs/haggle-modes.md`): https://github.com/TW2002/twxp, https://github.com/irtnog/twxproxy
- Live TWGS TEDIT capture (mcp-bbs `tedit-kv.jsonl`): https://github.com/livingstaccato/mcp-bbs
- Door World "Hints Galore" (v2 ship stats, MSLs, port radiation): https://breakintochat.com/collections/magazines/door-world/hint200/ART8.TXT
- TWUTIL 1.0 docs (v1.03 BIGBANG placement of SD and Class 0 ports): https://discmaster.textfiles.com/file/254/BBS%20Toolkit.iso/doors_2/twutil10.zip/TWUTIL.DOC
- Clme, "Trade Wars 2002 Bible" (density table, port pairs, probes): http://www.penismightier.com/clme/Trade_Wars/Trade_Wars_2002_Bible.htm
- twarp dev log (modern reimplementation; secondary): https://drss.io/reader/npub1ayw90t49ws2jh2w35zz6w9380dd8f0evnhqahrc4v67a2nwwgrhskxaj30/ports-and-trading, …/turns-and-maintenance, …/the-roadmap
- Break Into Chat wiki: https://breakintochat.com/wiki/TradeWars_2002
- BlackNova Traders (different, simpler model: `price = base ± delta x stock/limit`, regen = rate x ticks; not used above): https://github.com/photogabble/blacknova
