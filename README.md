# claude-code-bbs: lATeNt sPaCE

A BBS in the style of Vision-X and Oblivion/2 that lives in a Claude Code pane, for reading while Claude works. There is one global board for everyone who installs the plugin, and it runs on Cloudflare Workers, Durable Objects, D1 and R2 within the free plan.

```
 █    ▄▀▀▄ ▀██▀ █▀▀▀ █▄ █ ▀██▀    ▄▀▀▀ █▀▀▄ ▄▀▀▄ ▄▀▀▀ █▀▀▀
 █    █▀▀█  ██  █▀▀  █ ▀█  ██      ▀▀▄ █▀▀  █▀▀█ █    █▀▀
 ▀▀▀▀ ▀  ▀  ▀▀  ▀▀▀▀ ▀  ▀  ▀▀     ▀▀▀  ▀    ▀  ▀  ▀▀▀ ▀▀▀▀
```

Type `/bbs` to dial in. Use ctrl+x tab to give the pane the keys and Esc to hand them back. Phase 1 has a matrix screen, new-user application, logon sequence, one-liners, anonymous rumors, last callers, who's online (with what each caller's Claude is doing, coarse: "running Bash"), stats and a status bar.

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
2. `cd server && npx wrangler d1 create latent-space`, then put the printed id in `wrangler.jsonc`.
3. `npx wrangler r2 bucket create latent-space-feed`, then attach the custom domain `feed.mattfogel.com` to it in the dashboard and add a cache rule that caches everything on that host and respects origin `Cache-Control`.
4. Uncomment the `routes` block in `wrangler.jsonc`. Under Workers, set "fail closed" for the free-plan limit.
5. `npm run deploy -- --env production` (applies the D1 migrations and deploys).
6. Register through the mod, then make yourself sysop:
   `npx wrangler d1 execute latent-space --remote --command "UPDATE users SET role = 'sysop' WHERE handle = 'mattf'"`.
