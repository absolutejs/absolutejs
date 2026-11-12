import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { build } from '../../../src/core/build';
import { setCurrentIslandManifest } from '../../../src/core/islandPageContext';
import {
	handleHTMLPageRequest,
	handleHTMXPageRequest
} from '../../../src/core/pageHandlers';

/* Static (HTML/HTMX) pages with islands must get an islands bootstrap
 * script: the configured `islands.bootstrap` whatever its file name, or a
 * generated default when only `islands.registry` is set. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const testBuildRoot = join(repoRoot, '.test-builds');
const tempDirs: string[] = [];

afterEach(async () => {
	globalThis.__absoluteManifest = undefined;
	for (const dir of tempDirs.splice(0)) {
		await rm(dir, { force: true, recursive: true });
	}
});

const ISLAND_MARKUP = `<absolute-island framework="react" component="PriceChart" hydrate="idle" props='{"symbol":"BTC"}'></absolute-island>
<island framework="react" component="PriceChart" hydrate="visible" props='{"symbol":"ETH"}'></island>`;

const page = (title: string) =>
	`<!doctype html><html><head><title>${title}</title></head><body>\n${ISLAND_MARKUP}\n</body></html>\n`;

const createFixture = async () => {
	await mkdir(testBuildRoot, { recursive: true });
	const root = await mkdtemp(join(testBuildRoot, 'absolute-island-bootstrap-'));
	tempDirs.push(root);
	await mkdir(join(root, 'html', 'pages'), { recursive: true });
	await mkdir(join(root, 'htmx', 'pages'), { recursive: true });
	await mkdir(join(root, 'islands'), { recursive: true });
	await writeFile(join(root, 'html', 'pages', 'prices.html'), page('html'));
	await writeFile(join(root, 'htmx', 'pages', 'feed.html'), page('htmx'));
	await writeFile(
		join(root, 'islands', 'PriceChart.tsx'),
		`export const PriceChart = ({ symbol }: { symbol: string }) => <output>{symbol}</output>;\n`
	);
	await writeFile(
		join(root, 'islands', 'registry.ts'),
		`import { defineIslandRegistry } from '@absolutejs/absolute/islands';
import { PriceChart } from './PriceChart';

export const islandRegistry = defineIslandRegistry({ react: { PriceChart } });
`
	);
	await writeFile(
		join(root, 'islands', 'startMyIslands.ts'),
		`import { createIslandManifestResolver, startIslands } from '@absolutejs/absolute/client';

startIslands({
	registry: {},
	resolveComponent: createIslandManifestResolver()
});
`
	);

	return root;
};

const buildFixture = async (root: string, bootstrap?: string) => {
	const rel = (path: string) => relative(process.cwd(), join(root, path));
	const result = await build({
		buildDirectory: rel('build'),
		htmlDirectory: rel('html'),
		htmxDirectory: rel('htmx'),
		islands: {
			bootstrap: bootstrap && rel(bootstrap),
			registry: rel('islands/registry.ts')
		},
		mode: 'production',
		options: { throwOnError: true }
	});

	return result?.manifest ?? {};
};

const moduleScripts = (html: string) =>
	[...html.matchAll(/<script type="module" src="([^"]+)"><\/script>/g)].map(
		(match) => match[1]
	);

const expectBootstrapInjected = async (
	root: string,
	manifest: Record<string, string>,
	expectedPath: string
) => {
	setCurrentIslandManifest(manifest);
	const pages = [
		await handleHTMLPageRequest(manifest.prices ?? ''),
		await handleHTMXPageRequest(manifest.feed ?? '')
	];
	for (const response of pages) {
		const html = await response.text();
		expect(html).toContain('data-island="true"');
		expect(moduleScripts(html)).toEqual([expectedPath]);
	}
	expect(existsSync(join(root, 'build', expectedPath))).toBe(true);
};

describe('islands bootstrap for static pages', () => {
	test('islands.registry alone generates and injects a default bootstrap', async () => {
		const root = await createFixture();
		const manifest = await buildFixture(root);
		const bootstrapPath = manifest.AbsoluteIslandBootstrap ?? '';

		expect(bootstrapPath).toMatch(
			/^\/islands\/absoluteIslandBootstrap\.[a-z0-9]+\.js$/
		);
		expect(manifest.IslandReactPriceChart).toBeDefined();
		await expectBootstrapInjected(root, manifest, bootstrapPath);
	}, 120_000);

	test('a configured bootstrap is injected whatever its file name', async () => {
		const root = await createFixture();
		const manifest = await buildFixture(root, 'islands/startMyIslands.ts');
		const bootstrapPath = manifest.AbsoluteIslandBootstrap ?? '';

		expect(bootstrapPath).toBe(manifest.StartMyIslands ?? 'missing');
		expect(Object.values(manifest)).not.toContainEqual(
			expect.stringContaining('absoluteIslandBootstrap')
		);
		await expectBootstrapInjected(root, manifest, bootstrapPath);
	}, 120_000);
});
