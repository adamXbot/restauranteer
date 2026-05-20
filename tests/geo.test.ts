import { describe, expect, it } from 'vitest';
import { bboxAround, formatDistance, haversineMeters } from '../src/lib/geo';

describe('haversineMeters', () => {
	it('zero distance from a point to itself', () => {
		expect(haversineMeters(-37.8158, 144.9685, -37.8158, 144.9685)).toBe(0);
	});

	it('roughly Melbourne CBD to Fitzroy (~2km)', () => {
		// Cumulus Inc → Cutler & Co (Gertrude St, Fitzroy) is ~2km
		const d = haversineMeters(-37.8158, 144.9685, -37.802, 144.978);
		expect(d).toBeGreaterThan(1500);
		expect(d).toBeLessThan(2500);
	});

	it('Melbourne to Sydney is roughly 700-720km', () => {
		const d = haversineMeters(-37.8136, 144.9631, -33.8688, 151.2093);
		expect(d).toBeGreaterThan(700_000);
		expect(d).toBeLessThan(720_000);
	});
});

describe('bboxAround', () => {
	it('produces a box containing the centre point', () => {
		const c = bboxAround(-37.8158, 144.9685, 1000);
		expect(-37.8158).toBeGreaterThanOrEqual(c.minLat);
		expect(-37.8158).toBeLessThanOrEqual(c.maxLat);
		expect(144.9685).toBeGreaterThanOrEqual(c.minLng);
		expect(144.9685).toBeLessThanOrEqual(c.maxLng);
	});

	it('larger radius produces wider box', () => {
		const a = bboxAround(0, 0, 1000);
		const b = bboxAround(0, 0, 10_000);
		expect(b.maxLat - b.minLat).toBeGreaterThan(a.maxLat - a.minLat);
	});

	it('lng delta widens at higher latitudes', () => {
		// At the equator vs near the poles, the lng span for 1km differs
		const equator = bboxAround(0, 0, 1000);
		const high = bboxAround(70, 0, 1000);
		expect(high.maxLng - high.minLng).toBeGreaterThan(equator.maxLng - equator.minLng);
	});
});

describe('formatDistance', () => {
	it('renders <1km as metres', () => {
		expect(formatDistance(450)).toBe('450m');
		expect(formatDistance(999)).toBe('999m');
	});
	it('renders 1-10km with one decimal', () => {
		expect(formatDistance(1500)).toBe('1.5km');
		expect(formatDistance(9900)).toBe('9.9km');
	});
	it('rounds 10km+ to whole km', () => {
		expect(formatDistance(10_400)).toBe('10km');
		expect(formatDistance(715_000)).toBe('715km');
	});
});
