import { describe, expect, test } from 'bun:test';
import { getDurationString } from '../../../src/utils/getDurationString';

describe('getDurationString', () => {
	test('formats minute-scale durations as minutes and seconds', () => {
		expect(getDurationString(90_000)).toBe('1m 30s');
		expect(getDurationString(65_400)).toBe('1m 5s');
		expect(getDurationString(120_000)).toBe('2m');
	});
});
