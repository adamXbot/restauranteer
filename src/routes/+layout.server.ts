import type { LayoutServerLoad } from './$types';
import { inboxCount } from '$lib/server/inbox';

export const load: LayoutServerLoad = () => {
	return {
		inboxCount: inboxCount()
	};
};
