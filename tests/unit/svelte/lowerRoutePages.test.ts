import { describe, expect, test } from 'bun:test';
import { compile, parse } from 'svelte/compiler';
import { lowerSvelteRoutePages } from '../../../src/svelte/lowerRoutePages';

const page = (routes: string, extraImports = '') => `<script lang="ts">
	import Router from '@absolutejs/absolute/svelte/router/Router.svelte';
	import Route from '@absolutejs/absolute/svelte/router/Route.svelte';
	import Editor from './Editor.svelte';
	import Home from './Home.svelte';${extraImports}
	let { url }: { url?: string } = $props();
</script>

<Router {url}>
${routes}
</Router>
`;

const lower = (source: string) => lowerSvelteRoutePages(source, parse);
const compiles = (source: string) =>
	compile(source, { filename: 'Page.svelte', generate: 'client' }).js.code
		.length > 0;

describe('Svelte router pages load lazily', () => {
	test('a page alone in its content snippet becomes a loader', () => {
		const out =
			lower(
				page(`	<Route path="/">
		{#snippet content()}<Home />{/snippet}
	</Route>`)
			) ?? '';

		expect(out).toContain(
			`<Route path="/" loader={() => import("./Home.svelte")}>`
		);
		expect(out).not.toContain('{#snippet content()}');
		expect(out).not.toContain(`import Home from './Home.svelte';`);
		expect(compiles(out)).toBe(true);
	});

	test('a route param passed under its own name is dropped; other props move to props', () => {
		const out =
			lower(
				page(`	<Route path="/editor/:id">
		{#snippet content(params)}<Editor id={params.id} readOnly={false} label="Edit" />{/snippet}
	</Route>`)
			) ?? '';

		expect(out).toContain(
			`loader={() => import("./Editor.svelte")} props={{ readOnly: false, label: "Edit" }}`
		);
		expect(out).not.toContain('params.id');
		expect(compiles(out)).toBe(true);
	});

	test('a prop computed from the params stays as written', () => {
		const source = page(`	<Route path="/editor/:id">
		{#snippet content(params)}<Editor id={Number(params.id)} />{/snippet}
	</Route>`);

		expect(lower(source)).toBeNull();
	});

	test('a snippet holding more than the page stays as written', () => {
		const source = page(`	<Route path="/">
		{#snippet content()}<h1>Hi</h1><Home />{/snippet}
	</Route>`);

		expect(lower(source)).toBeNull();
	});

	test('a page the file also uses elsewhere stays eager', () => {
		const source = page(`	<Route path="/">
		{#snippet content()}<Home />{/snippet}
	</Route>
	<Home />`);

		expect(lower(source)).toBeNull();
	});

	test('a page used by two routes splits both, and its pending/error snippets stay', () => {
		const out =
			lower(
				page(`	<Route path="/">
		{#snippet content()}<Home />{/snippet}
		{#snippet pending()}<p>Loading</p>{/snippet}
	</Route>
	<Route path="/home">
		{#snippet content()}<Home />{/snippet}
	</Route>`)
			) ?? '';

		expect(
			out.match(/loader=\{\(\) => import\("\.\/Home\.svelte"\)\}/g)
				?.length
		).toBe(2);
		expect(out).toContain('{#snippet pending()}<p>Loading</p>{/snippet}');
		expect(compiles(out)).toBe(true);
	});

	test('a spread or a package component stays as written', () => {
		expect(
			lower(
				page(`	<Route path="/">
		{#snippet content()}<Home {...$$restProps} />{/snippet}
	</Route>`)
			)
		).toBeNull();
		expect(
			lower(
				page(
					`	<Route path="/docs">
		{#snippet content()}<Docs />{/snippet}
	</Route>`,
					`\n\timport Docs from '@acme/docs/Docs.svelte';`
				)
			)
		).toBeNull();
	});

	test('a file with no router is left alone', () => {
		expect(
			lower(`<script>import Home from './Home.svelte';</script><Home />`)
		).toBeNull();
	});
});
