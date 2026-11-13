import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "`SuspenseSlot` rendered its resolved content with React's `renderToStaticMarkup`, but `absolute start` strips React's legacy string renderer out of the production server bundle to save about 4,000 lines. In production every SuspenseSlot patch failed with `renderToStaticMarkup is not a function`, so the fallback stayed on the page. The slot now renders with `renderToReadableStream`, which the bundle keeps.",
	kind: 'fixed',
	summary: 'React `SuspenseSlot` content streams in production builds',
	symbols: ['SuspenseSlot']
};
