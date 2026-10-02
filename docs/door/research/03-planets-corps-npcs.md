# TW2002 research 03: planets, citadels, corporations, NPCs and the long arc

Scope: mechanics to copy faithfully. Version notes: **v1.03** (Martech DOS, ~1993), **v2** (Martech/HVS v2.0x beta, 1995), **MBBS** (Major BBS port), **TWGS / v3** (John Pritchett's rewrite, "3.x"/TWGS 1.x–2.x, the version still played today). Where versions differ I say which. Confidence tags: **[confirmed]** means two or more independent sources agree, or a live TEDIT dump. **[single]** means one credible source. **[reconstructed]** means my inference, so treat it as a design choice.

Key sources (all fetched):
- S1 Paladyne, *The Planet Handbook* v1.01 (TWGS 3.11.55, 2002): http://www.swath.net/?page=planethandbook%2Ftoc (chapters 2–9)
- S2 TW2002 v2 Beta citadel/planet tables (Door World "Hints Galore"): https://breakintochat.com/collections/magazines/door-world/hint200/ART8.TXT. The same tables appear in `20PLANET.TXT` and Slice-10 at https://www.thestardock.com/files/manuals/TWLinksManuals/
- S3 Mike Magero, planet chapter with death rates (v2): https://breakintochat.com/collections/magazines/door-world/1995-10-volume-1.8/ART16.TXT
- S4 Official in-game docs (TWINSTR; v3 version with radio/hail): https://bearstrong.net/tekst97/data/spill/twinstr/ and https://www.gamebanshee.com/bbs/guides/tradewars2002.php
- S5 **Live TWGS TEDIT dump** (default values of a fresh TWGS game, captured 2026-02): https://raw.githubusercontent.com/livingstaccato/mcp-bbs/e5d2b263bb15a5b2fdf8be9d1d71825fa44bb6bc/tedit-kv.jsonl and `tedit-log.md` in the same repo
- S6 Iago's War Manual (v1.03/v2): https://www.thestardock.com/files/manuals/Iago%27s%20War%20Manual.txt
- S7 Someguy "How to play TW and stay alive" (MBBS, 1997): …/TWLinksManuals/Someguy/someguy.txt
- S8 Slice-10 (v2 beta; includes TEDIT record layouts): …/TWLinksManuals/Slice-10/Slice-10.txt
- S9 TW Bible / Gypsy's Big Dummy's Guide / TW2002.FAQ / JP hints (John Pritchett quotes): https://www.thestardock.com/files/manuals/ and …/TWLinksManuals/TWFAQ/, …/Misc%20Info/JPhints.txt
- S10 "TradeWars 2002 Player Tips, Tricks, and Cheats" (Ferrengal): https://www.thestardock.com/files/manuals/TWLinksManuals/TradeWars%202002%20Player%20Tips,%20Tricks,%20and%20Cheats.htm
- S11 TWX Proxy source, which shows the exact message-banner text: https://github.com/irtnog/twxproxy/blob/master/Source/Process.pas
- S12 TW 200 / QuixPlus (Sherrick lineage) C port, which contains the **Cabal** code: https://github.com/markab21/tradewars-c (tw4/tw4.c)
- S13 breakintochat wiki: https://breakintochat.com/wiki/TradeWars_2002
- S14 thestardock "ModernManual" (2026, apparently AI-compiled from older docs; use only where it agrees with others): https://www.thestardock.com/files/ModernManual/

---

## 1. Units: colonists come in groups

- One cargo hold carries **one colonist unit = 1,000 people**. Planet displays label the column "Colonists (1000s)". Citadel and production figures below are in these units. [confirmed: S6 "One hold is one thousand people… 3,000,000 colonists required = 3000 holds"; S5 Ferrengal shows 598 "thousands" in ore producing 199/day = 598/3.]
- Colonists come only from **Terra** (planet #1, sector 1, class M, owned by "Federation"). TWGS defaults: Terra max **100,000** units, regeneration **1.5%/day = 1,500 units/day** (TEDIT "Terran colonist reproduction 1500/day") [S5]. Older or MBBS defaults were 750/day [S14]. Someguy recommends sysops set 20,000/day [S7]. Landing on Terra asks how many groups to load into empty holds. Colonists are free.
- Jettisoning colonists costs alignment: −1 per unit for good players (repeatable); for evil players it works only once a day [S7].

## 2. Creating planets (Genesis Torpedo)

- Bought at the StarDock Hardware Emporium. **TWGS default cost 20,000 cr** [S5]; edited games often charge more (S14 shows 80,000). Ship capacity varies by hull ("gen" column, e.g. Merchant Cruiser 5, ISS 10).
- Command `U` (Use Genesis Torpedo). The type is rolled and shown **before** you name the planet [S4].
- The roll: each class has a fixed base probability (the classes sum to 100%), ordered from least to most desirable. The roll is "modified by the number of planets in the sector above the allowed limit", so crowded sectors produce **class U** very often (S14 claims about 98% at the limit) [single: John Pritchett in S9 JPhints]. The exact weights are not published. Reconstruct with something like M 30%, L 15%, O 15%, K 15%, H 10%, C 7%, U 8% for an empty sector, shifting toward U as the count rises [reconstructed].
- **Max planets per sector**: TWGS default 5 (TEDIT range observed up to 6+) [S5].
- **Overloading and collisions** (v1/v2): if a sector holds more planets than the limit (in v1.03 you had to transwarp a planet in; in v2 any GTorp works except in sector 1), nightly maintenance prints "An Unstable Planetary Mass was detected in sector X" or "<A> collided with planet <B>", and planets are destroyed at random [S2 hint #2, TW Bible]. A 1/3 chance of destroying Terra this way was reported [S2 #1].
- Alignment for building a planet: **good +10 (paying cr 2,000 per point), evil −10** [S7, S9 Gypsy].
- New-player planets: a sysop option (`W`/"New-player planets") gives each new trader a free planet in a random sector, sometimes stocked with a little product or fighters [S4, S5].

## 3. Planet classes: production, capacity, death rates

The rules below hold for v2 and TWGS with Gold extensions off [confirmed: S1, S2, S3, S5].
- **Production per day per product = colonists in that line / ratio**, where "ratio" is the number of colonist units needed per product unit.
- **Each product line has its own colonist cap.** Production peaks at **50% of the cap**. Below 50% the population grows; above 50% it declines "at a proportional rate"; at 100% of the cap, production is 0 [S1, S2].
- **Fighters per day = (sum of the day's ore + org + equ produced) / F**, where F is the class's fighter factor. Worked example on class M: 1,500 units in ore give 500 ore and 50 fighters. Adding 700 units in organics gives +100 org, for 60 fighters in total [S1]. Ferrengal check: (199+111+144)/10 = 45 [S5]. You cannot assign colonists to fighters directly.

| Class | Ore ratio | Org ratio | Equ ratio | F (fig) | Max col/line | Peak at | Max/day O/Og/E | Storage O/Og/E | Max figs/day |
|---|---|---|---|---|---|---|---|---|---|
| M Earth | 3 | 7 | 13 | 10 | 30,000 | 15,000 | 5,000 / 2,142 / 1,153 | 100k / 100k / 100k | 829 |
| K Desert | 2 | 100 | 500 | 15 | 40,000 | 20,000 | 10,000 / 200 / 40 | 200k / 50k / 10k | 682 |
| O Oceanic | 20 | 2 | 100 | 15 | 200,000 | 100,000 | 5,000 / 50,000 / 1,000 | 100k / 1,000k / 50k | 3,733 |
| L Mountain | 2 | 5 | 20 | 12 | 40,000 | 20,000 | 10,000 / 4,000 / 1,000 | 200k / 200k / 100k* | 1,250 |
| C Glacial | 50 | 100 | 500 | 25 | 100,000 | 50,000 | 1,000 / 500 / 100 | 20k / 50k / 10k | 64 |
| H Volcanic | 1 | n/a** | 500 | 50 | 100,000 | 50,000 | 50,000 / 0 / 100 | 1,000k / 10k / 100k | 1,002 |
| U Gaseous | n/a | n/a | n/a | n/a | 3,000 | n/a | 0 | 10k / 10k / 10k (S1 says equ 100k) | 0 |

\* S1 gives L equipment storage as 200,000; S2 and S3 give 100,000. \*\* On Volcanic planets, colonists placed in organics "die immediately" [S2]. Planet fighter storage is 1,000,000 in v2/TWGS (it was 32,000 in v1.03 [S6]). TWGS class M max planetary shields = 50,000 [S5].

**Growth curve [reconstructed]:** no source publishes the exact curve. A model that matches the published endpoints: for a line with cap `C` and population `p`, effective workers `w = p` if `p ≤ C/2`, else `w = C − p`, and production is `floor(w / ratio)`. For daily growth, if `p < C/2` then `p += p·g` (g ≈ 1–2%, tunable per class); if `p > C/2` then `p −= p·d·(p − C/2)/(C/2)`. S1 adds that "weather" fluctuation exists.

**Landing/listing death rates (v2, Magero)** [single, S3]. Each time a ship lands or takes a planet listing, there is a chance of losing a share of the population:

| M | L | O | K | C | H | U |
|---|---|---|---|---|---|---|
| nil | 3% chance of −2% | 2% chance of −2% | 2% chance of −2% | 5% chance of −8% | 7% chance of −10% | 8% chance of −12% |

TWGS Gold planet records carry "hazard level" (M=1) and "habitability rating" (M=100) fields, which suggests these became per-class parameters [S5].

Flavour text (from the in-game Planetary Specs, abridged) [S1]. M: excellent all-round, "overpopulation problems, political unrest". K: hot and arid, great ore. O: no land mass, top organics. L: excellent ore and organics, poor equipment. C: violent, used as Federation prison colonies. H: no soil, best ore, "complete loss of a colony" risk, used by the Feds for key-sector defence. U: "no production can sustain itself", with rumours of valuable products.

## 4. Planet interaction (Planet menu, v3 keys) [S4]

`A` Take All Products (loads the most valuable first: Equ, then Org, then Ore). `C` Enter Citadel, or build one: it lists the requirements and refuses the "building permit" if they are short. `D` Display Planet. `M` Change Military Levels (take or leave fighters; **leaving fighters marks the planet as yours**). `O` Claim Ownership (Personal or Corporate). `P` Change Population Levels (move workers between lines). `S` Load/Unload Colonists. `T` Take or Leave Product. `Z` Try to Destroy Planet. `Q` Leave.

Display layout: columns Item / Colonists (1000s) / Colonists 2 Build 1 / Daily Product / Planet Amount / Ship Amount / Planet Maximum, with rows Fuel Ore, Organics, Equipment and Fighters. The fighter row's "2 build 1" figure is an efficiency number, e.g. 30 for 1,500 units in ore on M [S1].

**Planet Scanner** (ship option) shows planet details before landing, including the Q-cannon atmospheric setting, and lets you abort the landing [S4, S1].

**Planetary trade:** when a port shares the sector with your planet, porting offers a "Planetary Trade Agreement" that sells the planet's excess stock without hauling. The sysop setting "Planetary trade offers" defaults to 100% (MBBS-style) or "60% Normal" (TWGS) of normal prices. Players called it a poor deal [S4, S5, Door World 1995-11 review].

## 5. Citadels

Construction consumes the listed colonists and products when it starts and then takes N real days, ticked by nightly maintenance. v1.03 lore says you could remove everything after starting [S6, single]. Levels are strictly sequential, and Gold extensions can change costs but not the order [S1].

Requirements: colonists are in 1000s; products are in units [confirmed S1, S2, S3, S5].

| Class | Lvl | Col | Ore | Org | Equ | Days |
|---|---|---|---|---|---|---|
| **M** | 1/2/3/4/5/6 | 1000/2000/4000/6000/6000/6000 | 300/200/500/1000/300/1000 | 200/50/250/1200/400/1200 | 250/250/500/1000/1000/2000 | 4/4/5/10/5/15 = **43** |
| **K** | 1–6 | 1000/2400/4400/7000/8000/7000 | 400/300/600/700/300†/700 | 300/80/400/900/400/900 | 600/400/650/800/1000/1600 | 6/5/8/5/4/8 = **36** |
| **O** | 1–6 | 1400/2400/4400/7000/8000/7000 | 500/200/600/700/300/700 | 200/50/400/900/400/900 | 400/300/650/800/1000/1600 | 6/5/8/5/4/8 = **36** |
| **L** | 1–6 | 400/1400/3600/5600/7000/5600 | 150/200/600/1000/300/1000 | 100/50/250/1200/400/1200 | 150/250/700/1000/1000/2000 | 2/5/5/8/5/12 = **37** |
| **C** | 1–6 | 1000/2400/4400/6600/9000/6600 | 400/300/600/700/300/700 | 300/80/400/900/400/900 | 600/400/650/700/1000/1400 | 5/5/7/5/4/8 = **34** |
| **H** | 1–6 | 800/1600/4400/7000/10000/7000 | 500/300/1200/2000/3000/2000 | 300/100/400/2000/1200/2000 | 600/400/1500/2500/2000/5000 | 4/5/8/12/5/18 = **52** |
| **U** | 1–6 | 3000/3000/8000/6000/8000/6000 | 1200/300/500/500/200/500 | 400/100/500/200/200/200 | 2500/400/2000/600/600/1200 | 8/4/5/5/4/8 = **34** |

† S1 (TWGS) lists K level 5 ore as 800; S2 and S3 (v2) give 300. The TEDIT dump confirms the M row exactly [S5].

What each level adds (TEDIT names: Unarmed, Armed, Quasar, TransWarp, Shields, Interdict) [S1, S4, S5]:

1. **Treasury.** Lets you deposit credits and Remain Overnight (no protection yet). Interest is **2%/day** on all classes in v2/TWGS (S5 field "citadel interest rate 2.0%", accrued "a small percentage every second" per S1). It was **4%/day in v1.03** [S2, S8]. Treasury cap: 999,999,999,999,999 in TWGS; in v2 betas it overflowed near 2^31 [Door World]. **Anyone who gets into the citadel can withdraw everything.** The Stardock bank caps at 500,000 [S1, S5].
2. **Combat Control Computer and Military Reaction %.** That percentage of planet fighters attacks a lander at **2:1** odds. The remainder defend at **3:1** and must all be destroyed before landing. FAQ wisdom says set 0% [S9 FAQ]. Offensive planet fighters send 1.25× the fighters needed against the target's maximum fighters plus shields [S14, single].
3. **Quasar Cannon** (`L` sets Sector % and Atmospheric %). Each shot uses the set percentage of the ore **currently** on the planet, per shot [S4]:
   - **Sector shot** (on sector entry, after mines; multiple planets fire in planet-number order): ore used = Ore × S%; **damage = ore used / 3**. Example: 10,000 ore at 10% uses 1,000 ore for 333 damage [S1].
   - **Atmospheric shot** (on a landing attempt; fires again after shields fall):
     - **MBBS mode**: ore used = Ore × A%; **damage = 2 × ore used**. Example: 9,000 at 10% uses 900 for 1,800 damage.
     - **TWGS/Classic mode**: **damage = Ore × A%; ore used = half of that**. Example: 9,000 at 10% does 900 damage using 450 ore [S1].
   - Damage removes shields, then fighters, then destroys the ship. S14 reports caps of 3,333 per sector shot and 10,000 per atmospheric shot; this is unverified. Photons "dampen" the cannon [S1].
4. **Planetary TransWarp ("thrusters").** Moves the planet to any sector holding one of your or your corp's fighters, at **400 ore per sector jumped**; no blind warp [confirmed S1, S6, S10]. This makes "mobile planets" and planet-trading possible.
5. **Planetary Shielding System.** `G` moves ship shields in at **10 ship shields = 1 planetary shield**. An invader fights shields at **20:1** against himself. **200 or more planetary shields** stop photons from disabling the planet's Q-cannon and protect citadel occupants from photon turn-loss. Shielded planets cannot be scanned and look different on holoscan [S1, S4]. Older FAQs disagree on the occupant protection [S8]. Hint: v2 beta says photons still cost you your turns.
6. **Interdictor Generator** (`N` on/off). An enemy ship cannot leave the sector. Each escape attempt costs the planet **500 ore** and gives the Q-cannon another sector shot. Below 500 ore, the interdiction fails [S1].

**Planetary Transporter** (installable on any citadel level ≥1): **50,000 cr** to install plus **25,000 cr per extra hop** of range, paid from the ship. It beams you and your ship to a sector within range that holds your fighter, for **1 turn plus 10 planet ore per sector** [confirmed S1, S2, S5]. Other citadel commands: `B` transporter, `D` traders here, `E` exchange ships (only ships flagged tradeable; ship passwords block this), `R` remain overnight (the valet asks whether others may swap ships with you), `S` scan, `T` treasury, `U` upgrade, `V` **evict** other traders (they are put into orbit), `X` corp menu [S4].

**Major Space Lane rule:** planets with a level 3+ citadel inside an MSL are knocked down to level 2 at extern [S9 FAQ].

## 6. Attacking, capturing and destroying planets

Order of events entering a defended sector, then landing (TWGS) [S1, S14]:
1. Navhaz damage roll.
2. A limpet attaches.
3. Armid mines detonate (each about 50% per S14).
4. Q-cannon **sector** shots, by planet number.
5. Sector fighters: offensive fighters attack at 1:1, defensive fighters challenge, toll fighters ask 5 cr/fighter.
6. Q-cannon **atmospheric** shot.
7. Planetary shields at 20:1, then a second atmospheric shot.
8. Military-reaction fighters at 2:1, then defenders at 3:1.
9. Land, then `O` Claim Ownership.

A **photon** fired in (citadel <5 or <200 shields) skips mines, sector fighters, both Q-cannon shots and planet fighters for the wave duration. Only navhaz, limpets and planetary shields still apply [S1].

**Capture:** after landing, claim the planet as Personal or Corporate. Enter the citadel to take the treasury, evict occupants, or swap into their ships if they are unpassworded and tradeable [S4, S8]. A captured level-6 planet claimed as corporate can trap its own ex-corp owner if the Interdictor is on [S8].

**Destroy:** buy **Atomic Detonators** (TWGS default 15,000 cr [S5]) and use planet command `Z`. The planet's colonists may try to disarm them. Botched attempts explode, and if you are still on the planet you die with it. You may first kill colonists with fighters, at −1 alignment per 10 colonist units killed [S2, S4]. Detonators carried aboard do not go off by accident, despite the docs [S9 FAQ]. Rewards (v2, measured) [S2]:

| Citadel | none | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|---|
| Exp | 50 | 100 | 150 | 200 | 250 | 300 | 350 |

You also get about **+1 exp per 200 colonist units** on the planet (shown as 1,000→4, 2,000→10, 10,000→50, 20,000→100). Alignment is always **−1**. Players in the citadel go into escape pods in random sectors (no credits, no bounty), and the destroyer gets ±33.3% of each victim's alignment (opposite sign) plus 16.7% of their exp [S2].

## 7. Corporations

All from S4 (v2/v3 doc text) unless noted.
- **Make (`M`)**: files a charter at "Federation's Hall of Records". You become **C.E.O.**, and the CEO's alignment defines the corp ("As you go, so goes the Corporation").
- **Join (`J`)** requires the corp's **password** ("corporate security pass"). The classic docs require the same alignment sign as the CEO, and a member whose alignment flips is auto-ousted. TWGS-era play commonly uses mixed red/blue corps [S14], so it looks like a sysop or version toggle [uncertain].
- **Max traders per corp**: sysop setting, **default 5** (V screen "Traders on a Corp: 5") [confirmed S5, S9].
- Record (v2): name (41 chars), CEO, date, **password (8 chars)**, kills/medals [S8 TWCORP.DAT layout].
- Member functions: credit, fighter, mine and shield transfers (same sector only); `L` list corp planets (sector, name, population, production, inventories, fighters, citadel level, shields, treasury); `A` corp assets and member locations (sector, on-planet flag, fighters, shields, mines, credits); `X` leave. **If the CEO leaves, the corp dissolves and all corporate fighters become "rogue mercenaries"** (ownerless hostile fighters). Attacking rogue or evil fighters gives +1 alignment per 10 fighters *you lose* [S9 Slice].
- CEO-only: `T` **Corporate Memo** to all members, `P` change the password, `R` drop a member ("the member can take any corporate assets on his/her ship").
- Shared assets: fighters and mines deployed as **Corporate** treat members as friendly; corporate planets; anyone can access a citadel treasury; members can **transport into each other's ships** unless the ship has a password ("passwords protect you only from your own corp") [S7].
- **Corporate Flagship**: purchasable only by a CEO; one per corp [S7]. Price 163,500 in v2. Specs: 85 holds, 20,000 fighters, 1,500 shields, 3 TPW, odds 1.2, TransWarp [S2]. A CEO may quit and keep it, but cannot then join another corp [S9 FAQ].
- **Corp rankings**: `D`, then `L` (list with registration number, incorporation date, members, CEO flagged) or `R` (rank by corporate experience: rank, number, name, CEO, alignment, experience).

## 8. NPCs

### 8.1 How NPCs act (the simulation model)
- In v1/v2 there was no tick server. NPCs move **when any player passes a command prompt**, each with a sysop-set chance: "Ferrengi move chance 1 in 20", "Alien move chance 1 in 20" [S5, S8 TWCFIG fields `FerrMove`, `AlienMove`]. "Aliens, Federals and Ferrengi have the opportunity to move every time you pass the command prompt" [S6]. Nightly **extern** handles everything else: regeneration, production, towing.
- TWGS adds "Alien server offline mode: Active" (NPCs keep acting with nobody online) and a "Processing interval: 1 second" [S5, S14]. **Recommended implementation:** run NPC steps on (a) every player prompt with probability 1/20 per NPC, and (b) a daily or hourly maintenance tick [reconstructed].
- Movement restrictions [S6]:
  - Aliens and the three Feds will not enter a sector containing deployed fighters, so Feds can be "trapped" in dead ends by one fighter.
  - Ferrengi ignore sector fighters, but cannot enter a sector that has a planet *and* fighters.
  - Mines do hit Ferrengi and aliens.

### 8.2 Ferrengi (main NPC antagonist)
- Docs: "greedy, cowardly… steal from anyone… seldom face-to-face… travel in groups… spy on promising territory… raid the sector when it is least defended… if attacked, that group will hold a grudge" [S4].
- **Home:** planet **Ferrengal**, in a dead end, with nebula "The Ferrengi Empire". Starting state (v1/v2): about 600 colonist units per line, 10,000 ore, 5,000 fighters, 100,000 cr treasury, citadel L3 with Q-cannon (atmospheric 30%, sector 0%), MRL 40%, and heavy sector fighters plus mines in the home sector [S10, S6]. The TWGS dump shows Ferrengal as planet #2 at citadel L1 heading upward, with a 202,560 cr treasury and 45 fighters/day [S5]. TWGS race default: "starting citadel level 2".
- **Encounter:** a Ferrengi orders you to surrender.
  - **Surrender**: it takes your Equ/Org (or fuel plus some holds, or credits), and that "duty Ferrengi" leaves you alone for the rest of the day.
  - **Attack** puts **a grudge** on that ship. **Fleeing** caused a grudge in v2 lore, but was tested as no grudge in 1.03d [S6 Pittman test, S8].
  - Ferrengi size their attack to **your fighter count**: carrying ~0–1 fighters and full shields makes them nearly harmless (0–2 damage per hit) [S6].
- **Data (v1/v2 FERRENGI.DAT):** max **40** ships. Slots 1–20 are Assault Traders, 21–30 Battle Cruisers, 31–40 Dreadnoughts, so stronger hulls appear as the population grows. Each record has name, ship name, location, fighters, shields, corbomite, **destination**, **Grudge1–3** (trader record numbers) and **mission** [S6, S8]. Grudges survive Big Bang unless the file is deleted (the "pregrudged" bug).
- **Ferrengi ships** (capturable only, never bought; attacking them **captures**, it never destroys) [S2, S9]:

| Ship | Holds | Fighters | Shields | TPW | Fig/attack | Odds | Mines | Gtorp | Photon | TP range |
|---|---|---|---|---|---|---|---|---|---|---|
| Assault Trader | 50 | 3,000 | 200 | 2 | 1,000 | 1.0 | 10 | 0 | no | 0 |
| Battle Cruiser | 75 | 8,000 | 800 | 3 | 2,000 | 1.2 | 25 | 3 | no | 2 |
| Dreadnought | 100 | 15,000 | 1,000 | 4 | 5,000 | 1.4 | 50 | 6 | yes (1) | 5 |

Density: 40, 100 and 100 when Ferrengi-piloted [S9 FERRSPEC].
- **Regeneration:** TEDIT "Ferrengi regeneration % (of max)": the TWGS default is 20% of 600 = 120/day. The exact unit (ships' fighters versus home-sector fighters) is unclear [S5; uncertain]. **Neutralising** them: destroy Ferrengal's sector fighters *and replace them with your own* (about 3,000 suggested). Regeneration then stops, and only roaming ships remain. Taking the planet without holding the sector makes every Ferrengi attack you on sight while they keep regenerating [confirmed S6, S10]. TWGS has an "Invincible Ferrengal" toggle [S5].
- **TWGS Gold Ferrengi race defaults** [S5]: max 40 aliens; full strength at day 120; move chance 1 in 4 (Gold internal); travel in groups ≤3; protective; unforgiving; regenerate; aggressive; avoid FedSpace; rob/steal up to 80%; trade port pairs; maintain home sector with ≥10 outer sectors; "anomalous aliens" 1%. Ship tiers unlock by days: combat L2/L3/L4 at 30/50/70 days. Spawn profile ramps from start to full: fighters 30→~1,218 (max 2,430), shields 0→~606, holds 5→~66, exp 0→~714, alignment −15→~−1,907, credits ~500→~23k. Sample live Ferrengi: Assault Trader with 2,250 fighters and 200 shields; Dreadnought with 11,250 fighters and 1,000 shields. Rank titles: "Merchant Apprentice", "Merchant", "Executive Merchant".
- If Ferrengal is captured and stays put, Gold Ferrengi **spawn continuously and assault it** until they retake it [classictw forum: https://www.classictw.com/viewtopic.php?p=114651].
- **MBBS only:** the **Ferrengi Overlord** in the indestructible *Scorpion* appears around day 45. It transwarps into random sectors and **converts players' fighters and mines into Ferrengi ones** ("your fighters have been disrupted"), and photons fired at it rebound [S7]. Optional "late game" event [single].

### 8.3 Alien Traders
- "Visitors from another universe looking for better ports". They have exp and alignment, show in a computer **Alien list/ranks**, and cannot join corps. Killing them gives the same rewards as killing players: 10% of victim exp; goods gain 50% of an evil victim's alignment [S4, S7].
- v2 ALIENS.DAT: name, ship name, location, ship type, maker, shields, fighters, holds, corbomite, exp, alignment, credits [S8].
- TWGS Gold "Alien Traders" defaults: max 50, full strength by day 50, move 1 in 4, xenophobic, trade at ports and pairs, no robbing, retreat at <100 fighters. Ships are drawn from player hulls (e.g. Merchant Freighter with 300 fighters and 500 shields). Alignment-rank words seen: "Crass", "Rude", "Harsh", "Mean" [S5]. The V screen reports "50 Aliens (48% Good)" [S9 Gypsy]. A non-Gold game can use the older "internal" aliens or Ferrengi (shown in brown, where Gold ones are bright yellow) [S9 JP].

### 8.4 Federation
- Three indestructible Federals: **Captain Zyrain** (density 489), **Admiral Nelson** (462), **Fleet Admiral Clausewitz** (512). They fly Federation StarShips (*Intrepid*, *Valiant*, *Lexington*, whose sectors are TEDIT settings) [S7, S9, S5].
- **Zyrain** transwarps instantly to defend any **FedSpace-protected trader**: alignment ≥ +1, exp ≤ 999 (some versions <1000), in FedSpace (sectors 1–10 plus StarDock). He also handles anyone deploying fighters in FedSpace. All three **destroy evil pilots of an ISS** (the commission is revoked when you go evil). They cannot be attacked, though Zyrain cannot attack a cloaked ship [S6, S9].
- **Extern towing:** a ship parked in FedSpace with more than the "Limited Arms Agreement" fighter count (variously 50, 99 or 100 by version), or in excess of "Ships per FedSpace sector" (default 5), is **towed** to a random sector, usually on an MSL. Feds also strip sector fighters, armid and limpet mines from the **Major Space Lanes** (Sol↔StarDock↔Rylos↔Alpha Centauri↔Rylos) [S2 #11, S9 FAQ].

### 8.5 The Cabal (not a TW2002 NPC)
The **Cabal** belongs to the *pre-2002* Sherrick lineage (TW 200/500/1000). Yankee Trader replaced it with the "Xannor", and Gary Martin replaced it with the Ferrengi [S6 history]. In the TW 200 source [S12], the nightly maintenance moves Cabal fighter "groups":
- A home sector (hard-coded **85**) regenerates fighters up to a cap of about 2,000.
- Group 1 garrisons 1,000 fighters at home; group 2 holds the overflow.
- "Type II" groups of 100 wander toward random sectors.
- "Type III" groups of 50 path toward targets and attack players' fighters they meet.
- Group 9 **hunts the top-ranked player** if that player's value is ≥2,500.
- Combat is a coin-flip attrition loop, with a message to the victim.

In TW2002 the only "rogue" fighters are **rogue mercenaries**: fighters orphaned when a corp dissolves. Pick whichever antagonist fits; for faithfulness use Ferrengi, with an optional Cabal-style hunter-group algorithm as the offline aggression model.

## 9. Communications and social

- **Fed Comm-Link** (`` ` `` global key): broadcasts to all players; can be toggled off in Personal Settings. **Sub-space radio** (`'`): goes to everyone on your channel (default channel 0 in the help; setting 0 turns the radio off). **Hailing Frequencies** (`=Name, msg`): private; if the target is offline, the message goes to **Galactic M.A.I.L.** Lines are ≤155 chars; multi-line input ends on a blank line [S4 v3]. Banner text, as parsed by TWX [S11]:
  - "Incoming transmission from <Name> on Federation comm-link:"
  - "…from <Name> on channel <n>:"
  - "…from <Name>:" (hail)
  - "Continuing transmission from …"
  - "Deployed Fighters Report Sector <n>: …" (your fighters reporting hits)
  - "Shipboard Computers …"
- **Mail:** "Send Mail" (partial name match, ends on a blank line) and "Re-Read Your Mail" (messages since your last visit) [S4]. Tavern: announcements (cost 100 cr), "bathroom wall" graffiti, the Grimy Trader (sells the Underground password; will report where a named trader's current ship has docked) [S4, S9].
- **Daily Log ("Daily Journal")**: shown on entry and re-viewable via the computer's `D` "Scan Daily Log". Players add **Announcements** (155–160 chars). Log capped at **800 lines** (TEDIT default) [S4, S5]. Content [reconstructed from guides]: player announcements; ships destroyed or podded and by whom; planets destroyed or captured; planetary collisions ("Unstable Planetary Mass detected in sector X"); ports destroyed or built; new corps; Fed actions; Ferrengi raids. Guides warn that fighter hits "show in your daily log" [S9 Bible]. TWGS adds "entry log" and "game log" blackout options [S5]. There is no separate "Galactic News" in TW2002; that is LORD/BNT terminology.
- **V screen ("Game Configuration and Status")**, sample [S9 Gypsy]:
  - Settings: initial turns/fighters/credits/holds; inactive-delete days; max players/sectors/ports/planets; max planets per sector; traders per corp; ships per FedSpace sector; StarDock location (optional); photon wave duration; version; game age.
  - Live stats: ports open plus net worth; planets and % with citadels; traders (% good) and aliens (% good); total fighters and mines; corporations in business.

## 10. Rankings and titles

Rank thresholds are powers of two; the title depends on the alignment sign [S9 Gypsy, confirmed by TEDIT rank names]:

| Rank | Exp ≥ | Good | Evil |
|---|---|---|---|
| 1 | 2 | Private | Nuisance 3rd Class |
| 2 | 4 | Private 1st Class | Nuisance 2nd Class |
| 3 | 8 | Lance Corporal | Nuisance 1st Class |
| 4 | 16 | Corporal | Menace 3rd Class |
| 5 | 32 | Sergeant | Menace 2nd Class |
| 6 | 64 | Staff Sergeant | Menace 1st Class |
| 7 | 128 | Gunnery Sergeant | Smuggler 3rd Class |
| 8 | 256 | 1st Sergeant | Smuggler 2nd Class |
| 9 | 512 | Sergeant Major | Smuggler 1st Class |
| 10 | 1,024 | Warrant Officer | Smuggler Savant |
| 11 | 2,048 | Chief Warrant Officer | Robber |
| 12 | 4,096 | Ensign | Terrorist |
| 13 | 8,192 | Lieutenant J.G. | Pirate |
| 14 | 16,384 | Lieutenant | Infamous Pirate |
| 15 | 32,768 | Lieutenant Commander | Notorious Pirate |
| 16 | 65,536 | Commander | Dread Pirate |
| 17 | 131,072 | Captain | Galactic Scourge |
| 18 | 262,144 | Commodore | Enemy of the State |
| 19 | 524,288 | Rear Admiral | Enemy of the People |
| 20 | 1,048,576 | Vice Admiral | Enemy of Humankind |
| 21 | 2,097,152 | Admiral | Heinous Overlord |
| 22 | 4,194,304 | Fleet Admiral | Prime Evil |

Rank-0 names (below 2 exp) are believed to be "Civilian" (good) and "Annoyance" (evil) [uncertain]. Rankings and high scores can be shown as titles, values, or both, and are updated "on demand" (TWGS Report Manager) [S5].

Alignment milestones [S7, S9]:
- ≥ +500: may apply for a Commission, which sets alignment to +1,000; ≥ +1,000 auto-commissions; needed for the ISS.
- ≤ −100: may rob and steal.
- Ways to move alignment:
  - Taxes: 5% of credits over 100k on login, +1 per 1,500 cr.
  - Bounties: +1 per 1,000 cr.
  - Port upgrades: +1 per 5,000 cr (ore/org) or 6,000 cr (equ).
  - Underground hits: −1 per 250 cr.

## 11. The long arc: Big Bang, maintenance, deletion, endgame

**BIGBANG** (sysop utility) creates the universe [S14 settings list, S9]:
- Sector count (≤1,000 without Gold), max course length (default 45), max ports %, initial ports %, max planets %, two-way warps %, one-way warps %, max players (200), max ships (4 × players), Gold on/off, bubbles, MBBS compatibility, random seed.
- Fixed placements: Terra (sector 1), FedSpace 1–10, StarDock (class 9), Sol/Rylos/Alpha Centauri class-0 ports, Ferrengal in a dead end, starting aliens and Ferrengi.
- Internal aliens and Ferrengi can only be enabled during BIGBANG [S5].
- Known v2 bug: BIGBANG did not reset FERRENGI.DAT, ALIENS.DAT or the tavern files [S6].

**Extern / nightly maintenance** (the "day" boundary; v2 required the sysop to schedule it, TWGS runs it automatically) [assembled from S2, S6, S8, S9; ordering reconstructed]:
1. Reset turns (TWGS also has turn accumulation days).
2. Planet production and population growth or death.
3. Citadel construction countdown.
4. Treasury interest.
5. Terra regeneration.
6. Port regeneration (default 1–5%/day).
7. Ferrengi and alien regeneration.
8. Fed towing out of FedSpace; MSL clearing and citadel demotion.
9. Overloaded-sector planet collisions.
10. Cloak failure (default 3%).
11. Bust clearing (every 1–7 days).
12. Radiation decay of destroyed-port navhaz (1–14 days).
13. Fighter-lock decay.
14. **Inactive player deletion**, followed by a new Daily Log.

**Inactive deletion:** "Days until an inactive user is deleted", TWGS default **30** (V-screen examples show 7). Deleting a CEO dissolves the corp, and its fighters go rogue [S4, S5]. Ferrengi grudges may be "inherited" by whoever reuses a deleted trader's record [S2 #20, S6].

**Death rules (affect the arc)** [S7, S2 #12]:
- Pod or capture: −10% exp.
- A third death in a day, or dying in a pod or Scout: out for the day and −50% exp.
- Self-destruct: −50% exp plus 2 days out.
- "Death delay" can keep you out until the next midnight, or longer.

**Endgame and winning:** TW2002 has **no built-in victory condition**. The docs' framing is to be "the most powerful trader (or corporation of traders) in the universe", measured by experience rankings and corp rankings [S4]; TW 200 said "control the universe". In practice a game runs until the sysop re-BIGBANGs: weeks to months, typically 30–90+ days (V screen example: "running for 90 days"). Long arc in practice [S9, S14, S1]:
- Week 1 is a land-grab for colonists and Terra drain.
- Week 2 builds L2–L4 citadels and tunnel defences.
- Mid-game brings mobile L4+ planets, planet-trading, Ferrengal capture and fighter farming on O/L planets.
- Late game is invasions using photons, "moths" to drain Q-cannon ore, and Interdictor traps.
- Sysop endgame levers (TWGS): **Tournament mode**, "Days to allow entry" (closes signups after N days), "Lock-out mode", **"Max times blown up / Max Pod-Death count"** (eliminates traders after N deaths), "Closed game", and game "Age". A tournament therefore ends naturally as **last trader or corp standing**, or with the sysop declaring the top ranking [settings confirmed S5; end-rule interpretation reconstructed].

## 12. Sysop configuration reference (defaults)

From the live TWGS TEDIT dump [S5] unless marked; v2 equivalents from TWCFIG.DAT [S8].

| Setting | TWGS default | Notes |
|---|---|---|
| Turns per day | 65,520 (unlimited) in that test; classic 250–1,000 | v2 sample V screen: 750 |
| Initial fighters / credits / holds | 30 / 1,000 / 20 | v2 docs: 30 fighters; Gypsy V screen: 300 cr; S7 recommends 101 / 30,000 |
| Inactive delete days | 30 | |
| Max players / sectors / ports / planets | 200 / 1,000 / 400 / 200 | ports and planets as % of sectors at BIGBANG |
| Ferrengi regen % of max | 20% of 600 = 120 | unit unclear |
| Terran colonist reproduction | 1,500/day (max 100,000) | MBBS 750 |
| Daily log limit | 800 lines | |
| Max planets per sector | 5 | |
| Max traders per corp | 5 | |
| Underground password phrase | "BEWARE OF KAL DURAK" | |
| Tournament mode / days to allow entry / lock-out / max deaths | Off | |
| Ferrengi / alien move chance | 1 in 20 | per prompt pass |
| FedSpace ship limit | 5 | |
| Photon wave duration | 20 s (v2 sample 10 s) | |
| Max bank credits | 500,000 | |
| Cloak fail rate | 3% | |
| New-player planets | Yes | |
| Clear busts every | 7 days | |
| Port regen | 5%/day | |
| Planetary trade offers | 60% (Normal) | |
| Invincible Ferrengal | No | |
| Costs: transporter / upgrade | 50,000 / 25,000 | |
| Genesis torpedo / atomic detonator | 20,000 / 15,000 | |
| Photon / cloak / planet scanner | 40,000 / 25,000 / 30,000 | |
| Armid / limpet / ether probe / beacon | 1,000 / 10,000 / 3,000 / 100 | |
| Tavern announcement | 100 | |
| Radiation lifetime | 14 days | |
| Death delay | Yes, 1/day | |
| Combat penalty mode | Classic (alt. MBBS) | |
| Max port production | 65,530 | |
| Citadel interest | 2.0% (per planet class, Gold) | |

Also v2 config fields worth mirroring: `DeathDelay`, `PhoTime`, `CloakFail`, `NavClear`, `NewbiePlanet`, `FedLimit`, `DispStar`, `Aliases`, `LogLimit`, `ColsDay`, `FerrRegen`, `MaxPlanetSect`, `MaxTraderCorp`, `UGroundPWord`, `Intrepid/Valiant/Lexington` [S8].

## 13. Data model hints (from v2 record layouts) [S8]

- **Planet** (172 bytes): name, creator, date and time; **OrePop/OrgPop/EquPop**; Ore/Org/Equ stock; **MilReac, QAtmos, QSect**; PlanetType; Fighters; CitLevel; Location; Active; **CitComplete** (completion day); Owner (± for personal or corp); Shields; Credits; TransportPwr; Interdictor flag.
- **Ferrengi**: name, ship name, location, fighters, shields, corbomite, **destination, grudge1–3, mission**.
- **Corp**: name, CEO, date, password, kills/medals.

## 14. Open questions and uncertainties

1. The exact population growth and death curve and the overpopulation production curve (only endpoints are known).
2. Genesis class base probabilities.
3. Ferrengi regen units, and the per-encounter tribute formula (product, holds or credits taken).
4. Q-cannon damage caps (S14's 3,333 / 10,000 claim is unverified).
5. Whether corps require matching alignment (classic docs say yes; TWGS practice suggests a toggle).
6. The Limited Arms fighter limit in FedSpace (50, 99 or 100 by version).
7. K level-5 ore (300 vs 800) and L equipment storage (100k vs 200k).
8. Exact Daily Log line formats (no verbatim capture found).
9. Atomic detonator disarm probability.
