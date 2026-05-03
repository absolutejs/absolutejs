import { describe, expect, test } from 'bun:test';
import {
	hashPathnameOf,
	buildHashHref
} from '../../../../src/svelte/router/hashMode';

describe('hashPathnameOf', () => {
	test('no hash returns root', () => {
		expect(hashPathnameOf(new URL('http://x/'))).toBe('/');
	});

	test('bare "#" returns root', () => {
		expect(hashPathnameOf(new URL('http://x/#'))).toBe('/');
	});

	test('"#/" returns root', () => {
		expect(hashPathnameOf(new URL('http://x/#/'))).toBe('/');
	});

	test('"#/foo" returns "/foo"', () => {
		expect(hashPathnameOf(new URL('http://x/#/foo'))).toBe('/foo');
	});

	test('nested path "#/foo/bar"', () => {
		expect(hashPathnameOf(new URL('http://x/#/foo/bar'))).toBe('/foo/bar');
	});

	test('tolerates "#foo" (no slash after hash)', () => {
		expect(hashPathnameOf(new URL('http://x/#foo'))).toBe('/foo');
	});

	test('tolerates leading double slashes', () => {
		expect(hashPathnameOf(new URL('http://x/#//foo'))).toBe('/foo');
	});

	test('preserves query-style suffix in the hash as part of pathname', () => {
		// We do NOT split the hash on `?` here — hashMode uses the result
		// as a `pathname` for matchPattern, which only cares about segments.
		// Documenting the current behavior so a future change is intentional.
		expect(hashPathnameOf(new URL('http://x/#/users/42'))).toBe(
			'/users/42'
		);
	});

	test('ignores the document pathname', () => {
		// Hash mode lives at "/" on the server — the real pathname is
		// always discarded in favor of the hash.
		expect(hashPathnameOf(new URL('http://x/some/page#/dashboard'))).toBe(
			'/dashboard'
		);
	});
});

describe('buildHashHref', () => {
	test('root pathname produces "#/"', () => {
		expect(buildHashHref('/')).toBe('#/');
		expect(buildHashHref('')).toBe('#/');
	});

	test('single segment', () => {
		expect(buildHashHref('/dashboard')).toBe('#/dashboard');
	});

	test('multi-segment path', () => {
		expect(buildHashHref('/users/42/posts')).toBe('#/users/42/posts');
	});

	test('strips leading slashes', () => {
		expect(buildHashHref('//dashboard')).toBe('#/dashboard');
		expect(buildHashHref('dashboard')).toBe('#/dashboard');
	});
});

describe('hashMode round-trip', () => {
	test('build then extract returns the same routable pathname', () => {
		const samples = [
			'/',
			'/dashboard',
			'/users/42',
			'/users/42/posts/abc',
			'/files/a/b/c.txt'
		];
		for (const path of samples) {
			const href = buildHashHref(path);
			const url = new URL(`http://x/${href}`);
			expect(hashPathnameOf(url)).toBe(path);
		}
	});
});
