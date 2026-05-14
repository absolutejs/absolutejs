import { DestroyRef, inject } from '@angular/core';

/** Component-scoped `setTimeout` / `setInterval` with automatic cleanup
 *  on `DestroyRef.onDestroy`. Use instead of raw `setTimeout` so timers
 *  scheduled by a component never outlive it.
 *
 *  Must be called in an Angular injection context (component constructor,
 *  field initializer, or `runInInjectionContext`).
 *
 *  Note: this composable just manages timers — it does not trigger change
 *  detection. If the timer callback mutates state that drives the template,
 *  store that state in a `signal()` so the update propagates in zoneless
 *  Angular. See the absolutejs docs on zoneless change detection. */
export const useTimers = () => {
	const destroyRef = inject(DestroyRef);
	const timeouts = new Set<ReturnType<typeof setTimeout>>();
	const intervals = new Set<ReturnType<typeof setInterval>>();

	const clearAll = () => {
		timeouts.forEach((timer) => clearTimeout(timer));
		intervals.forEach((timer) => clearInterval(timer));
		timeouts.clear();
		intervals.clear();
	};

	destroyRef.onDestroy(clearAll);

	return {
		clearAll,
		clearInterval(
			timer: ReturnType<typeof setInterval> | null | undefined
		) {
			if (!timer) return;
			clearInterval(timer);
			intervals.delete(timer);
		},
		clearTimeout(timer: ReturnType<typeof setTimeout> | null | undefined) {
			if (!timer) return;
			clearTimeout(timer);
			timeouts.delete(timer);
		},
		setInterval(callback: () => void, delayMs: number) {
			const timer = setInterval(callback, delayMs);
			intervals.add(timer);

			return timer;
		},
		setTimeout(callback: () => void, delayMs: number) {
			const timer = setTimeout(() => {
				timeouts.delete(timer);
				callback();
			}, delayMs);
			timeouts.add(timer);

			return timer;
		}
	};
};
