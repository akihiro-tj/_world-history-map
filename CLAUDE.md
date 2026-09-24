# world-history-map Development Guidelines

## Project Structure

```text
apps/
  frontend/     # React frontend (MapLibre GL JS + react-map-gl + PMTiles)
  pipeline/     # CLI data pipeline (Node.js, @turf/turf, tippecanoe)
  worker/       # Cloudflare Pages project config + Pages Functions (R2 tile serving)
packages/
  tiles/        # Internal workspace package — hashed PMTiles build + manifest generation
```

## Commands

```bash
# Frontend development
pnpm dev                    # Start Vite dev server (runs tiles build first via predev)
pnpm build                  # Type-check and build frontend
pnpm storybook              # Start Storybook on port 6006

# Quality gates (run before merge)
pnpm test && pnpm check && pnpm typecheck
pnpm verify                 # typecheck + biome check (no tests)
pnpm format                 # biome format --write .

# Pipeline (data)
pnpm pipeline <subcommand>  # Subcommands: run | status | list | fetch | merge | validate | convert | index | territory-sync | territory-validate
pnpm pipeline run --year 1600          # Process a single year
pnpm pipeline run --years 1600..1800   # Process a year range
pnpm territory-sync         # Sync territory descriptions from Notion

# Cloudflare Pages (apps/worker/wrangler.toml)
pnpm --filter @world-history-map/worker run dev      # wrangler pages dev (needs `pnpm build` first)
pnpm --filter @world-history-map/worker run deploy   # wrangler pages deploy (normally done by CI)

# Tiles package
pnpm --filter @world-history-map/tiles run build          # Hash PMTiles → dist/ + update manifest.ts
pnpm --filter @world-history-map/tiles run build:check    # Verify manifest.ts is up to date (CI gate)
pnpm --filter @world-history-map/tiles run test           # Run tiles unit tests
```

## Key Documents

- `docs/overview.md`: Living architecture entry point. Start here for overall structure and cross-app data flow
- `docs/{pipeline,frontend,worker}.md`: Per-app deep dives; each is independently readable for the app it covers
- `DESIGN.md`: Design application rules (color usage, surface treatment, layout principles, Do/Don't). **Read this before creating or changing any UI** so generated screens stay consistent. The `colors` frontmatter is the source of truth for the design's color tokens; `theme.css` (Tailwind `@theme`) and `role-colors.generated.ts` (MapLibre) are generated from it via `@world-history-map/design-tokens` (`pnpm --filter @world-history-map/design-tokens run build`; CI's `build:check` guards drift). The prose body — including type/spacing/radii, which ride the framework defaults — is hand-written
- `.specify/memory/constitution.md`: Project constitution (ratified). Five principles govern change — consult before planning features

## Code Style

- Directory and file names: kebab-case (e.g., `year-selector.tsx`, `use-map-state.ts`)
- Frontend path alias: `@/` → `apps/frontend/src/`
- Biome enforces formatting (2-space, single quotes, line width 100) and lint rules (no `any`, import type, no unused)

## Product Vision

### Target Users
World history learners (high school students, university students, self-learners)

### Problems to Solve
1. **Vertical connections**: Textbooks split history by era (ancient/medieval/modern), fragmenting a country's continuous narrative across chapters. This app lets users track a specific territory's history as a continuous timeline.
2. **Horizontal connections**: Understanding what was happening simultaneously across the world requires cross-referencing textbooks with atlases, which is tedious. This app shows the entire world at any given year on a single interactive map.
3. **Geographic knowledge**: Memorizing locations of mountains, rivers, and cities from text alone is difficult. This app aims to make geographic learning natural through visual, interactive exploration.

### Core Value
An interactive world history map that makes spatial and temporal understanding of history intuitive — replacing the tedious textbook-atlas cross-referencing workflow with a single, explorable interface.

## Language Rules

- Code (comments, log messages, variable names): English
- Documentation (`CLAUDE.md`, `README.md`, etc.): English
- Specification documents under `specs/` (`spec.md`, `plan.md`, `tasks.md`, `clarifications.md`, etc.): body text in Japanese; section headings and technical terms (API names, type names, etc.) stay in English. When filling speckit templates, preserve the English headings and translate only the body
  - This applies to **task descriptions in `tasks.md`** as well: write each task's description in Japanese, keeping file paths, identifiers (function / type / property / constant names), library names, CLI invocations, and the `[ID] [P?] [Story?]` markers in English. Don't slip into English just because tasks read like commands.
- Skills (`.claude/skills/`): Japanese

## Specification Management

`specs/` and `docs/` flow in opposite directions:

- `specs/NNN-feature-name/`: Specs that drive implementation (spec → implementation). Japanese, generated by speckit; archived once the feature ships and not retroactively edited
- `docs/`: Living documentation generated from the current codebase (implementation → documentation). Entry point `overview.md` plus per-app detail files (`pipeline.md`, `frontend.md`, `worker.md`)

## Workflow

Features move through: **specify → clarify → plan → tasks → implement → verify → review → merge → update-doc**.

- Use speckit slash commands (`/speckit-specify`, `/speckit-plan`, `/speckit-tasks`, `/speckit-implement`) to generate the chain of artifacts under `specs/NNN-feature-name/`
- Any change that invalidates the living docs in `docs/` MUST be reflected via `/update-doc` before merging (constitution: Living Documentation)

## Gotchas

- **Pipeline is incremental**: State lives in `.cache/pipeline-state.json`; only years whose source hash changed are reprocessed. Delete the file to force a full rebuild
- **Tile URL differs by environment**:
  - Dev: `pmtiles:///pmtiles/world_{year}.{hash}.pmtiles` (vite middleware → `packages/tiles/dist/`)
  - Preview / Prod: same-origin `pmtiles:///pmtiles/...` → Pages Function `apps/worker/functions/pmtiles/[file].ts` → R2 `world-history-map-tiles-dev` (preview) / `world-history-map-tiles-prod` (production)
  - manifest is **build-time embedded** via `@world-history-map/tiles` import — no runtime fetch
- **Deployment is automated via CI**: PR → DEV upload + Pages preview deploy; main merge → PROD upload + Pages production deploy (`wrangler pages deploy`, project auto-created on first run)
- **Types are duplicated across apps**: `apps/pipeline` and `apps/frontend` each define `TerritoryDescription`, `YearEntry`, etc. independently — there is no shared package. The JSON files in `public/data/` are the de-facto schema contract. Keep both sides in sync when changing shape
- **Territory lookup is kebab-case**: GeoJSON `NAME` property is converted to kebab-case before indexing into `descriptions/{year}.json`
- **All Cloudflare settings live in `apps/worker/wrangler.toml`**: Pages is a Direct Upload project (no Git integration / dashboard build settings). Only the R2 buckets and the GitHub secrets `CLOUDFLARE_API_TOKEN` (Cloudflare Pages: Edit + Workers R2 Storage: Edit) / `CLOUDFLARE_ACCOUNT_ID` are set up outside git
