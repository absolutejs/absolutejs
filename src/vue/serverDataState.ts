import { getCurrentScope, onScopeDispose, ref, shallowRef } from 'vue';
import type {
	ServerData,
	ServerDataErrorEntry,
	ServerDataFetcher
} from '../../types/vue';

const toError = (cause: unknown) =>
	cause instanceof Error ? cause : new Error(String(cause));

/** Refs plus an abortable `refresh`, shared by the server and browser
 *  builds of `useServerData`. */
export const createServerDataState = <T>(
	fetcher: ServerDataFetcher<T>,
	initiallyPending: boolean
) => {
	const data = shallowRef<T | null>(null);
	const error = shallowRef<Error | null>(null);
	const pending = ref(initiallyPending);
	let controller: AbortController | null = null;
	let disposed = false;

	const cancel = () => {
		controller?.abort();
		controller = null;
	};
	const finish = (current: AbortController) => {
		if (controller === current) controller = null;
		if (!current.signal.aborted) pending.value = false;
	};

	const refresh = async () => {
		if (disposed) return;
		cancel();
		const current = new AbortController();
		controller = current;
		pending.value = true;
		error.value = null;
		try {
			const result = await fetcher(current.signal);
			if (!current.signal.aborted) data.value = result;
		} catch (cause) {
			if (!current.signal.aborted) error.value = toError(cause);
		} finally {
			finish(current);
		}
	};

	if (getCurrentScope()) {
		onScopeDispose(() => {
			disposed = true;
			cancel();
		});
	}

	const result: ServerData<T> = { data, error, pending, refresh };

	return result;
};

export const errorFromEntry = ({ error }: ServerDataErrorEntry) => {
	const restored = new Error(error.message);
	restored.name = error.name;

	return restored;
};

/** The page payload for a key was produced by this same fetcher on the
 *  server, so its value has the fetcher's result type. This predicate
 *  records that contract for the compiler; JSON cannot carry the type. */
export const isFetcherResult = <T>(
	_fetcher: ServerDataFetcher<T>,
	_value: unknown
): _value is T => true;
