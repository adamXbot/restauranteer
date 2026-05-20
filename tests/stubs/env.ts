// Vitest stub for SvelteKit's $env/dynamic/private — just a passthrough of
// process.env so server modules can import it from unit tests.
export const env = process.env as Record<string, string | undefined>;
