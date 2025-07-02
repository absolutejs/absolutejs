import { mkdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { env } from 'node:process';
import { write, file } from 'bun';
import { compile, preprocess } from 'svelte/compiler';

export const compileSvelte = async (
	entryPoints: string[],
	outputDirectory: string
) => {
	const pagesDir = join(outputDirectory, 'pages');
	const clientDir = join(outputDirectory, 'client');
	const indexesDir = join(outputDirectory, 'indexes');

	await Promise.all([
		mkdir(clientDir, { recursive: true }),
		mkdir(indexesDir, { recursive: true })
	]);

	const isDev = env.NODE_ENV === 'development';

	const builds = await Promise.all(
		entryPoints.map(async (entry) => {
			const source = await file(entry).text();
			const { code: pre } = await preprocess(source, {});

			const name = basename(entry, '.svelte');

			const { js: ssrJs } = compile(pre, {
				css: 'injected',
				dev: isDev,
				filename: entry,
				generate: 'server'
			});
			const ssrPath = join(pagesDir, `${name}.js`);

			const { js: clientJs } = compile(pre, {
				css: 'injected',
				dev: isDev,
				filename: entry,
				generate: 'client'
			});
			const clientComponentPath = join(clientDir, `${name}.js`);

			const bootstrap = `import Component from "../client/${name}.js";
import { hydrate } from "svelte";
hydrate(Component,{target:document.body,props:window.__INITIAL_PROPS__??{}});`;
			const clientIndexPath = join(indexesDir, `${name}.js`);

			await Promise.all([
				write(ssrPath, ssrJs.code),
				write(clientComponentPath, clientJs.code),
				write(clientIndexPath, bootstrap)
			]);

			return { clientIndexPath, ssrPath };
		})
	);

	return {
		svelteClientPaths: builds.map(({ clientIndexPath }) => clientIndexPath),
		svelteServerPaths: builds.map(({ ssrPath }) => ssrPath)
	};
};
