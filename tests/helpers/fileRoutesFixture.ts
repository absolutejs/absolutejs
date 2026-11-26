import { mkdir, readdir, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

/* A small app that opts into file routes (every framework: React, Svelte,
 * Vue, Angular, HTML, HTMX).
 * Written from
 * strings so the repo typecheck never sees its `@absolutejs/absolute`
 * imports, which resolve to an older published package from the repo root. */

const repoRoot = resolve(import.meta.dir, '..', '..');

const CONFIG = `import { defineConfig } from '@absolutejs/absolute';

export default defineConfig({
	angularDirectory: './angular',
	buildDirectory: './build',
	fileRoutes: { output: './routes.gen.ts' },
	islands: { registry: './islands/registry.ts' },
	navigation: true,
	htmlDirectory: './html',
	htmxDirectory: './htmx',
	reactDirectory: './react',
	// A pattern: the pages are the ones the route's entries() names.
	static: { routes: ['/blog/:slug'] },
	svelteDirectory: './svelte',
	vueDirectory: './vue'
});
`;

const SERVER = `import { Elysia } from 'elysia';
import { fileRoutes, networking, prepare } from '@absolutejs/absolute';
import { routeTree } from './routes.gen';

const { absolutejs, manifest } = await prepare();

export const server = new Elysia()
	.use(absolutejs)
	.get('/explicit-first', () => 'EXPLICIT_FIRST')
	.use(fileRoutes(routeTree, manifest))
	.get('/about', () => 'EXPLICIT_ABOUT')
	.use(networking);
`;

const reactDocument = (title: string, body: string) => `<html lang="en">
			<head>
				<title>${title}</title>
			</head>
			<body>
				${body}
			</body>
		</html>`;

export const FILE_ROUTES_FIXTURE: Record<string, string> = {
	'absolute.config.ts': CONFIG,
	/* Two Angular layouts, so the chain's ORDER is observable. A layout
	 * takes its content through `<ng-content />`, and it has to declare a
	 * `selector`: the wrap writes the layout into the page's template, and
	 * a template names a component by its selector. */
	'angular/routes/layout.ts': `import { Component } from '@angular/core';

@Component({
	selector: 'abs-ng-shell',
	standalone: true,
	template: \`<div id="ng-root-layout">NG_ROOT_LAYOUT<ng-content /></div>\`
})
export class NgRootLayout {}
`,
	/* An Angular route. Its `load` returns the page's request CONTEXT —
	 * Angular components take no props — which the component reads with
	 * `usePageContext`. The `Context` export is what the generated module
	 * types that `load` against. */
	'angular/routes/reports/[period].server.ts': `import type { FileRouteContext } from '@absolutejs/absolute';

export const load = ({ params }: FileRouteContext<'/reports/:period'>) => ({
	period: \`PERIOD_\${params.period}\`
});
`,
	'angular/routes/reports/[period].ts': `import { Component, inject, REQUEST_CONTEXT } from '@angular/core';

export type Context = { period: string };

@Component({
	selector: 'abs-report-page',
	standalone: true,
	template: \`<main><p id="period">{{ period }}</p></main>\`
})
export class ReportPageComponent {
	private readonly ctx = inject(REQUEST_CONTEXT, {
		optional: true
	}) as Context | null;
	period = this.ctx?.period ?? 'NO_CONTEXT';
}
`,
	'angular/routes/reports/layout.ts': `import { Component } from '@angular/core';

@Component({
	selector: 'abs-ng-reports',
	standalone: true,
	template: \`<section id="ng-reports-layout">NG_REPORTS_LAYOUT<ng-content /></section>\`
})
export class NgReportsLayout {}
`,
	'html/pages/HtmlHome.html': `<!doctype html>
<html lang="en"><head><title>Home</title></head>
<body><p>HTML_PAGE_HOME</p></body></html>
`,
	/* A static route with a partial it includes. The partial lives outside
	 * `routes/`, and `<abs-include>` resolves against the page's SOURCE
	 * location — which is why a route's output tree mirrors its source
	 * folder instead of being flattened into `pages/`. */
	'html/partials/_banner.html': `<p id="banner">HTML_BANNER</p>
`,
	'html/routes/(site)/handbook.html': `<!doctype html>
<html lang="en"><head><title>Handbook</title></head>
<body>
	<p id="handbook">HTML_ROUTE_HANDBOOK</p>
	<abs-include src="../../partials/_banner.html"></abs-include>
</body></html>
`,
	'htmx/routes/panel.html': `<!doctype html>
<html lang="en"><head><title>Panel</title></head>
<body><p id="panel">HTMX_ROUTE_PANEL</p></body></html>
`,
	/* The three Phase 2 segment kinds. A catch-all reads its param under
	 * the name the file gave it, not Elysia's `*`; an optional segment
	 * serves two paths from this one file, and its `load` runs on both; a
	 * group contributes no path segment at all. */
	/* An island declared ONCE, in a layout. Every route under that layout
	 * renders it, so a `persist` key written in one place is the key both
	 * pages of a navigation produce — which is what the navigation layer
	 * matches on. It records its own mounts so a test can tell a moved
	 * instance from a re-created one. */
	'islands/Counter.svelte': `<script lang="ts">
	import { onDestroy, onMount } from 'svelte';

	let ticks = $state(0);
	let timer: ReturnType<typeof setInterval> | undefined;

	const scope = () => (typeof window === 'undefined' ? undefined : window);

	onMount(() => {
		const target = scope();
		if (target) {
			const mounts = Reflect.get(target, '__counterMounts');
			Reflect.set(
				target,
				'__counterMounts',
				(typeof mounts === 'number' ? mounts : 0) + 1
			);
		}
		timer = setInterval(() => {
			ticks += 1;
		}, 50);
	});

	onDestroy(() => {
		if (timer !== undefined) clearInterval(timer);
		const target = scope();
		if (target) Reflect.set(target, '__counterDestroyed', true);
	});
</script>

<div id="counter-island">
	<input id="counter-draft" placeholder="type here" />
	<output id="counter-ticks">{ticks}</output>
</div>
`,
	'islands/registry.ts': `import { defineIslandRegistry } from '@absolutejs/absolute/islands';
import Counter from './Counter.svelte';

export const islandRegistry = defineIslandRegistry({ svelte: { Counter } });
`,
	'package.json': JSON.stringify(
		{ name: 'file-routes-fixture', private: true, type: 'module' },
		null,
		'\t'
	),
	/* The `loading` convention: markup the navigation layer shows while a
	 * soft navigation is in flight. A fragment, not a page — it is
	 * inserted into the live document. */
	'react/pages/loading.tsx': `export default function Loading() {
	return <div id="nav-loading">NAVIGATING</div>;
}
`,
	'react/routes/_parts/Shell.tsx': `import type { ReactNode } from 'react';

export const Shell = ({ children }: { children: ReactNode }) => (
	<main id="shell">{children}</main>
);
`,
	/* Nested layouts. `routes/layout.tsx` wraps every React route;
	 * `routes/(marketing)/layout.tsx` wraps the group inside it. The
	 * group matters: it contributes no path segment, so this is a layout
	 * that applies to a set of pages without appearing in their URLs. */
	/* The outer layout of the chain: it owns the document, because a page
	 * under layouts renders a fragment. The inline script marks every
	 * element the server sent, so a test can tell a kept tree from a
	 * re-rendered one. */
	'react/routes/(marketing)/layout.tsx': `import { Island } from '@absolutejs/absolute/react';
import type { ReactNode } from 'react';

export default function MarketingLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="en">
			<head>
				<title>Layouts</title>
			</head>
			<body>
				<div id="marketing-layout">
					<Island
						component="Counter"
						framework="svelte"
						hydrate="load"
						persist="marketing-counter"
						props={{}}
					/>
					{children}
				</div>
				<script
					dangerouslySetInnerHTML={{
						__html: "for (const el of document.querySelectorAll('[id]')) el.setAttribute('data-from-server', '1');"
					}}
				/>
			</body>
		</html>
	);
}
`,
	/* A sibling under the same two layouts, so a navigation between them
	 * stays inside the layout that owns the island. */
	'react/routes/(marketing)/plans/compare.tsx': `export default function Compare() {
	return (
		<p id="compare">
			FILE_COMPARE
			<a href="/plans/pricing" id="to-pricing">pricing</a>
		</p>
	);
}
`,
	'react/routes/(marketing)/plans/layout.tsx': `import type { ReactNode } from 'react';

export default function PlansLayout({ children }: { children: ReactNode }) {
	return <section id="plans-layout">{children}</section>;
}
`,
	'react/routes/(marketing)/plans/pricing.tsx': `import { useEffect, useState } from 'react';

export default function Pricing() {
	const [clicks, setClicks] = useState(0);

	useEffect(() => {
		Reflect.set(window, '__pricingHydrated', true);
	}, []);

	return (
		<p id="pricing">
			FILE_PRICING
			<button id="pricing-clicks" onClick={() => setClicks(clicks + 1)}>
				clicks {clicks}
			</button>
			<a href="/plans/compare" id="to-compare">compare</a>
			<a href="/plans/slow" id="to-slow">slow</a>
			<a href="/blog" id="to-blog">blog</a>
		</p>
	);
}
`,
	/* A deliberately slow route, so a navigation to it outlasts the
	 * indicator's delay. The sleep is in `load`, which runs before the
	 * page renders — the same place a real app's database call would be. */
	'react/routes/(marketing)/plans/slow.server.ts': `export const load = async () => {
	await new Promise((done) => setTimeout(done, 900));

	return { label: 'SLOW_READY' };
};
`,
	'react/routes/(marketing)/plans/slow.tsx': `export default function Slow({ label }: { label: string }) {
	return <p id="slow">{label}</p>;
}
`,
	'react/routes/[[lang]]/guide.server.ts': `import type { FileRouteContext } from '@absolutejs/absolute';

export const load = ({ params }: FileRouteContext<'/:lang?/guide'>) => ({
	lang: params.lang ?? 'none'
});
`,
	/* The language goes in its own element rather than beside static text:
	 * React SSR separates an interpolated value from the text around it
	 * with a `<!-- -->` comment, so `FILE_GUIDE_{lang}` renders as
	 * `FILE_GUIDE_<!-- -->none` and a `toContain` over the pair fails for a
	 * reason that has nothing to do with routing. */
	'react/routes/[[lang]]/guide.tsx': `type GuideProps = { lang: string; url?: string };

export default function Guide({ lang }: GuideProps) {
	return (
		${reactDocument(
			'Guide',
			'<p id="guide">FILE_GUIDE</p>\n\t\t\t\t<p id="lang">{lang}</p>'
		)}
	);
}
`,
	'react/routes/about.tsx': `export default function About() {
	return (
		${reactDocument('About', '<p>FILE_ABOUT</p>')}
	);
}
`,
	'react/routes/blog/[slug].server.ts': `import type { FileRouteContext } from '@absolutejs/absolute';

export const beforeHandle = ({ params, redirect }: FileRouteContext<'/blog/:slug'>) =>
	params.slug === 'secret' ? redirect('/') : undefined;

export const load = ({ params, query }: FileRouteContext<'/blog/:slug'>) => ({
	title: \`POST_\${params.slug.toUpperCase()}\`,
	view: query.view ?? 'full'
});

/* The param sets a build can enumerate — the sitemap today. Typed
   against the route, so a renamed [slug] fails here too. */
export const entries = () => [{ slug: 'hello' }, { slug: 'world' }];
`,
	'react/routes/blog/[slug].tsx': `import { useState } from 'react';
import { Shell } from '../_parts/Shell';

type PostProps = { title: string; view: string; url?: string };

export default function Post({ title, view }: PostProps) {
	const [count, setCount] = useState(0);

	return (
		<html lang="en">
			<head>
				<title>{title}</title>
			</head>
			<body>
				<Shell>
					<h1 id="title">{title}</h1>
					<p id="view">{view}</p>
					<button id="count" onClick={() => setCount(count + 1)}>
						count {count}
					</button>
				</Shell>
			</body>
		</html>
	);
}
`,
	'react/routes/blog/index.tsx': `export default function Blog() {
	return (
		${reactDocument('Blog', '<p id="blog-page">FILE_BLOG_INDEX</p>')}
	);
}
`,
	'react/routes/explicit-first.tsx': `export default function ExplicitFirst() {
	return (
		${reactDocument('Explicit first', '<p>FILE_EXPLICIT_FIRST</p>')}
	);
}
`,
	'react/routes/index.tsx': `export default function Home() {
	return (
		${reactDocument('Home', '<p>FILE_HOME</p>')}
	);
}
`,
	/* `ssr = false`: the browser renders these, and the server sends a
	 * shell. The React page reads `window` as its MODULE loads, not just
	 * when it renders — the case of a browser-only library — so it also
	 * proves the page module is never imported on the server. Its `load`
	 * still runs there and hands over the label. */
	'react/routes/live/board.server.ts': `export const ssr = false;

export const load = () => ({ label: 'BOARD_PROP' });
`,
	'react/routes/live/board.tsx': `import { useState } from 'react';

// Throws on a server, at import: there is no window there.
const loadedAt = window.location.pathname;

export default function Board({ label }: { label: string; url?: string }) {
	const [clicks, setClicks] = useState(0);

	return (
		${reactDocument(
			'Board',
			`<main id="live-board" data-loaded-at={loadedAt}>
					<p id="board-label">{label}</p>
					<button id="board-clicks" onClick={() => setClicks(clicks + 1)}>
						clicks {clicks}
					</button>
				</main>`
		)}
	);
}
`,
	/* Folder guards. `vault/layout.server.ts` stands in front of every
	 * route under `/vault`, and `vault/deep/layout.server.ts` in front of
	 * the ones under `/vault/deep` as well, so the deep route is reached
	 * only through both, outer first. Keyed on the query string so a test
	 * needs no cookie jar. */
	'react/routes/vault/deep/box.tsx': `export default function Box() {
	return (
		${reactDocument('Box', '<p>FILE_VAULT_BOX</p>')}
	);
}
`,
	'react/routes/vault/deep/layout.server.ts': `import type { FileRouteContext } from '@absolutejs/absolute';

export const beforeHandle = ({ query }: FileRouteContext) =>
	query.level === '2'
		? undefined
		: new Response('DEEP_GUARD_REFUSED', { status: 403 });
`,
	'react/routes/vault/door.tsx': `export default function Door() {
	return (
		${reactDocument('Door', '<p>FILE_VAULT_DOOR</p>')}
	);
}
`,
	'react/routes/vault/layout.server.ts': `import type { FileRouteContext } from '@absolutejs/absolute';

export const beforeHandle = ({ query, redirect }: FileRouteContext) =>
	query.key === 'open' ? undefined : redirect('/');
`,
	'server.ts': SERVER,
	'svelte/routes/docs/_Badge.svelte': `<script lang="ts">
	let { label }: { label: string } = $props();
</script>

<span class="badge">{label}</span>
`,
	'svelte/routes/docs/[...rest].server.ts': `import type { FileRouteContext } from '@absolutejs/absolute';

export const load = ({ params }: FileRouteContext<'/docs/:rest'>) => ({
	rest: params.rest
});

// A catch-all's entry is a path, so its value keeps its slashes.
export const entries = () => [{ rest: 'guide/routing' }];
`,
	'svelte/routes/docs/[...rest].svelte': `<script lang="ts">
	let { rest }: { rest: string; url?: string } = $props();
</script>

<h1 id="rest">CATCH_{rest}</h1>
`,
	'svelte/routes/docs/[topic].server.ts': `import type { FileRouteContext } from '@absolutejs/absolute';

export const load = ({ params }: FileRouteContext<'/docs/:topic'>) => ({
	topic: \`TOPIC_\${params.topic}\`
});
`,
	'svelte/routes/docs/[topic].svelte': `<script lang="ts">
	import Badge from './_Badge.svelte';

	let { topic }: { topic: string; url?: string } = $props();
	let clicks = $state(0);
</script>

<h1 id="topic">{topic}</h1>
<Badge label="SVELTE_CHILD" />
<button id="clicks" onclick={() => (clicks += 1)}>clicks {clicks}</button>
`,
	'svelte/routes/docs/index.svelte': `<h1>SVELTE_DOCS_INDEX</h1>
`,
	'svelte/routes/guides/[topic].server.ts': `import type { FileRouteContext } from '@absolutejs/absolute';

export const load = ({ params }: FileRouteContext<'/guides/:topic'>) => ({
	topic: \`GUIDE_\${params.topic}\`
});
`,
	/* A Svelte route under two layouts. Svelte wraps them in the page's
	 * source, so the server and the client load one module and cannot
	 * disagree — the opposite of React, where two composition sites have
	 * to be kept in step. A layout takes its content the Svelte 5 way,
	 * through `children`. */
	'svelte/routes/guides/[topic].svelte': `<script lang="ts">
	let { topic }: { topic: string; url?: string } = $props();
	let clicks = $state(0);

	// Browser only, once the page is live: what a test waits for before
	// it clicks.
	$effect(() => {
		Reflect.set(window, '__guideHydrated', true);
	});
</script>

<svelte:head><title>Guide</title></svelte:head>

<h1 id="guide-topic">{topic}</h1>
<button id="guide-clicks" onclick={() => (clicks += 1)}>clicks {clicks}</button>
`,
	'svelte/routes/guides/layout.svelte': `<script lang="ts">
	let { children }: { children: () => unknown } = $props();
</script>

<section id="guides-layout">{@render children()}</section>
`,
	'svelte/routes/layout.svelte': `<script lang="ts">
	let { children }: { children: () => unknown } = $props();
</script>

<div id="svelte-root-layout">{@render children()}</div>
`,
	'svelte/routes/live/feed.server.ts': `export const ssr = false;

export const load = () => ({ label: 'FEED_PROP' });
`,
	'svelte/routes/live/feed.svelte': `<script lang="ts">
	let { label }: { label: string; url?: string } = $props();
	let clicks = $state(0);
	// Throws on a server: there is no window there.
	const where = window.location.pathname;
</script>

<main id="live-feed" data-where={where}>
	<p id="feed-label">{label}</p>
	<button id="feed-clicks" onclick={() => (clicks += 1)}>clicks {clicks}</button>
</main>
`,
	'tsconfig.json': JSON.stringify(
		{
			compilerOptions: {
				esModuleInterop: true,
				jsx: 'react-jsx',
				module: 'ESNext',
				moduleResolution: 'bundler',
				noEmit: true,
				noUncheckedIndexedAccess: true,
				skipLibCheck: true,
				strict: true,
				target: 'ESNext',
				types: ['bun']
			},
			include: ['server.ts', 'routes.gen.ts', 'react', 'svelte']
		},
		null,
		'\t'
	),
	/* A Vue route, with a private sibling it imports. The sibling is what
	 * makes this worth serving: a Vue route's compiled module keeps its
	 * place in the mirrored generated tree and only takes the route's name,
	 * so `./_Tag.vue` still resolves — flattening it the way Svelte does
	 * would break exactly this import. */
	/* Two layouts over the Vue route. Vue wraps them in the page's source
	 * like Svelte, and a component imported in `<script setup>` is
	 * available to the template without being registered. */
	'vue/routes/layout.vue': `<template>
	<div id="vue-root-layout"><slot /></div>
</template>
`,
	'vue/routes/live/panel.server.ts': `export const ssr = false;

export const load = () => ({ label: 'PANEL_PROP' });
`,
	'vue/routes/live/panel.vue': `<script setup lang="ts">
import { ref } from 'vue';

const { label } = defineProps<{ label: string; url?: string }>();
const clicks = ref(0);
// Throws on a server: there is no window there.
const where = window.location.pathname;
</script>

<template>
	<main id="live-panel" :data-where="where">
		<p id="panel-label">{{ label }}</p>
		<button id="panel-clicks" @click="clicks += 1">clicks {{ clicks }}</button>
	</main>
</template>
`,
	'vue/routes/shop/_Tag.vue': `<script setup lang="ts">
const { label } = defineProps<{ label: string }>();
</script>

<template><span class="tag">{{ label }}</span></template>
`,
	'vue/routes/shop/[item].server.ts': `import type { FileRouteContext } from '@absolutejs/absolute';

export const load = ({ params }: FileRouteContext<'/shop/:item'>) => ({
	item: \`ITEM_\${params.item}\`
});
`,
	'vue/routes/shop/[item].vue': `<script setup lang="ts">
import { onMounted, ref } from 'vue';
import Tag from './_Tag.vue';

const { item } = defineProps<{ item: string; url?: string }>();
const clicks = ref(0);

// Browser only, once the page is live: what a test waits for before it
// clicks.
onMounted(() => {
	Reflect.set(window, '__itemHydrated', true);
});
</script>

<template>
	<h1 id="item">{{ item }}</h1>
	<Tag label="VUE_CHILD" />
	<button id="vue-clicks" @click="clicks += 1">clicks {{ clicks }}</button>
</template>
`,
	'vue/routes/shop/layout.vue': `<template>
	<section id="shop-layout"><slot /></section>
</template>
`
};
export const linkNodeModules = async (projectRoot: string) => {
	const source = join(repoRoot, 'node_modules');
	const target = join(projectRoot, 'node_modules');
	await mkdir(join(target, '@absolutejs'), { recursive: true });
	const [entries, scoped] = await Promise.all([
		readdir(source),
		readdir(join(source, '@absolutejs'))
	]);
	await Promise.all([
		...entries
			.filter((name) => name !== '@absolutejs' && name !== '.bin')
			.map((name) => symlink(join(source, name), join(target, name))),
		...scoped
			.filter((name) => name !== 'absolute' && !name.startsWith('.'))
			.map((name) =>
				symlink(
					join(source, '@absolutejs', name),
					join(target, '@absolutejs', name)
				)
			),
		symlink(repoRoot, join(target, '@absolutejs', 'absolute'))
	]);
};
export const writeFileRoutesFixture = async (root: string) => {
	await Promise.all(
		Object.entries(FILE_ROUTES_FIXTURE).map(async ([path, contents]) => {
			const target = join(root, path);
			await mkdir(dirname(target), { recursive: true });
			await writeFile(target, contents);
		})
	);
};
