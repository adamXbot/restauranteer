import type { PageServerLoad } from './$types';
import { getDb } from '$lib/server/db/schema';
import { error } from '@sveltejs/kit';
import type { ListMembership } from '$lib/server/vault/types';
import { getListMetadata, hasListShell } from '$lib/server/vault/moc';

type Row = {
	uuid: string;
	name: string;
	suburb: string | null;
	address: string | null;
	rating: number | null;
	memberships_json: string | null;
};

function membershipFor(row: Row, listName: string): ListMembership | null {
	if (!row.memberships_json) return null;
	try {
		const memberships = JSON.parse(row.memberships_json) as ListMembership[];
		return Array.isArray(memberships)
			? (memberships.find((x) => x?.list === listName) ?? null)
			: null;
	} catch {
		return null;
	}
}

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

	// List-level metadata now lives on the MOC file. Read it first; fall back
	// to the legacy per-restaurant list_memberships stamping for lists imported
	// before the MOC-based store was added.
	let listMeta: { notes: string | null; icon: string | null; source_url: string | null } | null =
		null;
	const mocMeta = await getListMetadata(name);
	if (mocMeta && (mocMeta.notes || mocMeta.icon || mocMeta.source_url)) {
		listMeta = {
			notes: mocMeta.notes,
			icon: mocMeta.icon,
			source_url: mocMeta.source_url
		};
	} else {
		for (const r of rows) {
			const m = membershipFor(r, name);
			if (m && (m.icon || m.source_url)) {
				listMeta = {
					notes: m.notes ?? null,
					icon: m.icon ?? null,
					source_url: m.source_url ?? null
				};
				break;
			}
		}
	}

	return {
		name,
		meta: listMeta,
		restaurants: rows.map((r) => {
			const membership = membershipFor(r, name);
			const listNote =
				membership?.notes && membership.notes !== listMeta?.notes ? membership.notes : null;
			return {
				uuid: r.uuid,
				name: r.name,
				suburb: r.suburb,
				address: r.address,
				rating: typeof r.rating === 'number' ? r.rating : null,
				listNote
			};
		})
	};
};
