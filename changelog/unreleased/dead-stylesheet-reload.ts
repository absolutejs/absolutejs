import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: 'In `absolute dev`, a stylesheet whose source was deleted was refetched on every style update, twice, forever: the HMR client reloads every `<link rel="stylesheet">` on each update and kept the dead link in place after its 404. A page left open while an agent rewrote the project sent thousands of requests for one deleted stylesheet. The client now asks once why a reload failed: a 404 or 410 disables that link (it stays in the document for the framework that rendered it) and it is not fetched again until the manifest points it at a different file; any other failure (a rate limit, a dropped connection) backs off from 1 second up to a minute. The dev server also stopped sending a Tailwind style update for every saved file that Tailwind scans; it now sends one only when the generated CSS changed. `compileTailwind` returns whether its output changed.',
	kind: 'fixed',
	summary:
		'Dev no longer refetches a deleted stylesheet on every update, and sends Tailwind style updates only when the CSS changed',
	symbols: ['build', 'compileTailwind', 'compileTailwindConfig']
};
