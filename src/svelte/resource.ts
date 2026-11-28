import type {
	ResourceActions,
	ResourceFetcher,
	ResourceOptions,
	ResourceState
} from '../../types/resource';
import { createResource } from '../client/resource';

/* A Svelte store's contract, written by hand as in formAction.ts: this
 * module is imported while a page renders on the server, and nothing
 * here needs Svelte's runtime. */
type Readable<Value> = {
	subscribe: (listener: (value: Value) => void) => () => void;
};

/** What `useResource` returns: the resource as a store, and what to do
 *  with it. */
export type SvelteResource<Value> = Readable<ResourceState<Value>> &
	ResourceActions<Value>;

/**
 * A value this component loads for itself, as a store:
 *
 *   <script lang="ts">
 *     import { useResource } from '@absolutejs/absolute/svelte';
 *
 *     const profile = useResource((signal) => api.profile.me.get({ signal }));
 *   </script>
 *
 *   {#if $profile.loading}<Spinner />
 *   {:else if $profile.error}<button onclick={profile.refresh}>Retry</button>
 *   {:else}<h1>{$profile.data?.name}</h1>{/if}
 *
 * It loads when something first subscribes in the browser, which `$profile`
 * in a template does as the component mounts, and the load is stopped
 * when the last subscriber leaves, which is the component going away.
 * An answer that was overtaken is dropped, and `mutate()` sets the
 * value by hand after an edit returned the new one.
 *
 * On the server nothing is loaded: `loading` is `true` and `data` is
 * `null`, which is what the browser starts from. Data a page should be
 * rendered with belongs in the route's `load`.
 *
 * It is a loader and not a cache: every call owns its state.
 */
export const useResource = <Value>(
	fetcher: ResourceFetcher<Value>,
	options: ResourceOptions = {}
) => {
	const resource = createResource(fetcher, options.start);
	let subscribers = 0;
	const store: SvelteResource<Value> = {
		cancel: resource.cancel,
		mutate: resource.mutate,
		refresh: resource.refresh,
		subscribe(listener) {
			listener(resource.snapshot());
			const stop = resource.subscribe(() =>
				listener(resource.snapshot())
			);
			subscribers += 1;
			// A page rendered on the server reads the store once and
			// lets go; there is no component there to load for.
			if (typeof window !== 'undefined') resource.mount();

			return () => {
				stop();
				subscribers -= 1;
				if (subscribers === 0) resource.unmount();
			};
		}
	};

	return store;
};
