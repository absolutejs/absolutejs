import type { Component } from 'svelte';

/* Pure helpers shared by the router (browser + server render) and the
 * Svelte page handler: turn whatever a lazy route's loader resolved to
 * into a component, and read the source id the AbsoluteJS Svelte compiler
 * stamps on every compiled component module. No module state lives here,
 * so it is safe to bundle more than once. */

export type LazyComponent = Component<Record<string, unknown>>;

/** `globalThis` record of `route pattern → module` that the hydration
 *  entry fills before it hydrates a page whose server render included lazy
 *  routes. Compiled client modules fill a sibling registry,
 *  `Symbol.for('absolutejs.svelte.lazy-modules')`, of `source id →
 *  () => import(chunk)` for every `.svelte` file they import dynamically
 *  (see {@link lazyModuleRegistration}). */
export const LAZY_RESOLVED_KEY = Symbol.for('absolutejs.svelte.lazy-resolved');

/** Export (and component property) the Svelte compiler adds to every
 *  compiled component: the component's source path, relative to the
 *  project root. The server records it for each lazy route it rendered so
 *  the browser can load the same module before hydrating. */
export const LAZY_SOURCE_EXPORT = '__ABSOLUTE_SVELTE_SOURCE__';

const isRecord = (value: unknown): value is Record<string | symbol, unknown> =>
	typeof value === 'object' && value !== null;

const isComponent = (value: unknown): value is LazyComponent =>
	typeof value === 'function';

/** The component a loader resolved to: a module namespace's `default`, or
 *  the value itself when the loader already unwrapped it. */
export const toLazyComponent = (value: unknown) => {
	if (isComponent(value)) return value;
	if (!isRecord(value)) return undefined;
	const fallback = value.default;

	return isComponent(fallback) ? fallback : undefined;
};

const readSourceFrom = (value: unknown) => {
	if (!isRecord(value) && !isComponent(value)) return undefined;
	const source: unknown = Reflect.get(value, LAZY_SOURCE_EXPORT);

	return typeof source === 'string' ? source : undefined;
};

/** The statement a compiled client module appends for each `.svelte` file
 *  it imports dynamically, registering `source id → () => import(chunk)`,
 *  so the hydration entry can load the module a lazy route rendered on the
 *  server before it hydrates. Used by the build (compileSvelte) and the dev
 *  module server. */
export const lazyModuleRegistration = (sourceId: string, specifier: string) =>
	`\n;(globalThis[Symbol.for("absolutejs.svelte.lazy-modules")] ??= new Map()).set(${JSON.stringify(sourceId)}, () => import(${JSON.stringify(specifier)}));`;

/** The compiler-stamped source id of a loader result, from the module
 *  namespace or from the component itself. */
export const readLazySource = (value: unknown) => {
	const fromValue = readSourceFrom(value);
	if (fromValue !== undefined) return fromValue;
	if (!isRecord(value)) return undefined;

	return readSourceFrom(value.default);
};

/** The module the hydration entry loaded for `pattern` before hydrating,
 *  if any. */
export const readSeededLazy = (pattern: string) => {
	if (typeof window === 'undefined') return undefined;
	const seeded: unknown = Reflect.get(globalThis, LAZY_RESOLVED_KEY);
	if (!isRecord(seeded)) return undefined;

	return toLazyComponent(seeded[pattern]);
};
