import type {
	ResourceFetcher,
	ResourceMutator,
	ResourceStart,
	ResourceState
} from '../../types/resource';

/* A component-scoped async value, without a framework.
 *
 * The same thing Vue's `useResource` does with refs — load, show the
 * load, stop it when the component goes away, load again, and set the
 * value by hand after an edit — as a small store a framework's own
 * primitive can read: React's `useSyncExternalStore`, a Svelte store's
 * `subscribe`.
 *
 * It is a loader and not a cache: every one owns its state and loads
 * when its component mounts. Data that should outlive a component, or be
 * shared by two, wants a cache.
 *
 * A load that was overtaken says nothing. `refresh()` twice, or
 * `mutate()` during a load, stops the earlier request, and whatever it
 * answers afterwards — a value or an error — is dropped: the later
 * call is what the component asked for last. */

const isUpdater = <Value>(
	next: ResourceMutator<Value>
): next is (previous: Value | null) => Value | null =>
	typeof next === 'function';

export const createResource = <Value>(
	fetcher: ResourceFetcher<Value>,
	start: ResourceStart = 'immediate'
) => {
	let state: ResourceState<Value> = {
		data: null,
		error: null,
		loading: start !== 'idle'
	};
	let controller: AbortController | null = null;
	let isMounted = false;
	const listeners = new Set<() => void>();

	const set = (next: Partial<ResourceState<Value>>) => {
		state = { ...state, ...next };
		for (const listener of listeners) listener();
	};

	const cancel = () => {
		controller?.abort();
		controller = null;
	};

	const settle = (
		request: AbortController,
		next: Partial<ResourceState<Value>>
	) => {
		// Overtaken: a later call owns the state now.
		if (request.signal.aborted) return;
		if (controller === request) controller = null;
		set({ ...next, loading: false });
	};

	const refresh = async () => {
		cancel();
		const request = new AbortController();
		controller = request;
		set({ error: null, loading: true });
		try {
			settle(request, { data: await fetcher(request.signal) });
		} catch (error) {
			settle(request, { error });
		}
	};

	const mutate = (next: ResourceMutator<Value>) => {
		cancel();
		set({
			data: isUpdater(next) ? next(state.data) : next,
			error: null,
			loading: false
		});
	};

	/* The component is on the page: the first load, when it is to
	 * happen by itself. Called again for the same mount, it does
	 * nothing. */
	const mount = () => {
		if (isMounted) return;
		isMounted = true;
		if (start === 'immediate') void refresh();
	};

	/* The component is gone: nothing it asked for matters now. It may
	 * be mounted again (React's strict mode does), and loads again
	 * then. */
	const unmount = () => {
		isMounted = false;
		cancel();
	};

	return {
		cancel,
		mount,
		mutate,
		refresh,
		unmount,
		snapshot: () => state,
		subscribe(listener: () => void) {
			listeners.add(listener);

			return () => {
				listeners.delete(listener);
			};
		}
	};
};
