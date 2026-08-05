import { describe, it, expect } from 'vitest';
import { localISODate } from '../src/lib/dates';
import { conflictCopyPath } from '../src/lib/server/vault/merge';

describe('localISODate', () => {
	it('formats the local calendar day, zero-padded', () => {
		// 5 Feb 2026, 09:00 local — month and day both need padding.
		expect(localISODate(new Date(2026, 1, 5, 9, 0, 0))).toBe('2026-02-05');
	});

	it('is the LOCAL day, not the UTC day', () => {
		// The bug this helper exists to fix: early morning east of Greenwich,
		// where toISOString() is still on yesterday. Construct a local
		// midnight-and-a-bit moment; unless the test runs in UTC+0, the UTC
		// date differs, and the local one must win either way.
		const early = new Date(2026, 6, 1, 0, 30, 0); // 1 Jul 2026, 00:30 local
		expect(localISODate(early)).toBe('2026-07-01');
		// Regardless of the machine's timezone, the answer tracks the local
		// components, never toISOString().
		const viaUTC = early.toISOString().slice(0, 10);
		if (early.getTimezoneOffset() > 0) {
			// West of Greenwich: UTC is ahead — no divergence at 00:30.
			expect(viaUTC).toBe('2026-07-01');
		} else if (early.getTimezoneOffset() < 0) {
			// East of Greenwich (Melbourne): UTC still reads 30 June.
			expect(viaUTC).toBe('2026-06-30');
		}
	});

	it('conflict-copy naming stays UTC — this helper is not for it', () => {
		// The (conflict YYYY-MM-DD) filename is a cross-peer convention iOS
		// matches in UTC form: two peers resolving the same conflict near
		// midnight must agree on the name. Pinned with a moment where UTC and
		// Melbourne disagree, so a refactor can't "helpfully" localize it.
		const utcEvening = new Date(Date.UTC(2026, 6, 1, 22, 0, 0)); // 2 Jul, 08:00 in Melbourne
		expect(conflictCopyPath('Restaurants/Tipo 00.md', utcEvening)).toBe(
			'Restaurants/Tipo 00 (conflict 2026-07-01).md'
		);
	});
});
