import { describe, expect, test } from 'bun:test';
import { parseVueSpaRoutes } from '../../../src/build/parseVueSpaRoutes';

describe('parseVueSpaRoutes', () => {
	test('does not pair a redirect path with the next route component', () => {
		const source = `
			export const routes = defineRoutes([
				{ path: '/portal/assets', redirect: '/portal/resources' },
				{
					meta: { title: 'Deal Rooms' },
					path: '/portal/deal-rooms',
					component: () => import('./DealRooms.vue').then((mod) => mod.default),
				},
			]);
		`;

		expect(parseVueSpaRoutes(source)).toEqual([
			{
				importPath: './DealRooms.vue',
				path: '/portal/deal-rooms'
			}
		]);
	});

	test('supports component before path and template string literals', () => {
		const source = `
			export const routes = defineRoutes([
				{
					component: () => import(\`./Dashboard.vue\`),
					path: \`/portal/dashboard\`,
				},
			]);
		`;

		expect(parseVueSpaRoutes(source)).toEqual([
			{
				importPath: './Dashboard.vue',
				path: '/portal/dashboard'
			}
		]);
	});
});

test('lazy routes under a layout route are found, with their full path', () => {
	const routes = parseVueSpaRoutes(`
export const routes = defineRoutes([
	{ component: Layout, path: '/app', children: [
		{ component: () => import('./Home.vue'), path: '' },
		{ component: () => import('./About.vue'), path: 'about' },
		{ component: () => import('./Help.vue'), path: '/help' }
	] }
]);
`);

	expect(routes).toEqual([
		{ importPath: './Home.vue', path: '/app' },
		{ importPath: './About.vue', path: '/app/about' },
		{ importPath: './Help.vue', path: '/help' }
	]);
});

test('each named view of a route is found', () => {
	const routes = parseVueSpaRoutes(`
export const routes = defineRoutes([
	{ components: { default: () => import('./Home.vue'), sidebar: () => import('./Side.vue') }, path: '/' }
]);
`);

	expect(routes).toEqual([
		{ importPath: './Home.vue', path: '/' },
		{ importPath: './Side.vue', path: '/' }
	]);
});
