import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getRestaurantByUuid } from '$lib/server/db/queries';
import { readRestaurant } from '$lib/server/vault/reader';
import { saveRestaurant } from '$lib/server/vault/save';
import type { Frontmatter, ListMembership } from '$lib/server/vault/types';

const MAX_LIST_NAME_LEN = 60;
const MAX_LISTS_PER_RESTAURANT = 50;
const MAX_LIST_NOTE_LEN = 1000;

function normalizeLists(input: unknown): string[] {
	if (!Array.isArray(input)) throw error(400, 'lists must be an array of strings');
	const out: string[] = [];
	const seen = new Set<string>();
	for (const raw of input) {
		if (typeof raw !== 'string') throw error(400, 'lists entries must be strings');
		const trimmed = raw.trim();
		if (trimmed.length === 0) continue;
		if (trimmed.length > MAX_LIST_NAME_LEN) {
			throw error(400, `list name too long (max ${MAX_LIST_NAME_LEN})`);
		}
		const key = trimmed.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(trimmed);
	}
	if (out.length > MAX_LISTS_PER_RESTAURANT) {
		throw error(400, `too many lists (max ${MAX_LISTS_PER_RESTAURANT})`);
	}
	return out;
}

function normalizePreviousMemberships(input: unknown): ListMembership[] {
	if (!Array.isArray(input)) return [];
	return input.filter(
		(m): m is ListMembership => m && typeof m === 'object' && typeof m.list === 'string'
	);
}

function normalizeMembershipNotes(input: unknown, lists: string[]): Map<string, string> {
	const out = new Map<string, string>();
	if (input === undefined) return out;
	if (!Array.isArray(input)) throw error(400, 'list_memberships must be an array');

	const canonical = new Map(lists.map((list) => [list.toLowerCase(), list]));
	for (const raw of input) {
		if (!raw || typeof raw !== 'object') throw error(400, 'invalid list_memberships entry');
		const entry = raw as Record<string, unknown>;
		if (typeof entry.list !== 'string') throw error(400, 'list_memberships list required');
		const list = canonical.get(entry.list.trim().toLowerCase());
		if (!list) continue;
		const notes = typeof entry.notes === 'string' ? entry.notes.trim() : '';
		if (notes.length > MAX_LIST_NOTE_LEN) {
			throw error(400, `list note too long (max ${MAX_LIST_NOTE_LEN})`);
		}
		out.set(list.toLowerCase(), notes);
	}
	return out;
}

function hasMembershipMetadata(membership: ListMembership): boolean {
	return Boolean(
		membership.notes || membership.icon || membership.source_url || membership.imported_at
	);
}

function mergeListMemberships(
	previous: ListMembership[],
	lists: string[],
	submittedNotes: Map<string, string>,
	hasSubmittedMemberships: boolean
): ListMembership[] {
	const previousByKey = new Map(previous.map((m) => [m.list.toLowerCase(), m]));
	const next: ListMembership[] = [];
	for (const list of lists) {
		const key = list.toLowerCase();
		const existing = previousByKey.get(key);
		const note = hasSubmittedMemberships
			? (submittedNotes.get(key) ?? '')
			: (existing?.notes ?? '');
		const membership: ListMembership = { ...(existing ?? {}), list };
		if (note) membership.notes = note;
		else delete membership.notes;
		if (hasMembershipMetadata(membership)) next.push(membership);
	}
	return next;
}

export const POST: RequestHandler = async ({ params, request }) => {
	const indexed = getRestaurantByUuid(params.uuid);
	if (!indexed) throw error(404, 'Restaurant not found');

	const body = (await request.json().catch(() => null)) as {
		lists?: unknown;
		list_memberships?: unknown;
	} | null;
	if (!body) throw error(400, 'invalid JSON');
	const newLists = normalizeLists(body.lists);
	const submittedNotes = normalizeMembershipNotes(body.list_memberships, newLists);

	const rf = await readRestaurant(indexed.file_path);
	const previousLists = Array.isArray(rf.frontmatter.lists)
		? (rf.frontmatter.lists as string[])
		: [];
	const affected = Array.from(new Set([...previousLists, ...newLists]));
	const previousMemberships = normalizePreviousMemberships(rf.frontmatter.list_memberships);
	const nextMemberships = mergeListMemberships(
		previousMemberships,
		newLists,
		submittedNotes,
		body.list_memberships !== undefined
	);

	const newFm: Frontmatter = { ...rf.frontmatter, lists: newLists };
	if (nextMemberships.length > 0) newFm.list_memberships = nextMemberships;
	else delete newFm.list_memberships;
	await saveRestaurant(indexed.file_path, newFm, rf.body, { affectedLists: affected });

	return json({ lists: newLists, list_memberships: nextMemberships });
};
