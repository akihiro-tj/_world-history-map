# world-history-map

## Development

See [`docs/overview.md`](./docs/overview.md) for architecture and [`CLAUDE.md`](./CLAUDE.md) for detailed guidelines.

### Repository layout

```text
apps/
  frontend/   # React app (MapLibre GL JS + react-map-gl + PMTiles)
  pipeline/   # CLI data pipeline (Node.js, @turf/turf, tippecanoe)
  worker/     # Cloudflare Pages project config + Pages Functions (R2 tile serving)
packages/
  tiles/          # Hashed PMTiles build + manifest generation
  design-tokens/  # Design token build (theme.css / MapLibre role colors)
```

pnpm workspaces on Node.js 26. The pnpm version is pinned via the `packageManager` field and enforced by the `engines` range; the Nix dev shell (below) provides both Node.js and pnpm directly.

### Development environment (Nix)

System tools — notably `tippecanoe` / `tile-join` for the data pipeline and the `specify` CLI for the spec-kit workflow — along with Node.js and pnpm are provided by a Nix flake dev shell, so they don't need to be installed globally (e.g. via Homebrew).

Prerequisites:

- Nix with flakes enabled (`experimental-features = nix-command flakes`)
- direnv + nix-direnv (recommended, for automatic activation)

With direnv, allow the directory once and the shell is entered automatically on `cd`:

```bash
direnv allow
```

Without direnv:

```bash
nix develop
```

Inside the shell, `node` and `pnpm` come from the flake (`nodejs_26` / `pnpm_11`), matching the versions pinned in `package.json`.

> `op` (1Password CLI) is used by `pnpm territory-sync` to read Notion credentials and is intentionally **not** bundled in the flake — it relies on the 1Password desktop app integration. Install it on your system if you sync territory descriptions.

### Common commands

#### Frontend

```bash
pnpm dev          # Vite dev server (builds tiles first via predev)
pnpm build        # Type-check and build
pnpm storybook    # Storybook on port 6006
```

#### Quality gates

```bash
pnpm test && pnpm check && pnpm typecheck
pnpm verify       # typecheck + biome check (no tests)
pnpm format       # biome format --write .
```

#### Pipeline (data)

```bash
pnpm pipeline run --year 1600          # Process a single year
pnpm pipeline run --years 1600..1800   # Process a year range
pnpm territory-sync                    # Sync territory descriptions from Notion
```

#### Cloudflare Pages

```bash
pnpm --filter @world-history-map/worker run dev      # wrangler pages dev (needs `pnpm build` first)
pnpm --filter @world-history-map/worker run deploy   # wrangler pages deploy (normally done by CI)
```

#### Tiles

```bash
pnpm --filter @world-history-map/tiles run build         # Hash PMTiles → dist/ + manifest.ts
pnpm --filter @world-history-map/tiles run build:check   # CI gate: verify manifest is current
```
