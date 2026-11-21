/* The prefetch runtime, reachable from code that cannot import it.
 *
 * `src/client/prefetch.ts` is the real implementation, and some callers
 * cannot import it:
 *
 * - An Angular component in `src/angular/components` is partial-compiled
 *   in a flat temp workspace holding that directory alone, so an import
 *   that climbs out of it does not resolve there — and when one does not,
 *   the step emits nothing and every Angular component publishes empty
 *   (see `compileAngularComponentsPartial` in scripts/build.ts, and the
 *   note in form-action.directive.ts).
 * - A runtime `import('@absolutejs/absolute/client/prefetch')` would type
 *   check against `dist/`, which does not exist yet while the package is
 *   being built.
 *
 * So this module has no imports at all, is copied into that workspace the
 * way `csrfTokenRef` is, and holds the runtime on a `Symbol.for` key —
 * the same indirection as the CSP nonce, the locale, the CSRF token and
 * the island disposers.
 *
 * Nothing registered means every call is a no-op, which is the right
 * behaviour rather than a failure: prefetching is an optimisation, and a
 * page that never loads the client runtime has nothing to prefetch into.
 * `enableNavigation()` pulls in the prefetch module (it consumes
 * prefetched documents), so any page that opts into soft navigation has
 * the runtime registered by the time a link is hovered. */

/** The part of `src/client/prefetch.ts` a link needs. Declared
 *  structurally so this file stays import-free. */
export type PrefetchRuntime = {
	canPrefetch: () => boolean;
	isPrefetchableHref: (href: string) => boolean;
	prefetch: (
		url: string,
		options?: { kind?: 'data' | 'document' | 'module' | 'route' }
	) => void;
	/* The precise union, not `string`: it is what the mode input accepts,
	 * and leaving it wide made TypeScript emit the real function's
	 * inferred union in a different order, which reads as an API change to
	 * a declaration-text comparison. */
	resolveDefaultPrefetchMode: () => 'viewport' | 'hover';
	speculate: (url: string) => void;
};

const RUNTIME_KEY = Symbol.for('absolutejs.prefetchRuntime');

const isPrefetchRuntime = (value: unknown): value is PrefetchRuntime =>
	typeof value === 'object' &&
	value !== null &&
	typeof Reflect.get(value, 'prefetch') === 'function' &&
	typeof Reflect.get(value, 'canPrefetch') === 'function' &&
	typeof Reflect.get(value, 'isPrefetchableHref') === 'function';

/** The registered runtime, or `undefined` when the client prefetch module
 *  was never loaded on this page. */
export const getPrefetchRuntime = () => {
	const runtime: unknown = Reflect.get(globalThis, RUNTIME_KEY);

	return isPrefetchRuntime(runtime) ? runtime : undefined;
};

/** Called by `src/client/prefetch.ts` as it loads. Idempotent: the first
 *  bundle copy to arrive wins, and every copy shares one store anyway. */
export const registerPrefetchRuntime = (runtime: PrefetchRuntime) => {
	if (getPrefetchRuntime() !== undefined) return;
	Reflect.set(globalThis, RUNTIME_KEY, runtime);
};

/** Prefetch `href` if there is a runtime and it considers the URL
 *  prefetchable. Returns whether anything was asked for, which is what
 *  lets a caller avoid arming hover listeners it cannot honour. */
export const requestPrefetch = (
	href: string,
	kind?: 'data' | 'document' | 'module' | 'route'
) => {
	const runtime = getPrefetchRuntime();
	if (!runtime?.canPrefetch() || !runtime.isPrefetchableHref(href))
		return false;
	runtime.prefetch(href, kind === undefined ? undefined : { kind });

	return true;
};

/** `<script type="speculationrules">` for `href`, when the runtime is
 *  present and the browser supports it. */
export const requestSpeculation = (href: string) => {
	const runtime = getPrefetchRuntime();
	if (!runtime?.canPrefetch() || !runtime.isPrefetchableHref(href))
		return false;
	runtime.speculate(href);

	return true;
};
