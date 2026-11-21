import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: 'The HTMX row of the cross-framework navigation matrix. Whether the swap works was already settled — an HTMX page is a static page — so what this covers is whether htmx still binds a body the navigation layer inserted. It does: the page\'s htmx `<script src>` is a classic script, so re-inserting it re-executes it and htmx initialises against the new document, which is why the layer never needs to call `htmx.process` the way the dev HMR handler does. Asserted by clicking a button whose only behaviour is `hx-get`, so an unbound page produces nothing. The test carries a control that enters the page directly, which is what caught the first draft shipping no htmx vendor copy — an app provides its own, globbed out of its htmx directory by the build — rather than letting a fixture gap read as a navigation defect. With the Vue, Angular, HTML and island rows, every framework now has a verified row. Two parts of navigation phase 2\'s exit wording are still not literally met and are recorded as such: "with islands" is verified only on the React to Svelte leg, and "no leaked roots" is verified behaviourally rather than with a heap snapshot.',
	kind: 'internal',
	summary: 'HTMX is a verified row in the cross-framework navigation matrix'
};
