/**
 * Pure-function tests for the fuzzy match heuristics. The real findVaultCandidates
 * pulls vault rows from SQLite, but the underlying name/token logic is what we
 * need to exercise — we duplicate it inline here for unit testing.
 */
import { describe, expect, it } from 'vitest';

const STRIP_NOISE = /\b(the|and|&|cafe|cafés?|restaurant|bar|kitchen|co|inc|pty|ltd)\b/gi;

function normalizeName(s: string): string {
	return s
		.toLowerCase()
		.replace(STRIP_NOISE, ' ')
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

function tokenSet(s: string): Set<string> {
	return new Set(s.split(/\s+/).filter((t) => t.length > 1));
}

function jaccard(a: Set<string>, b: Set<string>): number {
	let intersection = 0;
	for (const t of a) if (b.has(t)) intersection++;
	const union = new Set([...a, ...b]).size;
	return union === 0 ? 0 : intersection / union;
}

describe('name normalisation', () => {
	it('strips noise words and punctuation', () => {
		expect(normalizeName('Cumulus Inc.')).toBe('cumulus');
		expect(normalizeName('The Kettle Black')).toBe('kettle black');
		expect(normalizeName('Andrew McConnell & Co.')).toBe('andrew mcconnell');
		expect(normalizeName('Pidapipo Gelateria')).toBe('pidapipo gelateria');
	});

	it('exact normalised name matches', () => {
		expect(normalizeName('Cumulus Inc')).toBe(normalizeName('Cumulus, Inc.'));
		expect(normalizeName('The Kettle Black')).toBe(normalizeName('Kettle Black'));
	});
});

describe('fuzzy match decisions', () => {
	it('treats "Cumulus Inc" and "Cumulus" as exact match (after noise strip)', () => {
		const a = normalizeName('Cumulus Inc');
		const b = normalizeName('Cumulus');
		expect(a).toBe(b);
	});

	it('Jaccard over tokens for partial overlap', () => {
		const a = tokenSet(normalizeName('Vue de Monde'));
		const b = tokenSet(normalizeName('Vue de Monde Lui'));
		expect(jaccard(a, b)).toBeGreaterThanOrEqual(0.6);
	});

	it('unrelated names score low', () => {
		const a = tokenSet(normalizeName('Cumulus Inc'));
		const b = tokenSet(normalizeName('Vue de Monde'));
		expect(jaccard(a, b)).toBeLessThan(0.3);
	});

	it('subset match recognises one-name-contains-other', () => {
		const a = normalizeName('Pidapipo Gelateria');
		const b = normalizeName('Pidapipo');
		expect(a.includes(b) || b.includes(a)).toBe(true);
	});
});
