import {
	type ComponentType,
	createElement,
	type ReactNode,
	Suspense,
	use
} from 'react';

// What a page component takes: its props when it is one, else nothing.
type PropsOf<Value> = Value extends ComponentType<infer Props> ? Props : never;

// The module's exports that are components (a page module also exports
// types and helpers).
type ComponentExports<Module> = {
	[Name in keyof Module]: [PropsOf<Module[Name]>] extends [never]
		? never
		: Name;
}[keyof Module];

const isComponent = <Props>(value: unknown): value is ComponentType<Props> =>
	typeof value === 'function' ||
	(typeof value === 'object' && value !== null);

export type LazyRouteOptions = {
	/** Shown while a client-side navigation waits for the page's code.
	 *  Navigations run in a transition, so the page being left normally
	 *  stays on screen instead; this shows only when nothing can (a page
	 *  that suspends outside one). Defaults to nothing. */
	pending?: ReactNode;
};

export type LazyRoute<Props> = ComponentType<Props> & {
	/** Starts loading the page's code (a link's hover, say); resolves once
	 *  it is in. Loading twice costs nothing. */
	preload: () => Promise<void>;
};

/**
 * A page of a React SPA whose code loads the first time it is shown, not
 * with the rest of the app: `element={<Billing />}` where
 *
 *   const Billing = lazyRoute(() => import('./BillingView'), 'BillingView');
 *
 * The build puts the page in its own chunk (React client bundles split at
 * dynamic imports), so the app's entry no longer carries every page.
 *
 * - On the server the page renders in full, so the HTML is complete. Its
 *   module starts loading as soon as the route is defined, so a request
 *   never waits on it.
 * - In the browser the page sits in its own Suspense boundary. While its
 *   chunk loads during hydration, React keeps the server's HTML for it and
 *   hydrates everything else (the layout, its navigation) right away; the
 *   page hydrates when its code arrives. No blank, no mismatch.
 * - A page loaded once renders at once afterwards: going back to it never
 *   waits again.
 */
export const lazyRoute = <
	Module,
	Name extends ComponentExports<Module>,
	Props extends object = PropsOf<Module[Name]> & object
>(
	load: () => Promise<Module>,
	name: Name,
	options: LazyRouteOptions = {}
) => {
	let resolved: ComponentType<Props> | null = null;
	let loading: Promise<ComponentType<Props>> | null = null;

	const start = () => {
		loading ??= load().then(
			(module) => {
				const component: unknown = module[name];
				if (!isComponent<Props>(component))
					throw new Error(
						`lazyRoute: the module has no component named "${String(name)}".`
					);
				resolved = component;

				return resolved;
			},
			(error: unknown) => {
				// A failed load (a dropped connection, a deploy that removed
				// the chunk) is retried by the next render, not cached.
				loading = null;
				throw error;
			}
		);

		return loading;
	};

	// The server has every module on disk: start now, so the first request
	// renders the page instead of suspending on it.
	if (typeof window === 'undefined') void start().catch(() => undefined);

	const Page = (props: Props) =>
		createElement(resolved ?? use(start()), props);

	const Route = (props: Props) =>
		createElement(
			Suspense,
			{ fallback: options.pending ?? null },
			createElement(Page, props)
		);
	Route.displayName = `lazyRoute(${String(name)})`;

	return Object.assign(Route, {
		preload: () => start().then(() => undefined)
	}) satisfies LazyRoute<Props>;
};
