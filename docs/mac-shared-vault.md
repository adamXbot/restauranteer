# Running the web app on a Mac against the iOS app's vault

The iOS app and this server can share one vault two ways: **replication
through the sync API** (each side keeps its own copy — see `sync-api.md`)
or **one folder on disk**, which is this recipe. A Mac signed into the same
iCloud account sees the app's iCloud Drive vault as a plain folder, and the
web server points `VAULT_PATH` straight at it.

## The folder

With the vault in the app's own iCloud container:

```
~/Library/Mobile Documents/iCloud~com~kostarelas~restauranteer/Documents
```

(Finder shows this as "Restauranteer" in iCloud Drive. If the vault is a
picked external folder — an Obsidian vault in iCloud Drive or Dropbox — use
that folder's path instead.)

## Environment

```bash
VAULT_PATH="$HOME/Library/Mobile Documents/iCloud~com~kostarelas~restauranteer/Documents"

# REQUIRED for a synced vault: keep the SQLite index OUT of it. The index
# is rebuildable and WAL-churns on every write — inside the vault it
# becomes endless iCloud sync traffic.
RESTAURANTEER_INDEX_PATH="$HOME/.restauranteer/index.db"
```

Everything else is optional and unchanged (`GOOGLE_PLACES_API_KEY`,
`RESTAURANTEER_SYNC_TOKEN` if phones should *also* be able to replicate
against this server, and so on).

## What is shared, beyond restaurants

- **Preferences** — both apps read and write
  `{vault}/.restauranteer-settings.json`. A server that predates the file
  writes its existing settings out the first time Settings opens; unknown
  keys written by a newer peer survive a round-trip through an older one,
  in both directions.
- **Inbox** — links shared to the phone land as `{vault}/Inbox/*.md`
  (`kind: restauranteer_inbox`). The web mirrors them into its inbox on
  listing and **consumes the file only when the item is attached or
  dismissed here** — the same triage semantic the phone applies. Reading is
  never consumption: an item stays on the phone until one of the peers
  triages it.

## Keeping it running (launchd)

`~/Library/LaunchAgents/com.kostarelas.restauranteer.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.kostarelas.restauranteer</string>
  <key>WorkingDirectory</key><string>/path/to/restauranteer</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>build</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>VAULT_PATH</key>
    <string>/Users/YOU/Library/Mobile Documents/iCloud~com~kostarelas~restauranteer/Documents</string>
    <key>RESTAURANTEER_INDEX_PATH</key>
    <string>/Users/YOU/.restauranteer/index.db</string>
    <key>PORT</key><string>3000</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAgents/com.kostarelas.restauranteer.plist
```

Build first (`pnpm build`), and load after any rebuild.

## Caveats worth knowing

- **Keep the Mac's copy downloaded.** macOS can evict iCloud files to save
  space ("Optimize Mac Storage"); an evicted `.md` reads as missing to the
  scanner. Right-click the vault folder → "Keep Downloaded", or switch
  optimization off for this Mac.
- **Conflicts resolve on the phone.** When both sides edit one file across
  an offline gap, iCloud keeps both versions and the iOS app runs the
  three-way merge (its `merge_base` copy of the last common state lives on
  the phone). The web app's own editor-session merge still protects
  concurrent edits made *through the web UI*; it just doesn't see iCloud's
  version forks.
- **The watcher already tolerates sync storms.** Bursts of file events from
  iCloud land in the reconciler's burst mode; nothing to configure.
- **Don't expose the server publicly.** Unchanged posture — the browser UI
  has no auth. On a tailnet, `tailscale cert` + MagicDNS gives the https
  address the phone's pairing QR needs anyway.
