import { describe, expect, test } from 'bun:test';
import {
	absoluteServerEntryCopyOwnerPid,
	isMissingAbsoluteServerEntryCopyError,
	isStaleAbsoluteServerEntryCopy
} from '../../../src/dev/serverEntryCopies';

describe('server entry copy ownership', () => {
	test('extracts owners from bootstrap and reload copies', () => {
		expect(
			absoluteServerEntryCopyOwnerPid(
				'.absolutejs-hmr-123-bootstrap-2.ts'
			)
		).toBe(123);
		expect(
			absoluteServerEntryCopyOwnerPid('.absolutejs-hmr-456-0.ts')
		).toBe(456);
	});

	test('does not claim malformed or unrelated files', () => {
		expect(
			absoluteServerEntryCopyOwnerPid('.absolutejs-hmr-invalid.ts')
		).toBe(null);
		expect(absoluteServerEntryCopyOwnerPid('server.ts')).toBe(null);
	});

	test('cleans copies owned by the new process PID', () => {
		expect(
			isStaleAbsoluteServerEntryCopy(
				'.absolutejs-hmr-123-bootstrap-1.ts',
				123,
				() => true
			)
		).toBe(true);
	});

	test('cleans dead owners but preserves live foreign owners', () => {
		expect(
			isStaleAbsoluteServerEntryCopy(
				'.absolutejs-hmr-123-0.ts',
				999,
				() => false
			)
		).toBe(true);
		expect(
			isStaleAbsoluteServerEntryCopy(
				'.absolutejs-hmr-123-0.ts',
				999,
				() => true
			)
		).toBe(false);
	});

	test('preserves unowned matching-prefix files', () => {
		expect(
			isStaleAbsoluteServerEntryCopy(
				'.absolutejs-hmr-legacy.ts',
				999,
				() => false
			)
		).toBe(false);
	});
});

describe('isMissingAbsoluteServerEntryCopyError', () => {
	const copy = '/app/.absolutejs-hmr-123-bootstrap-2.ts';

	test('matches a missing framework-owned snapshot', () => {
		expect(
			isMissingAbsoluteServerEntryCopyError(
				new Error(
					`Cannot find module '${copy}' from '/app/bootstrap.ts'`
				),
				copy
			)
		).toBe(true);
	});

	test('does not hide a missing application dependency', () => {
		expect(
			isMissingAbsoluteServerEntryCopyError(
				new Error(
					`Cannot find module 'missing-package' from '${copy}'`
				),
				copy
			)
		).toBe(false);
	});

	test('requires an Error and the exact snapshot path', () => {
		expect(isMissingAbsoluteServerEntryCopyError('missing', copy)).toBe(
			false
		);
		expect(
			isMissingAbsoluteServerEntryCopyError(
				new Error(
					"Cannot find module '/app/.absolutejs-hmr-456-bootstrap-2.ts'"
				),
				copy
			)
		).toBe(false);
	});
});
