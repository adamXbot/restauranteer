<p align="center">
  <img src="static/favicon.svg" alt="Restauranteer icon" width="96" height="96">
</p>

<h1 align="center">Restauranteer</h1>

<p align="center">A self-hosted restaurant journal that keeps everything you know about a place in a Markdown vault you own.</p>

<p align="center">
  <a href="https://github.com/adamXbot/.github/blob/main/STATUS.md#restauranteer"><img src="https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2FadamXbot%2F.github%2Fmain%2Fbadges%2Frestauranteer.json" alt="Project status"></a>
  <a href="https://github.com/adamXbot/restauranteer/actions/workflows/docker-publish.yml"><img src="https://img.shields.io/github/actions/workflow/status/adamXbot/restauranteer/docker-publish.yml?branch=main&label=ci" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/adamXbot/restauranteer?label=licence" alt="Licence"></a>
</p>

<!-- disclosure:start -->
> [!WARNING]
> **Pre-1.0 — no stable release yet.** Anything can change in any release, including a patch: APIs, CLI flags, config keys, file formats, and data already on disk. Keep your own backups.
> **Project status.** The badge above is generated from [the adamXbot status list](https://github.com/adamXbot/.github/blob/main/STATUS.md), which says what I promise for this project and every other one.
<!-- disclosure:end -->

---

Restauranteer gathers everything you know about a restaurant into one place: Google place details, map links, local review sites, articles, and whatever else you want to save. Add restaurants by searching Google Places, or paste a URL and let the server work out what it is.

The server keeps every restaurant synced as Markdown, so the vault opens natively in Obsidian or any other Markdown app. Markdown is the source of truth; the SQLite index is derived and can be deleted at any time. It runs in Docker, installs to a phone home screen as a PWA, and works remotely over Tailscale.

Built for a single user. The discovery scrapers are aimed at Australian cities, but the Markdown vault and Google Places parts work anywhere.

## What it does

- **Search Google Places** with autocomplete biased to your current location, and add a result to the vault in one tap.
- **Paste any URL** on `/discover`. Dedicated adapters cover Broadsheet, Good Food (via The Age / SMH), AGFG, Time Out, Google Maps and Apple Maps; anything else is kept as a labelled source link.
- **Merge instead of duplicate.** On import the server fuzzy-matches by name and coordinates against the vault, so a likely match offers a merge picker and one restaurant can carry several sources.
- **Inbox** at `/inbox` collects items shared from another device — the iOS share extension writes `Inbox/*.md` into the vault — to attach to an existing restaurant or turn into a new one.
- **Near me and map views** over Mapbox GL, Apple MapKit JS or Google Maps JS, chosen in Settings.
- **Visits** as structured entries: date, meal, companions, notes, ratings, camera capture. Photos are resized client-side, recompressed with sharp, and written into `Restaurants/_attachments/{slug}/`. Visits recorded offline queue in IndexedDB and flush when the network returns.
- **Lists and tags.** Lists regenerate Obsidian MOC notes under `Restaurants/_Lists/`, so the same browsing works inside Obsidian.
- **Sync API** (`/api/sync/*`) for a companion client. Disabled until you set `RESTAURANTEER_SYNC_TOKEN`, then bearer-authenticated.

## Get it

You need Docker and a folder to use as the vault.

```bash
git clone https://github.com/adamXbot/restauranteer.git
cd restauranteer
cp .env.example .env
```

Edit `.env`. Only `VAULT_HOST_PATH` is required — the host path of the vault folder, mounted as `/data` in the container. `GOOGLE_PLACES_API_KEY` is what makes search, photos and place details work, and at least one map provider key is needed for `/map` and `/near`. See [docs/CONFIGURATION.md](docs/CONFIGURATION.md) for every variable and for the Mapbox, Google and Apple setup walkthroughs.

`docker-compose.yml` ships with Traefik labels and joins an external network called `proxy`. If you do not already run Traefik, create the network first so compose can attach to it:

```bash
docker network create proxy
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

That builds the image locally, which is the path that works today. CI publishes multi-arch images to `ghcr.io/adamxbot/restauranteer` on every push to `main` and every `v*` tag, but anonymous pulls of that package are currently refused, so pulling needs `docker login ghcr.io` and `RESTAURANTEER_IMAGE=ghcr.io/adamxbot/restauranteer:latest` in `.env`.

On first boot the server creates `Restaurants/`, `Restaurants/_Lists/` and `Restaurants/_attachments/` inside the vault, creates the SQLite index at `.restauranteer/index.db`, and starts the file watcher with a full reconcile.

Open `http://localhost:3000`, or the machine's hostname from another device. On an iPhone, **Add to Home Screen** in Safari installs it as a PWA.

Do not expose Restauranteer directly to the public internet — it writes real files into the mounted vault. See [SECURITY.md](SECURITY.md) and the remote-access notes in [docs/CONFIGURATION.md](docs/CONFIGURATION.md).

## Docs

There is no docs site. Everything lives in the repo:

- [docs/CONFIGURATION.md](docs/CONFIGURATION.md) — every environment variable, map-provider setup, remote access, data and privacy.
- [docs/SELF-HOSTING.md](docs/SELF-HOSTING.md) — recipes for Synology, TrueNAS, Unraid, Portainer and friends.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — how the vault layer works, the route and API surface, supported paste-URL forms, known limitations.
- [docs/sync-api.md](docs/sync-api.md) — the file-level sync protocol, with a curl walkthrough.
- [docs/mac-shared-vault.md](docs/mac-shared-vault.md) — running the server on a Mac against the iOS app's iCloud vault.
- [SECURITY.md](SECURITY.md) — the threat model and how to report a vulnerability.

## Contributing

The package manager is pnpm, pinned by `packageManager` in `package.json`; Node comes from `.nvmrc`. Everything the CI workflow runs is available locally:

```bash
pnpm install
pnpm dev      # http://localhost:3000
pnpm check    # svelte-kit sync && svelte-check
pnpm test     # vitest run
pnpm build    # production build via @sveltejs/adapter-node
```

`.github/workflows/docker-publish.yml` runs `pnpm check`, `pnpm test` and `pnpm build`, validates the compose files, then builds the image and smoke-tests `/health` in a container before publishing. There is a `justfile` wrapping the same commands. [CONTRIBUTING.md](CONTRIBUTING.md) has the fuller setup, the layout of `src/`, and how a release is cut.

## Licence

[MIT](LICENSE).
