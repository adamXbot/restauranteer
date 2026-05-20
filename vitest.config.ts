import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['tests/**/*.test.ts'],
		globals: false,
		environment: 'node'
	},
	resolve: {
		alias: {
			'$env/dynamic/private': path.resolve('./tests/stubs/env.ts'),
			'$env/static/private': path.resolve('./tests/stubs/env.ts')
		}
	}
});

