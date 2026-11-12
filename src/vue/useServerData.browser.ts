import type { ServerDataFetcher, ServerDataOptions } from '../../types/vue';
import {
	createServerDataState,
	errorFromEntry,
	isFetcherResult
} from './serverDataState';

/** Removes and returns this key's server result. Reading consumes the
 *  entry: hydration is the only time it describes what is on screen, so a
 *  later mount of the same component (a client-side route change back to
 *  this page, an HMR remount) loads fresh data. */
const takeServerDataEntry = (key: string) => {
	const payload =
		typeof window === 'undefined'
			? undefined
			: window.__ABSOLUTE_SERVER_DATA__;
	if (!payload || !Object.hasOwn(payload, key)) return null;
	const entry = payload[key];
	Reflect.deleteProperty(payload, key);

	return entry ?? null;
};

/** Browser build of `useServerData`: hydrates from the value the server
 *  wrote into the page without calling the fetcher, and calls the fetcher
 *  when the page carries no value for `key`. See the server build for the
 *  full contract. */
export const useServerData = <T>(
	key: string,
	fetcher: ServerDataFetcher<T>,
	_options: ServerDataOptions = {}
) => {
	const entry = takeServerDataEntry(key);
	const state = createServerDataState(fetcher, entry === null);
	if (entry === null) {
		void state.refresh();

		return state;
	}
	if ('error' in entry) {
		state.error.value = errorFromEntry(entry);

		return state;
	}
	if (isFetcherResult(fetcher, entry.data)) state.data.value = entry.data;

	return state;
};
