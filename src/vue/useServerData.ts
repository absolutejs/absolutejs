import {
	getCurrentInstance,
	inject,
	onServerPrefetch,
	ssrContextKey
} from 'vue';
import type {
	ServerData,
	ServerDataCollector,
	ServerDataFetcher,
	ServerDataOptions
} from '../../types/vue';
import {
	claimServerDataKey,
	isServerDataCollector,
	SERVER_DATA_CONTEXT_KEY,
	storeServerDataError,
	storeServerDataValue
} from './serverDataPayload';
import { createServerDataState } from './serverDataState';

const readCollector = () => {
	const ssrContext: unknown = inject(ssrContextKey, null);
	if (typeof ssrContext !== 'object' || ssrContext === null) return null;
	const candidate: unknown = Reflect.get(ssrContext, SERVER_DATA_CONTEXT_KEY);

	return isServerDataCollector(candidate) ? candidate : null;
};

const prefetchInto = async <T>(
	state: ServerData<T>,
	fetcher: ServerDataFetcher<T>,
	collector: ServerDataCollector,
	key: string
) => {
	try {
		const value = await fetcher(new AbortController().signal);
		const failure = storeServerDataValue(collector, key, value);
		state.data.value = failure ? null : value;
		state.error.value = failure;
	} catch (cause) {
		state.error.value = storeServerDataError(collector, key, cause);
	} finally {
		state.pending.value = false;
	}
};

/** Loads data while the page renders on the server and hands it to the
 *  browser with the page, so hydration reuses it instead of fetching again.
 *  When no server value exists (a client-side route change, `server: false`,
 *  or a page whose shell is not server-rendered) it loads in the browser.
 *
 *  Call it in a component's `setup()`. `key` must be unique among the
 *  `useServerData` calls of one request; the result must be JSON
 *  serializable.
 *
 *  ```ts
 *  const loadProfile = async (signal: AbortSignal): Promise<Profile> => {
 *  	const response = await fetch('https://api.example.com/me', { signal });
 *
 *  	return response.json();
 *  };
 *  const { data, error, pending, refresh } = useServerData(
 *  	'profile',
 *  	loadProfile
 *  );
 *  ```
 *
 *  This is the server build; the browser build reads the page payload. */
export const useServerData = <T>(
	key: string,
	fetcher: ServerDataFetcher<T>,
	options: ServerDataOptions = {}
) => {
	if (!getCurrentInstance()) {
		throw new Error(
			`useServerData("${key}") must be called inside a Vue component's setup().`
		);
	}
	const state = createServerDataState(fetcher, true);
	// No collector means this render's output never reaches a page payload
	// (an island rendered outside a Vue page, for example). Leave the state
	// pending so the server markup matches what the browser starts with, and
	// let the browser load the data.
	const collector = options.server === false ? null : readCollector();
	if (!collector) return state;
	if (!claimServerDataKey(collector, key)) return state;
	onServerPrefetch(() => prefetchInto(state, fetcher, collector, key));

	return state;
};
