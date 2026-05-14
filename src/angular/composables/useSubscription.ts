import { DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { Observable, Subscription } from 'rxjs';

export type Observer<T> = {
	next?: (value: T) => void;
	error?: (err: unknown) => void;
	complete?: () => void;
};

/** Subscribe to an Observable with automatic teardown when the host
 *  component is destroyed. Equivalent to
 *  `observable.pipe(takeUntilDestroyed(destroyRef)).subscribe(observer)`,
 *  collapsed into one call so consumers can't forget the cleanup
 *  operator (the most common Angular memory-leak source).
 *
 *  Must be called in an injection context.
 *
 *  Note: this composable handles teardown only — it does not trigger
 *  change detection on emissions. If the observer mutates state that
 *  drives the template, store that state in a `signal()` so updates
 *  propagate in zoneless Angular. */
export function useSubscription<T>(
	observable: Observable<T>,
	next: (value: T) => void
): Subscription;
export function useSubscription<T>(
	observable: Observable<T>,
	observer: Observer<T>
): Subscription;
export function useSubscription<T>(
	observable: Observable<T>,
	observerOrNext: Observer<T> | ((value: T) => void)
): Subscription {
	const destroyRef = inject(DestroyRef);

	return observable
		.pipe(takeUntilDestroyed(destroyRef))
		.subscribe(
			typeof observerOrNext === 'function'
				? { next: observerOrNext }
				: observerOrNext
		);
}
