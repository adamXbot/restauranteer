# Security

Restauranteer is a single-user, self-hosted app that can modify files on your computer as Markdown in the mounted Obsidian vault folder. It can also write uploaded photo attachments into that vault.

Do not expose Restauranteer directly to the public internet. Run it only on a trusted local network, behind a private VPN such as Tailscale, or behind a reverse proxy that requires authentication before traffic reaches the app.

Before pointing Restauranteer at your real vault, test it with a copied vault folder and make sure you have backups. Markdown is the source of truth for this app, so file changes made through the UI are real filesystem writes.

If you find a vulnerability, please avoid posting exploit details publicly until maintainers have had time to respond. Open a minimal GitHub issue describing the affected area, or use the repository's private security reporting channel if one is available.
