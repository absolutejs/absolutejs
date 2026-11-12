import type { GotoOptions } from '../../../types/svelteRouter';
import { navigate } from './navigation';

export { setRouterMode } from './navigation';

/**
 * Programmatically navigate to a URL. Runs the navigation guards
 * (`beforeNavigate`, `<Router guard>`, `<Route guard>`), then updates
 * `page.url`, writes history, swaps the route (inside
 * `document.startViewTransition` when supported) and scrolls: to the
 * `#hash` target when the URL has one, otherwise to the top — unless
 * `noScroll` is set.
 *
 * Resolves to what happened: `'committed'`, `'cancelled'` (a guard said
 * no), `'redirected'`, `'superseded'` (a newer navigation started while a
 * guard was pending) or `'external'` (another origin; the browser loads it).
 *
 * Mirrors SvelteKit's `goto` from `$app/navigation` — same name, same
 * options shape, so a SvelteKit user finds the primitive familiar.
 */
export const goto = (target: string, options: GotoOptions = {}) =>
	navigate(target, options, 'goto');
