import { describe, expect, test } from 'bun:test';
import { addAutoRouterSetupApp } from '../../../src/build/vueAutoRouterTransform';

const SPA_PAGE = `<script lang="ts">
export const routes = [{ path: '/portal/dashboard', component: {} }];
</script>
<template><RouterView /></template>`;

describe('addAutoRouterSetupApp', () => {
	test('reports an unmatched initial server route as not found', () => {
		const transformed = addAutoRouterSetupApp(SPA_PAGE);

		expect(transformed).toContain(
			'const currentRouteMatched = router.currentRoute.value.matched.length > 0;'
		);
		expect(transformed).toContain('ctx.setNotFound();');
	});

	test('reloads unmatched client routes through the server 404 handler', () => {
		const transformed = addAutoRouterSetupApp(SPA_PAGE);

		expect(transformed).toContain('window.location.assign(ctx.url);');
		expect(transformed).toContain('router.afterEach((to) => {');
		expect(transformed).toContain(
			'if (to.matched.length === 0) window.location.assign(to.fullPath);'
		);
	});
});
