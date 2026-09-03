import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import {
	chainBundleInlineSourcemap,
	chainBundleInlineSourcemaps,
	inlineLineMapComment
} from '../../../src/build/chainInlineSourcemaps';
import {
	getBuildWorkerPool,
	resetBuildWorkerPool
} from '../../../src/build/workerPool';

/* Real bundles: a `.ts`-style source → intermediate `.js` carrying an
 * inline map back to the source (exactly what compileVue / the ts-helper
 * copy emit) → `Bun.build({ sourcemap: 'inline' })`. The chain must then
 * resolve every bundle to the original source, identically whether it
 * ran on the main thread or across the worker pool. */

const INLINE_MAP_RE =
	/\/\/# sourceMappingURL=data:application\/json(?:;[^,]+)?;base64,([A-Za-z0-9+/=]+)\s*$/;

type ParsedMap = {
	mappings: string;
	sources: string[];
	sourcesContent?: (string | null)[];
};

const readInlineMap = async (path: string) => {
	const text = await readFile(path, 'utf-8');
	const match = text.match(INLINE_MAP_RE);
	if (!match?.[1]) throw new Error(`no inline map in ${path}`);
	const parsed: ParsedMap = JSON.parse(
		Buffer.from(match[1], 'base64').toString('utf-8')
	);

	return parsed;
};

const previousWorkers = process.env.ABSOLUTE_BUILD_WORKERS;
const tempDirs: string[] = [];

const makeFixture = async (bundleCount: number) => {
	const root = join(
		tmpdir(),
		`absolutejs-chain-pool-${process.pid}-${Date.now()}-${tempDirs.length}`
	);
	tempDirs.push(root);
	const sourceDir = join(root, 'src');
	const intermediateDir = join(root, 'intermediate');
	const outDir = join(root, 'out');
	await Promise.all([
		mkdir(sourceDir, { recursive: true }),
		mkdir(intermediateDir, { recursive: true })
	]);
	const entrypoints: string[] = [];
	const sourcePaths: string[] = [];
	for (let index = 0; index < bundleCount; index++) {
		const sourcePath = join(sourceDir, `page${index}.ts`);
		const source = [
			`type Props = { label: string };`,
			``,
			`export const render = (props: Props) => {`,
			`\tconst tag = 'page-${index}';`,
			`\tif (!props.label) throw new Error(\`missing \${tag}\`);`,
			``,
			`\treturn \`<h1>\${props.label}</h1>\`;`,
			`};`,
			``
		].join('\n');
		const generated = new Bun.Transpiler({
			loader: 'ts',
			target: 'bun'
		}).transformSync(source);
		const intermediatePath = join(intermediateDir, `page${index}.js`);
		await writeFile(sourcePath, source);
		await writeFile(
			intermediatePath,
			generated + inlineLineMapComment(sourcePath, source, generated)
		);
		entrypoints.push(intermediatePath);
		sourcePaths.push(sourcePath);
	}
	const result = await Bun.build({
		entrypoints,
		format: 'esm',
		naming: '[name].[hash].[ext]',
		outdir: outDir,
		sourcemap: 'inline',
		target: 'bun'
	});
	if (!result.success) throw new AggregateError(result.logs, 'build failed');
	const bundlePaths = result.outputs
		.map((output) => output.path)
		.filter((path) => path.endsWith('.js'))
		.sort();

	return { bundlePaths, sourcePaths };
};

afterEach(async () => {
	await resetBuildWorkerPool();
});

afterAll(async () => {
	if (previousWorkers === undefined) delete process.env.ABSOLUTE_BUILD_WORKERS;
	else process.env.ABSOLUTE_BUILD_WORKERS = previousWorkers;
	await Promise.all(
		tempDirs.map((dir) => rm(dir, { force: true, recursive: true }))
	);
});

describe('chainBundleInlineSourcemaps on the build worker pool', () => {
	test('worker-chained bundles equal main-thread-chained bundles and drop sourcesContent', async () => {
		const bundleCount = 6;
		const inlineFixture = await makeFixture(bundleCount);
		const pooledFixture = await makeFixture(bundleCount);

		process.env.ABSOLUTE_BUILD_WORKERS = '0';
		await resetBuildWorkerPool();
		await chainBundleInlineSourcemaps(inlineFixture.bundlePaths);
		const inlineStats = getBuildWorkerPool().stats();
		expect(inlineStats.inlineJobs).toBe(bundleCount);

		process.env.ABSOLUTE_BUILD_WORKERS = '2';
		await resetBuildWorkerPool();
		await chainBundleInlineSourcemaps(pooledFixture.bundlePaths);
		const pooledStats = getBuildWorkerPool().stats();
		expect(pooledStats.inlineJobs).toBe(0);
		expect(pooledStats.jobs).toBe(bundleCount);
		expect(pooledStats.workers).toHaveLength(2);

		for (let index = 0; index < bundleCount; index++) {
			const inlinePath = inlineFixture.bundlePaths[index];
			const pooledPath = pooledFixture.bundlePaths[index];
			if (!inlinePath || !pooledPath) throw new Error('missing bundle');
			const inlineMap = await readInlineMap(inlinePath);
			const pooledMap = await readInlineMap(pooledPath);
			// Fixture roots differ, so compare shape + the mapping string.
			expect(pooledMap.mappings).toBe(inlineMap.mappings);
			expect(pooledMap.sources.map((s) => s.split('/').pop())).toEqual(
				inlineMap.sources.map((s) => s.split('/').pop())
			);
			// Bun's runtime rejects a map without the key, so it stays
			// present but carries no text.
			expect(inlineMap.sourcesContent).toEqual(
				inlineMap.sources.map(() => null)
			);
			expect(pooledMap.sourcesContent).toEqual(
				pooledMap.sources.map(() => null)
			);
			// Chained to the deepest source: the .ts, not the intermediate.
			expect(
				pooledMap.sources.some((source) =>
					pooledFixture.sourcePaths.includes(source)
				)
			).toBe(true);
			// Both bodies are the same bundle text modulo the map itself
			// (and Bun's per-build path comment / debugId, which differ
			// because the fixtures live in different temp dirs).
			const bodyOf = async (path: string) => {
				const [body] = (await readFile(path, 'utf-8')).split(
					'//# sourceMappingURL='
				);

				return (body ?? '')
					.split('\n')
					.filter((line) => !line.startsWith('//'))
					.join('\n');
			};
			expect(await bodyOf(pooledPath)).toBe(await bodyOf(inlinePath));
		}
	}, 30_000);

	test('sourcesContent can be kept on request', async () => {
		const { bundlePaths, sourcePaths } = await makeFixture(1);
		const [bundlePath] = bundlePaths;
		if (!bundlePath) throw new Error('missing bundle');
		expect(chainBundleInlineSourcemap(bundlePath, { sourcesContent: true })).toBe(
			true
		);
		const map = await readInlineMap(bundlePath);
		const sourceIndex = map.sources.indexOf(sourcePaths[0] ?? '');
		expect(sourceIndex).toBeGreaterThanOrEqual(0);
		expect(map.sourcesContent?.[sourceIndex]).toContain('type Props');
	});

	test('a bundle without an inline map is left alone', async () => {
		const { bundlePaths } = await makeFixture(1);
		const [bundlePath] = bundlePaths;
		if (!bundlePath) throw new Error('missing bundle');
		const original = await readFile(bundlePath, 'utf-8');
		const [body] = original.split('//# sourceMappingURL=');
		await writeFile(bundlePath, body ?? '');
		expect(chainBundleInlineSourcemap(bundlePath)).toBe(false);
		expect(await readFile(bundlePath, 'utf-8')).toBe(body ?? '');
	});

	test('a small batch runs inline while the pool is cold', async () => {
		const { bundlePaths } = await makeFixture(2);
		process.env.ABSOLUTE_BUILD_WORKERS = '2';
		await resetBuildWorkerPool();
		await chainBundleInlineSourcemaps(bundlePaths);
		const stats = getBuildWorkerPool().stats();
		expect(stats.inlineJobs).toBe(2);
		expect(getBuildWorkerPool().isWarm()).toBe(false);
	});
});
