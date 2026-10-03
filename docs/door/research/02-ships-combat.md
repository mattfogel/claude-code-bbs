# TW2002 Research 02: Ships, StarDock, Equipment, Combat, Deployables, Rank/Alignment

Scope: mechanical reference for a faithful TradeWars 2002 replication. Confidence tags:
- **[P]** Primary: taken from shipped game files (in-game strings, docs, help screens, data files).
- **[C]** Community-measured: veteran guides and formula pages, generally consistent with each other.
- **[R]** Reconstructed or inferred by me. Treat as a design choice, not as canon.

Many values became sysop-configurable (TEDIT) in TWGS v3. Where the DOS v2 build and TWGS defaults differ, both are listed.

---

## 0. Key primary sources found

1. **Decoded in-game string table** from a TW2002 DOS distribution (`game/STRTABLE.D8A` in github.com/TradeWars2002crack/TW2002). Records are separated by bytes `02 01`. Each record is obfuscated with a constant per-record byte shift, which I brute-forced. This gives the verbatim Hardware Emporium sales pitches with prices, plus bank limits, Underground, Police, Tavern and combat messages. These are the **DOS v2-era defaults**.
2. **Default rank files**: `game/GOLD/DEFGOOD.RNK` and `DEFEVIL.RNK` (same repo).
3. **TWINSTR.DOC, TWGOLD.DOC, REVISION.TXT (TWGS changelog), ANSI/SHIP1..16.TXT ship blurbs** from a TWGS install: github.com/heywoodlh/tradewars-docker, path `wine/drive_c/Program Files/EIS/TWGS/Game/`.
4. **In-game "Ship Catalog" screens** transcribed verbatim in *Gypsy's Big Dummy's Guide to TradeWars Text*: https://wiki.classictw.com/index.php/Gypsy's_Big_Dummy's_Guide_to_TradeWars_Text
5. **TW Cabal "Formulas"** (Chris Kent "Traitor", 2002–05, tested on TWGS ".55"): https://www.thestardock.com/files/Site%20Caps/TWCabal/formulas.html, plus `pods.html` and `tips.html`.
6. Fred Wehner, *How To Play TradeWars And Stay Alive* (1997): https://www.electricscotland.com/games/twadvice.txt
7. *TW2002 Bible* (Clme, 2007): http://fedspace.org/Downloads/TWBible.html
8. *TradeWars 2002 Player Tips, Tricks, and Cheats*: https://www.thestardock.com/files/manuals/TWLinksManuals/TradeWars%202002%20Player%20Tips,%20Tricks,%20and%20Cheats.htm
9. Secondary sources: the twclone seed SQL at github.com/rdearman/twclone (`sql/pg/091_seed_essential.sql`), whose ship numbers mostly match; the Stardock "Modern Manual" (`/files/ModernManual/strategy/combat.md`, `core/ships.md`); and the oocities ship page, which is incomplete. EarlTheDuke/TW2002 `constants.py` is **not canon**: its values are invented.

---

## 1. Ship table (standard 16 ships + pod + Ferrengi) [P]

Values come from the in-game Ship Catalog screens (Gypsy). Cross-checks against Wehner, the Bible appendix and twclone agree, except for the noted Escape Pod variance.

**Base Cost** = Hold Cost + Drive Cost + Computer Cost + Hull Cost. This holds exactly for every ship. For example, the Merchant Cruiser is 10,000 + 1,000 + 20,300 + 10,000 = 41,300. The shipyard's trade-in screen values a ship by these same four components.

| # | Ship | Base cost | Hold / Drive / Computer / Hull | Init holds | Max holds | Max figs | Max figs per attack | Max shields | Turns per warp | Odds | Mines (each type) | Beacons | Genesis | TransWarp | LR scan | Planet scanner | Photon | Transport range |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Merchant Cruiser (start ship) | 41,300 | 10,000/1,000/20,300/10,000 | 20 | 75 | 2,500 | 750 | 400 | 3 | 1.0 | 50 | 50 | 5 | N | Y (Holo) | Y | N | 5 |
| 2 | Scout Marauder | 15,950 | 5,000/3,000/5,200/2,750 | 10 | 25 | 250 | 250 | 100 | 2 | 2.0 | 0 | 10 | 0 | N | Y | Y | N | 0 |
| 3 | Missile Frigate | 100,800 | 6,000/1,000/82,800/11,000 | 12 | 60 | 5,000 | 2,000 | 400 | 3 | 1.3 | 5 | 5 | 0 | N | N | N | **Y** | 2 |
| 4 | BattleShip (Corellian) | 88,500 | 8,000/1,000/61,500/18,000 | 16 | 80 | 10,000 | 3,000 | 750 | 4 | 1.6 | 25 | 50 | 1 | N | Y | Y | N | 8 |
| 5 | Corporate FlagShip (CEO only) | 163,500 | 10,000/5,000/120,000/28,500 | 20 | 85 | 20,000 | 6,000 | 1,500 | 3 | 1.2 | 100 | 100 | 10 | **Y** | Y | Y | N | 10 |
| 6 | Colonial Transport | 63,600 | 27,000/1,000/10,400/25,200 | 50 | 250 | 200 | 100 | 500 | 6 | 0.6 | 0 | 10 | 5 | N | N | Y | N | 7 |
| 7 | CargoTran | 51,950 | 27,000/1,000/11,050/12,900 | 50 | 125 | 400 | 125 | 1,000 | 4 | 0.8 | 1 | 20 | 2 | N | Y | Y | N | 5 |
| 8 | Merchant Freighter | 33,400 | 15,000/2,000/9,600/6,800 | 30 | 65 | 300 | 100 | 500 | 2 | 0.8 | 2 | 20 | 2 | N | Y | Y | N | 5 |
| 9 | Imperial StarShip (Fed commission) | 329,000 | 23,000/10,000/231,000/65,000 | 40 | 150 | 50,000 | 10,000 | 2,000 | 4 | 1.5 | 125 | 150 | 10 | **Y** | Y | Y | **Y** | 15 |
| 10 | Havoc GunStar | 79,000 | 6,000/10,000/48,000/15,000 | 12 | 50 | 10,000 | 1,000 | 3,000 | 3 | 1.2 | 5 | 5 | 1 | **Y** | Y (Holo only) | N | N | 6 |
| 11 | StarMaster | 61,300 | 10,000/10,000/29,000/12,300 | 20 | 73 | 5,000 | 1,000 | 2,000 | 3 | 1.4 | 50 | 50 | 5 | N | Y | Y | N | 3 |
| 12 | Constellation | 72,500 | 10,000/10,000/39,500/13,000 | 20 | 80 | 5,000 | 2,000 | 750 | 3 | 1.4 | 25 | 50 | 2 | N | Y | Y | N | 6 |
| 13 | T'Khasi Orion | 42,250 | 15,000/10,000/10,500/6,750 | 30 | 60 | 750 | 250 | 750 | 2 | 1.1 | 5 | 20 | 1 | N | Y | Y | N | 3 |
| 14 | Tholian Sentinel | 47,500 | 5,000/10,000/25,000/7,500 | 10 | 50 | 2,500 | 800 | 4,000 | 4 | 1.0 (4.0 def over own/corp planet) | 50 | 10 | 1 | N | Y | N | N | 3 |
| 15 | Taurean Mule | 63,600 | 28,000/10,000/10,300/15,300 | 50 | 150 | 300 | 150 | 600 | 4 | 0.5 | 0 | 20 | 1 | N | Y | Y | N | 5 |
| 16 | Interdictor Cruiser | 539,000 | 5,000/50,000/380,000/104,000 | 10 | 40 | 100,000 | 15,000 | 4,000 | 15 | 1.2 | 200 | 100 | 20 | N | Y | Y | N | 20 |
| 0 | Escape Pod | n/a (has resale value) | — | 5 or 50? | 5 or 50? | 50 | 10 | 50 | 6 | 0.6 or 0.7 | 0 | 0 | 0 | N | Density | N | N | 0 |

Notes:
- **Odds.** Classic ships show a single "Offensive Odds" value, which is used both when attacking and when defending. TWGS Gold split this into separate offensive and defensive odds ("Combat odds have been split into offensive and defensive", TWGOLD.DOC) [P]. Model both fields and default defensive odds to offensive odds.
- **Tholian Sentinel.** It gets 4× defensive odds in a sector containing a planet owned by its owner (personal ship) or by its corp (corp ship). Changelog v3.11.44 [P].
- **Interdictor Cruiser.** Its Interdictor Generator stops all other ships in the sector from warping out. Corp members are exempt (a changelog bug fix confirms this). It cannot land on planets and cannot carry TransWarp. It cannot interdict from FedSpace, while cloaked, or while on a planet or port, and it is disabled by a photon [P].
- **Photon capacity.** The Missile Frigate and the ISS are the only standard photon carriers. Capacity is uncertain [R]: the Bible chart lists Frigate 10 and ISS 5, and Wehner says ISS 5.
- **Other equipment maxima.** These are uniform in DOS v2 [P strings]: Atomic Detonators 5, Cloaks 5, Ether Probes 25, Mine Disruptors 10, Corbomite up to 1,500 ("on some ships"). In TWGS Gold they are configurable per ship.
- **Escape Pod.** Sources disagree. Wehner gives 6 turns/warp, 5 holds, 50 figs, 50 shields, 0.7 odds. The Bible chart gives 50 holds, 50 figs, 50 shields, 0.6 odds, 10 figs per attack. The pod cannot be captured, only destroyed. The Scout Marauder **has no escape pod**: dying in a Scout means you are dead until the next day [C].
- **Access restrictions.** The Corporate FlagShip requires corp CEO ("Only Corporate Chairs can purchase this ship!"). The ISS requires a Federal Commission ("Only those with Federal Commissions can buy this ship!") [P]. In Gold, a "rank required for commission" field also exists, and a FedShip flown without enough experience can be stopped by the Feds: the ship is forfeit and you are demoted [P changelog].
- **TransWarp.** Allowed only on the ISS, CFS and Havoc (plus some Ferrengi Dreadnoughts in some configurations).
- **Ferrengi ships** (capturable, not buyable) [C, Gypsy]:
  - Assault Trader: 31,900; 12–50 holds; 3,000 figs; 1,000 per attack; 200 shields; 2 turns per warp; 1.0 odds.
  - Battle Cruiser: 67,100; 16–75 holds; 8,000 figs; 2,000 per attack; 800 shields; 3 turns per warp; 1.2 odds.
  - Dreadnought: 139,000; 20–100 holds; 15,000 figs; 5,000 per attack; 1,000 shields; 4 turns per warp; 1.4 odds; photon-capable; TransWarp optional.
  - The Scorpion "Venom", flown by Overlord Kriv Rylach, cannot be attacked: a gamma field blocks target lock and reflects photons.

---

## 2. StarDock

Hidden StarDock keys [C]: `U` Underground, `+` Library ("Libram Universitatus", which shows Ferrengi ship specs and alien derelicts), and `B` Single's Bar (you can get robbed there). Visible menu keys: C Cineplex, G Bank, H Hardware, P Police, S Shipyards, T Tavern, ! help, Q leave.

### 2.1 Stellar Hardware Emporium: prices [P = DOS v2 string table]

| Item | Price | Max per ship | Notes |
|---|---|---|---|
| Atomic Detonator | 15,000 | 5 | Destroys a planet. "VERY unstable": can react like Corbomite when you are attacked, and can detonate on mines or offensive figs. Not usable on alien homeworlds (TWGS). |
| Marker Beacon | 100 | per ship (5–150) | Message up to 41 characters. Two beacons in one sector destroy each other. Any player can destroy one by launching 1 fighter. Beacons make blind TransWarp fatal. |
| Corbomite Transducer | 1,000 each (the Bible cites a later config at 100) | 1,500 | Each device deals 20 battle points to the attacker when your ship is destroyed. 1,500 devices = 30,000 points. Invisible to scans. |
| Cloaking Device | 25,000 | 5 | One use. Engage while stationary. Hides you even from your corp. Shows as an anomaly on density scan. Docs: "after 24 hours… good chance of being detected". Veterans say cloaked ships cannot be attacked; mines or a photon in the sector decloak you. |
| SubSpace Ether Probe | 3,000 (TWGS max price setting 65,000) | 25 | Reports every sector along a plotted course and self-destructs at the destination. Any enemy fighter destroys it and the fighter owner learns the probe owner's ID. Ignores avoids (TWGS). |
| Planet Scanner | 30,000 | 1 (ship flag) | Shows owner, creator and defenses without landing. Blocked by planetary shields. |
| Armid Mine | 1,000 | Mine Max | "up to 30 points of damage" each (v2 string). Later guides report about 20 (Bible) or about 15 (Wehner) per mine. |
| Limpet Mine | 10,000 | Mine Max (separate count) | Removal at StarDock or a Class 0 port costs 5,000. |
| Photon Missile | 40,000 | Frigate / ISS only | Registered versions only, and can be disabled by the sysop. |
| Long Range Scanner | Holographic 25,000 / Density 2,000 | 1 | Holo includes density. A holo scan costs 1 turn; a density scan costs 0 turns (it works even at 0 turns). |
| Mine Disruptor | 6,000 | 10 | Launched into an adjacent sector. Destroys up to 12 mines (about 6–7 on average) and disarms limpets. Cannot be launched from a planet. |
| Genesis Torpedo | 20,000 (v2); about 25,000 in later configs | Genesis Max | Planet type is determined by sector conditions. |
| TransWarp Drive | Type I 50,000; Type II (tow-capable) 80,000; I→II upgrade 40,000 | 1 | Costs 3 Fuel Ore per sector of distance and 1 turn. Requires a friendly fighter in the target sector, or a "blind" warp. A blind warp into any occupied sector (beacon, mines, ships) destroys you. |
| Psychic Probe | 10,000 | 1 | After a trade, reports what percentage of the port's best price you achieved. |

TWGS v3 lets the sysop set every one of these prices (the `*` game-settings screen lists "Genesis Torpedo=, Armid Mine=, Limpet Mine=, Beacon=, Type I TWarp=, Type II TWarp=, TWarp Upgrade=, Psychic Probe=, Planet Scanner=, Atomic Detonator=, Corbomite=, Ether Probe=, Photon Missile=, Cloaking Device=, Mine Disruptor=, Holographic Scanner=, Density Scanner=, Limpet Removal=, Reregister Ship=, Tavern Announcement=…") [P: mombot game.ts / twcrawl parser keys]. **Recommendation:** use the DOS values above as defaults and make them config-driven.

### 2.2 Holds, fighters, shields (Class 0 ports and the Shipyards "Buy Class 0 Items")

**Holds** [C formula; R-verified]: each additional hold costs 20 credits more than the previous one.

`Cost(from 0 to H holds) = B·H + I·H·(H−1)/2`, with I = 20

`Next hold cost = B + 20·(current holds)`

B is a daily base price that ranges from 151 to 249 on an 18-day triangle cycle (151 → 249 over 9 days, then back down), observed by Cabal.

I independently verified this against the Bible's "cost to max holds" column, which fits **B = 173 exactly** for 15 ships. For example, the Merchant Cruiser from 20 to 75 holds costs 55·173 + 20·2585 = 61,215 ✓. The Mule from 50 to 150 costs 216,300 ✓.

Gotcha: the purchase screen displays the next-hold price 1 credit low. Holds cannot exceed the ship's Max Holds, and Gold caps holds at 255.

**Fighters and shields** [C]: Class 0 prices drift. Fighters run 160–239 credits each and shields 110–189 per point (VidKid help file, in the Stardock tutorial). [R] Use the same daily-cycling base as holds.

Shipyards "Buy Class 0 Items" sells the same three items "at a premium price" [P]. The premium amount is unknown [R]; suggest ×1.5.

Strings: "credits / next hold", "credits per fighter", "credits per point", "Your squadron is limited to N fighters", "Your ship is structurally limited to N shield points" [P].

### 2.3 Federation Shipyards [P unless noted]

- **Buy a New Ship.** Your current ship is traded in. The appraiser gives a condition remark (10 tiers, from "Why not sell your ship to the Ferrengi for target practice!" to "That's a nice, clean ship"). Then it itemizes Ship Hull Value, Ship Holds Value, Main Drive Value, Computer Value, minus Limpet Removal, plus Fighters, Shields, Genesis Torps, Armid Mines, and so on. All carried equipment goes into the trade.
  - Resale rule (TWGS v3.10): base holds are part of the package. Value is reduced if you have fewer holds than the ship started with, and holds above the initial count are priced at normal hold value.
  - [R] Trade-in ≈ 4-component cost × condition factor (suggest 50–75%) + 25–50% of equipment value.
  - New ships are "very basic models": initial holds only, no fighters or extras.
- **Purchase prompts.** Choose Corporate or Personal ship; set a name (30 chars) and an optional password (10 chars). Warning: "move the ship out of FedSpace… the Feds will repossess any unmanned ships left there overnight."
- **Sell Extra Ships.** Only ships you own that are in orbit at StarDock.
- **Examine Ship Specs.** Shows the catalog screen from §1.
- **Change Ship Registration** (rename): 5,000 credits.
- Stock can run out ("we don't have anymore ships in stock"). ISS availability is limited.

### 2.4 Federal Space Police HQ [P]

- Menu: Apply for Federal Commission; Claim a Federation Reward; Examine the Ten Most Wanted List (level, corp, trader, bounty count, total reward); Post a Reward.
- **Commission.**
  - DOS v2 string: "You'll have to get your alignment up to 1000 to be eligible for a FedShip!"
  - TWGS / community: apply at **≥ +500 alignment**. Approval raises alignment to +1,000, and each player may apply only once [C]. At ≥ 1,000 alignment you are commissioned automatically [C].
  - Rejection taunts are tiered by how close you are.
  - Betraying the commission (going evil) triggers: "Return that vessel to the StarDock or face the consequences!"
- **Posting a reward** on a Most Wanted (evil) trader gives **+1 alignment per 1,000 credits** [C].
- **Access.** Evil players cannot enter ("too risky to show your face"). Wehner says the threshold is alignment below −50 [C].
- Rewards are claimable only when you **kill the trader**, not just destroy their ship. The pod must die too [P changelog].

### 2.5 2nd National Galactic Bank [P]

- Personal accounts only. Operations: Deposit, Examine, Transfer (to any trader), Withdraw (owner only).
- Max balance: **500,000** ("no one may have more than 500,000 credits on deposit"). Max credits on hand: **1,000,000,000**. Citadel treasury max: 1,000,000,000,000,000. All are configurable in TWGS.
- Balances are kept as whole numbers.

### 2.6 Lost Trader's Tavern [P]

| Option | Behaviour |
|---|---|
| Announcement | 100 credits; up to 7 lines; stays until the next one is posted. |
| Bar | Pay for a drink and get a random fortune line (flavor only). |
| Eavesdrop | Shared conversation file; you can append lines. |
| Food | "Blue Plate Special" with alien-language waitress jokes. |
| Tri-Cron | Gambling. Ante scales with the Top Winner's jackpot. 10 rounds vs the house, pays 2:1. Beat the champion's score to take the jackpot. Grimy Trader tip: best combination is 2-3-1. |
| Grimy Trader | Keyword chat (type a topic). |
| Facilities | Bathroom wall graffiti (Read / Write / Erase). |
| `;` | Live chat. |

**Grimy Trader** keyword chat:
- Topics cost credits; he charges more if you are rude.
- **"trader"** buys a trace on a named player: "That trader docked at X in sector N, D days ago."
- **"underground" / "mafia"** sells the Underground password for a fee.
- **Swearing** at him gives −1 alignment and −1 experience. In TWGS this is limited to once per day via a daily event flag (originally it was unlimited).

### 2.7 The Underground [P strings, C rules]

- **Entry.** Give the password at the door (guard "Guido"). Only for players with alignment ≤ +100; good players are barred ("We don't want your kind in here!").
- **Wrong passwords** escalate: thrown out → beaten and all credits taken → lose 50% of experience → "murdered on the Stardock" (ship lost).
- **Change alias.** Cost scales with your fame (experience), from "Seems you're a total unknown, this'll be cheap" to "You must be insane!". Capped at 999,999,999.
- **Buy a hit (bounty)** on anyone: **−1 alignment per 250 credits** posted. The Bible says 4 per 1,000, which agrees.
- **Collect** hit contracts.
- Players may also be asked to set a new password ("That password is getting old…").

### 2.8 Cineplex

Flavor ANSI movies for 100 or 200 credits.

---

## 3. Combat

### 3.1 Ship vs ship [C formulas; R where noted]

- **Attack flow** [P]:
  1. `A` → choose the target (ships in the sector, including unmanned ones).
  2. "Combat scanners show enemy shields at N" (needs a combat scanner).
  3. "Your computer can control N fighters at once in an attack" (the ship's Max Figs Per Attack).
  4. "How many fighters do you wish to use (0 to N)".
  5. Result: "You lost X fighter(s), Y remain" / "You destroyed Z enemy fighters".
- **Turns.** Attacking does **not** require turns (you can attack or land at 0 turns, Cabal tip 29). Retreat costs 1 turn, but still succeeds at 0 turns.
- **Kill threshold** (community rule of thumb):
  - `fighters_needed ≈ (def_figs × def_odds) / att_odds` (Player Tips 3.1; "a slight random factor").
  - **Safety rating** = (max figs + max shields) × odds = the fighters a 1:1 attacker needs to kill a fully loaded ship. Examples: ISS 78,000; CFS 25,800; MC 2,900; IC 124,800; Sentinel 26,000 over its planet but 6,500 otherwise (Wehner).
  - One old tip claims "shields are at 2:1 regardless of ship type (I think!)". It is unverified and conflicts with the safety-rating convention.
- **[R] Recommended resolution model** (consistent with all of the above):
  ```
  power = sent × att_odds × rand(0.95..1.05)
  shields absorb first: shield_loss = min(shields, power / def_odds)
  remaining power kills defender fighters at def_odds:
      fig_loss = min(def_figs, remaining / def_odds)
  attacker losses ≈ (shield_loss + fig_loss) × def_odds / att_odds
      (capped at the number sent; survivors return)
  ship destroyed when fighters = 0 and shields = 0 and power remains
  ```
  The Cabal example (blue sends 10k into 8k red figs and loses about 7k, red podded) fits this order of magnitude.
- **Flee** [C]: if `attacker_figs_sent > 1.25 × (defender figs + shields)`, the defender warps out to an adjacent sector. Use strictly greater-than, with a little randomness. Current amounts are used, not maxima, and odds are ignored. Messages: "X warps out of the sector!" / "tried to warp out but failed". Interdictors (IC or planetary) prevent fleeing.
- **Capture** [P]: attacking a ship with 0 fighters and 0 shields captures it ("X captured your Y in combat"). Scouts and Escape Pods cannot be captured. Unmanned ships can be taken, and may self-destruct ("Just as you're ready to board it, it self destructs!").
- **Salvage** [P]: a measured kill salvages the victim's cargo holds and credits ("You find X's credits worth N"). Overkill leaves nothing: "...In fact, TOO excellent! You can't salvage anything." [R] Treat overkill as damage > 2× what was needed. Killing colonists aboard a ship is reported.
- **Corbomite** [P]: when you destroy a ship carrying Corbomite, you take 20 battle points per device ("The other ship was booby trapped…"). This can destroy the attacker. Atomic Detonators aboard can react the same way.
- **Corp safety** [P]: "SAFETY OVERRIDE ENGAGED! Attempt to attack Corporation ship detected." You cannot attack your own corp's ships.
- **Attack order in a sector** [C]: empty ships attack first, then players in the order they entered the sector, then fighters.

### 3.2 Losing your ship [P/C]

- **Escape pod.** "You rush to an escape pod and abandon ship…" Cargo, fighters, shields and equipment are lost. You keep banked credits; credits on hand go to the killer as salvage.
- **Penalties.** Podded: −10% experience. Destroyed outright ("#SD#"): −50% experience and −50% alignment, and you are dead until the next day. Self-destruct: lose all or half of experience ("For self-destructing you lose all your experience!" in v2; 50% per guides).
- **When you die outright.** Default **2 pods per day** ("Max Times Blown Up" setting). A third kill, or death in a Scout or Pod, means dead until tomorrow.
- **Pod destination** [C, TWGS .55]:
  - Self-inflicted deaths (quasar, navhaz, offensive sector figs, mines, attacking a Fed) send the pod to your **previous sector**.
  - Being killed by another player triggers a **safe path**: pick random destinations 3–20 hops away and move as far as possible through sectors that are empty or hold your own or corp fighters. Avoids are ignored.
  - Blind-warp or transport fusion sends the pod to sector 1, and the destination sector gains NavHaz.
- **Wreckage.** A destroyed ship can add NavHaz to the sector (+1% per ship destroyed by haz).
- **Turn loss.** [R] Pods have 6 turns/warp; no extra turn penalty is documented.

### 3.3 FedSpace and the Federation [P/C]

- **FedSpace** = sectors 1–10 plus the StarDock sector. Protection applies to traders with **alignment ≥ 0, experience < 1,000**, and (in most guides) **< 50 fighters**. Extern evicts "too heavily armed" ships; Gypsy cites 99+ fighters. Protected traders cannot be attacked there.
- **Attacking in FedSpace.** "X tried to start a fight in Federation Space". Captain Zyrain responds to attacks on protected traders and to fighter deployment in FedSpace.
- **Federal ships** are indestructible, will not enter sectors containing fighters, and can be trapped in dead ends:
  - Captain Zyrain (density 489).
  - Admiral Nelson (462).
  - Fleet Admiral Clausewitz (512).
- **Attacking a FedShip.** "Are you POSITIVE…" → 150,000 battle points of damage (podded), −10 alignment, −10% experience.
- **Evil ISS owner meeting Nelson or Clausewitz.** "Turncoats against the Federation will NOT be tolerated! Your ship is forfeit". This is a "Combined Fighter and Ion Cannon attack" of 50,000 battle points.
- **FedLaw** [P]:
  - No mines, offensive planets or fighters on the Major Space Lanes (Feds remove them and message you). Extern clears the lanes nightly.
  - No photon launches into FedSpace; in TWGS also not from FedSpace if you are protected.
  - No towing out of FedSpace. No cargo dumping in FedSpace. No citadels in FedSpace. No interdicting from FedSpace.
  - Limit on ships parked per FedSpace sector (default 5; U.F.P. Regulation FS-32.4b). Unmanned ships are repossessed at Extern.
- **Taxes** [P/C]: good players entering with many credits are taxed 5% ("to help support the Federation's struggle against the Ferrengi"). Thresholds are cited as 50,000 (Bible) or 100,000 (Wehner) and are configurable. Taxes raise alignment at about 1 point per 1,500 credits. Taxed once per day.

### 3.4 Bounties

There are two separate pools:
- **Federation rewards**: posted by good players at the Police HQ on evil traders.
- **Underground hits**: posted on anyone.

To collect either, kill the trader (pod included) and claim at the matching office. Killing Ferrengi or their fighters pays "Bounty Credits" from the Federation.

---

## 4. Deployables

### 4.1 Sector fighters [P/C]

- **Deploy.** `F` deploys any number; there is no cap without a planet. With a planet in the sector the cap is 50,000.
- **Ownership:** **Personal** or **Corporate**.
- **Modes** ("Fighter Modifier 0 = Defend, 1 = Toll, 2 = Attack"):
  - **Defensive**: blocks entry. An intruder must attack, retreat or surrender. Fights at **1:1**.
  - **Offensive**: automatically attacks on entry. In TWGS ≥ .55 it sends `1.25 × (target max figs + max shields)` at 1:1 vs the ship's defensive odds; any not sent stay. Ships with odds ≥ 1.3 always survive. If the target has 0 figs and 0 shields it sends at least 1 fighter. Survivors fall back to defend.
  - **Toll**: demands **5 credits per toll fighter** (fee = count × 5). Collected tolls accumulate and can be picked up. Toll fighters fight back at 1:1.
- **Entering a hostile sector**, order of events [C, Cabal]:
  1. NavHaz check.
  2. One limpet attaches; any previously attached limpet falls off.
  3. Armid check: if mines trigger, **50% of the mines detonate (rounded down)** and each deals damage (shields absorb first, then fighters, then the ship dies).
  4. Sector quasar cannons fire, lowest planet number first.
  5. Fighter encounter (offensive, defensive or toll).
  6. "Mined Sector: Avoid in future?" prompt.

  During a photon wave only planetary-shield fights and planet defensive figs remain active.
- **Attacking sector fighters** gives experience and alignment changes [C] (L = your fighters lost):
  - Opposite alignment (good vs evil): exp += L/15; alignment += (owner alignment / 5,000) × L, with the sign flipped toward your side.
  - Same alignment: exp += L/35; alignment −= (owner alignment / 10,000) × L.
  - You collect any accumulated tolls ("You get the N credits these fighters had").
- **Fighter owner messages.** Fighters report intruders and destroyed probes to their owner, and act as TransWarp locator beacons ("Locating beam pinpointed, TransWarp Locked").

### 4.2 Mines [P/C]

- **Armid.** 1,000 credits each. Damage per detonating mine: 30 (v2), about 20 (Bible), about 15 (Wehner). Example: 250 mines → about 125 detonate → about 1,875–2,500 damage. Sector cap 250 (configurable). Mines are smart: they do not hit the owner or the owner's corp ("most of the time"). Density 10 per mine.
- **Limpet.** 10,000 credits each. A single limpet attaches on entry. You see an attached limpet's ship location under "Activated Limpet Scan". Density 2 plus the anomaly flag. Removal at StarDock or a Class 0 port costs 5,000. Disruptors disarm them. They are invisible to ether probes and fatal to blind TransWarp.
- **Rules.** Two traders can each hold one mine type in a sector. Mines can be personal or corp.

### 4.3 Photon Missiles [P/C]

- Fired from an adjacent sector into a target sector (or from a citadel computer prompt). The launch sector appears in logs.
- **Effect for N seconds** ("Photon Wave Duration", sysop-set: 10–60 s typical, 0 = disabled):
  - Disables sector fighters, mines, sector and atmospheric quasar cannons, and unshielded planets' Combat Computers (L2), Quasar Cannons (L3) and Interdictor Generators (L6).
  - Disables ship interdictors and decloaks ships.
  - Planets with ≥ 200 planetary shields are immune.
- **Players in the blast** are "All Systems Down! Fighters inactive!": they lose all turns until the end of the hour. In unlimited-turn games, 1 minute per second of duration.
- **Carried photons** detonate on mines, offensive figs, quasars or Ferrengi ("Accidental Photon Missile Blast!"), costing you your turns.
- One-time sysop option allows multiple photons.

### 4.4 Atomic Detonators, Genesis, NavHaz [P/C]

- **Atomic Detonator.** Destroys a planet: −1 alignment and +50 experience (Cabal; the Bible says −50 alignment). Everyone on the planet dies. Each planet destroyed adds about 10% NavHaz. Nightly planet collisions add about 20%.
- **NavHaz.** Hits with probability = haz%. Damage = 10 × haz% (for example, 97% haz → 970 points). Decays about 3% per night. Never in sector 1 or StarDock.
- **Genesis Torpedo.** Creates a planet: +25 experience; alignment +10 if good, 0 if neutral, −10 if evil. Removes some NavHaz (10% per planet).

### 4.5 Other deployables

- **Ether probe**: see §2.1.
- **Beacons**: two in one sector annihilate each other.
- **Cloak**: one use; not cloakable while moving; a cloaked ship is "not in the sector" (tow and lock-on break).
- **Mine Disruptor**: 12 mines maximum per disruptor.

**Density values** [C] (cumulative): 0 empty or cloaked ship (anomaly), 1 beacon, 2 limpet (anomaly), 5 per fighter, 10 per armid, 21 per 1% NavHaz, 38 unmanned ship, 40 manned ship, 50 destroyed port, 77 Ferrengi Scorpion, 100 port, BattleCruiser or Dreadnought, 462/489/512 Feds, 500 planet.

---

## 5. Experience, alignment, ranks

### 5.1 Rank titles [P files; C thresholds]

Rank n is reached at **2^n experience**: rank 1 = 2, rank 22 = 4,194,304. Rank 0 is the starting title. The good table is used when alignment ≥ 0 and the evil table when alignment < 0 [R on the boundary].

| Rank | Exp | Good title | Evil title |
|---|---|---|---|
| 0 | 0 | Civilian | Annoyance |
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

**Alignment descriptor words** [P string table, order low → high; thresholds unknown]: Off the Scale / Demonic, Brutal, Loathsome, Conniving, Dastardly, Harsh, Crass, **Neutral**, Tolerant, Polite, Unselfish, Giving, Forgiving, Gallant, Knightly, Princely, Saintly. [R] Suggested design: equal bands of about 125 alignment points around 0, with "Off the Scale" beyond the ends.

**Unlocks by status:**
- Alignment ≤ −100: rob and steal at ports. Rob safely ≈ EXP × 3 credits; steal ≈ EXP/30 holds (classic). MBBS mode is ×6 and /21.
- Alignment ≤ +100: Underground access.
- Alignment ≥ +500: Federal commission (raised to 1,000) and with it the ISS and TransWarp to FedSpace.
- Alignment ≥ 0 with experience < 1,000: FedSpace safety.
- Corp CEO: Corporate FlagShip.

### 5.2 Experience and alignment sources [C, Cabal / Wehner unless noted]

| Action | Experience | Alignment |
|---|---|---|
| First login each day | +1 | +1 |
| Trade at ≥ 98% / ≥ 99% / exact best price | +1 / +2 / +5 | 0 |
| Swear at Grimy Trader | −1 | −1 |
| Create planet | +25 | +10 good / 0 neutral / −10 evil |
| Destroy planet (detonator) | +50 | −1 (Bible: −50) |
| Destroy port | +50 | −50 |
| Create port (class 1–8) | +7 to +45 | +4 to +20 |
| Port upgrade (per unit: ore / org / equip) | 0.1 / 0.2 / 0.3 | 0.05 / 0.1 / 0.15 |
| Jettison colonists (only when good; once per extern) | 0 | −1 per colonist |
| Post Fed reward | 0 | +1 per 1,000 credits |
| Post Underground hit | 0 | −1 per 250 credits |
| Pay taxes | 0 | about +1 per 1,500 credits |
| Port bust while robbing or stealing | −10% experience, lose some holds | −5 per repeat bust |
| Attacking a Fed | −10% | −10 (and you are podded) |
| Ship vs ship, opposite alignment | +(your figs lost)/15 | ±(your figs lost/1000) × (enemy alignment × 0.2), moving toward "good kills evil" |
| Ship vs ship, same alignment | +(figs lost)/35 | penalty by the same formula |
| Ship vs ship, neutral attacker | +(figs lost)/25 | same formula |
| Podding a trader | +10% of victim's experience | +50% of victim's alignment, with the sign flipped (good killing evil gains; evil killing good loses) |
| Killing a trader on a planet | victim exp × 0.1666 + 50 | victim alignment × −0.333 − 1 |
| Killing a trader on a port | victim exp × 0.1666 + 50 | victim alignment × −1 − 55 |
| Mixed-alignment corp at Extern | −min(abs(lowest alignment), highest alignment)/4 per member | 0 |

Notes:
- Victims need at least about 10–25 experience for kill rewards to apply (Wehner).
- TWGS "Combat Penalty Mode":
  - The default v3 mode penalizes attacking anyone of like alignment, including their fighters and ships.
  - MBBS mode penalizes only attacks on like-aligned players, plus good players attacking good players' personal fighters [P changelog].
- Experience and alignment are clamped to limits. An overflowing award gives the boundary value.

---

## 6. Open questions and design calls for the replication

1. **Exact ship-vs-ship loss formula and random factor.** Not found in primary sources. Adopt the [R] model in §3.1 and tune it so that safety ratings and the Cabal example hold.
2. **Escape Pod stats** (holds 5 vs 50; odds 0.6 vs 0.7). Pick one.
3. **Price set.** DOS v2 string prices (Genesis 20k, Corbomite 1k, Photon 40k) vs later sysop defaults (Genesis 25k). Make prices config-driven.
4. **Armid damage per mine** (15 / 20 / 30).
5. **Commission threshold.** 1,000 (v2 string) vs 500 → 1,000 on application (TWGS). Recommend the TWGS rule.
6. **Alignment descriptor bands**, and whether the good/evil title switches at alignment < 0.
7. **Shipyard trade-in percentage** and the Class 0 premium in the Shipyards.
