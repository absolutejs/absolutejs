import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type {
	ResourceActions,
	ResourceFetcher,
	ResourceOptions,
	ResourceState
} from '../../../types/resource';
import { createResource } from '../../client/resource';

/** What `useResource` returns: the value, its load, and what to do
 *  with it. */
export type UseResourceResult<Value> = ResourceState<Value> &
	ResourceActions<Value>;

/**
 * A value this component loads for itself:
 *
 *   const profile = useResource((signal) => api.profile.me.get({ signal }));
 *
 *   if (profile.loading) return <Spinner />;
 *   if (profile.error) return <Retry onClick={profile.refresh} />;
 *   return <h1>{profile.data?.name}</h1>;
 *
 * In place of an effect that fetches into state: the load is stopped
 * when the component unmounts or `refresh()` is called again, an answer
 * that was overtaken is dropped, and `mutate()` sets the value by hand
 * after an edit returned the new one.
 *
 * It loads in the browser, when the component mounts. On the server
 * `loading` is `true` and `data` is `null`, which is what the browser
 * starts from, so hydration agrees. Data a page should be rendered with
 * belongs in the route's `load`.
 *
 * It is a loader and not a cache. Every call owns its state, and a
 * component mounted twice loads twice. The fetcher may change between
 * renders; the latest one is used by the next load.
 */
export const useResource = <Value>(
	fetcher: ResourceFetcher<Value>,
	options: ResourceOptions = {}
) => {
	const latest = useRef(fetcher);
	latest.current = fetcher;
	const [resource] = useState(() =>
		createResource<Value>((signal) => latest.current(signal), options.start)
	);
	const state = useSyncExternalStore(
		resource.subscribe,
		resource.snapshot,
		resource.snapshot
	);
	useEffect(() => {
		resource.mount();

		return resource.unmount;
	}, [resource]);
	const result: UseResourceResult<Value> = {
		...state,
		cancel: resource.cancel,
		mutate: resource.mutate,
		refresh: resource.refresh
	};

	return result;
};
