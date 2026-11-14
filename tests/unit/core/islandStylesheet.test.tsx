import { afterEach, describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import {
	findIslandStylesheet,
	INLINE_ISLAND_STYLES_CONTEXT_KEY
} from '../../../src/core/islandStylesheet';
import { setCurrentIslandManifest } from '../../../src/core/islandPageContext';
import { IslandWithStylesheet } from '../../../src/react/IslandStyleLink';
import { registerCspNonceGetter } from '../../../src/utils/cspNonceRef';
import { claimInlineIslandStyleLink } from '../../../src/vue/islandStyleLink';

const manifest: Record<string, string> = {
	IslandStyleSvelteCounter: '/islands/svelte/Counter.abc.css'
};

const counter = { component: 'Counter', framework: 'svelte' } as const;

afterEach(() => {
	registerCspNonceGetter(() => undefined);
});

describe('island stylesheets on the server', () => {
	test('come from the build manifest', () => {
		setCurrentIslandManifest(manifest);

		expect(findIslandStylesheet('svelte', 'Counter')).toEqual({
			href: '/islands/svelte/Counter.abc.css',
			key: 'IslandStyleSvelteCounter'
		});
		expect(findIslandStylesheet('vue', 'Counter')).toBeUndefined();
		expect(findIslandStylesheet('ember', 'Counter')).toBeUndefined();
	});

	test('React hoists one link per stylesheet, with the nonce', () => {
		setCurrentIslandManifest(manifest);
		registerCspNonceGetter(() => 'abc123');
		const html = renderToString(
			<>
				<IslandWithStylesheet {...counter} marker={{ id: 'one' }} />
				<IslandWithStylesheet {...counter} marker={{ id: 'two' }} />
			</>
		);
		const links = html.match(/<link\b[^>]*>/g) ?? [];

		expect(links).toHaveLength(1);
		expect(links[0]).toContain('href="/islands/svelte/Counter.abc.css"');
		expect(links[0]).toContain('nonce="abc123"');
		expect(links[0]).toContain(
			'data-island-style="IslandStyleSvelteCounter"'
		);
		expect(html).toContain('<div id="one"></div><div id="two"></div>');
	});

	test('a streamed Vue render links each stylesheet once', () => {
		setCurrentIslandManifest(manifest);
		registerCspNonceGetter(() => 'abc123');
		const ssrContext: Record<string, unknown> = {
			[INLINE_ISLAND_STYLES_CONTEXT_KEY]: new Set<string>()
		};

		expect(claimInlineIslandStyleLink(ssrContext, counter)).toEqual({
			'data-island-style': 'IslandStyleSvelteCounter',
			href: '/islands/svelte/Counter.abc.css',
			nonce: 'abc123',
			rel: 'stylesheet'
		});
		expect(claimInlineIslandStyleLink(ssrContext, counter)).toBeNull();
		expect(
			claimInlineIslandStyleLink(ssrContext, {
				component: 'Counter',
				framework: 'vue'
			})
		).toBeNull();
	});

	test('a whole-document Vue render links nothing inline', () => {
		setCurrentIslandManifest(manifest);

		expect(claimInlineIslandStyleLink({}, counter)).toBeNull();
		expect(claimInlineIslandStyleLink(undefined, counter)).toBeNull();
	});
});
