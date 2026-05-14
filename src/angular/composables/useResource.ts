import { DestroyRef, inject, signal, type Signal } from '@angular/core';

export type ResourceFetcher<T> = (signal: AbortSignal) => Promise<T>;

/** Controls the resource's startup behavior.
 *
 *  - `'immediate'` (default) — fire the fetcher synchronously at creation;
 *    `loading()` starts `true`.
 *  - `'pending'` — don't fire the fetcher yet, but render as if a fetch is
 *    coming: `loading()` starts `true`. Pair with a manual `refresh()` call
 *    from `ngOnInit` (or wherever the dependencies become available). Use
 *    this when the fetcher depends on state set after construction (e.g. a
 *    route param assigned by the page factory) — it avoids the blank-frame
 *    flash you'd get from `'idle'`.
 *  - `'idle'` — don't fire the fetcher and don't pretend you will:
 *    `loading()` starts `false`. The resource is dormant until `refresh()`
 *    or `mutate()` is called.
 */
export type ResourceStart = 'immediate' | 'pending' | 'idle';

export type ResourceOptions = {
	/** When and how the fetcher fires on creation. Default: `'immediate'`. */
	start?: ResourceStart;
};

export type ResourceMutator<T> = T | null | ((prev: T | null) => T | null);

export type Resource<T> = {
	/** Latest resolved value, or `null` before the first successful load. */
	data: Signal<T | null>;
	/** Latest rejection reason, or `null` when the resource is healthy. */
	error: Signal<unknown>;
	/** True while a fetch is in flight, or when `start: 'pending'` was set
	 *  and `refresh()` hasn't been called yet. */
	loading: Signal<boolean>;
	/** Re-runs the fetcher. Any in-flight request is aborted first. */
	refresh: () => Promise<void>;
	/** Aborts the in-flight request, if any. No-op otherwise. */
	cancel: () => void;
	/** Imperatively write the data signal without re-fetching. Accepts a
	 *  new value or an updater function. Use after an edit action returns
	 *  the new entity, so you avoid a wasteful re-fetch. Pending fetches
	 *  are aborted so a slower response can't clobber the mutation. */
	mutate: (next: ResourceMutator<T>) => void;
};

/** Signal-backed async data composable. Replaces the React
 *  `useEffect(() => { fetch(); }, [])` + `useState` pair with a single
 *  call that's safe in zoneless Angular (the signals it returns trigger
 *  change detection automatically when consumed in a template).
 *
 *  ```ts
 *  const profile = useResource(() => api.profile.me.get());
 *
 *  // in template:
 *  // @if (profile.loading()) { … }
 *  // @if (profile.data(); as data) { {{ data.name }} }
 *  ```
 *
 *  The fetcher receives an `AbortSignal` it can pass to `fetch` — the
 *  signal aborts on component destroy or on a new `refresh()` call.
 *  Must be called in an injection context. */
export const useResource = <T>(
	fetcher: ResourceFetcher<T>,
	options: ResourceOptions = {}
): Resource<T> => {
	const destroyRef = inject(DestroyRef);
	const start = options.start ?? 'immediate';
	const data = signal<T | null>(null);
	const error = signal<unknown>(null);
	const loading = signal(start !== 'idle');

	let controller: AbortController | null = null;
	let destroyed = false;

	const cancel = () => {
		if (controller) {
			controller.abort();
			controller = null;
		}
	};

	const refresh = async () => {
		if (destroyed) return;
		cancel();
		const next = new AbortController();
		controller = next;
		loading.set(true);
		error.set(null);
		try {
			const result = await fetcher(next.signal);
			if (next.signal.aborted) return;
			data.set(result);
		} catch (cause) {
			if (next.signal.aborted) return;
			error.set(cause);
		} finally {
			if (controller === next) {
				controller = null;
			}
			if (!next.signal.aborted) {
				loading.set(false);
			}
		}
	};

	const mutate = (next: ResourceMutator<T>) => {
		if (destroyed) return;
		cancel();
		error.set(null);
		loading.set(false);
		const resolved =
			typeof next === 'function'
				? (next as (prev: T | null) => T | null)(data())
				: next;
		data.set(resolved);
	};

	destroyRef.onDestroy(() => {
		destroyed = true;
		cancel();
	});

	if (start === 'immediate') {
		void refresh();
	}

	return { cancel, data, error, loading, mutate, refresh };
};
