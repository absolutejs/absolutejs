import { expect, mock, test } from 'bun:test';

/* Mirrors the production server bundle from `absolute start`, which stubs
 * React's legacy string renderer (renderToString / renderToStaticMarkup)
 * out of react-dom/server. Run in its own process by
 * tests/unit/react/suspenseSlotProductionRenderer.test.ts, because
 * mock.module applies to the whole test process. */
const realServer = await import('react-dom/server');
mock.module('react-dom/server', () => ({
	...realServer,
	renderToStaticMarkup: undefined,
	renderToString: undefined
}));

const { handleReactPageRequest } = await import('../../../src/react');
const { SuspenseSlot } = await import('../../../src/react/components');

const Page = () => (
	<html lang="en">
		<body>
			<SuspenseSlot
				fallback={<p>loading</p>}
				id="prod-suspense"
				promise={Promise.resolve('resolved in production')}
			>
				{(value: string) => <section>{value}</section>}
			</SuspenseSlot>
		</body>
	</html>
);

test('SuspenseSlot resolves without the legacy string renderer', async () => {
	const response = await handleReactPageRequest({
		collectStreamingSlots: true,
		index: '/react-index.js',
		Page
	});
	const html = await response.text();

	expect(html).toContain('resolved in production');
	expect(html).not.toContain('is not a function');
});
