import { describe, expect, test } from 'bun:test';
import {
	resolveBuildDevelopmentMode,
	resolveClientDefine,
	resolveVueFeatureFlags
} from '../../../src/build/resolveBuildMode';

describe('resolveBuildDevelopmentMode', () => {
	test('explicit production overrides an ambient development environment', () => {
		expect(resolveBuildDevelopmentMode('production', 'development')).toBe(
			false
		);
	});

	test('explicit development overrides an ambient production environment', () => {
		expect(resolveBuildDevelopmentMode('development', 'production')).toBe(
			true
		);
	});

	test('falls back to NODE_ENV when a caller does not provide a mode', () => {
		expect(resolveBuildDevelopmentMode(undefined, 'development')).toBe(true);
		expect(resolveBuildDevelopmentMode(undefined, 'production')).toBe(false);
	});

	test('uses production Vue flags for an explicit production build', () => {
		expect(resolveVueFeatureFlags(false)).toEqual({
			__VUE_OPTIONS_API__: 'true',
			__VUE_PROD_DEVTOOLS__: 'false',
			__VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false'
		});
	});
});

describe('resolveClientDefine', () => {
	test('a production build tells packages it is production', () => {
		expect(resolveClientDefine(false)).toEqual({
			'process.env.NODE_ENV': '"production"'
		});
	});

	test('a development build leaves the development default alone', () => {
		expect(resolveClientDefine(true)).toEqual({});
	});

	test('keeps the defines it was given', () => {
		expect(resolveClientDefine(false, { __FLAG__: 'true' })).toEqual({
			__FLAG__: 'true',
			'process.env.NODE_ENV': '"production"'
		});
		expect(resolveClientDefine(true, { __FLAG__: 'true' })).toEqual({
			__FLAG__: 'true'
		});
	});
});
