import type { PageServerLoad } from './$types';
import { listInbox, suggestionsForTitle } from '$lib/server/inbox';

export const load: PageServerLoad = ({ url }) => {
	const items = listInbox().map((i) => ({
		...i,
		suggestions: suggestionsForTitle(i.title)
	}));
	return {
		items,
		// Web Share Target on Android lands here with ?url=... or ?text=...
		// We use either field, since some apps pass the URL in `text`.
		sharedUrl: url.searchParams.get('url') ?? url.searchParams.get('text') ?? null
	};
};
