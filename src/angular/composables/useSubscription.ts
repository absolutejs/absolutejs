import { DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { Observable, Subscription } from 'rxjs';

export type Observer<T> = {
	next?: (value: T) => void;
	error?: (err: unknown) => void;
	complete?: () => void;
};

/** Try to capture the host component's `DestroyRef`. `inject(DestroyRef)`
 *  is only legal in an Angular injection context (constructor, field
 *  initializer, factory, `runInInjectionContext`) — calls from lifecycle
 *  hooks like `ngOnInit` are NOT in context and would throw NG0203.
 *  We catch that explicitly so `useSubscription` can degrade to a plain
 *  subscription (caller-managed teardown) in those call sites, with a
 *  single warning the first time it happens. */
let warnedOnce = false;
const tryCaptureDestroyRef = (): DestroyRef | null => {
	try {
		return inject(DestroyRef);
	} catch {
		if (!warnedOnce) {
			warnedOnce = true;
			console.warn(
				'[absolute/angular] useSubscription was called outside an Angular injection context (likely from a lifecycle hook). Auto-teardown via takeUntilDestroyed is disabled for that call; the subscription will leak unless the caller manually unsubscribes. Move the call to a field initializer or the constructor, or pass the captured DestroyRef as the third argument.'
			);
		}

		return null;
	}
};

/** Subscribe to an Observable with automatic teardown when the host
 *  component is destroyed. Equivalent to
 *  `observable.pipe(takeUntilDestroyed(destroyRef)).subscribe(observer)`,
 *  collapsed into one call so consumers can't forget the cleanup
 *  operator (the most common Angular memory-leak source).
 *
 *  Prefer calling from an injection context (field initializer or
 *  constructor). When called outside one — e.g. from `ngOnInit` —
 *  pass the host's `DestroyRef` explicitly as the third argument
 *  (capture it via `destroyRef = inject(DestroyRef)` in a field
 *  initializer once). Otherwise auto-teardown is dropped and the
 *  caller owns the returned `Subscription`.
 *
 *  Note: this composable handles teardown only — it does not trigger
 *  change detection on emissions. If the observer mutates state that
 *  drives the template, store that state in a `signal()` so updates
 *  propagate in zoneless Angular. */
export function useSubscription<T>(
	observable: Observable<T>,
	next: (value: T) => void,
	destroyRef?: DestroyRef
): Subscription;
export function useSubscription<T>(
	observable: Observable<T>,
	observer: Observer<T>,
	destroyRef?: DestroyRef
): Subscription;
export function useSubscription<T>(
	observable: Observable<T>,
	observerOrNext: Observer<T> | ((value: T) => void),
	destroyRef?: DestroyRef
): Subscription {
	const captured = destroyRef ?? tryCaptureDestroyRef();
	const observer =
		typeof observerOrNext === 'function'
			? { next: observerOrNext }
			: observerOrNext;
	if (!captured) return observable.subscribe(observer);

	return observable.pipe(takeUntilDestroyed(captured)).subscribe(observer);
}
