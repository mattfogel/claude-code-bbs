# TW2002 Replication Research: UI, Command Set, Onboarding, Licensing, Clones, Async

Research area 4 of 4. Scope: player-facing interface (menus, prompts, screen layouts, colors), onboarding, IP/licensing, existing clones, and async/request-budget adaptations.

## Confidence legend

Each prompt string is tagged with how sure we are of it:

- **[V]** Verified verbatim from a primary or near-primary source: the official v2.00 instructions (TWINSTR.TXT), TWX Proxy's screen parser (`Process.pas`), TWX test fixtures that replay real game lines, or the string literals that TWX/MomBot scripts match against.
- **[R]** Reconstructed from memory of v3/TWGS captures and community material. The structure is reliable, but small details (spacing, punctuation, exact wording) should be checked against a live TWGS capture if exactness matters.

Because we are renaming anyway (see section 3), small wording drift in [R] strings doesn't matter. The [V] strings show the structural conventions to copy: label column width, bracketed defaults, and `?` prompts.

### Primary sources used

- TWINSTR.TXT, the official TW2002 v2.00 player instructions (Martech Software, 1990–93). Mirror: https://bearstrong.net/tekst97/data/spill/twinstr/
- TWX Proxy 2.7 screen parser `Source/TWX27/Process.pas` and test fixtures `Source/TWX30/Tests/Core.Tests/Program.cs`: https://github.com/TW2002/twxp (GPL-3.0)
- MomBot / TWX script prompt matching: https://github.com/TW2002/mombot (GPL-3.0). Specific files: `haggle_inc.ts`, `trade.ts`, `furb.ts`, `phx_QuickDraw.ts`, `avoids.ts`.
- mcp-bbs TW2002 bot prompt catalogue (captures against TWGS v2.20b): https://github.com/livingstaccato/mcp-bbs, files `games/tw2002/prompts.json`, `rules.json`, `docs/TEDIT_REFERENCE.md`, `docs/TWGS_LOGIN_FLOW.md`
- Break Into Chat wiki: https://breakintochat.com/wiki/Trade_Wars and https://breakintochat.com/wiki/TradeWars_2002
- Wikipedia: https://en.wikipedia.org/wiki/Trade_Wars
- Trademark record: https://trademarkregistration.app/Trademark/Details/76548683

---

## 1. Command set and screens

### 1.1 The main prompt

```
Command [TL=00:00:00]:[3554] (?=Help)? :
```

This is **[V]**, from the TWX fixture `"Command [TL=00:00:00]:[3554] (?=Help)? : "`, which ends with a trailing space.

- `TL=` is the per-session **Time Left** in hh:mm:ss. It shows `00:00:00` when the sysop hasn't set a limit.
- `[3554]` is the current sector.
- Single-keystroke input; Enter isn't needed.
- The Computer submenu uses the same shape: `Computer command [TL=00:00:00]:[3554] (?=Help)? ` **[V]** (prefix `Computer command [TL=` is in the TWX parser).

**For our port:** drop `TL=` or reuse the slot for turns (`[T=187]`), since a time limit doesn't apply in async play.

Colors **[R]**, approximate from v3 ANSI:

| Element | Color | Pipe code |
|---|---|---|
| `Command` | magenta | `|05` |
| Brackets and colons | bright magenta | `|13` |
| `TL=` | green | `|02` |
| Time and sector number | bright yellow | `|14` |
| `?` | bright yellow | `|14` |
| `=Help` | magenta | `|05` |

### 1.2 Main menu: every key

The table below gives the official v2.00 key map **[V]**, taken from the `<X>  Name.` entries in TWINSTR.TXT and grouped as the documentation groups them. v3 additions are marked [R].

| Key | Command | Group |
|---|---|---|
| D | Re-display Sector | Navigation |
| P | Port and Trade | Navigation |
| M | Move to a Sector | Navigation |
| L | Land on a Planet | Navigation |
| S | Long Range Scan | Navigation |
| R | Release Beacon (max 41 characters) | Navigation |
| W | Tow SpaceCraft (tractor beam toggle) | Navigation |
| N | Move to NavPoint *(v3 [R]; MomBot matches `Choose NavPoint (?=Help) [Q] :`)* | Navigation |
| C | Onboard Computer | Computer & Info |
| X | Transporter Pad | Computer & Info |
| I | Ship Information | Computer & Info |
| T | Corporate Menu | Computer & Info |
| U | Use Genesis Torpedo | Computer & Info |
| J | Jettison Cargo | Computer & Info |
| B | Interdict Control (Interdictor Cruiser only) | Computer & Info |
| A | Attack Enemy SpaceCraft | Tactical |
| E | Use Subspace Ether Probe | Tactical |
| F | Take or Leave Fighters | Tactical |
| G | Show Deployed Fighters | Tactical |
| H | Handle Space Mines (Armid/Limpet, Personal/Corporate) | Tactical |
| K | Show Deployed Mines | Tactical |
| O | Starport Construction / Upgrade Starport | Tactical |
| Q | Quit and Exit | Misc |
| ! | Main Menu Help | Misc |
| Z | Trade Wars Docs (full document) | Misc |
| V | View Game Status (version, sizes, StarDock location, stats) | Misc |
| `/` | Quick Stats one-screen summary *(v3 [V]; field names below)* | v3 |
| `#` | Who's playing *(v3 [R])* | v3 |
| `'` | Sub-space radio: broadcast on comm channel *(v3 [R]; TWX parses `comm-link:` and `on channel `)* | v3 |
| `` ` `` | Federation comm-link *(v3 [R])* | v3 |
| `=` | Hail: private message to one player *(v3 [R])* | v3 |
| `Y` | Set NavPoints *(v3 [R]; uncertain)* | v3 |

Conventions **[V]** from TWINSTR:

- "When you are asked to make a selection, anything displayed in brackets [], will be the default."
- "Most displays can be aborted by hitting the space bar."
- "Useful menus are available anytime a ? appears in the prompt. Specific help files are available wherever an ! appears."

Quick Stats (`/`) field tokens **[V]** come from TWX `ProcessQuickStats`. In the original they are separated by CP437 `│` (0xB3, rendered `³` in TWX source):

```
 Sect 1│Turns 250│Creds 300│Figs 30│Shlds 0│Hlds 20│Ore 0│Org 0│Equ 0
 Col 0│Phot 0│Armd 0│Lmpt 0│GTorp 0│TWarp No│Clks 0│Beacns 0│AtmDt 0│Crbo 0
 EPrb 0│MDis 0│PsPrb No│PlScn No│LRS None│Aln 0│Exp 0│Corp 0│Ship 1 MerCru
```

`LRS` takes the values `None`, `Dens` or `Holo`. `TWarp` takes `No` or a drive type number. This is a compact HUD that fits in 80 columns, and it's an ideal model for our status line.

### 1.3 Sector display (`D`, and auto-shown on arrival)

All labels are padded to 8 characters plus `: `, so values start at column 11 **[V]**: the TWX parser does `Copy(Line,1,10) = 'Ports   : '`. Continuation lines start with 10 spaces. The exact label strings **[V]** are:

- `Sector  : `
- `Beacon  : `
- `Ports   : `
- `Planets : `
- `Traders : `
- `Ships   : `
- `Fighters: `
- `NavHaz  : `
- `Mines   : `
- `Warps to Sector(s) :`

```
Sector  : 1 in The Federation.
Beacon  : FedSpace, FedLaw Enforced
Ports   : Sol, Class 0 (Special)
Planets : (M) Terra
Traders : Captain Vex, w/ 30 ftrs,
          in Starfire (Merchant Cruiser)
Fighters: 3,000 (belong to The Feds) [Defensive]
Warps to Sector(s) :  2 - 3 - 4 - 5 - 6 - 7

Command [TL=00:00:00]:[1] (?=Help)? :
```

A typical non-Fed sector. The line shapes are [V] per the parser; the specific names and values are illustrative:

```
Sector  : 3554 in uncharted space.
Ports   : Hamal Alpha, Class 5 (SBS)
Ships   : Old Rustbucket [Owned by] Kira, w/ 50 ftrs,
          (Scout Marauder)
Fighters: 120 (yours) [Toll]
NavHaz  : 5% (Space Debris/Asteroids)
Mines   : 10 (Type 1 Armid) (yours)
        : 4 (Type 2 Limpet) (belong to your Corp)
Warps to Sector(s) :  412 - (1877) - 3009
```

Details:

- **Fighter lines** end in `[Toll]`, `[Defensive]` or nothing, which means Offensive **[V]**.
- **Port class letters** are three characters in the order Fuel Ore, Organics, Equipment. `B` means the port buys and `S` means it sells.
- **Class numbers** follow this table **[V]** (TWX `ProcessPortLine`):

  | Class | Letters |
  |---|---|
  | 1 | BBS |
  | 2 | BSB |
  | 3 | SBB |
  | 4 | SSB |
  | 5 | SBS |
  | 6 | BSS |
  | 7 | SSS |
  | 8 | BBB |
  | 0 | Special (holds, fighters, shields) |
  | 9 | StarDock |

- **Destroyed ports** show `Ports   : Scanners indicate massive debris and heavy ...` **[V]** from a fixture. Ports may also carry `<=-DANGER-=>` **[V]**, and under construction a continuation line shows days left.
- **Unexplored warps** appear in parentheses, e.g. `(1877)`; the TWX parser strips `(` and `)` **[V]**. They are drawn in red: "With a color display, the sectors you have not yet visited will show up in red" **[V]** (TWINSTR).
- **Constellation names** use `in uncharted space.` **[V]** and `in The Federation.` **[V]**.
- **StarDock** is a Class 9 port named `Stargate Alpha I` **[V]**, located in FedSpace with beacon `FedSpace, FedLaw Enforced` **[V]**. The `V` screen reveals its sector **[V]**.

Colors **[R]**:

| Element | Color | Pipe code |
|---|---|---|
| Labels | bright green | `|10` |
| `:` | yellow | `|14` or `|06` |
| Sector number | bright cyan | `|11` |
| `in` | green | `|02` |
| Constellation | bright blue | `|09` |
| Port name | bright cyan | `|11` |
| Class letters | B in bright green, S in bright cyan (uncertain) | |
| Visited warps | bright cyan with green ` - ` separators | |
| Unvisited warps | red | `|04` / `|12` |
| Your own forces (`yours`) | bright cyan | |
| Enemy forces | bright red | |

The style rule underneath: green labels, cyan data, yellow numbers and punctuation, red for danger or unknown.

### 1.4 Movement and autopilot

The move flow **[R]**:

1. `M` gives `<Move>`, then `Warps to Sector(s) :  2 - 3 - 4`, then `To which sector [1] ?`
2. An adjacent target produces `Warping to Sector 3`. If not adjacent, the course is plotted (step 3).
3. `The shortest path (5 hops, 15 turns) from sector 1 to sector 123 is:` **[V]** (prefix `The shortest path (`), followed by a path line such as `1 > 3 > 45 > (67) > 123`.
4. `Engage the Autopilot? (Y/N/Single step/Express) [Y]` **[V]** for the `Engage the Autopilot?` part.
5. At each interesting sector: `Stop in this sector (Y,N,E,I,R,S,D,P,?) (?=Help) [N] ?` **[V]** for the `Stop in this sector` part. The keys are **[V]** from the v2 Autopilot menu:

| Key | Meaning |
|---|---|
| Y | Yes, stop here |
| N | No, continue |
| E | Express non-stop |
| I | Ship info |
| R | Port report |
| S | Long-range scan |
| D | Re-display |
| P | Port & trade |
| ! | Help |

Autopilot modes **[V]**: Alert (the default, which stops at ports, planets, hazards and traders), Express, and Single Step. If you retreat from enemy forces, the course is re-plotted to avoid that sector **[V]**.

Turn messages **[R]** read like `One turn deducted, 249 turns left.`

### 1.5 Port trading: exact flow

**Step 1, choose an action.** `P` opens the port menu **[R]**; the prompt itself is **[V]**:

```
<T> Trade at this Port
<R> Rob this Port        (evil alignment; "Suddenly you're Busted!" [V] on failure)
<S> Steal Product        (evil)
<A> Attack this Port
<Q> Quit, nevermind
Enter your choice [T] ?
```

**Step 2, the commerce report.** After `T` (lines marked [V] are verified strings; the rest is [R]):

```
Docking...                                                        [V]

One turn deducted, 249 turns left.

Commerce report for Hamal Alpha: 06:45:12 PM Sat Oct 02, 2027     [V prefix]

-=-=-        Docking Log        -=-=-
No current ship docking log on file.

 Items     Status  Trading % of max OnBoard
 -----     ------  ------- -------- -------
Fuel Ore   Selling    2140    100%       0
Organics   Buying     1620     98%       0
Equipment  Selling    1180    100%       0

You have 300 credits and 20 empty cargo holds.                    [V "empty cargo holds."]
```

**Step 3, sell.** The port goes through the commodities it **buys** that you carry. Selling comes first, which frees holds:

```
We are buying up to 1620.  You have 20 in your holds.             [V "We are buying up to"]
How many holds of Organics do you want to sell [20]?              [V "How many holds of", "do you want to sell ["]
Agreed, 20 units.                                                 [V "Agreed,"]

We'll buy them for 412 credits.
Your offer [412] ?                                                [V "Your offer"]
```

**Step 4, buy.** Then the commodities it **sells**:

```
We are selling up to 2140.  You have 0 in your holds.
How many holds of Fuel Ore do you want to buy [20]?               [V]
Agreed, 20 units.

We'll sell them for 296 credits.
Your offer [296] ?
```

**Step 5, haggle.** Enter accepts the default **[V]**: mcp-bbs notes that "TW2002 expects Enter at 'Your offer [193]?'". Typing a different number starts a haggle. Responses **[R]**:

- `We'll sell them for 290 credits.` (counter)
- `Our final offer is 293 credits.`
- `We're not interested.` **[V]**, which ends the trade
- Good haggles award experience: `For your good trading you are awarded 2 experience point(s).`

Other port lines:

- `You only have N credits ...` **[V prefix]**
- The no-trade case: `You don't have anything they want, and they don't have anything you can buy.` **[V]** (fragment in MomBot)

Class 0 ports (Sol, Alpha Centauri, Rylos) sell holds, fighters and shields with per-item pricing **[V]** (TWINSTR plus the Synchronet TW2 port strings). Synchronet's TW2 equivalent prompt is `How many holds do you want to buy [0]-`.

### 1.6 Computer menu (`C`)

The key map below is **[V]**, from the v2 docs.

| Key | Function |
|---|---|
| F | Course Plotter |
| I | Inter-Sector Warps |
| K | Your Known Universe (% explored; list explored/unexplored) |
| R | Port Report; prompt `What sector is the port in? [1]` **[V]** |
| U | T-Warp Preference |
| V | Avoid Sectors |
| X | List Current Avoids (header `<List Avoided Sectors>` **[V]**) |
| A | Make Announcement (160 characters, goes to the Daily Log) |
| B | Begin Self-destruct |
| N | Toggle ANSI / Personal settings |
| O | Change Ship Settings (password) |
| P | Fire Photon Missile |
| M | Re-read Mail |
| S | Send Mail |
| T | Current Ship Time ("the game began in the year 2002") |
| W | Use Mine Disrupter |
| C | Ship Catalog |
| D | Scan Daily Log |
| E | Evil Trader Classes |
| G | Good Trader Classes |
| H | Alien Trader Ranks |
| J | Planetary Specs |
| L | List Trader Rank |
| Y | Personal Planets |
| Z | Active Ship Scan (`<Active Ship Scan>` **[V]**) |
| ! | Help |
| Q | Exit Computer |

The avoid-list limitation **[V]**: "if you want to remove one or more avoided sectors from the list, you must clear the entire list". Our port should simply fix this.

**CIM (Computer Interrogation Mode):** from the Computer prompt, `^` enters a bare `: ` prompt **[V]** (TWX: a line starting `': '` begins a CIM download). Sub-commands:

- `I` dumps the warp list for all known sectors: `sector warp warp ...`
- `R` dumps the port list for all known ports, with quantities and percentages. Port lines end in `%` **[V]**.
- `Q` exits.

Ending sentinel: `: ENDINTERROG` **[V]**.

CIM is a machine-readable dump, and it is the natural model for our JSON "known universe" endpoint.

### 1.7 Planet, Citadel, Corporation and StarDock menus

**Planet menu** keys **[V]**:

| Key | Function |
|---|---|
| A | Take All Products (loads Equipment first) |
| C | Enter Citadel / build it |
| D | Display Planet |
| M | Change Military Levels |
| O | Claim Ownership |
| P | Change Population Levels |
| S | Load/Unload Colonists |
| T | Take or Leave Product |
| Z | Try to Destroy Planet |
| Q | Leave |
| ! | Help |

Landing text **[V]**: `<Preparing ship to land on planet surface>`, then `<Atmospheric maneuvering system engaged>`. Terra shows `<Land on Terra>` (colonists are bought there). Prompt **[R]**: `Planet command (?=help) [D] `.

**Citadel menu** keys **[V]**:

| Key | Function |
|---|---|
| B | Transporter Control |
| C | Ship's Computer |
| D | Display Traders Here |
| E | Exchange Ships |
| G | Shield Generator (level 5; 10 ship shields = 1 planetary shield) |
| I | Personal Info |
| L | Quasar Cannon reaction level (atmospheric/sector %) |
| M | Military Reaction Level |
| N | Interdictor (level 6) |
| P | Planetary TransWarp (level 4) |
| R | Remain Here Overnight |
| S | Scan Sector |
| T | Treasury Fund Transfers |
| U | Upgrade Citadel |
| V | Evict Other Traders |
| X | Corporation Menu |
| ! | Help |
| Q | Leave |

Citadel strings: `Citadel treasury contains N credits.` **[V]**; prompt `Citadel command (?=help)` **[V prefix]**.

**Corporation menu (`T`)** keys **[V]**, by who can use them:

| Who | Keys |
|---|---|
| Anyone | D Display/Rank, J Join, M Make New, ! Help, Q Quit |
| Members only | C Credit transfer, F Fighter transfer, H Mines transfer, S Shields transfer, X Leave, L List corp planets, A Assets and member locations |
| CEO only | T Corporate Memo, P Corporate Security (password), R Drop Member |

**StarDock top-level** keys **[V]**. The prompt is `<StarDock> Where to? (?=Help)` **[V]**.

| Key | Location |
|---|---|
| C | CinePlex Videon Theatres |
| H | Stellar Hardware Emporium |
| P | Federal Space Police HQ |
| S | Federation Shipyards |
| T | Lost Trader's Tavern |
| (unlisted) | 2nd National Galactic Bank, `<Galactic Bank>` **[V]** |
| ! | Help |
| Q | Return to ship and leave |

Sub-menus **[V]**:

- **Hardware Emporium:** A Atomic Detonators, B Marker Beacons, C Corbomite, D Cloaking Device, E Ether Probes, F Planet Scanners, M Space Mines, P Photon Missiles, R Long Range Scanners, S Mine Disrupters, T Genesis Torpedoes, W TransWarp Drives, Y Psychic Probes, ! Help, Q Leave. Prompt: `Which item do you wish to buy? (?=Help)`.
- **Shipyards:** B Buy New Ship, S Sell Extra Ships (`<Sell an old Ship>`, `Choose which ship to sell (Q=Quit)` **[V]**), E Examine Specs, R Change Registration.
- **Tavern:** A Announcement, B Bar, C Eavesdrop, E Food, G Tri-Cron gambling, T Grimy Trader, U Facilities (graffiti wall).
- **Police:** A Federal Commission, C Claim Reward, E Ten Most Wanted, P Post Reward.
- **Bank:** D Deposit, E Examine, T Transfer, W Withdraw.

### 1.8 Ship Info (`I`)

Fields **[V]**, from the TWINSTR list:

- Trader Name
- Rank and Exp (experience, alignment, title)
- Times Blown Up
- Ship Name
- Ship Info (maker/model, Ported=, Kills=)
- Date Built
- Current Sector
- Turns to Warp
- Turns Left
- Total Holds (with a cargo breakdown)
- Special equipment
- Credits

Layout **[R]** uses colon-aligned labels:

```
Trader Name    : Lieutenant Vex
Rank and Exp   : 1,240 points, Alignment=150 Tolerant
Times Blown Up : 0
Corp           : 3, Night Freight Co.
Ship Name      : Starfire
Ship Info      : Merchant Cruiser  Ported=14 Kills=0
Date Built     : 06:00:00 PM Sat Oct 02, 2027
Turns to Warp  : 3
Current Sector : 3554
Turns left     : 187
Total Holds    : 20 - Fuel Ore=0 Organics=20 Empty=0
Fighters       : 30
Shield points  : 0
LongRange Scan : Density Scanner
Credits        : 2,412
```

### 1.9 Fighter deployment (`F`) **[R]**

```
You have 30 fighters available.
How many fighters do you want defending this sector? 10
Should these be (C)orporate fighters or (P)ersonal fighters? P
Should they be (D)efensive, (O)ffensive or Charge a (T)oll ? D
```

`G` shows `Deployed  Fighter  Scan` **[V]**, with columns for sector, quantity, Personal/Corp, mode and tolls. If you have none, it shows `No fighters deployed` **[V]**.

---

## 2. Onboarding

### 2.1 Entry and new character

TWGS v2.20b flow **[V where quoted]**, from mcp-bbs `TWGS_LOGIN_FLOW.md`, `prompts.json` and `LLM_HINTS.md`:

1. TWGS lobby: `Selection (? for menu):` **[V]**. The server banner reads `Trade Wars 2002 Game Server v…  Copyright (C) 1998 / www.tradewars.com  Epic Interactive Strategy` **[V]**.
2. Game menu, `Enter your choice:`, has T Play, I Intro/Docs, S Show Today's Log, X Exit **[R]**.
3. Large ANSI title (animated in ANSI mode), then `Show today's log? (Y/N)` **[V]** and `[Pause]` screens.
4. `Would you like to start a new character in this game? (Type Y or N)` **[V regex]**.
5. `Password?` asked twice, to protect the character.
6. `Use (N)ew Name or (B)BS Name [B] ?` **[V]**.
7. `What do you want to name your ship? (30 letters)` **[V prefix]**, then `Is what you want? (Y/N)` **[V regex]**.
8. If the sysop has personal planets on: `What do you want to name your home planet?` **[V]**.
9. Some TWGS builds add `Gender (M/F):` and a starting choice `Your choice (1-3) [1]:` **[V regex]**, then `Press ENTER to begin your adventure` **[V]**.
10. You arrive in **Sector 1** (FedSpace) at the main prompt.

**Starting kit.** The defaults below are **[V]** from the TEDIT defaults; the ship and Terra details are **[V]** from TWINSTR.

| Item | Default |
|---|---|
| Ship | Merchant Cruiser ("the most versatile ship") |
| Credits | 300 |
| Holds | 20 (empty) |
| Fighters | 30 |
| Turns | 250 per day |
| Location | Sector 1: Sol (Class 0) and Terra (colonists) |
| Nearby | StarDock somewhere in FedSpace, usually sectors 1–10 |
| Protection | Inside FedSpace until experienced (Fed protection is tied to experience and alignment) |

The game also has a death screen, `... start over from scratch` **[V]**, and a self-destruct option that costs the next day's turns.

**Intro text and title.** The v2 docs open with "TRADE WARS 2002 … A quality on-line game brought to you by Martech Software", followed by a brief premise: you are a trader competing to be the most powerful trader or corporation, good or evil, with "no right or wrong way to play". The in-game intro and title are big multi-color ANSI block letters for "TRADE WARS 2002" over a starfield or planet, with an animated logo in ANSI mode. **We must make original art and original story text.** Neither the name nor the art can be reused.

### 2.2 A typical first session

1. Read the daily log. Use `V` to learn the StarDock sector.
2. `D` to look at Sector 1. Use `CR` / `C` then `F` to start mapping.
3. Explore a few warps from Sol. Find a **port pair** (two adjacent ports with complementary B/S letters, ideally both Equipment and Organics) within 1–2 hops of each other.
4. Trade back and forth across the pair, haggling for small experience bonuses, until turns or port stock run low.
5. Spend profits on more holds at Sol (Class 0). This is the main early growth loop.
6. Later purchases: a Density or Holo scanner at StarDock, Ether Probes to scout, then a better trading ship, then a Genesis Torpedo to make a planet in a dead-end sector, colonists from Terra, and a Citadel.
7. Things to avoid early: Ferrengi (raiders who hold grudges), unknown fighter or mine sectors, and robbing ports until alignment and experience allow it.

**Our version:** a 5-step tutorial overlay that walks through the same loop (scan, port pair, trade, buy holds) is the highest-value onboarding.

---

## 3. Licensing and trademark

### 3.1 Ownership chain

| Year | Event |
|---|---|
| 1984 | Chris Sherrick creates Trade Wars (TRS-80, then IBM PC). He released it freely, which spawned variants. |
| 1986 | James Gunderson writes "TW2 for WWIV" (Turbo Pascal), distributed as source. |
| 1986 | Gary Martin releases TW2001. |
| 1991 | TW2002 v1.00 (Martech Software, Lawrence KS). |
| 1997 | John Pritchett writes v3 and the Gold expansion. |
| 1998 | Martin sells the license to John Pritchett. Pritchett's company EIS (Epic Interactive Strategy, eisonline.com) builds TWGS. |
| 2000 | Realm Interactive acquires TW rights from EIS for *Trade Wars: Dark Millennium*. That project became *Exarch*, then NCsoft's *Dungeon Runners* (2007). |

Sources: Break Into Chat; Wikipedia. More than 28,000 registrations have been sold (1990–2025). The latest TWGS is **v2.20b, released March 5, 2012**.

### 3.2 Trademark

**TRADE WARS** is a US trademark owned by John Pritchett (Shawnee, KS):

| Field | Value |
|---|---|
| Serial No. | 76548683 |
| Reg. No. | **2894858** |
| Filed | Sept 16, 2003 |
| Registered | Oct 19, 2004 |
| Class | 009, "Downloadable computer game software for hosting and playing an interactive game on the Internet" |
| Status | **Live, renewed. Status date Nov 1, 2024; next renewal Oct 19, 2034.** |

We found no evidence of separate registrations for "TradeWars 2002", "TW2002" or "StarDock" by EIS. But the registered mark plus decades of common-law use make **any "Trade Wars" / "TradeWars" / "TW2002" name a clear no.**

### 3.3 What is protectable

This is general information, not legal advice.

**Game mechanics, rules, systems and numbers are not copyrightable.** The basis is 17 U.S.C. §102(b) and the US Copyright Office's games circular FL-108. This covers sector graphs, port classes, B/S notation, haggling, turns, citadel levels and combat formulas. Courts protect **expression**: text, art, specific names, and distinctive look-and-feel.

- *Tetris Holding v. Xio Interactive* (D.N.J. 2012) found infringement where a clone copied the visual expression wholesale.
- *Spry Fox v. 6waves* (2012) is a similar case.
- *Data East v. Epyx* (9th Cir. 1988) protects scènes à faire and generic elements.

The clone community follows this line. **OpenTW**'s README says it "does not use the name Trade Wars anywhere in the software out of respect for the EIS trademarks and IP" while aiming for prompt compatibility. BNT describes itself as "inspired by the popular BBS game of TradeWars."

Short functional prompts like "How many holds of X do you want to sell [N]?" have minimal originality and are low-risk. Even so, we should **write our own wording in a similar terse style** rather than copy text in bulk. Help text, story, rank titles, ship descriptions and ANSI art must be entirely original.

### 3.4 Rename list

**Must rename.** These are trademark, distinctive TW coinage, or third-party IP:

| TW term | Why | Suggested direction |
|---|---|---|
| Trade Wars / TradeWars 2002 / TW2002 | Registered TM | New title, e.g. "Warp Lanes", "Void Merchants", "Longhaul '26" |
| Ferrengi | Star Trek "Ferengi" (Paramount) | Original raider faction ("the Skav", "Corsairs") |
| Tholian Sentinel, Corbomite, Imperial StarShip | Star Trek terms | New ship and device names |
| TransWarp, Genesis Torpedo, Class M planets | Star Trek terms | "Jump drive", "Seed torpedo", planet types with our own letters |
| StarDock; "Stargate Alpha I" | Stardock Corp (software TM); Stargate (MGM TM); TW-distinctive | "Drydock", "Hub Station" |
| Federation, FedSpace, FedLaw, The Feds | Trek flavor; distinctive in context | "Concord Space", "Patrol" |
| Sol, Alpha Centauri, Rylos (Class 0 names) | Rylos is TW coinage. Sol and Alpha Centauri are generic, but keep them only if the set doesn't mirror TW. | Original names |
| Lost Trader's Tavern, Stellar Hardware Emporium, 2nd National Galactic Bank, CinePlex Videon, Grimy Trader, Tri-Cron, Underground | Distinctive TW expression | Original venues |
| Quasar Cannon, Armid mine, Ether Probe, Psychic Probe, Scout Marauder, Havoc Gunstar, Missile Frigate (names) | TW coinages | Rename; keep the mechanics |
| Rank titles ("Dread Pirate" ladder), ship blurbs, all help, story and log text | Copyrightable expression | Write new |

**Generally safe generic terms:** sector, warp, port, trade, holds, fighters, shields, mines, limpet, beacon, planet, citadel, colonists, corporation, CEO, Terra, turns, autopilot, course plotter, long-range or density scanner, interdictor, photon, cloak, tow. The port class 0–9 system, B/S notation, single-key menus and the `[default]` convention are also fine.

**Attribution:** a small "Inspired by BBS-era space trading games" credit is fine. Avoid "TradeWars" in the title, marketing or command names. Nominative mention in docs ("a homage to Trade Wars 2002 by Gary Martin & John Pritchett") is low-risk if it isn't prominent, but omitting it entirely is safest.

---

## 4. Existing clones and reimplementations

| Project | Lang / License | Status | Notes |
|---|---|---|---|
| **BlackNova Traders** (sourceforge.net/projects/blacknova) | PHP/MySQL; AGPL (later), originally GPL | Classic, mostly dormant; mirror at github.com/photogabble/blacknova | Web, browser-turn based. **Turn regen:** `turns_per_tick=6` every `sched_turns=2` minutes, `max_turns=2500`, `start_turns=1200` (`classic_config.ini.php`). Scheduler jobs for ports, planets, IGB interest, rankings, news and fighter degrade. **Saved trade routes**, up to 40 per player, executed in one action. Xenobe NPCs. |
| **bnt2** (github.com/harwoodr/bnt2) | PHP 8.4 / FlightPHP; AGPL-3.0 | WIP (2025–26), "not complete" | BNT's original author rebuilding it API-first with a planned terminal client. |
| **The Kabal Invasion** (github.com/thekabal/tki) | PHP; AGPL | Last push 2023 | BNT fork, modernised. |
| **Alien Assault Traders**, **Xenobe Rage** (brandonlamb/xenoberage) | PHP | Dormant | BNT forks. |
| **twclone** (github.com/rdearman/twclone) | C server, Godot + Python clients; repo GPL-2 with author's parts MIT | Active (2026) | Most complete open clone. Headless server, **JSON protocol**, PostgreSQL, separate engine process for clocks, economy and NPCs; deterministic "Big Bang" universe generator. |
| **OpenTW** (github.com/opentw-server/opentw) | C# .NET; no license file | New beta (Sept 2026), test server games.opentw.org:2002 | Goal is "100% prompt and server output compatibility" so TWX/MomBot scripts run. Deliberately avoids the TW name. |
| **Synchronet "TradeWars v.ii"** (`SynchronetBBS/sbbs` `xtrn/tw2`) | JavaScript; GPL (Synchronet) | Shipped with Synchronet | Port of the old TW2 (pre-2002) door. Includes `bang.js` universe generator and `.ans` screens. Useful reference for a JS door structure. |
| jasonhendriks/tradewars | Java/Redis/HTMX; AGPL-3.0 | Small, 2025 | Web homage. |
| markab21/tradewars-c, sethnielson/tw2002clone (BSD-2), bluecough/tradewars (TS), Reshui/Trade-Wars-2002 (Py), leonard4/SectorWars (C++) | Various | Toy or early | |
| **TWX Proxy / MomBot / TWFM** (github.com/TW2002) | Pascal or C#; GPL-3 or MIT | Active community tooling | Helpers, not clones, but the best prompt-text corpus. |
| **TWGS** (EIS) | Proprietary, Windows | v2.20b (2012); community servers still run, and twgs-docker exists | The canonical product. |
| *Trade Wars: Dark Millennium* | Commercial (Realm Interactive, 2000s) | Cancelled; became Exarch, then Dungeon Runners | A graphical MMO pivot that shows how far the brand drifted. |

How the async and web clones adapted the game:

- **BNT** replaced "N turns per day, reset at maintenance" with continuous **regen ticks** and a high cap. Players could log in anytime without losing value.
- BNT added **trade routes** (one click runs a buy-move-sell loop) and **realspace vs warp** movement costs.
- BNT moved NPC and economy simulation into cron scheduler scripts that "auto-adjust, possibly running many of the same events in a single call". In other words, catch-up batch processing.
- twclone and bnt2 both moved to **JSON APIs with thin clients**, which matches our architecture.

---

## 5. Async adaptations for our environment

Our environment: 10–30 s latency, every action is an HTTP write, and roughly 100k requests per day shared across the whole BBS. Proposed rules:

1. **Pure-function rendering from a cached snapshot.** Read-only screens cost zero writes. These include `D`, `I`, `/`, `G`/`K` deployed lists, the computer (`F` plotter, `I` warps, `K` known universe, `R` port report from memory), and the help screens. Every write response returns an updated snapshot delta: current sector view, ship, known-universe additions and messages. CIM is the precedent; the "known universe" is just client-side data.

2. **One write per intent, not per keystroke.** Collapse TW's multi-prompt dialogs into a single command payload. The UI still walks the player through the familiar prompts locally, then submits once.
   - **Move:** `move {path:[a,b,c], mode:"alert"|"express"}`. The server walks the path and halts at the first interrupt: port or planet in Alert mode, fighters, mines, toll, NavHaz or another trader. It returns the stop point and an event log; the client replays it as the classic "Auto Warping to Sector…" scroll. This turns 1 write per hop into 1 write per trip.
   - **Trade:** `trade {port, sells:{ore:20}, buys:{equ:30}, offers:{...}}`. All three commodities go in one call.
   - **Haggling** has hidden server state, so offer two designs:
     - (a) **One-shot haggle.** The player enters an offer as a number or `%`; the server resolves accept, counter or final-offer, and the client either accepts the counter or not in a second write. That's at most 2 writes.
     - (b) **Haggle policy.** E.g. "try 6% better, accept the final". The server simulates the whole negotiation in one write.
   - **Deploy:** `deploy {figs:10, owner:"P", mode:"D"}` is one write.

3. **Server-side autopilot and macros.** TW players historically used TWX scripts for this, and BNT built trade routes into the game. Offer **trade routes**: a saved port pair plus a repeat count, run server-side ("run 15 loops on route 1"). The response is a summary log. This is the biggest budget saver, and it also neutralises the advantage that script users had.

4. **Turns: lazy regen rather than cron.** Store `turns, turns_at` and compute `min(cap, turns + floor((now - turns_at) / interval) * rate)` on every request. Recommended model: a daily-equivalent pool, e.g. **10 turns/hour with a cap of 250**, so idle players aren't punished and grinders can't exceed TW's pacing. Apply the same lazy catch-up to port stock regen, planet production, citadel interest and fighter degrade; this is the BNT scheduler's "auto-adjust" idea without a scheduler. Use a daily "extern" maintenance only for log rollover and rankings, run lazily by the first request after midnight.

5. **Combat and interaction stay server-authoritative and asynchronous.** TW's offline model already works this way: deployed fighters, mines, citadel defenses and Quasar-style cannons defend while you're away, so encounters resolve at the mover's request time. Live player-vs-player (`A` on a trader in-sector) resolves in one write using the defender's stored stance. Sub-space radio, hails and Fed comm map to the BBS message feed, polled with existing reads.

6. **Budget sketch.** With 30 active players at ~60 writes per session, that's ~1,800 writes per day. With route macros a heavy session is ~25 writes. Polling should use the existing `hub.json`-style read cadence, not per-game polling. Rate-limit trades and moves per player per minute, e.g. 6, as a safety valve.

7. **UI implications for 80 columns and 16 colors.**
   - Keep the 10-column label gutter and the green/cyan/yellow/red palette.
   - Show a persistent one-line Quick Stats bar (`Sect│Turns│Creds│Figs│Shlds│Hlds│Ore│Org│Equ`).
   - Show `(pending…)` on the prompt line while a write is in flight. Never make a keystroke a write.
   - Express movement displays the returned hop log at once rather than animating 30 s of latency.

8. **Determinism.** Seed RNG per action (the game seed plus the action ID) so that server resolution is reproducible and auditable. This also lets clients predict outcomes (e.g. warp cost) before writing.

---

## Open questions for the design team

1. Do we want literal TW prompt shapes (OpenTW-style familiarity), or paraphrase everything? The recommendation is to paraphrase while keeping the structure.
2. Haggling: one-shot, or policy-based?
3. Turn model: daily reset (authentic) or hourly regen with a cap (recommended)?
4. Should trade-route macros be available from day 1 or unlocked, e.g. by buying a "route computer"?
