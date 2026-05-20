import { agfg } from './agfg';
import { applemaps } from './applemaps';
import { broadsheet } from './broadsheet';
import { goodfood } from './goodfood';
import { timeout } from './timeout';
import type { SourceAdapter, SourceId } from './types';

export const adapters: SourceAdapter[] = [broadsheet, timeout, goodfood, agfg, applemaps];

export function getAdapter(id: string): SourceAdapter | null {
	const found = adapters.find((a) => a.id === id);
	return found ?? null;
}

export function findAdapterForUrl(url: string): SourceAdapter | null {
	return adapters.find((a) => a.matchesUrl(url)) ?? null;
}

export type { SourceId, SourceAdapter };
