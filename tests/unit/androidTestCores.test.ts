import { expect, test } from 'bun:test';
import { androidTestCores } from '../helpers/androidTestCores';

test('diagnostic CPU selection preserves the four-core default', () => {
	expect(androidTestCores(undefined)).toBe(4);
	expect(androidTestCores('4')).toBe(4);
	expect(androidTestCores('1')).toBe(1);
});

test('diagnostic CPU selection rejects ambiguous or unsupported values', () => {
	for (const value of ['', '0', '2', '8', '01', '1.0', ' 1', '4 ', 'NaN'])
		expect(() => androidTestCores(value)).toThrow();
});
