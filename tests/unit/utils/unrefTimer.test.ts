import { expect, test } from 'bun:test';
import { unrefTimer } from '../../../src/utils/unrefTimer';

type TimerStub = { unref(): void };

test('unrefTimer detaches server timers and ignores browser handles', () => {
	let calls = 0;
	const timer: TimerStub = {
		unref() {
			calls += 1;
			expect(this).toBe(timer);
		}
	};

	unrefTimer(timer);
	unrefTimer(1);
	unrefTimer(null);

	expect(calls).toBe(1);
});
