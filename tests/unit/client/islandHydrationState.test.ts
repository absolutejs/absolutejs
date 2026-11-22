import { describe, expect, test } from 'bun:test';
import { islandHydrationState } from '../../../src/client/islandHydrationState';

/* The defect this guards is not "two sets" but "two copies of the module
 * that owns the sets", so the test has to produce a second copy rather
 * than a second call. A module URL evaluates once, so importing the same
 * file under a different URL is what makes another instance of it — which
 * is exactly how the real one appeared: a soft navigation re-runs a page's
 * entry under `?absolute-nav=N` (client/navigation.ts), the islands
 * bootstrap is one of those entries, and every visit left another runtime
 * watching the document and hydrating islands past its own private guard.
 *
 * Importing with a query here is therefore the mechanism under test, not a
 * trick to get around the module cache. */
type StateModule = { islandHydrationState: typeof islandHydrationState };

/* Assembled rather than written out: a query-suffixed specifier is a real
 * URL to the runtime and an unresolvable module path to TypeScript. */
const MODULE_PATH = '../../../src/client/islandHydrationState.ts';

const secondInstance = async () => {
	const loaded = (await import(`${MODULE_PATH}?instance=2`)) as StateModule;

	return loaded.islandHydrationState;
};

describe('the islands runtime hydration state', () => {
	test('is the same store in a second copy of the module', async () => {
		const first = islandHydrationState();
		const second = (await secondInstance())();

		expect(second.hydrating).toBe(first.hydrating);
		expect(second.observed).toBe(first.observed);
	});

	test('shows one copy what another has already started', async () => {
		const element = { nodeType: 1 } as unknown as HTMLElement;
		const root = { nodeType: 9 } as unknown as Node;
		const first = islandHydrationState();
		first.hydrating.add(element);
		first.observed.add(root);
		const second = (await secondInstance())();

		expect(second.hydrating.has(element)).toBe(true);
		expect(second.observed.has(root)).toBe(true);
	});
});
