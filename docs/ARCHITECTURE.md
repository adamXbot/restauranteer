# Architecture

Implementation detail: how the vault layer works, what the route surface looks
like, which URLs the importer understands, and where the sharp edges are. None
of this is needed to use the app.

## Shape

```
iPhone Safari (PWA)
  │  HTTPS over your network / Tailscale
  ▼
SvelteKit (Node adapter) in Docker
  ├─ Vault layer: chokidar watcher + frontmatter parser + atomic writer + three-way merge
  ├─ SQLite index (better-sqlite3, FTS5) — rebuildable from a full vault scan
  ├─ Preferences: `.restauranteer-settings.json` in the vault root, shared with the iOS app
  ├─ Place provider: Google Places (New) — search, details, nearby, photos
  ├─ Map renderers (one active per user choice): Mapbox GL, Apple MapKit JS, Google Maps JS
  ├─ Scrapers: Broadsheet, Good Food (via SMH/Age), AGFG, Time Out, Apple Maps
  │             behind a rate-limited polite fetcher, plus a generic link handler
  ├─ Google Maps URL resolver: short URL → place ID via Places text search
  ├─ Sync API: file-level replication for the companion client (docs/sync-api.md)
  └─ Image pipeline (sharp), Google photo proxy, attachment server, PhotoSwipe gallery
       ▲
       │ volume mount
/data (your vault folder on the host)
  ├─ Restaurants/, Restaurants/_Lists/, Restaurants/_attachments/
  ├─ Inbox/                     — items shared from another device
  └─ .restauranteer/index.db    — derived index (relocatable, see CONFIGURATION.md)
```

## Vault mechanics

- **Markdown is canonical.** SQLite is a derived index and can always be rebuilt
  by scanning the vault.
- **Three-way merge on save** handles Obsidian editing a file while the app's
  form is open. Frontmatter merges field by field using dirty-field tracking;
  a body conflict surfaces a "save as conflict copy" option named after
  Obsidian Sync's own convention.
- **Self-write echo suppression.** When the app writes a file it records the
  content sha256 in an in-memory table with a 10-second TTL. Watcher events
  whose content matches are dropped, so the app never re-indexes its own writes.
- **Burst mode.** More than 20 watcher events inside 2 seconds (an iCloud sync
  storm) suspends per-file indexing; a single bulk reconcile runs once the
  filesystem has been quiet for 3 seconds.
- **Atomic writes** via tempfile-and-rename for both Markdown and photos, so a
  crash mid-write leaves a clean state.

## Pages

`/` (vault home and search) · `/discover` · `/inbox` · `/lists` ·
`/lists/[name]` · `/map` · `/near` · `/place/[id]` · `/restaurant/[uuid]` ·
`/restaurant/[uuid]/compare` · `/restaurant/[uuid]/visit` ·
`/restaurant/[uuid]/visit/[index]/edit` · `/settings`

## API

Restaurants and visits:

- `GET, POST /api/restaurants`
- `POST /api/restaurants/[uuid]/visits`, `PUT, DELETE /api/restaurants/[uuid]/visits/[index]`
- `POST /api/restaurants/[uuid]/tags`, `.../lists`, `.../attributes`, `.../notes`, `.../name`
- `POST, DELETE /api/restaurants/[uuid]/articles`
- `GET, POST /api/restaurants/[uuid]/enrich`, `GET, POST /api/restaurants/[uuid]/compare`

Import and discovery:

- `POST /api/import` — the canonical paste endpoint. Returns `created`,
  `linked`, or `candidates`, the last of which drives the merge picker
- `POST /api/import/list`, `POST /api/import/markdown`
- `GET /api/sources`, `GET /api/sources/detect`,
  `GET /api/sources/[site]/discover`, `GET /api/sources/[site]/suburbs`,
  `POST /api/sources/[site]/extract`, `POST /api/sources/[site]/import`,
  `POST /api/sources/auto-extract`
- `GET /api/sources/github/discover`, `POST /api/sources/github/import`
- `GET /api/discover/feeds`
- `GET, POST /api/inbox`, `DELETE /api/inbox/[id]`,
  `POST /api/inbox/[id]/attach`, `POST /api/inbox/[id]/create`

Places, media and geography:

- `GET /api/places/[id]` — Google place details, cached
- `GET /api/photos` — Google photo proxy, scrubs the API key
- `GET /api/attachments/[...rest]` — serves `Restaurants/_attachments/`
- `GET /api/near`, `GET /api/map`, `GET /api/search`
- `GET /api/apple/maps-token` — signed MapKit JS JWT

Lists, settings and operations:

- `GET, POST /api/lists`, `POST /api/lists/[name]/restaurants`, `GET /api/lists/[name]/bundle`
- `GET, POST /api/settings/preferences`, `POST /api/settings/pairing`
- `GET, DELETE /api/cache`
- `POST /api/admin/reconcile`, `GET /api/admin/prewarm-targets`
- `GET /api/info`, `GET /health`, `GET /manifest.webmanifest`

Sync — disabled unless `RESTAURANTEER_SYNC_TOKEN` is set, then bearer
authenticated. Full reference in [sync-api.md](sync-api.md):

- `GET /api/sync/info`, `GET /api/sync/manifest`
- `GET, PUT, DELETE /api/sync/file`

Endpoints that hit external sites accept `?refresh=1` (or `{refresh: true}` in a
JSON body) to bypass the cache.

## Paste-URL forms

| Source | Accepted shape |
|---|---|
| Broadsheet article | `broadsheet.com.au/{city}/food-and-drink/article/{slug}` |
| Broadsheet directory (canonical) | `/{city}/{suburb}/{restaurants\|cafes\|bars}/{slug}` |
| Broadsheet directory (legacy) | `/{city}/{restaurants\|cafes\|bars}/{slug}` |
| Good Food / The Age / SMH | `smh.com.au` or `theage.com.au` under `/goodfood/` |
| AGFG | `agfg.com.au/restaurant/…` |
| Time Out | `timeout.com/…` |
| Apple Maps | `maps.apple/p/{id}`, `maps.apple.com/place?…`, `maps.apple.com/?q=…`, `beta.maps.apple.com/…` |
| Google Maps (full) | `google.com/maps/place/{name}/@{lat},{lng},…` |
| Google Maps (short) | `maps.app.goo.gl/X` or `goo.gl/maps/X` |
| Google Maps (place ID) | `?placeid=ChIJ…`, `?place_id=…`, `?q=place_id:ChIJ…` |
| Anything else | Stored as a labelled source link — Instagram, TikTok, Reddit, YouTube, TripAdvisor, Facebook, Yelp, The Urban List and Concrete Playground get a friendly name; other hosts fall back to the domain |

Broadsheet directory entries get the same extraction as articles: name,
address, suburb, coordinates, phone, cuisine.

## Known limitations

- **Broadsheet suburb and guide pages** are JavaScript-rendered, so browsing
  that directory is not supported. Individual entries are server-rendered with
  full JSON-LD, so pasting their URLs works.
- **AGFG directory pages** are also JS-rendered — AGFG is paste-URL only, and
  its discover mode is hidden from the city dropdown. Individual restaurant URLs
  work.
- **Google Maps `?cid=…` URLs** cannot be resolved to a place ID through the
  public API. Use the share URL that carries the place name in the path.
- **Tap-to-pin on `/near`** works on Mapbox and Google only. Apple MapKit JS
  does not expose a clean lat/lng for taps on empty map area, so under Apple the
  pin can only be set from "Use my location".
- **iOS splash screens** are pre-generated for the devices in `static/splash/`
  (iPhone SE 3, 13 mini, 14, 14 Plus, 14 Pro, 14 Pro Max, and iPad Pro 11").
  Other devices fall back to the manifest theme colour.
- **Apple's place API is not wired in.** Apple Maps is map rendering only;
  restaurant data still comes from Google Places.
- **No Yelp provider.** `YELP_API_KEY` is only reported as present or absent on
  the Settings page; a Yelp URL is stored as a plain source link like any other.
