# List available commands
default:
    @just --list

# Install dependencies
[group("dev")]
setup:
    pnpm install

# Run the vitest suite
[group("dev")]
test:
    pnpm run test

# Sync SvelteKit types and run svelte-check
[group("dev")]
lint:
    pnpm run check

# Build the app
[group("dev")]
build:
    pnpm run build

# Start the dev server
[group("dev")]
run:
    pnpm run dev

# Tag and push a release (triggers the Docker image publish)
[group("ship")]
release version:
    git tag "v{{version}}"
    git push origin "v{{version}}"
