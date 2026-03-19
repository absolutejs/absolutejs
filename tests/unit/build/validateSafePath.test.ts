import { describe, expect, test } from 'bun:test';
import { validateSafePath } from '../../../src/utils/validateSafePath';

describe('validateSafePath', () => {
	const baseDir = '/home/user/project';

	test('allows simple relative paths', () => {
		const result = validateSafePath('src/index.ts', baseDir);
		expect(result).toBe('/home/user/project/src/index.ts');
	});

	test('allows nested paths', () => {
		const result = validateSafePath('src/components/Button.tsx', baseDir);
		expect(result).toBe('/home/user/project/src/components/Button.tsx');
	});

	test('blocks directory traversal with ../', () => {
		expect(() => validateSafePath('../../../etc/passwd', baseDir)).toThrow(
			'Unsafe path'
		);
	});

	test('blocks directory traversal with encoded paths', () => {
		expect(() => validateSafePath('src/../../etc/passwd', baseDir)).toThrow(
			'Unsafe path'
		);
	});

	test('blocks bare .. path', () => {
		expect(() => validateSafePath('..', baseDir)).toThrow('Unsafe path');
	});

	test('allows paths that contain .. but resolve within base', () => {
		const result = validateSafePath('src/../src/index.ts', baseDir);
		expect(result).toBe('/home/user/project/src/index.ts');
	});

	test('allows absolute paths within base directory', () => {
		const result = validateSafePath('build/output.js', baseDir);
		expect(result).toBe('/home/user/project/build/output.js');
	});
});
