import type {
	CreateRAGAccessControlOptions,
	RAGChatPluginConfig
} from '../../../types/ai';

export const createRAGAccessControl = <TContext = unknown>(
	options: CreateRAGAccessControlOptions<TContext>
): Pick<
	RAGChatPluginConfig,
	'authorizeRAGAction' | 'resolveRAGAccessScope'
> => {
	const authorize = options.authorize;
	const contextCache = new WeakMap<Request, Promise<TContext | undefined>>();
	const resolveScope = options.resolveScope;

	const loadContext = (request: Request) => {
		const existing = contextCache.get(request);
		if (existing) {
			return existing;
		}

		const next = Promise.resolve(options.resolveContext(request));
		contextCache.set(request, next);
		return next;
	};

	return {
		authorizeRAGAction: authorize
			? async (input) =>
					authorize({
						...input,
						context: await loadContext(input.request)
					})
			: undefined,
		resolveRAGAccessScope: resolveScope
			? async (request) =>
					resolveScope({
						context: await loadContext(request),
						request
					})
			: undefined
	};
};
