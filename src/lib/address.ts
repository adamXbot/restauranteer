/**
 * Address helpers usable on both server and client.
 */

const REGION = /^[A-Z]{2,3}$/;
const POSTAL = /^(?:[A-Z]{2,3}\s+)?\d[\d-]*$/;
const TRAILING_POSTAL = /\s+(?:[A-Z]{2,3}\s+)?\d[\d-]*$/;

/**
 * The town or suburb in a one-line address, for places that have no `suburb`
 * of their own — Google's formatted addresses put it in the address instead.
 *
 *   "3377 Wilshire Blvd #105, Los Angeles, CA 90010, USA" → "Los Angeles"
 *   "Level 1/123 Collins St, Melbourne VIC 3000, Australia" → "Melbourne"
 *
 * Null when what's left looks like a street ("45 Smith St").
 */
export function cityFromAddress(address: string | null | undefined): string | null {
	if (!address) return null;
	const parts = address
		.split(',')
		.map((p) => p.trim())
		.filter(Boolean);
	const last = () => parts[parts.length - 1];
	// A trailing country never holds a digit; a postcode always does.
	if (parts.length >= 3 && !/\d/.test(last())) parts.pop();
	while (parts.length > 1 && (REGION.test(last()) || POSTAL.test(last()))) parts.pop();
	const city = last()?.replace(TRAILING_POSTAL, '').trim();
	if (!city || /^\d/.test(city)) return null;
	return city;
}
