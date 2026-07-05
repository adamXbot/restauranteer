import type { PageServerLoad } from './$types';
import { nearMapData } from '$lib/server/nearData';

export const load: PageServerLoad = () => nearMapData();
