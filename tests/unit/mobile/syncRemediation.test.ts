import { describe, expect, test } from 'bun:test';
import {
	type AbsoluteMobileSyncRemediation,
	getAbsoluteMobileSyncRemediation,
	installAbsoluteMobileSyncRemediation
} from '../../../src/mobile/syncRemediation';

describe('mobile Sync remediation bridge', () => {
	test('shares the latest framework-neutral bridge and restores nesting', async () => {
		const first: AbsoluteMobileSyncRemediation = {
			discard: async () => undefined,
			inspect: async () => ({
				automaticResolutions: 0,
				clients: 1,
				conflicts: 0,
				deadLetters: [],
				pending: 0
			}),
			rebase: async () => 'first',
			retry: async () => undefined
		};
		const second: AbsoluteMobileSyncRemediation = {
			...first,
			rebase: async () => 'second'
		};
		const removeFirst = installAbsoluteMobileSyncRemediation(first);
		const removeSecond = installAbsoluteMobileSyncRemediation(second);
		try {
			expect(
				await getAbsoluteMobileSyncRemediation()?.rebase(
					'operation',
					{}
				)
			).toBe('second');
			removeSecond();
			expect(
				await getAbsoluteMobileSyncRemediation()?.rebase(
					'operation',
					{}
				)
			).toBe('first');
		} finally {
			removeSecond();
			removeFirst();
		}
	});
});
