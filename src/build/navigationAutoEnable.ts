/* `navigation: true` in absolute.config.ts — install the cross-framework
 * navigation layer from every hydration index, so an app does not call
 * `enableNavigation()` by hand on every page.
 *
 * The layer is opt-in per page by design (navigation plan §3: "call it
 * from every page that should take part"), and that is right for a page
 * that wants to stay out. It is the wrong default for an app that wants
 * all of them in: the call has to be repeated in every page component,
 * in a `useEffect` or an `onMount` or an `ngOnInit`, and forgetting it on
 * one page silently turns every link out of that page into a full
 * document load. Every test fixture written for this feature had to write
 * the call by hand, which is a fair signal.
 *
 * Set from the build config rather than threaded through four generator
 * signatures (`generateReactIndexFiles`, `compileSvelte`, `compileVue`,
 * `compileAngular`), each of which takes positional optionals already.
 * `build()` sets it on every run from the config it was given, so a
 * second build in the same process — a dev rebuild, or the next test —
 * overwrites it rather than inheriting it. Same shape as
 * `setSvelteVendorPaths` and `setCurrentIslandManifest`.
 *
 * Not covered: a STATIC HTML or HTMX page that is the entry point. It has
 * no hydration index to inject into, so it still loads the client module
 * and calls `enableNavigation()` itself. One swapped in by another page
 * needs nothing — the layer marks it as having no framework app to tear
 * down (client/navigation.ts). */

let autoEnabled = false;

/** Called by `build()` from `config.navigation`. */
export const setNavigationAutoEnable = (value: boolean) => {
	autoEnabled = value;
};

export const navigationAutoEnabled = () => autoEnabled;

/* Appended to the END of a hydration index. The import hoists, so the
 * call runs after the page has mounted — which is where the documented
 * API says to call it from (a React effect, a Svelte `onMount`), and it
 * matters: `enableNavigation()` marks a page with no teardown hook as
 * having nothing to tear down, so it has to run after an index has
 * registered its real one. */
export const NAVIGATION_AUTO_ENABLE_SOURCE = `
import { enableNavigation as __absoluteEnableNavigation__ } from '@absolutejs/absolute/client/navigation';
if (typeof window !== 'undefined') __absoluteEnableNavigation__();
`;

/** `source` with the auto-enable snippet appended when the config asked
 *  for it, unchanged otherwise. */
export const withNavigationAutoEnable = (source: string) =>
	autoEnabled ? `${source}\n${NAVIGATION_AUTO_ENABLE_SOURCE}` : source;
