/* eslint-disable absolute/max-depth-extended -- The coordinator's try/catch state transitions intentionally remain adjacent to the async boundary. */

export type AbsoluteMobileNavigationHistoryMode = 'none' | 'push' | 'replace';

export type AbsoluteMobileNavigationRequest = {
	direction: 'back' | 'forward' | 'replace';
	from: string;
	historyMode: AbsoluteMobileNavigationHistoryMode;
	path: string;
};

export type AbsoluteMobileNavigationFailurePhase = 'commit' | 'load';

export type AbsoluteMobileNavigationResult =
	| { kind: 'cancelled' }
	| { kind: 'committed' }
	| {
			kind: 'failed';
			error: unknown;
			phase: AbsoluteMobileNavigationFailurePhase;
	  };

export type AbsoluteMobileNavigationCoordinatorOptions<Payload> = {
	commit: (
		payload: Payload,
		request: AbsoluteMobileNavigationRequest
	) => Promise<void>;
	load: (
		request: AbsoluteMobileNavigationRequest,
		signal: AbortSignal
	) => Promise<Payload>;
	onCommit?: (request: AbsoluteMobileNavigationRequest) => void;
	onFailure?: (
		error: unknown,
		phase: AbsoluteMobileNavigationFailurePhase,
		request: AbsoluteMobileNavigationRequest
	) => void;
	onStart?: (request: AbsoluteMobileNavigationRequest) => void;
	onSuccess?: (request: AbsoluteMobileNavigationRequest) => void;
};

export type AbsoluteMobileNavigationCoordinator = {
	cancelPending(): boolean;
	dispose(): void;
	navigate(
		request: AbsoluteMobileNavigationRequest
	): Promise<AbsoluteMobileNavigationResult>;
	phase(): 'committing' | 'idle' | 'loading' | 'queued';
};

const isAbortError = (error: unknown) =>
	error instanceof DOMException
		? error.name === 'AbortError'
		: error instanceof Error && error.name === 'AbortError';

const cancelledResult = { kind: 'cancelled' } as const;
const committedResult = { kind: 'committed' } as const;
const failedResult = (
	error: unknown,
	phase: AbsoluteMobileNavigationFailurePhase
) => ({ error, kind: 'failed', phase }) as const;

/**
 * Coordinates native-shell route loads. Loads may overlap, but only the latest
 * completed load may enter the serialized document commit boundary.
 */
export const createAbsoluteMobileNavigationCoordinator = <Payload>(
	options: AbsoluteMobileNavigationCoordinatorOptions<Payload>
): AbsoluteMobileNavigationCoordinator => {
	let activeLoad: AbortController | undefined;
	let commitQueue = Promise.resolve();
	let disposed = false;
	let generation = 0;
	let lifecyclePhase: 'committing' | 'idle' | 'loading' | 'queued' = 'idle';

	const navigate = async (request: AbsoluteMobileNavigationRequest) => {
		if (disposed) return cancelledResult;
		const ownGeneration = (generation += 1);
		activeLoad?.abort();
		const controller = new AbortController();
		activeLoad = controller;
		lifecyclePhase = 'loading';
		options.onStart?.(request);

		let payload: Payload;
		try {
			payload = await options.load(request, controller.signal);
		} catch (error) {
			if (
				controller.signal.aborted ||
				isAbortError(error) ||
				ownGeneration !== generation ||
				disposed
			) {
				if (ownGeneration === generation) lifecyclePhase = 'idle';

				return cancelledResult;
			}
			lifecyclePhase = 'idle';
			options.onFailure?.(error, 'load', request);

			return failedResult(error, 'load');
		}
		if (ownGeneration !== generation || disposed) return cancelledResult;
		if (activeLoad === controller) activeLoad = undefined;
		lifecyclePhase = 'queued';

		const execute = async () => {
			if (ownGeneration !== generation || disposed) {
				if (ownGeneration === generation) lifecyclePhase = 'idle';

				return cancelledResult;
			}
			lifecyclePhase = 'committing';
			try {
				await options.commit(payload, request);
				options.onCommit?.(request);
			} catch (error) {
				if (ownGeneration === generation) {
					lifecyclePhase = 'idle';
					options.onFailure?.(error, 'commit', request);
				}

				return failedResult(error, 'commit');
			}
			if (ownGeneration !== generation || disposed) {
				return cancelledResult;
			}
			lifecyclePhase = 'idle';
			options.onSuccess?.(request);

			return committedResult;
		};
		const result = commitQueue.then(execute, execute);
		commitQueue = result.then(
			() => undefined,
			() => undefined
		);

		return result;
	};

	return {
		cancelPending: () => {
			if (
				disposed ||
				(lifecyclePhase !== 'loading' && lifecyclePhase !== 'queued')
			)
				return false;
			generation += 1;
			activeLoad?.abort();
			activeLoad = undefined;
			lifecyclePhase = 'idle';

			return true;
		},
		dispose: () => {
			if (disposed) return;
			disposed = true;
			generation += 1;
			activeLoad?.abort();
			activeLoad = undefined;
			lifecyclePhase = 'idle';
		},
		navigate: (request) => navigate(request),
		phase: () => lifecyclePhase
	};
};
