import { describe, expect, test } from 'bun:test';
import { manifestKeyForPagePath } from '../../../src/angular/loadGlobalProviders';

describe('manifestKeyForPagePath', () => {
	test('source .ts path → PascalCase basename', () => {
		expect(manifestKeyForPagePath('/abs/src/frontend/pages/home/home.ts')).toBe(
			'Home'
		);
	});

	test('built artifact with Bun content hash → PascalCase basename', () => {
		expect(
			manifestKeyForPagePath(
				'/abs/build/angular/pages/home/home.zpqs628y.js'
			)
		).toBe('Home');
	});

	test('kebab-case basename pascalizes correctly', () => {
		expect(
			manifestKeyForPagePath(
				'/abs/build/angular/pages/admin-leads/admin-leads.3eft8sbx.js'
			)
		).toBe('AdminLeads');
	});

	test('built artifact without hash falls back to plain stem', () => {
		expect(
			manifestKeyForPagePath('/abs/.absolutejs/generated/angular/pages/home/home.js')
		).toBe('Home');
	});

	test('JIT compiled output (no hash) → manifest key', () => {
		expect(manifestKeyForPagePath('/tmp/absolutejs/.../portal.js')).toBe(
			'Portal'
		);
	});
});
