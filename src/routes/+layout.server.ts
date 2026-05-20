import type { LayoutServerLoad } from './$types';
import { inboxCount } from '$lib/server/inbox';
import { getPreferences } from '$lib/server/preferences';

export const load: LayoutServerLoad = () => {
	return {
		inboxCount: inboxCount(),
		preferences: getPreferences()
	};
};
