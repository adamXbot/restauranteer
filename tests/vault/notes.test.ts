import { describe, expect, it } from 'vitest';
import {
	extractRestaurantNotes,
	removeRestaurantNotesSection,
	updateRestaurantNotes
} from '../../src/lib/server/vault/notes';

describe('restaurant notes section', () => {
	it('inserts notes before visits', () => {
		const body = '## Overview\n\nGenerated text.\n\n## Visits\n';
		const next = updateRestaurantNotes(body, 'Worth booking for groups.');
		expect(next).toContain('## Overview\n\nGenerated text.\n\n## Notes\n\nWorth booking for groups.\n\n## Visits');
		expect(extractRestaurantNotes(next)).toBe('Worth booking for groups.');
	});

	it('replaces existing notes without touching other sections', () => {
		const body = '## Overview\n\nA\n\n## Notes\n\nOld\n\n## Menu\n\n- Link\n\n## Visits\n';
		const next = updateRestaurantNotes(body, 'New');
		expect(next).toContain('## Overview\n\nA');
		expect(next).toContain('## Notes\n\nNew\n\n## Menu');
		expect(next).toContain('## Visits');
		expect(extractRestaurantNotes(next)).toBe('New');
	});

	it('removes the notes section when notes are cleared', () => {
		const body = '## Overview\n\nA\n\n## Notes\n\nOld\n\n## Visits\n';
		const next = updateRestaurantNotes(body, '');
		expect(next).not.toContain('## Notes');
		expect(next).toContain('## Overview\n\nA\n\n## Visits');
		expect(removeRestaurantNotesSection(body)).toBe(next);
	});
});
