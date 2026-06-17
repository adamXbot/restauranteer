import type { AttributeValue } from '$lib/attributes';

export const CURRENT_SCHEMA_VERSION = 1;

/**
 * Per-restaurant metadata about a list it belongs to. Optional auxiliary
 * data — the source of truth for membership is still `lists: string[]`.
 * `list` here must match a string in `lists`.
 */
export type ListMembership = {
	list: string;
	notes?: string;
	icon?: string;
	source_url?: string;
	imported_at?: string;
};

export type Frontmatter = {
	id?: string;
	schema_version?: number;
	name?: string;
	aliases?: string[];
	address?: string;
	suburb?: string;
	lat?: number;
	lng?: number;
	phone?: string;
	website?: string;
	socials?: Record<string, string>;
	hours?: Record<string, string>;
	cuisine?: string[];
	price_level?: number;
	place_ids?: Record<string, string>;
	lists?: string[];
	list_memberships?: ListMembership[];
	tags?: string[];
	rating?: number;
	attributes?: Record<string, AttributeValue>;
	last_synced?: string;
	// MOC-only fields
	generated_by?: string;
	do_not_edit?: boolean;
	list_name?: string;
	created_manually?: boolean;
	// Allow other user-added fields to pass through
	[key: string]: unknown;
};

export type RestaurantFile = {
	frontmatter: Frontmatter;
	body: string;
	rawContent: string;
	filePath: string;
	mtime: number;
	sha256: string;
};
