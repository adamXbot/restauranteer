# Contributing

## Toolchain

The package manager is **pnpm**, pinned by `packageManager` in `package.json`;
npm and yarn are not supported here. The Node version comes from `.nvmrc`, and
CI reads both files rather than hard-coding versions, so bumping either is a
one-line change.

```bash
corepack enable
pnpm install
```

## Commands

```bash
pnpm dev              # dev server on http://localhost:3000, bound to 0.0.0.0
pnpm check            # svelte-kit sync && svelte-check
pnpm check:watch      # the same, watching
pnpm test             # vitest run
pnpm test:watch       # vitest in watch mode
pnpm build            # production build via @sveltejs/adapter-node
pnpm start            # run the production build (node build)
pnpm preview          # vite preview
pnpm export-fixtures  # regenerate the golden fixtures in fixtures/
```

There is a `justfile` wrapping the common ones — `just setup`, `just test`,
`just lint`, `just build`, `just run`, and `just release <version>`.

The dev server needs the same `.env` as the container. `VAULT_PATH` defaults to
`./data` outside Docker, so point it at a scratch vault rather than a real one
while you work. See [docs/CONFIGURATION.md](docs/CONFIGURATION.md).

## Building the container locally

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

The override sets `build: .` and tags the result `restauranteer:local`. The base
compose file joins an external Docker network named `proxy` (it carries Traefik
labels), so create that network first if you do not already run Traefik:
`docker network create proxy`.

## What CI runs

`.github/workflows/docker-publish.yml` triggers on pushes to `main`, on `v*`
tags, on pull requests, and manually. It has three stages:

1. **quality** — `pnpm install --frozen-lockfile`, then `pnpm check`,
   `pnpm test`, `pnpm build`, then `docker compose config` against both compose
   files to catch YAML and variable errors.
2. **container-smoke** — builds the image, runs it with a scratch vault mounted
   at `/data`, and polls `/health` until it answers.
3. **build-and-push / publish-manifest** — skipped on pull requests. Builds
   `linux/amd64` and `linux/arm64` on separate runners, pushes by digest to
   `ghcr.io/adamxbot/restauranteer`, assembles a multi-arch manifest, and
   attests build provenance.

A pull request therefore gets the full check, test, build and container smoke
test, but publishes nothing.

## Tests

Vitest, configured in `vitest.config.ts`. The suites live in `tests/`:

- `tests/vault/` — frontmatter, three-way merge, visit blocks, notes, share
- `tests/providers/` — the scraper adapters and the Google Maps URL resolver
- `tests/sync/` — sync auth, path allowlisting, tombstones, the HTTP surface
- top level — geo, dates, dedup, attributes, preferences, theme, manifest,
  featured image, visit sorting, fixture export

`fixtures/` holds generated golden fixtures that pin the exact byte-level
behaviour of the vault file format, so a Swift port can be tested against the
same bytes. **Do not hand-edit that tree** — regenerate it with
`pnpm export-fixtures`. `fixtures/README.md` explains which production modules
feed it.

## Layout

```
src/
├── app.html, app.css        # global shell and Markdown body styles
├── hooks.server.ts          # boots the vault watcher and reconciler; sync auth guard
├── lib/
│   ├── *.ts                 # shared client helpers — geo, cuisine, dates, theme,
│   │                        #   share, navigation, image resize, offline visit queue,
│   │                        #   PhotoSwipe, service-worker cache, map SDK loaders
│   ├── components/          # Svelte UI components
│   └── server/
│       ├── config.ts        # env → vault paths, index path, log level
│       ├── db/              # SQLite schema (incl. FTS5) and queries
│       ├── images.ts        # sharp pipeline
│       ├── inbox.ts         # shared-item inbox
│       ├── preferences.ts   # preferences file in the vault root
│       ├── providers/
│       │   ├── google.ts    # Places (New) client
│       │   ├── apple.ts     # MapKit JS JWT signer (ES256 via jose)
│       │   ├── cache.ts     # forever cache with manual refresh
│       │   ├── mapsResolver.ts
│       │   └── scraper/     # fetcher, parser, per-site adapters, generic link, registry
│       ├── sync/            # auth, path allowlist, manifest, files, tombstones, pairing
│       └── vault/           # watcher, reader/writer, frontmatter, merge, MOC,
│                            #   visits, filenames, reconciler, importers
└── routes/                  # SvelteKit file-based routing (see docs/ARCHITECTURE.md)
```

`scripts/` holds the fixture exporter plus the icon and splash generators.

## Releases

`just release <version>` tags `v<version>` and pushes the tag, which is what
triggers the semver-tagged image publish. There are no published releases yet
and the version in `package.json` is `0.1.0`, so treat every change as
potentially breaking and say so in the commit message.
