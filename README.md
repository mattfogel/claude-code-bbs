# claude-code-bbs: lATENT sPACE

A BBS in the style of Vision-X and Oblivion/2 that lives in a Claude Code pane, for reading while Claude works. There is one global board for everyone who installs the plugin, and it runs on Cloudflare Workers, Durable Objects, D1 and R2 within the free plan.

```
 █    ▄▀▀▄ ▀██▀ █▀▀▀ █▄ █ ▀██▀    ▄▀▀▀ █▀▀▄ ▄▀▀▄ ▄▀▀▀ █▀▀▀
 █    █▀▀█  ██  █▀▀  █ ▀█  ██      ▀▀▄ █▀▀  █▀▀█ █    █▀▀
 ▀▀▀▀ ▀  ▀  ▀▀  ▀▀▀▀ ▀  ▀  ▀▀     ▀▀▀  ▀    ▀  ▀  ▀▀▀ ▀▀▀▀
```

Type `/bbs` to dial in. Use ctrl+x tab to give the pane the keys and Esc to hand them back. It has a matrix screen, new-user application, logon sequence, message bases (base change, threads, an Obv/2-style reader, the classic line editor, newscan), one-liners, anonymous rumors, a voting booth, Top Ten, last callers, who's online (with what each caller's Claude is doing, coarse: "running Bash"), stats and a status bar.

Design: [docs/design.md](docs/design.md). Background: [docs/research.md](docs/research.md).

## Layout

| Path | What |
|---|---|
| `plugin/` | The Claude Code mod: hooks module, Client surface module, shared parser and protocol |
| `server/` | Cloudflare Worker (Hono), Hub Durable Object, D1 migrations |
| `test/` | Node unit tests for `plugin/shared` and `plugin/client` |
| `scripts/screens.ts` | Prints every screen in truecolor |

## Develop

```sh
npm install && npm --prefix server install   # .npmrc sets legacy-peer-deps (npm arborist bug)
npm run test:unit                            # parser, protocol, screen state machine
npm --prefix server test                     # Worker + Durable Object + D1 under Miniflare
claude plugin test plugin                    # the mod against the engine, with a fake board
claude plugin validate plugin
bun scripts/screens.ts 80 24                 # look at the art
bun scripts/palettes.ts > palettes.html      # compare color palettes on the real screens
bun scripts/screens.ts 80 24 --pipe | bun scripts/shot.ts > screens.html   # the screens as HTML, in the board palette
```

To try the mod against a local server:

```sh
cd server && npm run migrate:local && npm run dev      # http://localhost:8787, serves /feed/hub.json
claude --plugin-dir plugin
```

Then point the plugin at the dev server in `~/.claude/settings.json`:

```json
{ "pluginConfigs": { "latent-space": { "options": { "apiUrl": "http://localhost:8787", "feedUrl": "http://localhost:8787/feed/hub.json" } } } }
```

## Deploy (once)

1. Add the `mattfogel.com` zone to the Cloudflare account.
2. `cd server && npx wrangler d1 create latent-space`, then put the printed id in both `d1_databases` entries in `wrangler.jsonc` (top level and `env.production`).
3. `npx wrangler r2 bucket create latent-space-feed`, then attach the custom domain `feed.mattfogel.com` to it in the dashboard and add a cache rule (zone → Caching → Cache Rules) that caches everything on that host and respects origin `Cache-Control`.
4. Check that `env.production` in `wrangler.jsonc` has the right D1 id and routes. `bbs.mattfogel.com` is a custom domain, so it already fails closed (error 1027) when it hits the free-plan limit. There is no toggle to set.
5. `npm run deploy` (applies the D1 migrations and deploys the `production` environment; never run a bare `wrangler deploy`, which would stand up a second Worker on the same database and bucket).
6. Register through the mod, then make yourself sysop:
   `npx wrangler d1 execute latent-space --remote --command "UPDATE users SET role = 'sysop' WHERE handle = 'mattf'"`.

## Sysop chores

Once your account is sysop (step 6 above), press `*` on the main menu for the sysop menu: conferences, polls, the message of the day, and ban, unban or mute. It's hidden; for everyone else `*` does nothing. The same changes as `curl` calls, with your secret (the `account.secret` value the mod keeps in its `$.store`):

```sh
B=https://bbs.mattfogel.com/v1; A="Authorization: Bearer $SECRET"; J="content-type: application/json"
curl -sH "$A" -H "$J" $B/mod/poll -d '{"question":"Which modem did you have first?","options":["2400","14.4k","US Robotics Courier"]}'
curl -sH "$A" -H "$J" $B/mod/poll/close -d '{"id":1}'
curl -sH "$A" -H "$J" $B/mod/conference -d '{"slug":"demoscene","name":"Demoscene","sponsor":"mattf","n":5}'
curl -sH "$A" -H "$J" $B/mod/motd -d '{"text":"|13welcome to |15lATENT sPACE"}'
curl -sH "$A" -H "$J" $B/mod/delete -d '{"kind":"post","conference":"general","id":12}'
```
