# Research notes

Summary of the initial research (2026-10-02) behind the design: the BBS lineage we're imitating, the Claude Code mod API, and the Cloudflare primitives.

## 1. Vision-X / Oblivion/2 lineage

- **Forum family tree:** Forum-PC (Ken Duda) → LSD (Ken Sallot). LSD 1.21's source leaked, and ViSiON, ViSiON/2, Vision-X and Oblivion/2 were all built from it. The "matrix" pre-login screen came from TCS, another Forum hack. <http://software.bbsdocumentary.com/IBM/DOS/FORUM/>
- **ViSiON/2:** by Crimson Blade, about 1991–93. The Turbo Pascal source has no license: <https://github.com/stlalpha/vision-2-bbs>
- **Vision-X:** v0.90 to v2.00 (1993–94). A warez/elite-scene favorite, forked often and known for backdoors. <http://www.bbsdocumentary.com/software/IBM/DOS/VISIONX/>
- **Oblivion/2:** by Darkened Enmity and Lord Tracer, starting in 1992. v2.30 shipped July 1995. <http://software.bbsdocumentary.com/IBM/DOS/OBLIVION2/>
- **Iniquity:** derived from Telegard, with an Obv/2 flavor. <http://software.bbsdocumentary.com/IBM/DOS/INIQUITY/>
- **What set the Forum hacks apart from Renegade, Telegard and WWIV:** almost every screen was replaceable art, plus the matrix login, New User Voting (NUV), arrow-key lightbars, user-selectable menu libraries, and "repeat ANSIs" (START/MID/END templates for lists).

### Signature UX
- **Matrix screen:** a block logo with a horizontal lightbar: Login, Apply, Feedback, Check status, Chat.
- **New-user application:** handle, location and note, then an infoform, then NUV.
- **Main menu items:** Messages, Files, Email, Last Callers, Rumors, One-liners, BBS List, Voting, Top Ten, Your Stats, Who's Online, Chat/Page, Goodbye.
- **Prompt:** `[Main Menu] Command:` with a time/status line.
- **Conferences:** numbered sub-boards, each with a sponsor, plus a "base change" screen.
- **Rumors:** anonymous random one-line gossip, separate from the one-liners.
- **Top Ten:** leaderboards drawn as ASCII bar graphs.

### Color and MCI codes (Obv/2, from OBV.DOC v2.30)
- `|01`–`|15` set the foreground color. Renegade/Telegard style adds `|16`–`|23` for backgrounds.
- `|U1`–`|U6` are user palette slots (Regular, Prompt, Status, Input, Inverse, Box).
- Prompt MCIs: `|MN` menu name, `|TL` time left, `|TM` time now, `|NN` node.
- Textfile MCIs: `%UN` handle, `%LO` location, `%CS` calls, `%PS` posts, `%LC` last caller, `%BN` board name, `%DT`/`%TM` date and time.
- Fields inside repeat templates: e.g. `|UH` handle, `|DO` time online.

### Aesthetic
- 16-color CGA/VGA palette on black. The usual gradients are `|08 |07 |15` (grey) and `|03 |11 |09` (cyan/blue).
- Shaded block logos, two-column `[K] Item` menus, boxed list headers and footers, "eLiTe" casing.
- CP437 glyphs map 1:1 to Unicode: `░▒▓█▀▄▌▐■` and the U+2500 box-drawing block. Half-blocks give 2× vertical resolution.

### Licensing
The original code is leaked or unlicensed; read it for behavior but don't port it. ANSI art on 16colo.rs stays the property of each artist. **We make original art.**

### Modern references
- Oblivion2-XRM (C++, zlib): <https://github.com/M-griffin/Oblivion2-XRM>
- ViSiON/3 (Go, MIT): <https://github.com/ViSiON-3/vision-3-bbs>
- ENiGMA½ (Node.js): <https://github.com/NuSkooler/enigma-bbs>
- Art archive: <https://16colo.rs/>

## 2. Claude Code mod API (v2.1.287, early access)

- **Network:** `$.http.fetch(url, init)` → `{status, ok, headers, text}`. The body is buffered (no streaming), and there is no WebSocket or SSE.
- **Processes:** `$.process.spawn({argv, input})` streams stdout. Stdin is written once and then closed. CLI only.
- **Panes:**
  - `$.ui.open({id, title, rows, columns, focus})`.
  - An automatic (unasked) open only appears from 144 columns, or 110 if the person opened it before. An open the person triggered (e.g. `/bbs`) appears at any width.
  - The person focuses a pane with ctrl+x tab or a click; Esc returns the keys.
- **Elements:**
  - Terminal elements: `Box, Text, Button, Input, Select, Link, Code, Markdown, Client, Raster, Image`.
  - `Client` modules get raw keys (`surface.onKey`), `every(ms)`, and `post()` to the hooks module.
  - `Raster` draws a cell grid up to 512×256: base64 `[codePoint, fg 0xRRGGBB, bg]` u32 triplets, with at most 1024 distinct color pairs. `$.ui.blit` repaints up to about 60/s.
  - Raw ANSI escape codes are refused in text.
- **Timers:** `$.clock.every / after / sleep`. Timers are dropped on hot reload, so start them from `session.start`.
- **State:**
  - `$.state` lasts for the session and survives hot reload.
  - `$.store` is a persistent plaintext JSON file (4 MiB).
  - `userConfig` fields marked sensitive go to secure storage, but there is no runtime API for writing them.
- **Events:** `turn.start`, `turn.complete` (with `agentId` absent on the main loop), `tool.call`, `session.start`.
- **Crypto:** only `subtle.digest`, `randomUUID` and `getRandomValues`, so no Ed25519 without a vendored library.
- **Tests:** `claude plugin test`, `*.test.ts` importing from `'claude-code/testing'`. Network and process calls are answered by hooks registered in the test.

## 3. Cloudflare

- **Free plan (verified 2026-10-02):**
  - Workers: 100k requests/day, 10 ms CPU per request; over the limit returns error 1027 (or fails open). <https://developers.cloudflare.com/workers/platform/limits/>
  - Durable Objects (SQLite-backed only on Free): 100k requests/day, 13k GB-s/day duration, 5M rows read/day, 100k rows written/day, 5 GB total. Over the limit, operations fail. Limits reset at 00:00 UTC. <https://developers.cloudflare.com/durable-objects/platform/pricing/>
  - R2: 10 GB storage, 1M Class A and 10M Class B operations per month, no egress fees.
- **Paid plan ($5/mo):** 10M Worker requests and 1M DO requests per month included. Incoming WebSocket messages bill at 20:1.
- **Hibernation:** a hibernated WebSocket isn't billed for duration. A DO holding an SSE stream or long-poll stays awake.
- **Throughput:** about 500–1,000 simple requests/s per DO. Shard by "atom of coordination".
- **Rate limiting binding:** counted per location and only roughly accurate. Use DO-side token buckets for exact limits.
- **Security:**
  - Strip C0/C1 control characters and escape sequences from all user text on the server.
  - BBS content must never enter the model's context (prompt injection).
