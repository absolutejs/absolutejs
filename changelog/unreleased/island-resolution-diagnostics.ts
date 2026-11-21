import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: 'An island whose component did not resolve returned silently — no throw, no log, no `data-error` attribute. The element kept its server markup and simply never came alive, which is indistinguishable from the island runtime never having run, and it left every island problem undiagnosable: two separate production defects in static-page islands hid behind it for eight debugging rounds. All four framework branches now throw instead, which routes the failure through the same path as any other hydration error, so `hydrateIsland` writes the message to `data-error` on the element and logs it with the framework and component name. The message names what was resolved instead of a component and points at the three things that cause it: the component missing from the island registry, its island bundle failing to load, and its framework directory not being configured so the build never compiled it.',
	kind: 'changed',
	summary: 'An island that cannot resolve its component now says so'
};
