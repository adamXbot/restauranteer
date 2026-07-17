// Module-resolution hooks so plain `node` can run scripts that import the
// production SvelteKit server modules (scripts/export-fixtures.ts).
//
// Handles exactly three things:
//   1. `$env/dynamic/private` / `$env/static/private` → tests/stubs/env.ts
//      (the same stub vitest.config.ts aliases to — a process.env passthrough).
//   2. `$lib/*` → src/lib/*.
//   3. Extensionless relative/absolute imports (`./types`, `../config`) → `.ts`,
//      which the production sources use because Vite resolves them.
//
// Type stripping is native in Node >= 23.6, so no transpiler dependency is
// needed. Usage: node --import ./scripts/fixtures-loader.mjs <script.ts>

import { registerHooks } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier === '$env/dynamic/private' || specifier === '$env/static/private') {
			return {
				url: pathToFileURL(path.join(ROOT, 'tests', 'stubs', 'env.ts')).href,
				shortCircuit: true
			};
		}
		if (specifier.startsWith('$lib/')) {
			specifier = pathToFileURL(path.join(ROOT, 'src', 'lib', specifier.slice('$lib/'.length))).href;
		}
		try {
			return nextResolve(specifier, context);
		} catch (err) {
			const retryable =
				specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('file:');
			if (retryable && !specifier.endsWith('.ts')) {
				return nextResolve(`${specifier}.ts`, context);
			}
			throw err;
		}
	}
});
