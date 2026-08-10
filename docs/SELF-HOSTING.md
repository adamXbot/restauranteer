# Self-hosting recipes

`docker-compose.yml` is portable; these are quick recipes for the common NAS and
homelab UIs. They all share the same `.env` described in
[CONFIGURATION.md](CONFIGURATION.md) — only `VAULT_HOST_PATH` changes to match
each platform's path convention.

Two things apply everywhere:

- The compose file carries Traefik labels and joins an **external** Docker
  network called `proxy`. If you do not already run Traefik, create it first
  with `docker network create proxy`, or remove the `networks:` blocks and the
  `labels:` block.
- `VAULT_HOST_PATH` must be an absolute path the Docker daemon itself can see —
  a bind-mounted host folder, not a managed named volume. Otherwise Obsidian on
  your desktop or phone cannot reach the files.

## Synology DSM 7.2+ (Container Manager)

1. File Station → create `/docker/restauranteer` and upload `docker-compose.yml`
   and `.env` into it. Set `VAULT_HOST_PATH=/volume1/obsidian/MyVault`, or
   wherever the vault lives on the NAS.
2. Container Manager → **Project** → Create → name `restauranteer`, path
   `/docker/restauranteer`, source "Use existing docker-compose.yml" → Build.
3. Open `http://<nas-ip>:3000`. If port 3000 is taken, change the host side of
   `"3000:3000"` in `docker-compose.yml`.

## TrueNAS SCALE 24.10+ / HexOS

SCALE moved from K3s/Helm to Docker in Electric Eel (24.10), so this compose
file runs natively. HexOS is a UI on top of TrueNAS and uses the same dataset
paths.

1. Create a dataset for the app config (e.g. `tank/apps/restauranteer`) and make
   sure the vault dataset exists (e.g. `tank/obsidian/MyVault`).
2. SSH in, put `docker-compose.yml` and `.env` in
   `/mnt/tank/apps/restauranteer`, set
   `VAULT_HOST_PATH=/mnt/tank/obsidian/MyVault`, then run `docker compose up -d`
   from that directory.
3. The Apps UI has a "Custom App" form, but it uses TrueNAS's own schema rather
   than raw compose, so SSH is the simplest path for an unmodified file.

## Unraid 6.12+ (Docker Compose Manager plugin)

1. Community Applications → install **Docker Compose Manager**.
2. Add a new stack → paste `docker-compose.yml` and `.env`. Set
   `VAULT_HOST_PATH=/mnt/user/obsidian/MyVault`, or your share path.
3. **Compose Up**. The container appears in the regular Docker tab once running.

## CasaOS / Dockge / Portainer

Each has a "paste a compose YAML" form:

- **CasaOS** — App Store → **Custom Install** → paste the YAML, fill the env
  fields, Install.
- **Dockge** — Compose → New Stack → paste `docker-compose.yml` and `.env` →
  Deploy.
- **Portainer** — Stacks → Add stack → **Web editor**, paste the compose, add
  the env vars in the UI → Deploy.

## YunoHost

YunoHost is Debian plus a curated app catalogue and does not ship Docker by
default. There is no Restauranteer package for it, but it can run alongside
YunoHost apps:

1. SSH in and install Docker: `sudo apt install docker.io docker-compose-v2`.
2. Follow the normal setup in any folder, e.g.
   `/home/yunohost.app/restauranteer`.
3. Install YunoHost's **Custom Webapp** app and point it at
   `http://127.0.0.1:3000`, so YunoHost handles Let's Encrypt (and optionally
   SSO) in front. Keep Restauranteer bound to `127.0.0.1` rather than `0.0.0.0`
   if you do not want it reachable directly on the LAN.
