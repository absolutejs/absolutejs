import { describe, expect, test } from 'bun:test';
import {
	absoluteServerEntryCopyOwnerPid,
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
