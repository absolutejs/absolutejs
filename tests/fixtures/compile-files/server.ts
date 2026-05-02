import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Elysia } from '__ELYSIA_ENTRY__';
import { networking, prepare } from '__ABSOLUTE_DIST_INDEX__';
import data from './runtime/data.json' with { type: 'json' };

const { absolutejs } = await prepare();
const templateUrl = new URL('./runtime/template.html', import.meta.url);
const blobUrl = new URL('./runtime/blob.txt', import.meta.url);
const binaryUrl = new URL('./runtime/nested/binary.bin', import.meta.url);
const dirJoinPath = join(import.meta.dir, 'runtime', 'dir-join.txt');
const nestedReadFilePath = join(
	import.meta.dir,
	'runtime',
	'nested',
	'readfile.txt'
);

export const server = new Elysia()
	.use(absolutejs)
	.get(
		'/',
		() =>
			new Response('<!DOCTYPE html><h1>FILES_COMPILE_HOME</h1>', {
				headers: { 'content-type': 'text/html; charset=utf-8' }
			})
	)
	.get('/api/files', async () => {
		const dynamicName = 'dynamic-hidden';
		const dynamicUrl = new URL(
			`./runtime/${dynamicName}.txt`,
			import.meta.url
		);

		return {
			blob: (await Bun.file(blobUrl).text()).trim(),
			dirJoin: (await Bun.file(dirJoinPath).text()).trim(),
			dynamicExists: existsSync(dynamicUrl),
			dynamicModule: await (
				await import('./runtime/dynamic-module')
			).readDynamicModuleAsset(),
			json: data,
			nested: readFileSync(nestedReadFilePath, 'utf-8').trim(),
			template: readFileSync(templateUrl, 'utf-8').trim()
		};
	})
	.get('/api/binary-file', async () => {
		const bytes = new Uint8Array(await Bun.file(binaryUrl).arrayBuffer());

		return {
			ok: true,
			prefix: String.fromCharCode(...bytes.slice(0, 6)),
			size: bytes.byteLength
		};
	})
	.use(networking);
