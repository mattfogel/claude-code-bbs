# lATENT sPACE — design

A Vision-X / Oblivion/2-style BBS that lives in a Claude Code pane. There is one global board for everyone who installs the plugin, hosted on Cloudflare and designed to stay within the **Workers Free plan**.

See [research.md](research.md) for the background, API details and sources.

## Goals

- **Nostalgia.** It should feel like calling an elite-scene board in 1994: matrix screen, pipe-colored menus, `[Main Menu] Command:`, one-liners, rumors, last callers.
- **Something to read while Claude works.** You open it with `/bbs` and glance at it during a turn.
- **One global board** shared by every installer.
- **$0/month** at expected scale. Over the limit, it degrades gracefully instead of costing money.

## Non-goals (for now)

- Real-time delivery under one second. Content arriving 10–20 s late is accepted.
- File areas, full door games, FidoNet-style echo networks.
- Reusing original 1990s code or art. Both have unclear licensing (see research.md), so all art is original.

## Domains

| Host | What | Served by |
|---|---|---|
| `bbs.mattfogel.com` | Write API (`/v1/*`) and static assets (art, version manifest) | Worker + Workers Static Assets |
| `feed.mattfogel.com` | Read-only JSON snapshots | Public R2 bucket on a custom domain, behind the Cloudflare cache |

Prerequisite: the `mattfogel.com` zone must be on the Cloudflare account, so the Worker route and the R2 custom domain can be attached.

## Architecture

```
 Claude Code mod (plugin/)
   │  reads: GET feed.mattfogel.com/*.json   (cached, ~10 s TTL; never reaches the Worker)
   │  writes: POST bbs.mattfogel.com/v1/*    (bearer secret)
   ▼
 Worker (server/src/index.ts) ── auth, validation, sanitizing, ban check
   │  RPC
   ├── Hub Durable Object (singleton "global")
   │     SQLite: oneliners, rumors, lastcallers, presence, conferences, polls + votes,
   │             per-user stats (Top Ten), quotas, event log (seq)
   │     alarm: at most every ~5 s, if dirty → write hub.json to R2
   ├── Board Durable Object (one per conference, named by slug)
   │     SQLite: threads, posts → writes boards/<slug>/index.json + threads/<id>.json to R2
   └── Mailbox Durable Object (one per user)      [phase 3; mail is private, so it never goes on the feed]
 D1: users (handle UNIQUE, secret_hash, role, created_at, banned), bans, modlog
 R2 bucket "latent-space-feed": hub.json, boards/…   (public via feed.mattfogel.com)
```

### Why reads go through R2 and the cache (the free-tier trick)

The free plan allows 100k Worker requests/day and 100k Durable Object requests/day. If clients polled a Worker directly, a few dozen active users would use that up. Instead the Durable Objects **publish static JSON snapshots** to R2. Clients poll those files through the Cloudflare cache (`Cache-Control: public, max-age=10`), so a poll never runs a Worker. Each object writes at most once per ~5 s and only when something changed, which stays far below R2's 1M writes/month.

The Worker handles only **writes**: sign-up, one-liners, rumors, posts, votes and presence updates. That budget covers roughly 5k daily users at about 20 writes each.

Verify early: confirm that cache hits on the R2 custom domain don't count as R2 Class B operations. If they do, the 10M/month allowance still covers a lot.

### When the free limits run out

Daily limits reset at 00:00 UTC. Once a limit is used up, the Worker returns error 1027 (configure the route to fail closed), or Durable Object operations fail. The client then:
- shows **`ALL NODES BUSY — TRY AGAIN LATER`** in BBS style
- keeps reading the feed, which still works because it is served from R2 and the cache
- disables writing until it next sees a successful write

If the board grows, upgrading to Workers Paid ($5/mo) needs no redesign.

## Feed format (`feed.mattfogel.com/hub.json`)

```jsonc
{
  "v": 1,
  "seq": 18234,                 // monotonic, bumped on every change
  "generatedAt": "2026-10-02T18:04:11Z",
  "motd": "|08[|15lATENT sPACE|08] |07welcome back, |11%UN|07.",
  "oneliners":  [{ "id": "…", "handle": "mattf", "text": "…", "ts": "…" }],   // last 15
  "rumors":     [{ "id": "…", "text": "…", "ts": "…" }],                      // last 50; clients pick one at random
  "lastCallers":[{ "handle": "…", "location": "…", "ts": "…", "node": 3 }],   // last 10
  "nodes":      [{ "node": 3, "handle": "mattf", "status": "Claude is running Bash…", "since": "…" }],
  "stats":      { "users": 412, "callsToday": 87, "onelinersTotal": 3051 }
}
```

- **Fetching:** clients fetch with `If-None-Match`. The Cloudflare cache handles ETags, and a 304 is cheap.
- **Poll rate:** about every 10 s while the pane is focused, about every 30 s while it is open but unfocused, and not at all when the pane is closed.
- **Your own writes:** a client merges them in optimistically, so posting feels instant.

## Write API (`bbs.mattfogel.com/v1`)

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/register` | `{handle, location?, pow}` | Returns `{secret}` once. The server stores only `sha256(secret)`. A UNIQUE constraint on handle makes the claim atomic. |
| POST | `/call` | — | Records a logon to last callers and bumps calls. Sent once per `/bbs` session. |
| POST | `/presence` | `{status}` | The client sends it only when the status changes, at most once per 120 s. Entries expire after 10 min. |
| POST | `/oneliners` | `{text}` | Max 70 chars. |
| POST | `/rumors` | `{text}` | Max 70 chars. Shown anonymously, but the server keeps the author for moderation. |
| POST | `/report` | `{kind, id, reason}` | |
| POST | `/posts` | `{conference, subject?, to?, body, replyTo?, thread?}` | A new thread needs a subject; a reply takes the thread, "Re:" subject and To: of the post it answers. Body up to 4,000 chars and 100 lines. 1 per 30 s and 20 per day per user, across conferences. |
| POST | `/votes` | `{poll, option}` | One vote per user per poll, final. Closed polls refuse. |
| POST | `/mod/{delete,ban,unban,mute}` | | Requires the `sysop` or `mod` role. Writes to modlog. `delete` takes `kind: "post"` with `conference`. A ban also hides the user's posts in every conference. |
| POST | `/mod/poll`, `/mod/poll/close` | `{question, options[2..8]}`, `{id}` | Sysop or mod. |
| POST | `/mod/conference` | `{slug, name, sponsor?, description?, n?, remove?}` | Sysop only. Removing a conference hides it from the list; its Board keeps the posts. |

- **Auth:** every request except `/register` sends `Authorization: Bearer <secret>`. The Worker looks up the user by `sha256(secret)` in D1.
- **Errors:** `{error: {code, message}}`, with codes `rate_limited`, `banned`, `cooldown`, `invalid`, `busy`.

### Abuse controls (minimal, for launch)

- **Proof of work on `/register`:**
  - The client finds a nonce such that `sha256(lowercase(handle) + ":" + nonce)` has N leading zero bits. N=16 (`LIMITS.powBits`, server `POW_BITS`): measured at about 2 s in the mod environment, where 18 bits took over 10 s.
  - The server checks it with a single hash, which fits the 10 ms CPU limit.
  - `crypto.subtle.digest` is available in the mod.
- **Limits:**
  - Registrations: 3 per IP per day, counted by the Hub against a hash of the IP. The Rate Limiting binding was dropped because it only supports 10 s or 60 s periods.
  - New accounts are read-only for 10 minutes.
  - One-liners and rumors: 1 per 60 s per user, and 20 per day. These are exact token buckets in the Hub's SQLite.
- **Sanitizing:**
  - On the server, strip all C0/C1 control characters, ESC sequences and bidi overrides, and normalize to NFC.
  - Pipe codes in user text are limited to colors `|01`–`|15`. All other `|XX` and `%XX` codes are removed.
- **Moderation:**
  - Matt has the `sysop` role, set directly in D1.
  - Deleted items vanish from the next snapshot.
  - Bans are checked on every write.

## The mod (plugin/)

### UX

- **Opening:** `/bbs` opens the pane. It's opened by the person, so it is placed at any width, docked in fullscreen or inline otherwise. It never opens by itself.
- **First run:** matrix screen → `[N]ew User` → handle/location prompts → proof of work ("Negotiating carrier…") → secret saved to `$.store`.
- **Returning user:** matrix → Login (automatic, using the stored secret) → logon sequence (rumor of the day, last callers, one-liners) → Main Menu.
- **Main menu:** `[M]essages [N]ewscan [B]ase Change [O]ne-liners [R]umors [V]oting Booth [T]op Ten [L]ast Callers [W]ho's Online [S]tats [G]oodbye`, in two columns. Arrow-key lightbar plus single-key hotkeys.
- **Message bases (phase 2):**
  - *Base change* lists the conferences by number with sponsor, message count and a red `*` when something is newer than your read pointer. A digit joins one.
  - *Messages* is the joined conference's thread list, most recently active first, with the same `*` marker. `P` posts a new thread.
  - *Reading* shows one message at a time under an Obv/2-style header: a `┌─[ Base ]──── Msg n of N ─┐` rule, then From/Date, To and Subj. `N`/`P` step through the thread, `R` replies, arrows scroll long bodies, and `T` returns to the thread list.
  - *The line editor* is the classic one: you type a line, Enter commits it, words wrap at the line width, and Backspace on an empty line pulls the previous one back. `/S` saves and `/A` aborts.
  - *Newscan* collects every thread with posts past your read pointers (up to 20 threads), shows the count, and reads them in order. Running off the end of one thread moves on to the next, and then back to the main menu.
- **Read pointers:** one per conference, the highest post id read, kept in `$.store`. Opening a thread starts at its first unread post. Newscan's `M` marks everything read.
- **Voting booth:** lists polls (open first). A poll shows each option with a `████░░░░` bar, percent and count; a digit votes once. Your votes are kept in `$.store` so the screen can mark them.
- **Top Ten:** posters, callers and one-liners as bars, scaled to the leader.
- **Status bar** (bottom row): `lATENT sPACE │ Node 3 │ mattf │ 18:04 │ Claude: running Bash…`.
- **"What my Claude is doing":**
  - `turn.start`, `tool.call` and `turn.complete` hooks set the local status ("Claude is thinking…", "Claude is running Bash…", "idle").
  - The status bar shows it, and the presence update sends it, throttled.
  - **Never** send prompt text, file paths or tool arguments. Only the tool name and a coarse state go out.

### Rendering

- **Screen:** a `Client` surface module (`client/term.tsx`) holds the local UI state and draws it. Width is the pane's `bodyColumns`, capped at 80.
  - A Client module's element table has no `Raster` (`ClientElements` omits it), so each row is a `Text` of nested `Text` runs. A run is a stretch of cells with one VGA color pair, drawn as truecolor `color`/`backgroundColor`. As a side effect, the board also works on the desktop surface.
  - CP437 glyphs are stored as their Unicode equivalents.
  - `client/app.ts` is pure: `press(state, key, view)` returns the next state and an optional Action, and `draw(state, view, w, h)` returns exactly `h` pipe-coded lines. It's tested under plain Node.
- **Text renderer:** in `plugin/shared/pipe.ts`, it parses `|00`–`|15` foreground and `|16`–`|23` background codes, plus `%XX` MCI fields from a context object (`%UN`, `%LO`, `%BN`, `%DT`, `%TM`, `%NN`, …), into cells. It's shared with the server so both sides validate user text the same way.
- **Input:** `surface.onKey` drives hotkeys, the lightbar and a one-line editor for one-liners and rumors.
- **Messages:** the Client module `post()`s actions to the hooks module (`ui.message`), which does the `$.http.fetch` calls and updates `$.state`.
- **Art:** original and pipe-coded, because escape codes are refused in text and pipe codes diff cleanly. A mod loads only code files, so art lives in TS modules. The matrix logo (`client/logo.ts`) is "LATENT SPACE" in a 4×5 pixel font, drawn with half blocks in a `|15 |13 |05` gradient, 59 columns wide. Below that width it falls back to a one-line title. `bun scripts/screens.ts [w] [h]` prints every screen in truecolor for review.

### Where data is kept

| Data | Where | Why |
|---|---|---|
| handle, secret | `$.store` | Persists across sessions. It's plaintext, like `~/.ssh`. |
| latest feed snapshot, ETags per feed URL | `$.state` | Lasts the session and survives hot reload. |
| board index on screen, the thread being read (bodies near the focused post only) | `$.state` (`view.board`, `view.thread`) | The Client's props are capped at 100,000 characters, so only about 30,000 characters of bodies go across at a time. |
| last 12 thread files | `$.state` (`threads`) | Moving between posts doesn't refetch. |
| read pointers, your votes | `$.store` (`lastRead`, `votes`) | Persist across sessions. |
| current screen/menu, lightbar index | Client module state | UI-local. |
| Claude status | `$.state` | Written by turn and tool hooks, read by the status bar. |

### Security invariants

1. BBS content is **never** passed into the model context: no `prompt.compose` sections, no tool results. It is drawn only in the pane.
2. Text from the feed is sanitized again on the client before rendering. Anything that isn't printable, width-1 and in the BMP becomes `?`, so the grid stays aligned.
3. Nothing about the user's work leaves the machine except the coarse status string.

## Repo layout

```
claude-code-bbs/
  plugin/                        # the mod (self-contained: installs copy only this folder)
    .claude-plugin/plugin.json   # name "latent-space", userConfig apiUrl/feedUrl
    hooks/hooks.json             # { "modules": ["./register.tsx"] }
    hooks/register.tsx           # /bbs, pane, Client props, poll loop, write API, PoW, status hooks
    client/term.tsx              # Client surface module: keys in, colored Text runs out
    client/app.ts                # pure screen state machine + drawing
    client/logo.ts               # generated half-block logo
    shared/pipe.ts               # pipe/MCI parser + sanitizer (server imports it too)
    shared/protocol.ts           # feed + API types, limits, status encoding, PoW
    types/index.d.ts             # PluginState contract, View, Action
    test/bbs.test.tsx            # claude plugin test: fake board, full flows
  server/
    wrangler.jsonc               # Worker, Hub DO, D1, R2, vars
    src/index.ts                 # Hono router, auth, sanitize, moderation
    src/hub.ts                   # Hub Durable Object
    migrations/0001_init.sql     # D1: users, reports, modlog
    test/api.test.ts             # @cloudflare/vitest-pool-workers
  test/                          # Node unit tests of plugin/shared and plugin/client
  scripts/screens.ts             # print every screen in truecolor
  docs/
```

The shared code lives under `plugin/shared/` rather than at the top level, because an installed plugin is only its own folder. The server imports it from there.

**Plugin dev loop:**
- The engine writes the mod API types into `plugin/.claude-plugin/types/` when it loads the mod (gitignored). `npm run typecheck` and `claude plugin validate plugin` check it.
- The validator follows `$` only into functions declared at the top level of the hooks module, and state writes must name an atom directly (no generic helpers).
- Locally, run `claude --plugin-dir plugin/` or symlink `plugin/` into the session's dev-mods folder for hot reload.
- Run `claude plugin test plugin/`.

**Server dev loop:** `wrangler dev`, `wrangler d1 migrations apply DB --local`, `vitest`. Deploy with `wrangler d1 migrations apply DB --remote && wrangler deploy`.

## Phases

### Phase 1: the board is live
- [x] `shared/pipe.ts`: pipe/MCI parser, sanitizer, tests
- [x] `shared/protocol.ts`: feed and API types
- [x] Server: D1 schema (users, reports, modlog); Worker router; `/register` (with proof of work), `/call`, `/presence`, `/logoff`, `/oneliners`, `/rumors`, `/report`, `/mod/{delete,ban,unban,mute,motd}`
- [x] Hub Durable Object: SQLite tables, per-user quotas, per-IP registration quota, dirty flag + alarm → `hub.json` to R2, presence expiry
- [ ] Cloudflare: D1 database id, R2 bucket + custom domain `feed.mattfogel.com` with a cache rule; Worker route `bbs.mattfogel.com`; fail-closed route (needs the account; see README)
- [x] Plugin: `/bbs` command, pane, Client module renderer, matrix screen, new-user flow, logon sequence, main menu, one-liners, rumors, last callers, who's online, stats, status bar, BUSY mode
- [x] Original art: matrix logo, menu headers and footers
- [x] Tests: Node unit tests, Workers integration tests, `claude plugin test` flows
- [ ] Deploy; seed with a sysop account (`UPDATE users SET role = 'sysop' WHERE handle = ...`)
- [ ] Try it in a real fullscreen session: key focus, pane sizing, colors in light themes

### Phase 2: messages and voting
- [x] Board Durable Object per conference: threads, posts, R2 publishing of index and thread files, moderation (delete, purge on ban)
- [x] Conferences in the Hub, seeded with General, Claude Talk, Show Off and Sysop & Feedback (sponsor "SysOp"); `/mod/conference` edits them
- [x] Message quota across conferences; per-user stats; Top Ten in hub.json
- [x] Polls and votes in the Hub, results in hub.json
- [x] Mod: base change, thread list, reader with Obv/2 headers, line editor, newscan with read pointers, voting booth, Top Ten
- [x] Tests: server (threads, replies, quotas, moderation, conferences, polls), Node (every new screen and key flow), `claude plugin test` (newscan → read → reply → vote)
- [ ] Deploy: the Board class arrives with Durable Object migration `v2`; a normal `npm run deploy` applies it

### Phase 3: social
Private mail (Mailbox Durable Objects, fetched through the Worker since mail is private), paging between users, New User Voting, a daily-turn door game, an optional GitHub device-flow "verified" badge.

## Open questions

- The exact wording of `Cache-Control` and the R2 Class B billing for cache hits needs measuring once the feed is deployed.
- The Client module and Text color limits come from an early-access API (Claude Code 2.1.287). Re-check `claude-code.d.ts` after upgrades.
- Whether hashing is faster in a pure-JS SHA-256 than with `crypto.subtle` per digest in the mod environment. If it is, the PoW could go back to 18 bits.
- Chosen color theme for lATENT sPACE: the default proposal is the purple/magenta gradient `|05 |13 |15` with a `|08` frame.
