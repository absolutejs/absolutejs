import { Elysia } from 'elysia';

// Dev-only request inspector. A named plugin whose onRequest/onAfterResponse
// hooks are cast to GLOBAL scope via `.as('global')` — the only form that makes
// Elysia fire them for every route across all instances (the per-hook
// `{ as: 'global' }` argument form is unsupported here and throws). Wired in by
// the networking plugin in development; the captured requests live in a
// globalThis ring buffer (survives server-entry HMR) and are served at
// /__absolute/requests for `absolute inspect`. Never present in compiled prod.

const RING_MAX = 200;
const DEFAULT_STATUS = 200;

const ASSET_EXTENSION =
	/\.(?:avif|css|gif|ico|jpe?g|js|json|map|mjs|otf|png|svg|ttf|txt|wasm|webp|woff2?)$/i;

const requestLog = () => {
	globalThis.__absoluteRequestLog ??= [];

	return globalThis.__absoluteRequestLog;
};

const classify = (path: string) => {
	if (path.startsWith('/@') || path.includes('/__hmr')) return 'hmr';
	if (path.startsWith('/api')) return 'api';
	if (ASSET_EXTENSION.test(path) || path.startsWith('/assets/'))
		return 'asset';

	return 'page';
};

const pathOf = (url: string) => {
	try {
		return new URL(url).pathname;
	} catch {
		return url;
	}
};

const byteSize = (header: unknown, value: unknown) => {
	if (typeof header === 'string' && Number.isFinite(Number(header))) {
		return Number(header);
	}
	if (typeof value === 'string') return Buffer.byteLength(value);

	return null;
};

const starts = new WeakMap<Request, number>();

export const requestInspector = new Elysia({
	name: 'absolute-request-inspector'
})
	.get('/__absolute/requests', () => requestLog())
	.onRequest(({ request }) => {
		starts.set(request, performance.now());
	})
	.onAfterResponse(({ request, set, responseValue }) => {
		const path = pathOf(request.url);
		// Skip the inspector's own introspection traffic (observer effect).
		if (path.startsWith('/__absolute')) return;
		const start = starts.get(request);
		const log = requestLog();
		log.push({
			at: Date.now(),
			durationMs: start === undefined ? 0 : performance.now() - start,
			kind: classify(path),
			method: request.method,
			path,
			size: byteSize(set.headers['content-length'], responseValue),
			status: typeof set.status === 'number' ? set.status : DEFAULT_STATUS
		});
		if (log.length > RING_MAX) log.shift();
	})
	.as('global');
