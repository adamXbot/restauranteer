<p align="center">
  <img src="static/favicon.svg" alt="Restauranteer icon" width="96" height="96">
</p>

# Restauranteer

Restauranteer is a self-hosted restaurant companion app that gathers everything you know about a restaurant into one place: Google place details, Apple or Google map links, local review sites, Instagram posts, articles, and whatever else you want to save. Add restaurants manually or from supported sources, then browse your saved list when you are deciding where to go.

The server keeps every restaurant synced as Markdown, perfect for Obsidian or any other Markdown app. It runs in Docker, is easy to deploy on Synology, TrueNAS, Unraid, or a small VPS, installs to your phone home screen as a PWA, and works remotely over Tailscale.

Built for a single user and designed around Australian cities, but the Markdown vault and Google Places parts work anywhere.

## Quickstart

Requires Docker. The published image is available on Docker Hub at [`adamxbot/restauranteer`](https://hub.docker.com/r/adamxbot/restauranteer).
The container is single-user; everything writes into a vault folder you control.

```bash
git clone <this-repo> restauranteer
cd restauranteer
cp .env.example .env
```

Edit `.env` — only one variable is strictly required:

```bash
# REQUIRED — where your Obsidian vault lives on the host.
VAULT_HOST_PATH=/Users/you/Documents/Obsidian/MyVault

# Recommended — search, photos, place details, nearby search, Google Maps URL
# resolution all need this (server-side only, not exposed to the browser).
GOOGLE_PLACES_API_KEY=...

# At least one map provider — pick the one you prefer in Settings → Map provider.
# All three can coexist if you want to switch later.
MAPBOX_PUBLIC_TOKEN=pk.eyJ...                    # /map and /near, Mapbox
GOOGLE_MAPS_PUBLIC_KEY=AIza...                   # /map and /near, Google (referrer-restricted)
# APPLE_MAPKIT_TEAM_ID, APPLE_MAPKIT_KEY_ID, APPLE_MAPKIT_PRIVATE_KEY  # /map and /near, Apple

# Optional (enables "Open in Obsidian" deep-link buttons)
OBSIDIAN_VAULT_NAME=MyVault
```

Then:

```bash
docker compose pull
docker compose up -d
```

The default compose file pulls the multi-arch image for `linux/amd64` and `linux/arm64`.
Set `RESTAURANTEER_IMAGE=adamxbot/restauranteer:vX.Y.Z` in `.env` to pin a version (default is `:latest`); use a different repo string to run a fork.

Open `http://localhost:3000` (or your machine's hostname from another device) and **Add to Home Screen** in Safari on the iPhone to install as a PWA.

The first boot will:
- Create `Restaurants/`, `Restaurants/_Lists/`, `Restaurants/_attachments/` inside your vault
- Create `.restauranteer/index.db` (SQLite index, alongside the vault)
- Start the file watcher and run a vault reconcile

### Self-hosted platforms

The compose file is portable — these are quick recipes for the common NAS / homelab UIs. They all share the same `.env` from above; only `VAULT_HOST_PATH` changes to match the platform's path convention.

**Synology DSM 7.2+ (Container Manager)**
1. File Station → create `/docker/restauranteer`; upload `docker-compose.yml` and `.env` into that folder. Edit `.env` so `VAULT_HOST_PATH=/volume1/obsidian/MyVault` (or wherever your vault lives on the NAS).
2. Container Manager → **Project** → Create → name `restauranteer`, path `/docker/restauranteer`, source "Use existing docker-compose.yml" → Build.
3. Open `http://<nas-ip>:3000`. If port 3000 is taken, change the host side of `"3000:3000"` in `docker-compose.yml`.

**TrueNAS SCALE 24.10+ / HexOS**
SCALE switched from K3s/Helm to Docker in Electric Eel (24.10), so this compose file runs natively. HexOS is a UI on top of TrueNAS and uses the same dataset paths.
1. Create a dataset for the app config (e.g. `tank/apps/restauranteer`) and ensure your vault dataset exists (e.g. `tank/obsidian/MyVault`).
2. SSH in, drop `docker-compose.yml` + `.env` into `/mnt/tank/apps/restauranteer`, set `VAULT_HOST_PATH=/mnt/tank/obsidian/MyVault`, then `cd` there and `docker compose up -d`.
3. The Apps UI has a "Custom App" form, but it uses TrueNAS's own schema rather than raw compose — SSH is the simplest path for an unmodified compose file.

**Unraid 6.12+ (Docker Compose Manager plugin)**
1. Community Applications → install **Docker Compose Manager**.
2. Add a new stack → paste `docker-compose.yml` + `.env`. Set `VAULT_HOST_PATH=/mnt/user/obsidian/MyVault` (or your share path).
3. **Compose Up**. The container appears in the regular Docker tab once it's running.

**CasaOS / Dockge / Portainer (any Docker host)**
Each has a "paste a compose YAML" form:
- **CasaOS:** App Store → **Custom Install** → paste the YAML and fill the env fields → Install.
- **Dockge:** Compose → New Stack → paste `docker-compose.yml` and `.env` → Deploy.
- **Portainer:** Stacks → Add stack → **Web editor**, paste compose, add the env vars in the UI → Deploy.

In all three, `VAULT_HOST_PATH` must be an absolute path the Docker daemon itself can see (a bind-mounted host folder, not a Portainer-managed named volume — otherwise Obsidian on your desktop / phone can't reach the files).

**YunoHost**
YunoHost is Debian + a curated app catalogue and doesn't ship Docker by default — there's no first-class Restauranteer package, but you can run it alongside YunoHost apps:
1. SSH in and install Docker yourself: `sudo apt install docker.io docker-compose-v2`.
2. Follow the Quickstart above in any folder (e.g. `/home/yunohost.app/restauranteer`).
3. Install YunoHost's **Custom Webapp** app and configure it to reverse-proxy `http://127.0.0.1:3000` onto a subdomain — YunoHost then handles Let's Encrypt SSL (and, if you want, SSO) in front. Keep Restauranteer bound to `127.0.0.1` rather than `0.0.0.0` if you don't want it directly reachable on the LAN.

## What it does

- **Search** restaurants on Google Places (autocomplete biased to your current location) and add them to your vault with one tap.
- **Discover** by browsing Broadsheet or Good Food / The Age / SMH city sections, or paste any URL from those sites + AGFG + Google Maps to import the restaurant.
- **Smart dedup on import** — when you paste a URL, the server fuzzy-matches by name + coords against your vault. If a candidate looks like the same place, you get a "merge into existing?" picker instead of a duplicate entry. Google Maps URLs merge Google data into the existing restaurant; article URLs append as a source. Multiple sources per restaurant — one Cumulus Inc with Broadsheet + Good Food + Google data attached.
- **Near me** drops a pin (your location or anywhere on the map) and lists restaurants within a radius, filterable by cuisine, rating, and tags. Optionally augments your vault with Google Nearby Search results.
- **Three map providers** — choose Mapbox, Apple MapKit JS, or Google Maps JS in Settings. The `/map` and `/near` views render with the chosen engine. Falls back gracefully when the picked provider's key isn't set.
- **Navigate button** — opens directions to a restaurant in either Apple Maps or Google Maps (your pick in Settings). Builds the right URL scheme for each app.
- **Share button** — every article card has a Share button. iOS Safari gets the native share sheet (Messages, AirDrop, Copy Link); other browsers fall back to clipboard with visual confirmation.
- **Lists** — a restaurant can be on multiple. Auto-regenerates Obsidian MOC notes under `Restaurants/_Lists/` so you can browse natively in Obsidian.
- **Tags** — chip editor, stored in frontmatter.
- **Visits** — structured form (date, meal, vibe, food, quality, service, rating, free notes, **companions** "With" line) plus camera capture. Photos client-side resized to 1600px, server-side compressed via sharp, written to `Restaurants/_attachments/{slug}/`.
- **Per-area star ratings (optional)** — toggle in Settings. When on, the visit form shows star pickers for Vibe / Food / Quality / Service and computes their average. Off (default), it's one overall rating.
- **Offline visit queue** — if you're offline at the restaurant, visits are stored in IndexedDB and flushed when the connection comes back. An amber banner at the top of every page shows the pending count + manual sync.
- **PhotoSwipe lightbox** — tap any photo (Google place photos or your own visit photos) to view full-resolution in a swipeable gallery.
- **Markdown body renderer** with `_attachments/` URL rewriting and `[[wikilinks]]` rendered as italics.
- **Infinite cache** for Google + scraped pages, with per-page or global manual refresh. Settings page also exposes offline service-worker caches so you can clear photo / restaurant-detail caches on the device.

---

## Technical stuff

Everything from here on is implementation detail — architecture, env reference, map-provider setup, routes, the storage model, known limitations. Skip if you just want to use the app; come back when you need to debug, self-host beyond the basics, or hack on the code.

## How it works

```
iPhone Safari (PWA)
  │  HTTPS over your network / Tailscale
  ▼
SvelteKit (Node adapter) in Docker
  ├─ Vault layer: chokidar watcher + frontmatter parser + atomic writer + three-way merge
  ├─ SQLite index (better-sqlite3, FTS5) — rebuildable from a full vault scan
  ├─ Preferences (SQLite meta): map provider, navigation app, per-area ratings
  ├─ Place providers: Google Places (New) — search, details, nearby, photos
  ├─ Map renderers (one active per user choice): Mapbox GL, Apple MapKit JS, Google Maps JS
  ├─ Scrapers: Broadsheet, Good Food (via SMH/Age), AGFG — rate-limited polite fetcher
  ├─ Google Maps URL resolver: short URL → place ID via Places text search
  └─ Image pipeline (sharp), photo proxy (Google), attachment server, PhotoSwipe gallery
       ▲
       │ volume mount
/data (your Obsidian vault folder on the host)
  └─ Restaurants/, Restaurants/_Lists/, Restaurants/_attachments/
```

- **Markdown is canonical.** SQLite is a derived index that can always be rebuilt by scanning the vault.
- **Three-way merge** on save handles the case where Obsidian (mobile or desktop) edited the file while the app's form was open — frontmatter merges field-by-field using dirty-field tracking; body conflicts surface a "save as conflict copy" option named like Obsidian Sync's own convention.
- **Self-write echo suppression** in the watcher: when the app writes a file, it records the sha256 in an in-memory set with a 10s TTL. Watcher events with matching content are dropped so we don't re-index our own writes.
- **Burst-mode reconcile**: if the watcher sees >20 events in 2s (iCloud Sync storm), it suspends per-file indexing and runs a single bulk reconcile at quiet.
- **Tempfile-rename** atomic writes for both markdown and photos — crash mid-write leaves a clean state.

## Configuration reference

All env vars (in `.env`):

| Variable | Purpose | Required |
|---|---|---|
| `VAULT_HOST_PATH` | Host path to mount as `/data` inside the container | Yes |
| `VAULT_PATH` | Vault path inside the container | No (default `/data`) |
| `VAULT_SUBDIR` | Subdirectory inside the vault for restaurant files | No (default `Restaurants`) |
| `OBSIDIAN_VAULT_NAME` | Vault display name for `obsidian://open?vault=...` deep links | No |
| `GOOGLE_PLACES_API_KEY` | Google Places API (New) — search, details, nearby, photos. Server-only | No (recommended) |
| `MAPBOX_PUBLIC_TOKEN` | Mapbox GL token for the Mapbox map provider | No |
| `GOOGLE_MAPS_PUBLIC_KEY` | Google Maps JS key for the Google map provider. **Browser-exposed** — restrict it by HTTP referrer in Cloud Console | No |
| `APPLE_MAPKIT_TEAM_ID` | Apple Developer Team ID for MapKit JS | No (all three Apple vars required if using the signing flow) |
| `APPLE_MAPKIT_KEY_ID` | MapKit JS Key ID | No |
| `APPLE_MAPKIT_PRIVATE_KEY` | Contents of the `.p8` file. `\n` escapes accepted for single-line env values | No |
| `APPLE_MAPKIT_TOKEN` | Pre-signed MapKit JS JWT from the Quickstart token tool. Use this **or** the three signing vars above — not both. Expires per Apple's settings (typically 7 days); rotate manually | No |
| `LOG_LEVEL` | `debug`, `info`, `warn`, `error` | No (default `info`) |
| `PORT` | Container listen port | No (default `3000`) |

At least one of `MAPBOX_PUBLIC_TOKEN` / `GOOGLE_MAPS_PUBLIC_KEY` / `APPLE_MAPKIT_*` should be set for the map views. The Settings page disables provider buttons whose keys aren't configured.

API keys are read once at server boot — changing `.env` requires a container restart. The Settings page (gear icon in the nav) shows which keys are configured (presence only, never values).

### Map API setup

You only need one provider — pick whichever is easiest. All three can coexist if you want to switch later. Once the env vars are set and the container restarted, the Settings → Map provider buttons stop being disabled.

#### Mapbox (easiest, free tier)
1. Sign up at <https://account.mapbox.com/auth/signup/>.
2. Account → **Tokens** → **Create a token**. The default public token works.
3. Optional: restrict URL referrers on the token to your deployment's hostname.
4. Copy the `pk.…` value into `MAPBOX_PUBLIC_TOKEN`.

Free tier covers 50,000 map loads / month — plenty for personal use. The token is browser-exposed (it has to be for Mapbox GL to fetch tiles); URL restriction is the protection.

#### Google Maps JS (good if you already pay for Google Places)
1. <https://console.cloud.google.com/> → pick the same project as your `GOOGLE_PLACES_API_KEY`.
2. **APIs & Services** → **Library** → enable **Maps JavaScript API**.
3. **Credentials** → **Create credentials** → **API key**. (You can reuse your Places key, but only if it has the right HTTP referrer restrictions — otherwise create a separate one.)
4. Edit the new key → **Application restrictions** → **HTTP referrers** → add your deployment hostnames (e.g. `http://localhost:3000/*`, `https://your.host/*`, and your phone's IP if you LAN-test).
5. **API restrictions** → restrict to **Maps JavaScript API** only.
6. Copy the key into `GOOGLE_MAPS_PUBLIC_KEY`.

This key is browser-exposed (Google's JS SDK needs it client-side), so the referrer restriction is mandatory — without it, anyone who views your map page can copy the key and burn your quota.

#### Apple MapKit JS (two paths)

Apple gives you two ways to authenticate MapKit JS, and which you pick determines what you put in `.env`:

##### Path A — Quickstart token (fast, expires)

Easiest for "try Apple Maps right now". Gives you a pre-signed JWT directly, no server-side signing involved.

1. Sign in at <https://maps.developer.apple.com/> with any Apple ID.
2. Open the **Maps Token Maker** at <https://maps.developer.apple.com/token-maker>.
3. Set the **Origin** to your deployment's URL (e.g. `http://localhost:3000`, or `*` for testing on the LAN). Pick an **Expiration** — Apple defaults to 7 days, max ~6 months on free tier.
4. Click **Generate Token**. Copy the resulting `eyJ…` string — it has three dot-separated parts.
5. Set `APPLE_MAPKIT_TOKEN=eyJ…` in `.env`. Leave `APPLE_MAPKIT_TEAM_ID` / `KEY_ID` / `PRIVATE_KEY` empty.
6. Restart the container.

The server returns this token verbatim to MapKit JS. When it expires, regenerate from the same page and update `.env`. The server logs a warning when the embedded `exp` is less than 7 days away.

##### Path B — Signing key (proper, auto-renews)

The long-term answer. Requires a **paid Apple Developer Program membership** ($99/year, as Apple retired the free MapKit tier in 2024) but the maps and tokens then auto-renew forever.

1. Join the **Apple Developer Program** at <https://developer.apple.com/programs/> if you haven't.
2. <https://developer.apple.com/account/resources/identifiers/list/maps> → **Identifiers** → **+** → **Maps IDs**. Reverse-DNS identifier (e.g. `maps.com.you.restauranteer`) and a description.
3. **Keys** → **+** → name the key, tick **MapKit JS**, **Configure** → pick the Maps ID. Continue → Register → **Download the `.p8` file** (one-time download). Note the **Key ID** (10 chars).
4. Find your **Team ID** at <https://developer.apple.com/account> (top-right, 10 chars).
5. Set the three env vars:
   - `APPLE_MAPKIT_TEAM_ID` — Team ID
   - `APPLE_MAPKIT_KEY_ID` — Key ID
   - `APPLE_MAPKIT_PRIVATE_KEY` — contents of the `.p8` file (multi-line PEM, or single line with `\n` escapes)

The `.p8` key never leaves the server. The server signs short-lived JWTs (30-minute TTL) on demand at `/api/apple/maps-token` and MapKit JS calls that endpoint via its `authorizationCallback` — see "How Apple MapKit JS works" below.

##### Picking a path

| | Path A (Quickstart token) | Path B (Signing key) |
|---|---|---|
| Account needed | Any Apple ID | Apple Developer Program ($99/year) |
| Setup steps | 3 minutes | ~15 minutes |
| Token lifetime | 7 days (free) / ~6 months max | 30 minutes, auto-renewed |
| Manual rotation? | Yes, before each expiry | No |
| Production-ready? | Only if you're OK rotating env vars | Yes |

Start with A while you're trying things out, switch to B once you commit to Apple Maps as your daily provider. Setting both works — A wins, B is ignored.

### How Apple MapKit JS works

Apple MapKit JS is the only provider that needs server-side signing — Mapbox and Google use a long-lived browser token, Apple uses short-lived JWTs minted with your private key. The flow:

1. **Browser asks for the SDK.** `src/lib/appleMapKit.ts` lazy-injects `https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.js` with `data-callback` pointing at a global, and Apple's loader calls that global once the SDK is ready.
2. **Browser calls `mapkit.init` with an `authorizationCallback`.** Apple's SDK invokes this callback every time it needs a token — initial load, periodic re-auth, sometimes per-tile. The callback is the only thing that knows how to fetch tokens.
3. **Callback hits `/api/apple/maps-token`.** That endpoint (`src/routes/api/apple/maps-token/+server.ts`) calls `getMapKitToken()` in `src/lib/server/providers/apple.ts`. Two paths from here:
   - **If `APPLE_MAPKIT_TOKEN` is set** (Quickstart path), the function returns it verbatim and decodes the embedded `exp` to log a warning when expiry is within 7 days.
   - **Otherwise**, the signing-key path:
     - Loads your `.p8` PEM via `jose.importPKCS8` (cached after first read).
     - Signs an ES256 JWT with `iss = APPLE_MAPKIT_TEAM_ID`, `kid = APPLE_MAPKIT_KEY_ID`, `iat = now`, `exp = now + 30 min`, empty payload.
     - Caches the JWT in-process until 60s before expiry and serves the same token to subsequent callers.
4. **Browser passes the token back to MapKit** via the callback. MapKit then includes it as `Authorization: Bearer …` on its CDN requests for tiles, services (geocoding, search), and annotation assets.
5. **Re-auth.** When the token nears expiry, MapKit calls the same `authorizationCallback` again; our endpoint returns the cached JWT until it itself is close to expiry, at which point a new one is signed.

A few specific consequences worth knowing:
- **The `.p8` key never leaves the server.** Compromising the running container compromises map auth; compromising your browser doesn't.
- **Token expiry is short (30 minutes) by choice.** Apple allows up to a year, but a 30-minute ceiling means a leaked JWT is useless quickly. The cost is a JWT signature roughly every half hour per active session — trivial.
- **Geocoding and place search go through Apple too.** If you use Apple as your map provider, MapKit's `Search` and `Geocoder` services are authenticated by the same JWT — so cuisine names rendered on the map and reverse-geocode results all count toward your Apple Maps quota, not Google's.
- **The 503 path matters.** `hasAppleMapKit()` short-circuits to a 503 when any of the three vars are missing; the client's catch in `appleMapKit.ts` swallows the error and passes an empty string to MapKit, which then surfaces "Unauthorized" in the map. We rely on the Settings page disabling the Apple button when the keys aren't set so the user doesn't end up here.

## Routes

UI (icon-labelled bottom nav: Vault · Lists · Near · Map · Find · Settings):
- `/` — vault home with search bar
- `/restaurant/[uuid]` — restaurant detail (Articles & sources, Lists, Tags, Hours, Reviews, Photos, Markdown body, Navigate, Share, Refresh)
- `/restaurant/[uuid]/visit` — visit capture form (with star pickers when per-area mode is on)
- `/place/[id]` — Google Place detail with "Add to vault" CTA
- `/lists`, `/lists/[name]` — list index and per-list view
- `/near` — pin-and-filter "what's near here?" with cuisine / rating / source filters
- `/map` — full-screen map of every vault restaurant
- `/discover` — paste any URL (Broadsheet / Good Food / AGFG / Google Maps) or browse a city directory; shows a merge picker when a fuzzy candidate is found
- `/settings` — vault status, preferences, API key presence, vault stats, server-side + offline cache controls, manual reconcile

API:
- `GET  /api/restaurants` — list everything indexed
- `POST /api/restaurants` — create from `{google_place_id}`
- `POST /api/restaurants/[uuid]/visits` — multipart form: structured fields + per-area `*_rating` + `companions` + `photo[]`
- `POST /api/restaurants/[uuid]/tags` — replace tags
- `POST /api/restaurants/[uuid]/lists` — replace lists (regenerates affected MOCs)
- `POST /api/restaurants/[uuid]/articles` — append an article URL to this restaurant
- `POST /api/import` — universal paste. Body: `{url, link_to_uuid?, force_new?, refresh?}`. Returns `{type: 'created' | 'linked' | 'candidates', …}` — `candidates` triggers the merge picker
- `GET  /api/sources` — list adapters + cities
- `GET  /api/sources/[site]/discover?city=...` — directory listing
- `POST /api/sources/[site]/{extract,import,auto-extract}` — site-specific helpers (legacy; `/api/import` is the canonical path)
- `GET  /api/places/[id]` — Google place details (cached)
- `GET  /api/photos?name=...&w=...` — Google photo proxy (scrubs API key)
- `GET  /api/attachments/[...path]` — serves files from `Restaurants/_attachments/`
- `GET  /api/near?lat=&lng=&radius=&min_rating=&cuisines=&source=` — geo search with filters
- `GET  /api/map?bbox=...` — pins for a bounding box
- `GET  /api/search?q=&lat=&lng=` — vault FTS + Google autocomplete
- `GET  /api/lists` — distinct lists + counts
- `GET  /api/apple/maps-token` — signed MapKit JS JWT (when Apple is the chosen map provider)
- `GET, POST /api/settings/preferences` — read/write preferences (per-area ratings, navigation app, map provider)
- `GET  /api/cache`, `DELETE /api/cache?provider=...` or `?all=1` — server-side cache stats + clear
- `POST /api/admin/reconcile` — force a full vault rescan
- `GET  /health` — health check

All endpoints that hit external sites accept `?refresh=1` (or `{refresh: true}` in the JSON body) to bypass the cache.

## Development

Requires pnpm.

```bash
pnpm install
pnpm dev             # http://localhost:3000
pnpm check           # svelte-check
pnpm test            # vitest run
pnpm build           # production build via @sveltejs/adapter-node
pnpm start           # run the production build
```

To build the container locally instead of pulling the GHCR image:

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

Project structure:

```
src/
├── app.html, app.css           # global shell + markdown body styles
├── hooks.server.ts             # boot vault watcher + reconciler
├── lib/
│   ├── geo.ts                  # Haversine + bbox (shared client/server)
│   ├── cuisine.ts              # Google type → cuisine label map
│   ├── imageResize.ts          # client-side canvas resize before upload
│   ├── visitQueue.ts           # IndexedDB queue for offline visits
│   ├── share.ts                # Web Share API → clipboard fallback
│   ├── navigation.ts           # Apple/Google Maps directions URL builder
│   ├── appleMapKit.ts          # Apple MapKit JS lazy loader
│   ├── googleMaps.ts           # Google Maps JS lazy loader + dark theme
│   ├── photoswipe.ts           # PhotoSwipe lightbox bootstrap
│   ├── swCache.ts              # Service-worker cache inspection / clear
│   ├── components/             # UI components (BackLink, NavIcon, ShareButton,
│   │                           #   StarPicker, CuisinePicker, ListPicker,
│   │                           #   TagEditor, LinkArticleSheet, MergePicker,
│   │                           #   PhotoCarousel, PhotoGrid, ActionRow,
│   │                           #   ReviewList, HoursList,
│   │                           #   PendingVisitsBanner)
│   └── server/
│       ├── config.ts, log.ts, uuid.ts
│       ├── preferences.ts      # SQLite-backed user preferences
│       ├── images.ts           # sharp pipeline
│       ├── db/                 # SQLite schema + queries
│       ├── providers/
│       │   ├── google.ts       # Places (New) API client (search, details, nearby)
│       │   ├── apple.ts        # MapKit JS JWT signer (ES256 via jose)
│       │   ├── cache.ts        # forever cache with manual refresh
│       │   ├── mapsResolver.ts # Google Maps URL → place ID
│       │   └── scraper/
│       │       ├── fetcher.ts  # rate-limited polite fetch
│       │       ├── parser.ts   # JSON-LD + OG extraction
│       │       ├── broadsheet.ts, goodfood.ts, agfg.ts
│       │       └── registry.ts
│       └── vault/
│           ├── watcher.ts      # chokidar + echo suppression + burst mode
│           ├── reader.ts, writer.ts, save.ts
│           ├── frontmatter.ts, merge.ts, moc.ts
│           ├── visit.ts, filename.ts
│           ├── reconciler.ts
│           ├── create.ts          # createRestaurantFromGooglePlace + merge
│           ├── createFromArticle.ts
│           └── index.ts        # bootVault / shutdownVault
└── routes/                     # SvelteKit file-based routing
```

## Remote access

The container binds `0.0.0.0:3000` so anything on your LAN can reach it. To use the PWA away from home, expose it via:

- **Tailscale** (recommended) — `tailscale serve` gives you an HTTPS URL inside your tailnet; no port forwarding, no public exposure. PWA install + geolocation require HTTPS on iOS, so this is the smoothest path.
- **Cloudflare Tunnel** — only with access control in front of the app.
- **Plain LAN access** — fine when you're home; the PWA caches enough that you can browse offline anywhere, but new search/discover calls need network.

Do not expose Restauranteer directly to the public internet. It can modify Markdown files and write attachments in the mounted vault folder. See `SECURITY.md`.

## Data & privacy

- Restaurant data lives entirely in your Obsidian vault as Markdown. The SQLite index can be deleted at any time and will be rebuilt on next boot.
- External API responses (Google Places, scraped pages) are cached server-side in SQLite indefinitely; clear from Settings.
- Photos you upload are written to `Restaurants/_attachments/{slug}/` on disk only. Nothing is uploaded anywhere external.
- Google Place photo URLs are *proxied* through the server so your API key is never exposed to the client.

## Supported URL forms for paste-import

The paste-URL field on `/discover` accepts:

| Form | Example |
|---|---|
| Broadsheet news article | `/melbourne/food-and-drink/article/{slug}` |
| Broadsheet directory entry (canonical) | `/melbourne/{suburb}/{cafes\|restaurants\|bars}/{slug}` |
| Broadsheet directory entry (legacy) | `/melbourne/{cafes\|restaurants\|bars}/{slug}` |
| Good Food / The Age / SMH | `/goodfood/{section}/{slug}-{id}.html` |
| AGFG | `agfg.com.au/restaurant/{slug}-{id}` |
| Google Maps (full URL) | `google.com/maps/place/{name}/@{lat},{lng},…` |
| Google Maps (short) | `maps.app.goo.gl/X` or `goo.gl/maps/X` |
| Google Maps (with Place ID) | `?placeid=ChIJ…` or `?q=place_id:ChIJ…` |

Directory entries get the same full extraction as articles — name, address, suburb (from JSON-LD or URL path), coordinates, phone, cuisine.

## Known limitations

- **Browsing the Broadsheet directory** isn't supported because suburb and guide pages are JavaScript-rendered. Individual directory entries are server-rendered with full JSON-LD, so paste-URL works perfectly for them.
- **AGFG's directory pages** are also JS-rendered — AGFG is paste-URL only (its `discover` mode is hidden from the city dropdown). Individual restaurant URLs work fine.
- **Google Maps `?cid=...` URLs** cannot be resolved to a Place ID via the public API; use the "share" URL with the place name in the path instead.
- **Tap-to-pin on `/near`** is Mapbox- and Google-only. Apple MapKit JS doesn't expose a clean lat/lng for taps on empty map area, so under Apple the pin can only be set via "Use my location".
- **iOS splash screens** are pre-generated for iPhone SE3 / 13 mini / 14 / 14 Pro / 14 Plus / 14 Pro Max / iPad Pro 11". Other devices fall back to the manifest theme color.
- **Apple MapKit's place info API** isn't wired in — Apple Maps is map *rendering* only. Restaurant data still comes from Google Places (which has better AU coverage anyway).
- **Yelp** integration is not implemented — Yelp pulled out of Australia, so its AU coverage is sparse.
