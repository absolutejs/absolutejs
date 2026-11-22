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
			<a href="/blog" id="to-blog">blog</a>
		</p>
	);
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
import { ref } from 'vue';
import Tag from './_Tag.vue';

const { item } = defineProps<{ item: string; url?: string }>();
const clicks = ref(0);
</script>

<template>
	<h1 id="item">{{ item }}</h1>
	<Tag label="VUE_CHILD" />
	<button id="vue-clicks" @click="clicks += 1">clicks {{ clicks }}</button>
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
