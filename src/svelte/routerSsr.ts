import type {
	SvelteRouterSsrOutcome,
	SvelteRouterSsrResolved,
	SvelteRouterSsrState
} from '../../types/svelteRouter';
import { readLazySource, toLazyComponent } from './router/lazyModule';

/* Server side of the Svelte router's guards and lazy routes.
 *
 * Svelte's server render is synchronous, so the router can't await a
 * guard or a lazy route's `import()` while it renders. Instead the page
 * handler hands it this per-request state through Svelte context:
 *
 *   pass 1  →  <Router> queues its guard chain, an active lazy <Route>
 *              starts its loader
 *   settle  →  run the guards (a redirect / cancel ends the render), then
 *              await the loaders
 *   pass 2  →  the lazy <Route> finds its component and renders it
 *
 * A page without a router does one pass, exactly as before. */

/** Context key the router reads (Router.svelte / Route.svelte use the
 *  same `Symbol.for` name). */
export const SVELTE_ROUTER_SSR_CONTEXT_KEY = Symbol.for(
	'absolutejs.svelte-router.ssr'
);

const REDIRECT_STATUS = 302;
const FORBIDDEN_STATUS = 403;

const runSequentially = async (
	tasks: Array<() => Promise<void>>,
	index = 0
): Promise<void> => {
	const task = tasks[index];
	if (!task) return;
	await task();
	await runSequentially(tasks, index + 1);
};

const toResolved = (value: unknown) => {
	const component = toLazyComponent(value);
	const resolved: SvelteRouterSsrResolved = component
		? { component, source: readLazySource(value) }
		: {
				error: new Error(
					'A lazy <Route> loader must resolve to a Svelte component or to a module whose default export is one, e.g. `() => import("./Page.svelte")`.'
				)
			};

	return resolved;
};

export const createSvelteRouterSsr = (request: Request | undefined) => {
	const tasks: Array<() => Promise<void>> = [];
	const pending = new Map<string, Promise<void>>();
	const resolved = new Map<string, SvelteRouterSsrResolved>();
	let outcome: SvelteRouterSsrOutcome | undefined;

	const state: SvelteRouterSsrState = {
		request,
		resolved,
		settledGuards: new Set(),
		afterRender: (task) => {
			tasks.push(task);
		},
		load: (key, loader) => {
			if (resolved.has(key) || pending.has(key)) return;
			const settle = Promise.resolve()
				.then(loader)
				.then(
					(value) => {
						resolved.set(key, toResolved(value));
					},
					(error: unknown) => {
						resolved.set(key, { error });
					}
				);
			pending.set(key, settle);
		},
		outcome: () => outcome,
		setOutcome: (next) => {
			outcome ??= next;
		}
	};

	/** After a render pass: run the queued guards, then await the lazy
	 *  loads. Resolves `true` when another pass is needed. */
	const settle = async () => {
		await runSequentially(tasks.splice(0));
		if (outcome !== undefined) return false;
		if (pending.size === 0) return false;
		const loads = Array.from(pending.values());
		pending.clear();
		await Promise.all(loads);

		return true;
	};

	/** The response a guard decided on (302 / 403), if any. */
	const response = () => {
		if (!outcome) return undefined;
		if (outcome.kind === 'redirect') {
			return new Response(null, {
				headers: { Location: outcome.location },
				status: REDIRECT_STATUS
			});
		}

		return new Response('Forbidden', {
			headers: { 'Content-Type': 'text/plain; charset=utf-8' },
			status: FORBIDDEN_STATUS
		});
	};

	/** Script that tells the hydration entry which lazy route modules to
	 *  load before it hydrates, so the first client render matches the
	 *  server HTML. Empty when the page rendered no lazy route. */
	const bootstrapScript = () => {
		const sources: Record<string, string> = {};
		for (const [key, entry] of resolved) {
			if ('component' in entry && entry.source)
				sources[key] = entry.source;
		}
		if (Object.keys(sources).length === 0) return '';

		return `window.__ABS_SVELTE_LAZY_ROUTES__=${JSON.stringify(sources)};`;
	};

	return {
		bootstrapScript,
		context: new Map<unknown, unknown>([
			[SVELTE_ROUTER_SSR_CONTEXT_KEY, state]
		]),
		response,
		settle
	};
};
