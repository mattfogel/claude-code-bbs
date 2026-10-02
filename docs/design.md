# lATeNt sPaCE — design

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
   │     SQLite: oneliners, rumors, lastcallers, presence, event log (seq)
   │     alarm: at most every ~5 s, if dirty → write hub.json to R2
   ├── Board Durable Object (one per conference)  [phase 2]
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
  "motd": "|08[|15lATeNt sPaCE|08] |07welcome back, |11%UN|07.",
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
| POST | `/mod/{delete,ban,unban,mute}` | | Requires the `sysop` or `mod` role. Writes to modlog. |

- **Auth:** every request except `/register` sends `Authorization: Bearer <secret>`. The Worker looks up the user by `sha256(secret)` in D1.
- **Errors:** `{error: {code, message}}`, with codes `rate_limited`, `banned`, `cooldown`, `invalid`, `busy`.

### Abuse controls (minimal, for launch)

- **Proof of work on `/register`:**
  - The client finds a nonce such that `sha256(handle + ":" + nonce)` has N leading zero bits. Start with N≈20, about 1–2 s.
  - The server checks it with a single hash, which fits the 10 ms CPU limit.
  - `crypto.subtle.digest` is available in the mod.
- **Limits:**
  - Registrations: 3 per IP per day, via the Rate Limiting binding.
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
- **Main menu (phase 1):** `[O]ne-liners  [R]umors  [L]ast Callers  [W]ho's Online  [S]tats  [G]oodbye`. Arrow-key lightbar plus single-key hotkeys.
- **Status bar** (bottom row): `lATeNt sPaCE │ Node 3 │ mattf │ 18:04 │ Claude: running Bash…`.
- **"What my Claude is doing":**
  - `turn.start`, `tool.call` and `turn.complete` hooks set the local status ("Claude is thinking…", "Claude is running Bash…", "idle").
  - The status bar shows it, and the presence update sends it, throttled.
  - **Never** send prompt text, file paths or tool arguments. Only the tool name and a coarse state go out.

### Rendering

- **Screen:** a `Client` surface module holds the screen buffer (width = pane `bodyColumns`, capped at 80; target art width about 60) and draws it as a `Raster`.
  - Each cell is `[codePoint, fg, bg]` using the VGA 16-color palette as truecolor.
  - CP437 glyphs are stored as their Unicode equivalents.
- **Text renderer:** in `shared/pipe.ts`, it parses `|00`–`|15` foreground and `|16`–`|23` background codes, plus `%XX` MCI fields from a context object (`%UN`, `%LO`, `%BN`, `%DT`, `%TM`, `%NN`, …), into cells. It's shared with the server so both sides validate user text the same way.
- **Input:** `surface.onKey` drives hotkeys, the lightbar and a one-line editor for one-liners and rumors.
- **Messages:** the Client module `post()`s actions to the hooks module (`ui.message`), which does the `$.http.fetch` calls and updates `$.state`.
- **Art:** `plugin/art/*.ans.txt` files are original art written with pipe codes rather than raw ANSI escape codes, because escape codes are refused in text and pipe codes diff cleanly. The matrix logo is a gradient "lATeNt sPaCE" in half-block/shade characters, about 60 columns wide.

### Where data is kept

| Data | Where | Why |
|---|---|---|
| handle, secret | `$.store` | Persists across sessions. It's plaintext, like `~/.ssh`. |
| latest feed snapshot, ETag | `$.state` | Lasts the session and survives hot reload. |
| current screen/menu, lightbar index | Client module state | UI-local. |
| Claude status | `$.state` | Written by turn and tool hooks, read by the status bar. |

### Security invariants

1. BBS content is **never** passed into the model context: no `prompt.compose` sections, no tool results. It is drawn only in the pane.
2. Text from the feed is sanitized again on the client before rendering. Anything that isn't printable, width-1 and in the BMP becomes `?`, as Raster requires.
3. Nothing about the user's work leaves the machine except the coarse status string.

## Repo layout

```
claude-code-bbs/
  plugin/                     # the mod
    .claude-plugin/plugin.json   # name "latent-space"
    hooks/hooks.json             # { "modules": ["./register.tsx"] }
    hooks/register.tsx           # /bbs command, pane, turn/tool hooks, fetch + poll loop
    client/                      # Client surface module: screens, renderer, input
    art/                         # *.ans.txt (pipe-coded)
    types/index.d.ts             # PluginState contract
    test/*.test.ts               # claude plugin test
  server/
    wrangler.jsonc               # Worker, DO bindings (Hub; Board/Mailbox later), D1, R2, ratelimits, routes
    src/index.ts                 # router (Hono), auth, sanitize, RPC
    src/do/hub.ts
    migrations/0001_init.sql     # D1
    test/*.test.ts               # @cloudflare/vitest-pool-workers
  shared/
    protocol.ts                  # feed + API types
    pipe.ts                      # pipe/MCI parser + sanitizer
  docs/
```

**Plugin dev loop:**
- The engine writes the mod API types when the plugin-authoring skill loads, and `claude plugin validate plugin/` checks the mod.
- Locally, run `claude --plugin-dir plugin/` or symlink `plugin/` into the session's dev-mods folder for hot reload.
- Run `claude plugin test plugin/`.

**Server dev loop:** `wrangler dev`, `wrangler d1 migrations apply DB --local`, `vitest`. Deploy with `wrangler d1 migrations apply DB --remote && wrangler deploy`.

## Phases

### Phase 1: the board is live
- [ ] `shared/pipe.ts`: pipe/MCI parser, sanitizer, tests
- [ ] `shared/protocol.ts`: feed and API types
- [ ] Server: D1 schema (users, bans, modlog); Worker router; `/register` (with proof of work), `/call`, `/presence`, `/oneliners`, `/rumors`, `/report`, `/mod/*`
- [ ] Hub Durable Object: SQLite tables, token buckets, dirty flag + alarm → `hub.json` to R2
- [ ] Cloudflare: R2 bucket + custom domain `feed.mattfogel.com` with a cache rule; Worker route `bbs.mattfogel.com`; fail-closed route
- [ ] Plugin: `/bbs` command, pane, Client module renderer (Raster), matrix screen, new-user flow, logon sequence, main menu, one-liners, rumors, last callers, who's online, stats, status bar, BUSY mode
- [ ] Original art: matrix logo, main menu frame, list headers and footers
- [ ] Tests on both sides; deploy; seed with a sysop account

### Phase 2: messages and voting
Message conferences (one Board Durable Object each, with sponsors), newscan, Obv/2-style post headers, a line editor, a voting booth with ASCII bars, Top Ten.

### Phase 3: social
Private mail (Mailbox Durable Objects, fetched through the Worker since mail is private), paging between users, New User Voting, a daily-turn door game, an optional GitHub device-flow "verified" badge.

## Open questions

- The exact wording of `Cache-Control` and the R2 Class B billing for cache hits needs measuring once the feed is deployed.
- `Raster` color formats and the Client module limits are from an early-access API (Claude Code 2.1.287). Re-check `claude-code.d.ts` when work starts.
- Chosen color theme for lATeNt sPaCE: the default proposal is the purple/magenta gradient `|05 |13 |15` with a `|08` frame.
