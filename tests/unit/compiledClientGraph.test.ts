import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareCompiledClientGraph } from '../../src/build/compiledClientGraph';
import { createClientAssetArchive } from '../../src/runtime/clientAssetArchive';

const directories: string[] = [];
afterEach(async () => {
	await Promise.all(
		directories
			.splice(0)
			.map((path) => rm(path, { force: true, recursive: true }))
	);
});
const temporary = async () => {
	const path = await mkdtemp(join(tmpdir(), 'absolute-graph-'));
	directories.push(path);

	return path;
};
const build = async (vendor: string) => {
	const directory = await temporary();
	await mkdir(join(directory, 'vue/indexes'), { recursive: true });
	await mkdir(join(directory, 'vue/vendor'), { recursive: true });
	await Bun.write(
		join(directory, 'vue/indexes/Home.js'),
		'export const load = () => import("../../chunk-lazy.js");'
	);
	await Bun.write(
		join(directory, 'chunk-lazy.js'),
		'import { value } from "/vue/vendor/vue.js"; export { value };'
	);
	await Bun.write(
		join(directory, 'vue/vendor/vue.js'),
		`export const value = ${JSON.stringify(vendor)};`
	);
	await Bun.write(join(directory, 'server.js'), 'SECRET');
	await Bun.write(
		join(directory, 'manifest.json'),
		JSON.stringify({
			Home: join(directory, 'server.js'),
			HomeIndex: '/vue/indexes/Home.js'
		})
	);
	const id = prepareCompiledClientGraph(directory, 'server.js');
	const prefix = `/_absolute/assets/${id}`;
	const assets: Record<string, string> = {};
	for (const file of [
		'vue/indexes/Home.js',
		'chunk-lazy.js',
		'vue/vendor/vue.js'
	])
		assets[`${prefix}/${file}`] = join(directory, prefix.slice(1), file);

	return { assets, directory, id, prefix };
};

test('vendor-only changes get a new complete graph and keep server files private', async () => {
	const a = await build('old');
	const b = await build('new');
	expect(a.id).not.toBe(b.id);
	const manifest = JSON.parse(
		await readFile(join(a.directory, 'manifest.json'), 'utf8')
	);
	expect(manifest.HomeIndex).toBe(`${a.prefix}/vue/indexes/Home.js`);
	expect(manifest.Home).toBe(join(a.directory, 'server.js'));
	expect(
		await Bun.file(
			join(a.directory, a.prefix.slice(1), 'server.js')
		).exists()
	).toBe(false);
	expect(
		await Bun.file(
			join(a.directory, a.prefix.slice(1), 'chunk-lazy.js')
		).text()
	).toContain(`${a.prefix}/vue/vendor/vue.js`);
});

test('a new server serves the prior graph from disk and rejects traversal and metadata', async () => {
	const archive = await temporary();
	const a = await build('old');
	const b = await build('new');
	await createClientAssetArchive(a.assets, archive, 1000);
	const retained = await createClientAssetArchive(b.assets, archive, 2000);
	expect(
		await (await retained(`${a.prefix}/vue/vendor/vue.js`))?.text()
	).toContain('"old"');
	expect(
		await (await retained(`${b.prefix}/vue/vendor/vue.js`))?.text()
	).toContain('"new"');
	for (const path of [
		`${a.prefix}/../graph.json`,
		`${a.prefix}/graph.json`,
		'/server.js',
		`${a.prefix}/server.js`,
		`${a.prefix}/%2e%2e/graph.json`
	])
		expect(await retained(path)).toBeUndefined();
});

test('retention expires old graphs and keeps at most three releases', async () => {
	const archive = await temporary();
	const graphs = [];
	for (let i = 0; i < 4; i++) {
		const graph = await build(String(i));
		graphs.push(graph);
		await createClientAssetArchive(graph.assets, archive, 1000 + i);
	}
	const [oldest, previous, , latest] = graphs;
	if (!oldest || !previous || !latest) throw new Error('Missing test graphs');
	const retained = await createClientAssetArchive(
		latest.assets,
		archive,
		2000
	);
	expect(await retained(`${oldest.prefix}/chunk-lazy.js`)).toBeUndefined();
	expect(await retained(`${previous.prefix}/chunk-lazy.js`)).toBeDefined();
	const expired = await createClientAssetArchive(
		latest.assets,
		archive,
		8 * 86400000
	);
	expect(await expired(`${previous.prefix}/chunk-lazy.js`)).toBeUndefined();
	expect(await expired(`${latest.prefix}/chunk-lazy.js`)).toBeDefined();
});

test('does not retain transitive server chunks, maps, metadata or unrelated runtime scripts', async () => {
	const directory = await temporary();
	await mkdir(join(directory, 'vue'), { recursive: true });
	await Bun.write(
		join(directory, 'vue/Home.js'),
		'export { secret } from "./chunk-private.js";'
	);
	await Bun.write(
		join(directory, 'vue/chunk-private.js'),
		'export const secret = "PRIVATE";'
	);
	await Bun.write(join(directory, 'private.js'), 'PRIVATE');
	await Bun.write(join(directory, 'chunk-client.js.map'), 'PRIVATE SOURCE');
	await Bun.write(
		join(directory, 'chunk-client.js'),
		'export const value = 1;'
	);
	await Bun.write(
		join(directory, 'manifest.json'),
		JSON.stringify({
			Home: join(directory, 'vue/Home.js'),
			HomeIndex: '/chunk-client.js'
		})
	);
	const id = prepareCompiledClientGraph(directory, 'server.js');
	for (const path of [
		'vue/Home.js',
		'vue/chunk-private.js',
		'private.js',
		'chunk-client.js.map',
		'manifest.json'
	]) {
		expect(
			await Bun.file(
				join(directory, '_absolute/assets', id, path)
			).exists()
		).toBe(false);
	}
	expect(
		await Bun.file(
			join(directory, '_absolute/assets', id, 'chunk-client.js')
		).exists()
	).toBe(true);
});

test('worker URL constructors stay in the graph without rewriting example text or comments', async () => {
	const directory = await temporary();
	await Bun.write(
		join(directory, 'task.hash.js'),
		'self.postMessage("ready");'
	);
	const example = `new URL('/task.hash.js', import.meta.url)`;
	await Bun.write(
		join(directory, 'chunk-client.js'),
		`export const worker = new URL('/task.hash.js', import.meta.url);\nexport const example = ${JSON.stringify(example)};\n// ${example}`
	);
	await Bun.write(
		join(directory, 'manifest.json'),
		JSON.stringify({ HomeIndex: '/chunk-client.js' })
	);
	const id = prepareCompiledClientGraph(directory, 'server.js');
	const content = await Bun.file(
		join(directory, '_absolute/assets', id, 'chunk-client.js')
	).text();
	expect(content).toContain(
		`new URL("/_absolute/assets/${id}/task.hash.js", import.meta.url)`
	);
	expect(content).toContain(
		`export const example = ${JSON.stringify(example)};`
	);
	expect(content).toContain(`// ${example}`);
	expect(
		await Bun.file(
			join(directory, '_absolute/assets', id, 'task.hash.js')
		).exists()
	).toBe(true);
});

test('a long-running release gets its grace period when replaced, including rollback', async () => {
	const archive = await temporary();
	const first = await build('long running');
	const second = await build('replacement');
	const day = 86400000;
	await createClientAssetArchive(first.assets, archive, 0);
	const replacement = await createClientAssetArchive(
		second.assets,
		archive,
		30 * day
	);
	expect(await replacement(`${first.prefix}/chunk-lazy.js`)).toBeDefined();
	const stillRetained = await createClientAssetArchive(
		second.assets,
		archive,
		36 * day
	);
	expect(await stillRetained(`${first.prefix}/chunk-lazy.js`)).toBeDefined();
	const rollback = await createClientAssetArchive(
		first.assets,
		archive,
		36 * day
	);
	expect(await rollback(`${first.prefix}/chunk-lazy.js`)).toBeDefined();
	const forwardAgain = await createClientAssetArchive(
		second.assets,
		archive,
		40 * day
	);
	expect(await forwardAgain(`${first.prefix}/chunk-lazy.js`)).toBeDefined();
	const expired = await createClientAssetArchive(
		second.assets,
		archive,
		48 * day
	);
	expect(await expired(`${first.prefix}/chunk-lazy.js`)).toBeUndefined();
});
