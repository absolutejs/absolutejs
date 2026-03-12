import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import {
	mapSourceFileToManifestKeys,
	groupModuleUpdatesByFramework,
	type ModuleUpdate
} from '../../../src/dev/moduleMapper';

describe('mapSourceFileToManifestKeys', () => {
	const resolvedPaths: Record<string, string> = {
		angularDir: resolve('/project/example/angular'),
		reactDir: resolve('/project/example/react'),
		svelteDir: resolve('/project/example/svelte'),
		vueDir: resolve('/project/example/vue')
	};

	test('maps react page to Index and CSS keys', () => {
		const keys = mapSourceFileToManifestKeys(
			resolve('/project/example/react/pages/ReactExample.tsx'),
			'react',
			resolvedPaths
		);
		expect(keys).toContain('ReactExampleIndex');
		expect(keys).toContain('ReactExampleCSS');
	});

	test('maps svelte page to name, Index, and CSS keys', () => {
		const keys = mapSourceFileToManifestKeys(
			resolve('/project/example/svelte/pages/SvelteExample.svelte'),
			'svelte',
			resolvedPaths
		);
		expect(keys).toContain('SvelteExample');
		expect(keys).toContain('SvelteExampleIndex');
		expect(keys).toContain('SvelteExampleCSS');
	});

	test('maps vue page to name, Index, and CSS keys', () => {
		const keys = mapSourceFileToManifestKeys(
			resolve('/project/example/vue/pages/VueExample.vue'),
			'vue',
			resolvedPaths
		);
		expect(keys).toContain('VueExample');
		expect(keys).toContain('VueExampleIndex');
		expect(keys).toContain('VueExampleCSS');
	});

	test('maps angular page to name and Index keys', () => {
		const keys = mapSourceFileToManifestKeys(
			resolve('/project/example/angular/pages/angular-example.ts'),
			'angular',
			resolvedPaths
		);
		expect(keys).toContain('AngularExample');
		expect(keys).toContain('AngularExampleIndex');
	});

	test('returns empty for html/htmx', () => {
		expect(
			mapSourceFileToManifestKeys(
				'/project/html/pages/index.html',
				'html'
			)
		).toHaveLength(0);
		expect(
			mapSourceFileToManifestKeys('/project/htmx/pages/page.html', 'htmx')
		).toHaveLength(0);
	});

	test('maps asset CSS files to CSS key', () => {
		const keys = mapSourceFileToManifestKeys(
			'/project/assets/theme.css',
			'assets'
		);
		expect(keys).toContain('ThemeCSS');
	});

	test('falls back to path heuristics without resolvedPaths', () => {
		const keys = mapSourceFileToManifestKeys(
			resolve('/project/example/react/pages/MyPage.tsx'),
			'react'
		);
		expect(keys).toContain('MyPageIndex');
	});
});

describe('groupModuleUpdatesByFramework', () => {
	test('groups updates by framework', () => {
		const updates: ModuleUpdate[] = [
			{
				framework: 'react',
				moduleKeys: ['AIndex'],
				modulePaths: { AIndex: '/a.js' },
				sourceFile: '/a.tsx'
			},
			{
				framework: 'svelte',
				moduleKeys: ['B'],
				modulePaths: { B: '/b.js' },
				sourceFile: '/b.svelte'
			},
			{
				framework: 'react',
				moduleKeys: ['CIndex'],
				modulePaths: { CIndex: '/c.js' },
				sourceFile: '/c.tsx'
			}
		];

		const grouped = groupModuleUpdatesByFramework(updates);
		expect(grouped.get('react')?.length).toBe(2);
		expect(grouped.get('svelte')?.length).toBe(1);
		expect(grouped.has('vue')).toBe(false);
	});

	test('returns empty map for no updates', () => {
		const grouped = groupModuleUpdatesByFramework([]);
		expect(grouped.size).toBe(0);
	});
});
