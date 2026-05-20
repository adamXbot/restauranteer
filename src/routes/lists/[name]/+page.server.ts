import type { PageServerLoad } from './$types';
import { getDb } from '$lib/server/db/schema';
import { error } from '@sveltejs/kit';
import type { ListMembership } from '$lib/server/vault/types';
import { hasListShell } from '$lib/server/vault/moc';

type Row = {
	uuid: string;
	name: string;
	suburb: string | null;
	address: string | null;
	rating: number | null;
	memberships_json: string | null;
};

export const load: PageServerLoad = async ({ params }) => {
	const name = params.name;
	const rows = getDb()
		.prepare(
			`SELECT r.uuid,
			        r.name,
			        json_extract(r.frontmatter_json, '$.suburb') AS suburb,
			        json_extract(r.frontmatter_json, '$.address') AS address,
			        json_extract(r.frontmatter_json, '$.rating') AS rating,
			        json_extract(r.frontmatter_json, '$.list_memberships') AS memberships_json
			 FROM lists l
			 JOIN restaurants r ON r.uuid = l.restaurant_uuid
			 WHERE l.list_name = ?
			 ORDER BY r.name COLLATE NOCASE`
		)
		.all(name) as Row[];

	if (rows.length === 0 && !(await hasListShell(name))) {
		throw error(404, `List "${name}" does not exist`);
	}

	// Pick the first matching list_memberships entry we find — list-level
	// metadata is stored redundantly across restaurants, so any one of them is
	// authoritative for display.
	let listMeta: { notes: string | null; icon: string | null; source_url: string | null } | null =
		null;
	for (const r of rows) {
		if (!r.memberships_json) continue;
		try {
			const memberships = JSON.parse(r.memberships_json) as ListMembership[];
			const m = Array.isArray(memberships) ? memberships.find((x) => x?.list === name) : null;
			if (m && (m.notes || m.icon || m.source_url)) {
				listMeta = {
					notes: m.notes ?? null,
					icon: m.icon ?? null,
					source_url: m.source_url ?? null
				};
				break;
			}
		} catch {
			// malformed frontmatter — skip
		}
	}

	return {
		name,
		meta: listMeta,
		restaurants: rows.map((r) => ({
			uuid: r.uuid,
			name: r.name,
			suburb: r.suburb,
			address: r.address,
			rating: typeof r.rating === 'number' ? r.rating : null
		}))
	};
};
