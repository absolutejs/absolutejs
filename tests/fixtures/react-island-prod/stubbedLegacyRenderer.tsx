import { expect, mock, test } from 'bun:test';
import { useState } from 'react';

/* Mirrors the production server bundle from `absolute start`, which stubs
 * React's legacy string renderer (renderToString / renderToStaticMarkup)
 * out of react-dom/server. Run in its own process by
 * tests/unit/core/reactIslandProductionRenderer.test.ts, because
 * mock.module applies to the whole test process. */
const realServer = await import('react-dom/server');
mock.module('react-dom/server', () => ({
	...realServer,
	renderToStaticMarkup: undefined,
	renderToString: undefined
}));

const { renderReactIslandToHtml } = await import('../../../src/core/islandSsr');

const Counter = ({ start }: { start: number }) => {
	const [count] = useState(start);

	return <output className="counter">COUNT {count}</output>;
};

test('React islands render without the legacy string renderer', async () => {
	const html = await renderReactIslandToHtml(Counter, { start: 7 });

	expect(html).toBe('<output class="counter">COUNT <!-- -->7</output>');
});
