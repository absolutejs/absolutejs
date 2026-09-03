import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';
import type { DevPageEntry } from '../../../types/build';
import {
	createLazyPageRegistry,
	createOnDemandPageBuilder,
	createPageProbe,
	isPageBuilt,
	pageNameCandidates,
	primaryManifestKey,
	resolveLazyPageEntry,
	toDevPageEntry,
	updateLazyPageRegistry
} from '../../../src/dev/lazyPages';

const vuePage = toDevPageEntry('vue', '/app/src/frontend/pages/portal.vue');
const reactPage = toDevPageEntry('react', '/app/src/react/pages/Dashboard.tsx');
const indexNamed = toDevPageEntry(
	'svelte',
	'/app/src/svelte/pages/HomeIndex.svelte'
);
const registry = createLazyPageRegistry([vuePage, reactPage, indexNamed]);

describe('lazy page registry: key → source mapping', () => {
	test('derives the PascalCase manifest name from the source file', () => {
		expect(vuePage.name).toBe('Portal');
		expect(vuePage.source).toBe(
			resolvePath('/app/src/frontend/pages/portal.vue')
		);
		expect(reactPage.name).toBe('Dashboard');
	});

	test('strips one known suffix, longest first', () => {
		expect(pageNameCandidates('PortalCompiledCSS')).toEqual([
			'PortalCompiledCSS',
			'Portal'
		]);
		expect(pageNameCandidates('PortalIndex')).toEqual([
			'PortalIndex',
			'Portal'
		]);
		expect(pageNameCandidates('Portal')).toEqual(['Portal']);
		// A bare suffix is a page name of its own, never an empty candidate.
		expect(pageNameCandidates('Index')).toEqual(['Index']);
	});

	test('resolves every manifest key shape of a page to its source', () => {
		for (const key of [
			'Portal',
			'PortalIndex',
			'PortalClient',
			'PortalCSS',
			'PortalCss',
			'PortalCompiledCSS',
			'PortalBundledCSS',
			'PortalSpaManifest',
			'PortalPage'
		]) {
			expect(resolveLazyPageEntry(registry, key)?.source).toBe(
				vuePage.source
			);
		}
		expect(resolveLazyPageEntry(registry, 'DashboardIndex')?.source).toBe(
			reactPage.source
		);
	});

	test('prefers an exact page name over a stripped suffix', () => {
		expect(resolveLazyPageEntry(registry, 'HomeIndex')?.source).toBe(
			indexNamed.source
		);
	});

	test('resolves page source paths and /@src/ URLs', () => {
		expect(
			resolveLazyPageEntry(registry, '/app/src/frontend/pages/portal.vue')
				?.name
		).toBe('Portal');
		expect(
			resolveLazyPageEntry(
				registry,
				'/@src//app/src/frontend/pages/portal.vue?v=3'
			)?.name
		).toBe('Portal');
	});

	test('returns undefined for unknown keys and empty input', () => {
		expect(resolveLazyPageEntry(registry, 'Nope')).toBeUndefined();
		expect(resolveLazyPageEntry(registry, 'NopeIndex')).toBeUndefined();
		expect(resolveLazyPageEntry(registry, '')).toBeUndefined();
	});

	test('ignores generated helper entries and refreshes in place', () => {
		const live = createLazyPageRegistry([
			toDevPageEntry('react', '/app/src/react/pages/_refresh.tsx'),
			reactPage
		]);
		expect(live.byName.has('_refresh')).toBe(false);
		expect(live.byName.has('Dashboard')).toBe(true);

		updateLazyPageRegistry(live, [vuePage]);
		expect(live.byName.has('Dashboard')).toBe(false);
		expect(live.byName.has('Portal')).toBe(true);
	});

	test('falls back to a filesystem probe for pages created after the last scan', () => {
		const root = mkdtempSync(join(tmpdir(), 'absolute-lazy-pages-'));
		const vueDir = join(root, 'vue');
		mkdirSync(join(vueDir, 'pages'), { recursive: true });
		writeFileSync(join(vueDir, 'pages', 'Fresh.vue'), '<template />');
		const probe = createPageProbe({ vueDirectory: vueDir });

		expect(resolveLazyPageEntry(registry, 'FreshIndex')).toBeUndefined();
		const probed = resolveLazyPageEntry(registry, 'FreshIndex', probe);
		expect(probed?.framework).toBe('vue');
		expect(probed?.source).toBe(join(vueDir, 'pages', 'Fresh.vue'));
		expect(
			resolveLazyPageEntry(registry, 'Missing', probe)
		).toBeUndefined();
	});

	test('a page counts as built once its primary key is in the manifest', () => {
		expect(primaryManifestKey(vuePage)).toBe('Portal');
		expect(primaryManifestKey(reactPage)).toBe('DashboardIndex');
		expect(isPageBuilt(vuePage, {})).toBe(false);
		expect(isPageBuilt(vuePage, { PortalIndex: '/x.js' })).toBe(false);
		expect(isPageBuilt(vuePage, { Portal: '/build/Portal.abc.js' })).toBe(
			true
		);
		expect(isPageBuilt(reactPage, { DashboardIndex: '' })).toBe(false);
		expect(isPageBuilt(reactPage, { DashboardIndex: '/x.js' })).toBe(true);
	});
});

describe('on-demand page builder: dedupe', () => {
	const deferred = () => {
		let settle: (value: boolean) => void = () => undefined;
		const promise = new Promise<boolean>((resolve) => {
			settle = resolve;
		});

		return { promise, settle };
	};

	test('concurrent requests for one page share a single build', async () => {
		const runs: DevPageEntry[] = [];
		const gate = deferred();
		const builder = createOnDemandPageBuilder((entry) => {
			runs.push(entry);

			return gate.promise;
		});

		const first = builder.warm(vuePage);
		const second = builder.warm(vuePage);
		expect(runs).toHaveLength(1);
		expect(builder.isInFlight(vuePage.source)).toBe(true);
		expect(builder.inFlight()).toEqual([vuePage.source]);

		gate.settle(true);
		expect(await Promise.all([first, second])).toEqual([true, true]);
		expect(builder.isInFlight(vuePage.source)).toBe(false);
		expect(builder.inFlight()).toEqual([]);
	});

	test('different pages each get their own build', async () => {
		const runs: string[] = [];
		const builder = createOnDemandPageBuilder(async (entry) => {
			runs.push(entry.name);

			return true;
		});
		await Promise.all([builder.warm(vuePage), builder.warm(reactPage)]);
		expect(runs).toEqual(['Portal', 'Dashboard']);
	});

	test('a finished build is not reused — the next warm runs again', async () => {
		let count = 0;
		const builder = createOnDemandPageBuilder(async () => {
			count += 1;

			return true;
		});
		await builder.warm(vuePage);
		await builder.warm(vuePage);
		expect(count).toBe(2);
	});

	test('a throwing build resolves false and clears the in-flight slot', async () => {
		const builder = createOnDemandPageBuilder(() =>
			Promise.reject(new Error('boom'))
		);
		expect(await builder.warm(vuePage)).toBe(false);
		expect(builder.isInFlight(vuePage.source)).toBe(false);
	});
});
