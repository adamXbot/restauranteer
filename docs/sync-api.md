# Sync API

A small, file-level replication protocol that lets another Restauranteer client
— today, the iOS app — keep a complete local vault in step with the one this
server owns.

The unit of sync is **the file**, not "create restaurant" / "add visit". The
semantic API can't express arbitrary body edits, Obsidian's edits, or unknown
frontmatter keys, whereas both ends already honour the Markdown format
byte-for-byte. Every device keeps a full vault and works offline; the server is
the hub they meet at, not a vault location.

The API is **disabled by default**. It turns on only when you set
`RESTAURANTEER_SYNC_TOKEN`.

---

## Enabling it

| Variable | Effect |
|---|---|
| `RESTAURANTEER_SYNC_TOKEN` | Unset → `/api/sync/*` answers **503**. Set → those routes require `Authorization: Bearer <token>`. Comma-separate for one token per device. |
| `RESTAURANTEER_REQUIRE_AUTH` | `1` extends the same bearer requirement to **all** of `/api/*` (`/health` and the HTML pages stay open). |

```bash
# .env
RESTAURANTEER_SYNC_TOKEN=$(openssl rand -hex 32)
# or, one per device, so you can revoke a single phone:
# RESTAURANTEER_SYNC_TOKEN=phone-a1b2…,ipad-c3d4…
```

Tokens are compared in constant time (both sides hashed to 32 bytes first, so
no length is leaked and `timingSafeEqual` never sees a size mismatch).

> `RESTAURANTEER_REQUIRE_AUTH=1` **locks out the browser UI**, whose own
> `fetch()` calls carry no bearer token. Use it for headless deployments where
> only the iOS app talks to the server. If you set it without also setting
> `RESTAURANTEER_SYNC_TOKEN`, `/api/*` fails closed with
> `503 {"error":"auth_misconfigured"}` rather than silently staying open.

---

## Endpoints

All responses are JSON unless stated otherwise. All sync routes send
`Cache-Control: no-store`.

### `GET /api/sync/info`

The pairing handshake.

```json
{
  "app": "restauranteer",
  "vault_id": "6f1e0c2a-…",
  "schema_version": 1,
  "protocol": 1,
  "capabilities": ["manifest", "file", "delete"]
}
```

`vault_id` is a UUID minted on first use and stored in **`info.md`'s
frontmatter** — deliberately a real vault file, so the identity survives an
index rebuild (the SQLite index is explicitly disposable). It is also cached in
the `meta` table; `info.md` wins if they ever disagree, and it is never
regenerated when one is already present.

A client pins `vault_id` when it pairs and refuses to sync a server reporting a
different one. That is what stops a phone being pointed at the wrong server and
silently merging two unrelated vaults.

### `GET /api/sync/manifest`

Everything the server holds, plus everything it has deleted.

```json
{
  "cursor": "9a3f…",
  "generated_at": "2026-07-27T04:11:52.104Z",
  "files": [
    { "path": "Restaurants/Etta.md", "sha256": "b41c…", "size": 1234, "mtime": 1785076646193 }
  ],
  "tombstones": [
    { "path": "Restaurants/Gone.md", "deleted_at": 1785000000000 }
  ]
}
```

- `sha256` is over **raw bytes**, never a decoded string — an attachment must
  hash identically on both ends.
- `mtime` is integral epoch milliseconds.
- `files` is sorted by `path`.
- `cursor` is opaque: a sha256 over the sorted `(path, sha, size)` tuples and
  the tombstones. Use it as a cheap "did anything move?" check. **v1 clients may
  ignore it** — the manifest is always complete.
- `?since=<cursor>` is accepted and ignored; it is reserved for a server-side
  change log later, and a client that sends it still gets a correct answer.
- A path is never reported as both present and deleted. Present wins.

v1 returns the whole manifest every time: 500 restaurants is roughly 60 KB of
JSON, and a complete compare beats a wrong incremental one.

### `GET /api/sync/file?path=<urlencoded rel path>`

Raw bytes.

```
200 OK
Content-Type: text/markdown; charset=utf-8
Content-Length: 1234
ETag: "b41c…"          ← sha256 of the body, quoted
X-Vault-Mtime: 1785076646193
```

`404 {"error":"not_found"}` when it does not exist (a directory reads as
not-found too). `400 {"error":"invalid_path","reason":"…"}` when the path is
not allowlisted.

### `PUT /api/sync/file?path=<rel>`

Body is raw bytes. `If-Match` is the whole concurrency story.

| `If-Match` | Meaning |
|---|---|
| *absent* | **Create-only.** `409` if the path already exists. |
| `"<sha256>"` | Update. The server's current content hash must match. |
| `*` | Unconditional overwrite; creates the file if absent. |

Strong (`"abc"`), weak (`W/"abc"`), bare (`abc`) and comma-separated lists are
all accepted; hex is case-insensitive.

```json
200 { "sha256": "b41c…", "mtime": 1785076646193 }
409 { "error": "conflict", "server_sha256": "d92e…" }
```

A `409` means the server moved on. The client three-way-merges locally (base =
last synced content, ours = local, theirs = re-fetched) and re-PUTs with the
new `If-Match`.

**`server_sha256` is `null`** when the client sent a specific sha but the path
is gone on the server. That is a conflict, not a 404 — check the manifest's
tombstones to tell "deleted there" from "never arrived".

### `DELETE /api/sync/file?path=<rel>`

`If-Match` is **required** — deleting without stating what you expect to delete
is never safe.

```json
200 { "deleted": true }
400 { "error": "if_match_required" }
404 { "error": "not_found" }
409 { "error": "conflict", "server_sha256": "d92e…" }
```

A successful delete records a tombstone, which the next manifest serves.

### Auth failures

```json
401 { "error": "unauthorized", "message": "Authorization: Bearer <token> required" }
    WWW-Authenticate: Bearer realm="restauranteer"
503 { "error": "sync_disabled", "message": "Set RESTAURANTEER_SYNC_TOKEN to enable sync" }
```

---

## Path allowlist

Paths are vault-root-relative and POSIX-separated.

**Allowed**

- `Restaurants/**` — including `_Lists/**` (list MOCs) and `_attachments/**`
  (photos). If you have overridden `VAULT_SUBDIR`, that name replaces
  `Restaurants` here; leave it at the default for iOS compatibility.
- `Inbox/**` — the iOS share-sheet inbox.
- `info.md` — vault root, exact.
- `.restauranteer-settings.json` — vault root, exact. The only permitted
  dotfile.

**Rejected with `400`**

- `..` in any position, absolute paths, Windows drive letters, backslashes,
  NUL bytes, `.` and empty segments, paths over 1024 characters.
- Any other dot-prefixed segment. That covers `.restauranteer/**` (the SQLite
  index), `Restaurants/.restauranteer-tmp/**` (atomic-write staging),
  `.DS_Store`, and iCloud's `.Foo.md.icloud` placeholder stubs.
- Anything whose **real** path — after resolving symlinks on every existing
  ancestor — falls outside the vault root. A string check alone can be defeated
  by a symlink planted in the vault, so both layers run.

---

## Tombstones

Without them, "absent from the manifest" is ambiguous between *deleted on the
server* and *new on this device* — and a client resolves that ambiguity by
uploading the file straight back.

Deletions are recorded in `sync_tombstones(path, deleted_at, last_sha)` (schema
migration v6) from every path that removes an allowlisted vault file:

| Site | What it covers |
|---|---|
| `DELETE /api/sync/file` | This API |
| `vault/rename.ts` | The old file after a restaurant rename |
| `vault/moc.ts` | List MOCs dropped because a list emptied, and stale MOCs swept by `regenerateAllMocs()` |
| `api/restaurants/[uuid]/visits/[index]` | A deleted visit photo and its `.thumb` sibling |
| `vault/watcher.ts` | External deletions (Obsidian, Finder, another sync client) |
| `vault/reconciler.ts` | `fullReconcile()`'s orphan sweep — indexed last boot, gone from disk now |

Deletions of non-allowlisted paths (temp files, the index database) are ignored
— they never appear in a manifest, so a tombstone would be noise.

**Re-creating a path clears its tombstone.** That is hooked at the lowest level:
`vault/writer.ts` clears on every atomic write, so every creation path in the
app is covered without each one having to remember. The manifest also filters
out any tombstone whose path exists again, as a backstop.

Tombstones older than **90 days** are pruned on boot.

---

## Behaviour worth knowing before you write a client

- **Writes are indexed inline.** A `PUT` of a restaurant `.md` runs
  `indexSingleFile()` in the same request, and a `DELETE` runs
  `removeSingleFile()`. Do not wait for the filesystem watcher: under
  Docker-on-macOS host events are not forwarded into the container, and even
  where they are, the write is registered as a self-write and deliberately
  suppressed. `PUT` then query `/api/restaurants` and you will see it.
- **`_Lists/*.md` are server-generated.** A sync `PUT` does *not* regenerate
  them, on purpose: regenerating mid-push would fight the client's own copy and
  could delete a MOC whose members haven't been pushed yet, losing list-level
  metadata (notes, icon, source URL) that exists nowhere else. List *membership*
  is live immediately — it comes from the index, which the `PUT` updated — so
  only the Obsidian-facing projection lags, and it is rebuilt on the next boot
  or web edit. Treat MOC files as low-priority, server-authoritative content.
- **Attachments go through the same endpoint.** They are hashed as bytes and
  round-trip exactly. Fetch thumbnails eagerly and full-res on demand;
  `BODY_SIZE_LIMIT` is already raised to 64 MB for photo uploads.
- **Writes are atomic.** Content is staged in `Restaurants/.restauranteer-tmp/`
  and renamed into place, so a reader never sees a partial file.
- **`Inbox/**` and `.restauranteer-settings.json` are stored opaquely.** The web
  app keeps its own preferences in the index's `meta` table and does not read
  that file; it is carried for iOS-to-iOS sync through the hub.

---

## Walkthrough

```bash
BASE=https://restauranteer.example.com
TOKEN=your-token-here
AUTH="Authorization: Bearer $TOKEN"

# 1. Pair — record vault_id
curl -sS -H "$AUTH" "$BASE/api/sync/info"
# {"app":"restauranteer","vault_id":"6f1e…","schema_version":1,"protocol":1,
#  "capabilities":["manifest","file","delete"]}

# 2. What does the server hold?
curl -sS -H "$AUTH" "$BASE/api/sync/manifest" | jq '.files[:3], .tombstones'

# 3. Pull one file, keeping the ETag
curl -sS -D headers.txt -H "$AUTH" \
  "$BASE/api/sync/file?path=Restaurants%2FEtta.md" -o Etta.md
SHA=$(grep -i '^etag:' headers.txt | tr -d '\r' | sed 's/.*"\(.*\)".*/\1/')

# 4. Push it back with the sha you fetched
printf '\nSecond visit: even better.\n' >> Etta.md
curl -sS -X PUT -H "$AUTH" -H "If-Match: \"$SHA\"" \
  --data-binary @Etta.md \
  "$BASE/api/sync/file?path=Restaurants%2FEtta.md"
# {"sha256":"e77a…","mtime":1785076646193}

# 5. Create-only (no If-Match) — 409 if it already exists
curl -sS -o /dev/null -w '%{http_code}\n' -X PUT -H "$AUTH" \
  --data-binary @Etta.md "$BASE/api/sync/file?path=Restaurants%2FEtta.md"
# 409

# 6. A stale sha loses, and is told the winner
curl -sS -X PUT -H "$AUTH" -H 'If-Match: "0000000000000000000000000000000000000000000000000000000000000000"' \
  --data-binary @Etta.md "$BASE/api/sync/file?path=Restaurants%2FEtta.md"
# {"error":"conflict","server_sha256":"e77a…"}

# 7. An attachment, byte-for-byte
curl -sS -X PUT -H "$AUTH" --data-binary @photo.jpg \
  "$BASE/api/sync/file?path=Restaurants%2F_attachments%2Fetta%2F2026-07-27.jpg"

# 8. Delete, then watch it appear as a tombstone
curl -sS -X DELETE -H "$AUTH" -H "If-Match: \"$SHA\"" \
  "$BASE/api/sync/file?path=Restaurants%2FGone.md"
# {"deleted":true}
curl -sS -H "$AUTH" "$BASE/api/sync/manifest" | jq '.tombstones'

# 9. Traversal is refused
curl -sS -H "$AUTH" "$BASE/api/sync/file?path=..%2F..%2Fetc%2Fpasswd"
# {"error":"invalid_path","reason":"traversal"}
```

---

## Security

**Use HTTPS. The bearer token is sent on every request** and cleartext would
hand it to anyone on the path. iOS App Transport Security blocks cleartext
outright, and a per-host exception can't be configured from the app's settings,
so this is a requirement rather than a recommendation.

Two deployments that already have it:

**Public, via Traefik + Let's Encrypt** — the compose file is already set up for
a reverse proxy; point a hostname at it and let ACME issue the certificate.

```yaml
# docker-compose.yml (excerpt)
services:
  restauranteer:
    labels:
      - traefik.enable=true
      - traefik.http.routers.restauranteer.rule=Host(`restauranteer.example.com`)
      - traefik.http.routers.restauranteer.entrypoints=websecure
      - traefik.http.routers.restauranteer.tls.certresolver=letsencrypt
```

**Private, via Tailscale** — no public exposure at all, and a real certificate
from MagicDNS:

```bash
tailscale cert your-host.your-tailnet.ts.net
# then terminate TLS with that cert in front of the container
```

Beyond transport:

- **Generate the token randomly** (`openssl rand -hex 32`). It is the only thing
  between the internet and your whole vault.
- **One token per device.** `RESTAURANTEER_SYNC_TOKEN` takes a comma-separated
  list so you can revoke a lost phone without re-pairing everything else.
- **Rotate by editing `.env` and restarting**; tokens are read from the
  environment on every request, so there is nothing else to clear.
- **The token is never logged.** Sync logs record paths and hashes only.
- Leaving `RESTAURANTEER_SYNC_TOKEN` unset genuinely disables the API — the
  guard returns 503 before any handler runs, so an accidental public exposure
  does not also expose the vault through this route.
- The rest of the API remains unauthenticated by default, exactly as before.
  The app is still documented as "don't expose publicly" — enabling sync does
  not change that for `/api/*` unless you also set
  `RESTAURANTEER_REQUIRE_AUTH=1`.
