import {
	getCurrentScope,
	onScopeDispose,
	type Ref,
	ref,
	shallowRef
} from 'vue';

export type ResourceFetcher<T> = (signal: AbortSignal) => Promise<T>;

/** Controls the resource's startup behavior.
 *
 *  - `'immediate'` (default) — fire the fetcher synchronously at creation;
 *    `loading.value` starts `true`.
 *  - `'pending'` — don't fire the fetcher yet, but render as if a fetch is
 *    coming: `loading.value` starts `true`. Pair with a manual `refresh()`
 *    call from `onMounted` (or wherever the dependencies become available).
 *    Use this when the fetcher depends on state set after setup runs (e.g. a
 *    route param resolved asynchronously) — it avoids the blank-frame flash
 *    you'd get from `'idle'`.
 *  - `'idle'` — don't fire the fetcher and don't pretend you will:
 *    `loading.value` starts `false`. The resource is dormant until
 *    `refresh()` or `mutate()` is called.
 */
export type ResourceStart = 'immediate' | 'pending' | 'idle';

export type ResourceOptions = {
	/** When and how the fetcher fires on creation. Default: `'immediate'`. */
	start?: ResourceStart;
};

export type ResourceMutator<T> = T | null | ((prev: T | null) => T | null);

export type Resource<T> = {
	/** Latest resolved value, or `null` before the first successful load. */
	data: Ref<T | null>;
	/** Latest rejection reason, or `null` when the resource is healthy. */
	error: Ref<unknown>;
	/** True while a fetch is in flight, or when `start: 'pending'` was set
	 *  and `refresh()` hasn't been called yet. */
	loading: Ref<boolean>;
	/** Re-runs the fetcher. Any in-flight request is aborted first. */
	refresh: () => Promise<void>;
	/** Aborts the in-flight request, if any. No-op otherwise. */
	cancel: () => void;
	/** Imperatively write the data ref without re-fetching. Accepts a new
	 *  value or an updater function. Use after an edit action returns the new
	 *  entity, so you avoid a wasteful re-fetch. Pending fetches are aborted
	 *  so a slower response can't clobber the mutation. */
	mutate: (next: ResourceMutator<T>) => void;
};

/** Ref-backed async data composable for AbsoluteJS Vue pages. Replaces the
 *  hand-rolled `onMounted(() => { loading.value = true; data.value = await
 *  fetch(); })` + `ref` boilerplate with a single call that also handles
 *  abort-on-teardown, refresh, and optimistic mutation.
 *
 *  This is a per-component LOADER, not a cross-component cache — every call
 *  owns its own state and refetches on creation. For data that should survive
 *  navigation / be shared across components (so revisiting a route doesn't
 *  refetch), use a cache layer (e.g. TanStack Query) or `@absolutejs/sync`
 *  instead. Reach for `useResource` when a one-shot, component-scoped fetch is
 *  exactly what you want.
 *
 *  ```ts
 *  const profile = useResource((signal) => api.profile.me.get({ signal }));
 *
 *  // in template:
 *  // <Spinner v-if="profile.loading.value" />
 *  // <h1 v-else-if="profile.data.value">{{ profile.data.value.name }}</h1>
 *  ```
 *
 *  The fetcher receives an `AbortSignal` it can pass to `fetch` — the signal
 *  aborts when the owning effect scope is disposed (component unmount) or on a
 *  new `refresh()` call. Call it during `setup()` so an effect scope is
 *  active; teardown won't be wired up otherwise. */
export const useResource = <T>(
	fetcher: ResourceFetcher<T>,
	options: ResourceOptions = {}
): Resource<T> => {
	const start = options.start ?? 'immediate';
	const data = shallowRef<T | null>(null);
	const error = shallowRef<unknown>(null);
	const loading = ref(start !== 'idle');

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
		loading.value = true;
		error.value = null;
		try {
			const result = await fetcher(next.signal);
			if (next.signal.aborted) return;
			data.value = result;
		} catch (cause) {
			if (next.signal.aborted) return;
			error.value = cause;
		} finally {
			if (controller === next) {
				controller = null;
			}
			if (!next.signal.aborted) {
				loading.value = false;
			}
		}
	};

	const mutate = (next: ResourceMutator<T>) => {
		if (destroyed) return;
		cancel();
		error.value = null;
		loading.value = false;
		const resolved =
			typeof next === 'function'
				? (next as (prev: T | null) => T | null)(data.value)
				: next;
		data.value = resolved;
	};

	// `onScopeDispose` is the Vue analog of Angular's `DestroyRef.onDestroy`:
	// it fires when the active effect scope (the component's, during setup)
	// tears down. Guard on an active scope so calling outside setup is a no-op
	// rather than a warning — the fetch still works, it just won't auto-abort.
	if (getCurrentScope()) {
		onScopeDispose(() => {
			destroyed = true;
			cancel();
		});
	}

	if (start === 'immediate') {
		void refresh();
	}

	return { cancel, data, error, loading, mutate, refresh };
};
