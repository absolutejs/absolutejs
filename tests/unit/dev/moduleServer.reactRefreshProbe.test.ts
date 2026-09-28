import { describe, expect, test } from 'bun:test';
import { runtimeSupportsReactFastRefresh } from '../../../src/cli/patchedBun';
import { isReactFastRefreshSupported } from '../../../src/dev/moduleServer';

/* The dev server's probe decides between React Fast Refresh and the stock-Bun
 * remount fallback. It used an underscore-prefixed component name, which React
 * Fast Refresh never registers, so it reported "unsupported" even on a Bun
 * with the fix. It must agree with an independent check of the running Bun:
 * false on stock Bun, true on AbsoluteJS's patched Bun. */
describe('React Fast Refresh probe', () => {
	test('agrees with the running Bun', () => {
		expect(isReactFastRefreshSupported()).toBe(
			runtimeSupportsReactFastRefresh()
		);
	});
});
