/**
 * The calendar day where the code is running, as `yyyy-MM-dd`.
 *
 * This exists because `new Date().toISOString().slice(0, 10)` is the *UTC*
 * day, and east of Greenwich that is yesterday for the first part of every
 * morning — in Melbourne, until 10–11am. A visit logged over breakfast was
 * dated the day before (review 2026-07-25 §A13). The iOS app already uses
 * the device-local day (`VisitOps.todayISODate`); this brings the web to the
 * same rule.
 *
 * In the browser this is the user's day; on the server it is the server's —
 * which is why the visit form always submits its date and the API's default
 * is only a fallback for direct callers.
 *
 * Deliberately NOT used by `merge.ts`'s conflict-copy stamp: that `(conflict
 * YYYY-MM-DD)` filename is a cross-peer naming convention and iOS matches
 * its UTC form. Two peers resolving the same conflict near midnight must
 * agree on the name, so it follows a fixed clock, not a local one.
 */
export function localISODate(now: Date = new Date()): string {
	const y = now.getFullYear();
	const m = String(now.getMonth() + 1).padStart(2, '0');
	const d = String(now.getDate()).padStart(2, '0');
	return `${y}-${m}-${d}`;
}
