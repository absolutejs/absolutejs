import { describe, expect, test } from 'bun:test';
import { guardedTestFiles } from '../../../scripts/patchedBunTests';

/* The nightly's third job runs the tests that only work on the patched
 * Bun build. It discovers them instead of listing them, so this test is
 * what keeps that discovery honest: if the guard is renamed, or the files
 * move, the list goes empty and the job would run nothing while passing.
 * Here that is a failing test rather than a green tick. */

describe('the patched-Bun job finds its tests', () => {
	test('every file guarded on Fast Refresh support', async () => {
		expect(await guardedTestFiles()).toEqual([
			'tests/integration/hmr/lifecycle/island-hmr-browser.test.ts',
			'tests/integration/hmr/lifecycle/island-host-hmr-browser.test.ts',
			'tests/integration/hmr/lifecycle/island-host-hmr-packaged.test.ts',
			'tests/integration/hmr/lifecycle/react-fast-refresh-coverage.test.ts',
			'tests/integration/hmr/lifecycle/react-state-preservation.test.ts'
		]);
	});

	test('and finds some, which is the thing that can silently break', async () => {
		expect((await guardedTestFiles()).length).toBeGreaterThan(0);
	});
});
