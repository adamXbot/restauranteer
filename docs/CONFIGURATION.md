# Configuration

Everything is configured through `.env`, read once at server boot — changing a
value needs a container restart. The Settings page (gear icon in the nav) shows
which keys are configured, presence only, never values.

Start from `.env.example`, which carries the same list with inline comments.

## Environment variables

| Variable | Purpose | Required |
|---|---|---|
| `VAULT_HOST_PATH` | Host path mounted as `/data` inside the container. Used by `docker-compose.yml`, not by the app itself | Yes |
| `VAULT_PATH` | Vault path as the app sees it | No (default `/data` in the image, `./data` outside it) |
| `VAULT_SUBDIR` | Subdirectory inside the vault holding restaurant files | No (default `Restaurants`) |
| `RESTAURANTEER_INDEX_PATH` | Move the SQLite index off the vault. Useful when the vault lives in iCloud Drive, where WAL churn turns into endless sync traffic | No (default `{vault}/.restauranteer/index.db`) |
| `OBSIDIAN_VAULT_NAME` | Vault display name for `obsidian://open?vault=…` deep links | No |
| `GOOGLE_PLACES_API_KEY` | Google Places API (New) — search, details, nearby, photos. Server-side only | No (recommended) |
| `MAPBOX_PUBLIC_TOKEN` | Mapbox GL token for the Mapbox map provider | No |
| `GOOGLE_MAPS_PUBLIC_KEY` | Google Maps JS key for the Google map provider. **Browser-exposed** — restrict it by HTTP referrer in Cloud Console | No |
| `APPLE_MAPKIT_TEAM_ID` | Apple Developer Team ID for MapKit JS (signing path) | No |
| `APPLE_MAPKIT_KEY_ID` | MapKit JS Key ID (signing path) | No |
| `APPLE_MAPKIT_PRIVATE_KEY` | Contents of the `.p8` file. `\n` escapes accepted for single-line env values (signing path) | No |
| `APPLE_MAPKIT_ORIGIN` | Exact page origin (scheme + host, no trailing slash) to put in the token's `origin` claim. Needed for domain-restricted keys; without it the server derives the origin from the request, which a reverse proxy can get wrong | No |
| `APPLE_MAPKIT_TOKEN` | Pre-signed MapKit JS JWT from Apple's token maker. Use this **or** the signing vars above — not both | No |
| `RESTAURANTEER_SYNC_TOKEN` | Bearer token(s) for the sync API. Unset means `/api/sync/*` is disabled. Comma-separate for one token per device. See [sync-api.md](sync-api.md) | No |
| `RESTAURANTEER_REQUIRE_AUTH` | `1` extends the bearer requirement to all of `/api/*`. **Locks out the browser UI** — headless deployments only. Needs `RESTAURANTEER_SYNC_TOKEN` too | No |
| `LOG_LEVEL` | `debug`, `info`, `warn`, `error` | No (default `info`) |
| `PORT` | Listen port | No (default `3000`) |

Two more are consumed by Docker rather than the app: `RESTAURANTEER_IMAGE`
selects the image `docker-compose.yml` runs, and `BODY_SIZE_LIMIT` (default
`64M`) raises adapter-node's 512K request cap, which is otherwise too small for
a visit carrying photos and shows up as a generic 400.

At least one of `MAPBOX_PUBLIC_TOKEN` / `GOOGLE_MAPS_PUBLIC_KEY` /
`APPLE_MAPKIT_*` should be set for the map views. The Settings page disables
provider buttons whose keys are not configured.

## Map provider setup

You only need one provider. All three can coexist if you want to switch later.
Once the env vars are set and the container restarted, the Settings → Map
provider buttons stop being disabled.

### Mapbox (easiest, free tier)

1. Sign up at <https://account.mapbox.com/auth/signup/>.
2. Account → **Tokens** → **Create a token**. The default public token works.
3. Optional: restrict URL referrers on the token to your deployment's hostname.
4. Copy the `pk.…` value into `MAPBOX_PUBLIC_TOKEN`.

The token is browser-exposed — it has to be, for Mapbox GL to fetch tiles — so
URL restriction is the protection.

### Google Maps JS (good if you already pay for Google Places)

1. <https://console.cloud.google.com/> → pick the same project as your
   `GOOGLE_PLACES_API_KEY`.
2. **APIs & Services** → **Library** → enable **Maps JavaScript API**.
3. **Credentials** → **Create credentials** → **API key**. You can reuse the
   Places key only if it has the right HTTP referrer restrictions; otherwise
   create a separate one.
4. Edit the key → **Application restrictions** → **HTTP referrers** → add your
   deployment hostnames (e.g. `http://localhost:3000/*`, `https://your.host/*`,
   and your phone's IP if you test on the LAN).
5. **API restrictions** → restrict to **Maps JavaScript API** only.
6. Copy the key into `GOOGLE_MAPS_PUBLIC_KEY`.

This key is browser-exposed, so the referrer restriction is not optional —
without it, anyone who loads your map page can copy the key and burn the quota.

### Apple MapKit JS

Apple offers two ways to authenticate MapKit JS, and the one you pick decides
what goes in `.env`.

**Path A — pre-signed token (fast, expires).**

1. Sign in at <https://maps.developer.apple.com/> with any Apple ID.
2. Open the token maker at <https://maps.developer.apple.com/token-maker>.
3. Set the **Origin** to your deployment's URL and pick an **Expiration**.
4. Generate the token and copy the `eyJ…` string.
5. Set `APPLE_MAPKIT_TOKEN` and leave the three signing vars empty.
6. Restart the container.

The server returns this token verbatim. It logs a warning when the embedded
`exp` is less than seven days away and an error once it has passed; regenerate
from the same page and update `.env`.

**Path B — signing key (auto-renews).** Requires a paid Apple Developer
Program membership.

1. Join the programme at <https://developer.apple.com/programs/> if you have not.
2. <https://developer.apple.com/account/resources/identifiers/list/maps> →
   **Identifiers** → **+** → **Maps IDs**. Use a reverse-DNS identifier.
3. **Keys** → **+** → name the key, tick **MapKit JS**, **Configure** → pick the
   Maps ID. Register, then download the `.p8` file (one-time download) and note
   the 10-character **Key ID**.
4. Find your **Team ID** at <https://developer.apple.com/account>.
5. Set `APPLE_MAPKIT_TEAM_ID`, `APPLE_MAPKIT_KEY_ID` and
   `APPLE_MAPKIT_PRIVATE_KEY`.

Setting both paths works — the pre-signed token wins and the signing key is
ignored.

### How the Apple token flow works

Apple is the only provider that needs server-side signing; Mapbox and Google use
a long-lived browser token.

1. `src/lib/appleMapKit.ts` lazy-injects Apple's SDK and calls `mapkit.init`
   with an `authorizationCallback`.
2. That callback fetches `/api/apple/maps-token`, which calls
   `getMapKitToken()` in `src/lib/server/providers/apple.ts`.
3. On the signing path the server loads the `.p8` PEM via `jose.importPKCS8`,
   signs an ES256 JWT with a 30-minute TTL, and caches it in process until 60
   seconds before expiry. The payload carries an `origin` claim when
   `APPLE_MAPKIT_ORIGIN` is set, or the request's own origin otherwise.
4. MapKit sends the token as `Authorization: Bearer …` on its own requests and
   calls the callback again as expiry approaches.

Consequences worth knowing:

- The `.p8` key never leaves the server.
- The 30-minute ceiling is a deliberate choice — Apple allows far longer, but a
  leaked JWT stops being useful quickly, and the signing cost is trivial.
- With Apple as the map provider, MapKit's own search and geocoding services are
  authenticated by the same JWT, so those calls count against your Apple quota
  rather than Google's.
- `hasAppleMapKit()` short-circuits to a 503 when the keys are missing, and the
  client swallows that and hands MapKit an empty string, which surfaces as
  "Unauthorized" on the map. The Settings page disabling the Apple button is
  what keeps you out of that state.

## Remote access

The container binds `0.0.0.0:3000`, so anything on the LAN can reach it. For
access away from home:

- **Tailscale** — `tailscale serve` gives an HTTPS URL inside your tailnet with
  no port forwarding and no public exposure. PWA install and geolocation both
  require HTTPS on iOS, so this is the smoothest path.
- **Cloudflare Tunnel** — only with access control in front of the app.
- **Plain LAN** — fine at home. The PWA caches enough to browse offline, but
  search and import need the network.

Do not expose Restauranteer directly to the public internet. It modifies
Markdown files and writes attachments in the mounted vault. See
[SECURITY.md](../SECURITY.md).

The sync API is the one bearer-authenticated surface. It stays disabled until
`RESTAURANTEER_SYNC_TOKEN` is set, and it needs HTTPS because the token travels
on every request — `tailscale cert` with MagicDNS, or Traefik with Let's
Encrypt, both work. See [sync-api.md](sync-api.md).

## Data and privacy

- Restaurant data lives entirely in the vault as Markdown. The SQLite index can
  be deleted at any time and is rebuilt on the next boot.
- External API responses (Google Places, scraped pages) are cached server-side
  in SQLite indefinitely. Clear them from Settings.
- Uploaded photos are written to `Restaurants/_attachments/{slug}/` on disk and
  nowhere else.
- Google place photo URLs are proxied through the server, so the Places key is
  never exposed to the browser.
