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
 *  `inject(DestroyRef)` is only legal in an Angular injection context
 *  (constructor, field initializer, factory,
 *  `runInInjectionContext`). Calling `useSubscription` without a
 *  captured `DestroyRef` from `ngOnInit` or any other lifecycle hook
 *  will throw `NG0203`. For those call sites, capture the ref once in
 *  a field initializer (`private destroyRef = inject(DestroyRef);`)
 *  and pass it as the third argument:
 *
 *  ```ts
 *  ngOnInit() {
 *    useSubscription(this.events$, (event) => { ... }, this.destroyRef);
 *  }
 *  ```
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
) {
	const captured = destroyRef ?? inject(DestroyRef);
	const observer =
		typeof observerOrNext === 'function'
			? { next: observerOrNext }
			: observerOrNext;

	return observable.pipe(takeUntilDestroyed(captured)).subscribe(observer);
}
