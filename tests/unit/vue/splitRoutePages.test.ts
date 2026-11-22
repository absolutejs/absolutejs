import { describe, expect, test } from 'bun:test';
import { splitVueRoutePages } from '../../../src/vue/splitRoutePages';

const script = (routes: string, extra = '') => `
import { defineRoutes } from '@absolutejs/absolute/vue';
import Home from '../components/Home.vue';
import About from '../components/About.vue';
import Layout from '../components/Layout.vue';${extra}

export const routes = defineRoutes(${routes});
`;
const sfc = (body: string, template = '<template><RouterView /></template>') =>
	`<script lang="ts">${body}</script>\n${template}\n`;
const split = (body: string, template?: string) =>
	splitVueRoutePages(body, sfc(body, template));

describe('Vue router pages load lazily', () => {
	test('a leaf route component imported from the app becomes a lazy import', () => {
		const out =
			split(
				script(
					`[{ component: Home, path: '/' }, { component: About, path: '/about' }]`
				)
			) ?? '';

		expect(out).toContain(
			`component: () => import("../components/Home.vue"), path: '/'`
		);
		expect(out).toContain(
			`component: () => import("../components/About.vue"), path: '/about'`
		);
		expect(out).not.toContain(`import Home from`);
		expect(out).not.toContain(`import About from`);
		expect(out).toContain(`import Layout from '../components/Layout.vue';`);
	});

	test('a layout route keeps its component; its children are split', () => {
		const out =
			split(
				script(
					`[{ component: Layout, path: '/app', children: [{ component: Home, path: '' }, { component: About, path: 'about' }] }]`
				)
			) ?? '';

		expect(out).toContain('component: Layout,');
		expect(out).toContain(`import Layout from '../components/Layout.vue';`);
		expect(out).toContain(
			`component: () => import("../components/Home.vue")`
		);
		expect(out).toContain(
			`component: () => import("../components/About.vue")`
		);
	});

	test('each named view of a route is split', () => {
		const out =
			split(
				script(
					`[{ components: { default: Home, sidebar: About }, path: '/' }]`
				)
			) ?? '';

		expect(out).toContain(
			`default: () => import("../components/Home.vue")`
		);
		expect(out).toContain(
			`sidebar: () => import("../components/About.vue")`
		);
		expect(out).not.toContain(`import Home from`);
		expect(out).not.toContain(`import About from`);
	});

	test('the page name in template text (a link label) is not a use', () => {
		const body = script(`[{ component: Home, path: '/' }]`);
		const out = split(
			body,
			'<template><RouterLink to="/">Home</RouterLink><RouterView /></template>'
		);

		expect(out).toContain(
			`component: () => import("../components/Home.vue")`
		);
	});

	test('a component the template uses by kebab tag or binding stays eager', () => {
		const body = script(`[{ component: Home, path: '/' }]`);

		expect(
			split(body, '<template><home /><RouterView /></template>')
		).toBeNull();
		expect(
			split(
				body,
				'<template><component :is="Home" /><RouterView /></template>'
			)
		).toBeNull();
	});

	test('a component the template also uses stays eager', () => {
		const body = script(`[{ component: Home, path: '/' }]`);
		const out = split(body, '<template><Home /><RouterView /></template>');

		expect(out).toBeNull();
	});

	test('a component from a package, or an already lazy route, is left alone', () => {
		expect(
			split(
				script(
					`[{ component: Docs, path: '/docs' }, { component: () => import('./X.vue'), path: '/x' }]`,
					`\nimport Docs from '@acme/docs/Docs.vue';`
				)
			)
		).toBeNull();
	});

	test('a page without defineRoutes is left alone', () => {
		expect(
			split(
				`import Home from '../components/Home.vue';\nexport default Home;`
			)
		).toBeNull();
	});
});
