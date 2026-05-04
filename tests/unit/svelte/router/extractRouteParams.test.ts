import { describe, expect, test } from 'bun:test';
import type { ExtractRouteParams } from '../../../../types/svelteRouter';

// Compile-time type assertions. The file failing to compile IS the test —
// the runtime body is just there so bun:test counts the cases. Keep one
// `expect(true).toBe(true)` per case so a regression shows up as a tsc
// error rather than a silent pass.

type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
		? true
		: false;

type AssertTrue<T extends true> = T;

describe('ExtractRouteParams (compile-time type tests)', () => {
	test('static path → Record<string, never>', () => {
		type T = ExtractRouteParams<'/dashboard'>;
		const _check: AssertTrue<Equal<T, Record<string, never>>> = true;
		expect(_check).toBe(true);
	});

	test('root "/" → Record<string, never>', () => {
		type T = ExtractRouteParams<'/'>;
		const _check: AssertTrue<Equal<T, Record<string, never>>> = true;
		expect(_check).toBe(true);
	});

	test('single :param → { id: string }', () => {
		type T = ExtractRouteParams<'/users/:id'>;
		const _check: AssertTrue<Equal<T, { id: string }>> = true;
		expect(_check).toBe(true);
	});

	test('multiple :params → { id, postId }', () => {
		type T = ExtractRouteParams<'/users/:id/posts/:postId'>;
		const _check: AssertTrue<Equal<T, { id: string; postId: string }>> =
			true;
		expect(_check).toBe(true);
	});

	test('optional :param? → { id: string | undefined }', () => {
		type T = ExtractRouteParams<'/users/:id?'>;
		const _check: AssertTrue<Equal<T, { id: string | undefined }>> = true;
		expect(_check).toBe(true);
	});

	test('mixed required + optional', () => {
		type T = ExtractRouteParams<'/users/:id/posts/:postId?'>;
		const _check: AssertTrue<
			Equal<T, { id: string; postId: string | undefined }>
		> = true;
		expect(_check).toBe(true);
	});

	test('lone wildcard → { wildcard: string }', () => {
		type T = ExtractRouteParams<'/*'>;
		const _check: AssertTrue<Equal<T, { wildcard: string }>> = true;
		expect(_check).toBe(true);
	});

	test('static prefix + wildcard tail → { wildcard: string }', () => {
		type T = ExtractRouteParams<'/files/*'>;
		const _check: AssertTrue<Equal<T, { wildcard: string }>> = true;
		expect(_check).toBe(true);
	});

	test('param + wildcard combo', () => {
		type T = ExtractRouteParams<'/users/:id/files/*'>;
		const _check: AssertTrue<Equal<T, { id: string; wildcard: string }>> =
			true;
		expect(_check).toBe(true);
	});

	test('non-literal `string` falls back to Record<string, string>', () => {
		// When the path isn't known at compile time (e.g. coming from a
		// variable typed as `string`), the type cannot extract individual
		// params and falls back to the loose record shape.
		type T = ExtractRouteParams<string>;
		const _check: AssertTrue<Equal<T, Record<string, string>>> = true;
		expect(_check).toBe(true);
	});
});
