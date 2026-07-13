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
