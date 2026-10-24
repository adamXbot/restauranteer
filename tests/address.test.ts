import { describe, expect, it } from 'vitest';
import { cityFromAddress } from '../src/lib/address';

describe('cityFromAddress', () => {
	it.each([
		['3377 Wilshire Blvd #105, Los Angeles, CA 90010, USA', 'Los Angeles'],
		['1 Colorado Blvd, Pasadena, CA 91101-1234, United States', 'Pasadena'],
		['1 Colorado Blvd, Pasadena, CA, 91107', 'Pasadena'],
		['Pasadena, CA, USA', 'Pasadena'],
		['Level 1/123 Collins St, Melbourne VIC 3000, Australia', 'Melbourne'],
		['Shop 2, 45 Smith St, Fitzroy VIC 3065', 'Fitzroy'],
		['1-chōme-1-2 Oshiage, Sumida City, Tokyo 131-0045, Japan', 'Tokyo'],
		['Fitzroy', 'Fitzroy']
	])('%s → %s', (address, city) => {
		expect(cityFromAddress(address)).toBe(city);
	});

	it.each([null, undefined, '', '45 Smith St', 'Shop 2, 45 Smith St', '123 Main St, 91101'])(
		'%s → null',
		(address) => {
			expect(cityFromAddress(address)).toBeNull();
		}
	);
});
