export type AttributeValue = 'yes' | 'no';

export type AttributeScope = {
	tags?: string[];
	cuisines?: string[];
	lists?: string[];
};

export type AttributeDefinition = {
	id: string;
	label: string;
	description?: string;
	scope: AttributeScope;
};

const MAX_LABEL_LEN = 60;
const MAX_DESC_LEN = 200;
const MAX_SCOPE_ENTRIES = 50;
const MAX_DEFINITIONS = 50;

export const ATTRIBUTE_LIMITS = {
	MAX_LABEL_LEN,
	MAX_DESC_LEN,
	MAX_SCOPE_ENTRIES,
	MAX_DEFINITIONS
};

export function slugifyLabel(label: string): string {
	const base = label
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '');
	return base || 'attribute';
}

/** Pick an id from `label` that doesn't collide with `existingIds`. */
export function uniqueAttributeId(label: string, existingIds: Iterable<string>): string {
	const taken = new Set(existingIds);
	const base = slugifyLabel(label);
	if (!taken.has(base)) return base;
	for (let i = 2; i < 1000; i++) {
		const candidate = `${base}_${i}`;
		if (!taken.has(candidate)) return candidate;
	}
	return `${base}_${Date.now()}`;
}

function uniqLower(values: string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const v of values) {
		const k = v.toLowerCase();
		if (seen.has(k)) continue;
		seen.add(k);
		out.push(v);
	}
	return out;
}

/** Parse a single attribute definition from untrusted input, returning null when unusable. */
export function coerceAttributeDefinition(raw: unknown): AttributeDefinition | null {
	if (!raw || typeof raw !== 'object') return null;
	const r = raw as Record<string, unknown>;
	const label = typeof r.label === 'string' ? r.label.trim() : '';
	if (!label || label.length > MAX_LABEL_LEN) return null;
	const id =
		typeof r.id === 'string' && r.id.trim().length > 0 ? slugifyLabel(r.id) : slugifyLabel(label);
	const description =
		typeof r.description === 'string' && r.description.trim().length > 0
			? r.description.trim().slice(0, MAX_DESC_LEN)
			: undefined;

	const rawScope =
		r.scope && typeof r.scope === 'object' ? (r.scope as Record<string, unknown>) : {};
	const scope: AttributeScope = {};
	for (const key of ['tags', 'cuisines', 'lists'] as const) {
		const arr = rawScope[key];
		if (!Array.isArray(arr)) continue;
		const cleaned = arr
			.filter((v): v is string => typeof v === 'string')
			.map((v) => v.trim())
			.filter((v) => v.length > 0);
		const deduped = uniqLower(cleaned).slice(0, MAX_SCOPE_ENTRIES);
		if (deduped.length > 0) scope[key] = deduped;
	}

	const def: AttributeDefinition = { id, label, scope };
	if (description) def.description = description;
	return def;
}

/** Coerce an array of attribute definitions, dropping invalids and deduping by id. */
export function coerceAttributeDefinitions(raw: unknown): AttributeDefinition[] {
	if (!Array.isArray(raw)) return [];
	const seenIds = new Set<string>();
	const out: AttributeDefinition[] = [];
	for (const entry of raw) {
		const def = coerceAttributeDefinition(entry);
		if (!def) continue;
		const id = uniqueAttributeId(def.id, seenIds);
		seenIds.add(id);
		out.push({ ...def, id });
		if (out.length >= MAX_DEFINITIONS) break;
	}
	return out;
}

/** Coerce a Record<string, 'yes'|'no'> from untrusted input. */
export function coerceAttributeAnswers(raw: unknown): Record<string, AttributeValue> {
	if (!raw || typeof raw !== 'object') return {};
	const out: Record<string, AttributeValue> = {};
	for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
		const slug = slugifyLabel(k);
		if (!slug) continue;
		if (v === 'yes' || v === true) out[slug] = 'yes';
		else if (v === 'no' || v === false) out[slug] = 'no';
		// Anything else (null, undefined, 'unset', etc.) → key absent.
	}
	return out;
}

type ScopeTarget = {
	tags: readonly string[];
	cuisines: readonly string[];
	lists: readonly string[];
};

function intersectsLower(target: readonly string[], probe: readonly string[]): boolean {
	if (probe.length === 0) return true;
	const have = new Set(target.map((s) => s.toLowerCase()));
	for (const p of probe) {
		if (have.has(p.toLowerCase())) return true;
	}
	return false;
}

/**
 * True when this attribute's scope matches the restaurant. Empty scope on every
 * dimension means "applies to all". Within a dimension we OR; across dimensions
 * we AND.
 */
export function attributeAppliesTo(def: AttributeDefinition, target: ScopeTarget): boolean {
	const { tags = [], cuisines = [], lists = [] } = def.scope;
	if (tags.length > 0 && !intersectsLower(target.tags, tags)) return false;
	if (cuisines.length > 0 && !intersectsLower(target.cuisines, cuisines)) return false;
	if (lists.length > 0 && !intersectsLower(target.lists, lists)) return false;
	return true;
}

/**
 * Serialise per-visit overrides into the `**Attributes:** k=v, ...` line.
 * Returns null when there are no effective overrides.
 */
export function serializeOverrides(
	overrides: Record<string, AttributeValue | null | undefined> | null | undefined
): string | null {
	if (!overrides) return null;
	const parts: string[] = [];
	for (const [id, val] of Object.entries(overrides)) {
		if (val !== 'yes' && val !== 'no') continue;
		const slug = slugifyLabel(id);
		if (!slug) continue;
		parts.push(`${slug}=${val}`);
	}
	if (parts.length === 0) return null;
	return parts.join(', ');
}

/** Parse the value-side of a `**Attributes:** ...` line into a Record. */
export function parseOverrideLine(value: string): Record<string, AttributeValue> {
	const out: Record<string, AttributeValue> = {};
	if (!value) return out;
	for (const raw of value.split(',')) {
		const eq = raw.indexOf('=');
		if (eq < 0) continue;
		const key = slugifyLabel(raw.slice(0, eq));
		const v = raw.slice(eq + 1).trim().toLowerCase();
		if (!key) continue;
		if (v === 'yes' || v === 'true' || v === '1') out[key] = 'yes';
		else if (v === 'no' || v === 'false' || v === '0') out[key] = 'no';
		// 'clear', 'unset', anything else → ignore (no override)
	}
	return out;
}

/**
 * Resolve the value shown for a given attribute on a given visit. Overrides
 * win, otherwise the restaurant default. Returns null when there is no answer.
 */
export function effectiveAttributeValue(
	id: string,
	restaurantAnswers: Record<string, AttributeValue> | undefined,
	visitOverrides?: Record<string, AttributeValue> | null
): AttributeValue | null {
	const override = visitOverrides?.[id];
	if (override === 'yes' || override === 'no') return override;
	const base = restaurantAnswers?.[id];
	if (base === 'yes' || base === 'no') return base;
	return null;
}

/** Trim answer objects to keys that have a valid yes/no value. */
export function cleanAnswers(
	answers: Record<string, AttributeValue> | undefined
): Record<string, AttributeValue> {
	const out: Record<string, AttributeValue> = {};
	if (!answers) return out;
	for (const [k, v] of Object.entries(answers)) {
		if (v === 'yes' || v === 'no') {
			const slug = slugifyLabel(k);
			if (slug) out[slug] = v;
		}
	}
	return out;
}
