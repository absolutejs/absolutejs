import { mkdir, stat } from 'node:fs/promises';
import {
	dirname,
	join,
	basename,
	extname,
	resolve,
	relative,
	sep
} from 'node:path';
import { cwd, env } from 'node:process';
import { write, file, Transpiler } from 'bun';
import { compile, compileModule, preprocess } from 'svelte/compiler';

type Built = { ssr: string; client: string };
type Cache = Map<string, Built>;

const exists = async (filepath: string) => {
	try {
		await stat(filepath);

		return true;
	} catch {
		return false;
	}
};

const resolveSvelte = async (spec: string, from: string) => {
	const basePath = resolve(dirname(from), spec);
	const explicit = /\.(svelte|svelte\.(?:ts|js))$/.test(basePath);

	if (!explicit) {
		const extensions = ['.svelte', '.svelte.ts', '.svelte.js'];
		const paths = extensions.map((ext) => `${basePath}${ext}`);
		const checks = await Promise.all(paths.map(exists));
		const match = paths.find((_, index) => checks[index]);

		return match ?? null;
	}

	if (await exists(basePath)) return basePath;
	if (!basePath.endsWith('.svelte')) return null;

	const tsPath = `${basePath}.ts`;
	if (await exists(tsPath)) return tsPath;

	const jsPath = `${basePath}.js`;
	if (await exists(jsPath)) return jsPath;

	return null;
};

const transpiler = new Transpiler({ loader: 'ts', target: 'browser' });
const projectRoot = cwd();

export const compileSvelte = async (
	entryPoints: string[],
	outRoot: string,
	cache: Cache = new Map()
) => {
	const clientFolder = 'client';
	const indexFolder = 'indexes';
	const pagesFolder = 'pages';

	await Promise.all(
		[clientFolder, indexFolder, pagesFolder].map((d) =>
			mkdir(join(outRoot, d), { recursive: true })
		)
	);

	const dev = env.NODE_ENV === 'development';

	const build = async (src: string) => {
		const memo = cache.get(src);
		if (memo) return memo;

		const raw = await file(src).text();
		const isModule =
			src.endsWith('.svelte.ts') || src.endsWith('.svelte.js');
		const prepped = isModule ? raw : (await preprocess(raw, {})).code;
		const transpiledCode =
			src.endsWith('.ts') || src.endsWith('.svelte.ts')
				? transpiler.transformSync(prepped)
				: prepped;

		const relDir = dirname(relative(projectRoot, src));
		const baseName = basename(src).replace(/\.svelte(\.(ts|js))?$/, '');

		const importPaths = Array.from(
			transpiledCode.matchAll(/from\s+['"]([^'"]+)['"]/g)
		)
			.map((m) => m[1])
			.filter((p): p is string => p !== undefined);

		const resolveResults = await Promise.all(
			importPaths.map((p) => resolveSvelte(p, src))
		);
		const childSources = resolveResults.filter(
			(path): path is string => path !== undefined
		);
		await Promise.all(childSources.map((p) => build(p)));

		const generate = (mode: 'server' | 'client') =>
			(isModule
				? compileModule(transpiledCode, { dev, filename: src }).js.code
				: compile(transpiledCode, {
						css: 'injected',
						dev,
						filename: src,
						generate: mode
					}).js.code
			).replace(/\.svelte(?:\.(?:ts|js))?(['"])/g, '.js$1');

		const ssrPath = join(outRoot, pagesFolder, relDir, `${baseName}.js`);
		const clientPath = join(
			outRoot,
			clientFolder,
			relDir,
			`${baseName}.js`
		);

		await Promise.all([
			mkdir(dirname(ssrPath), { recursive: true }),
			mkdir(dirname(clientPath), { recursive: true })
		]);

		if (isModule) {
			const bundle = generate('client');
			await Promise.all([
				write(ssrPath, bundle),
				write(clientPath, bundle)
			]);
		} else {
			const serverBundle = generate('server');
			const clientBundle = generate('client');
			await Promise.all([
				write(ssrPath, serverBundle),
				write(clientPath, clientBundle)
			]);
		}

		const built: Built = { client: clientPath, ssr: ssrPath };
		cache.set(src, built);

		return built;
	};

	const roots = await Promise.all(entryPoints.map(build));

	await Promise.all(
		roots.map(({ client }) => {
			const relClientDir = dirname(
				relative(join(outRoot, clientFolder), client)
			);
			const name = basename(client, extname(client));
			const indexDir = join(outRoot, indexFolder, relClientDir);
			const importPathRaw = relative(indexDir, client)
				.split(sep)
				.join('/');
			const importPath = importPathRaw.startsWith('.')
				? importPathRaw
				: `./${importPathRaw}`;

			const indexPath = join(indexDir, `${name}.js`);
			const boot = `import C from "${importPath}";
import { hydrate } from "svelte";
hydrate(C,{target:document.body,props:window.__INITIAL_PROPS__??{}});`;

			return mkdir(indexDir, { recursive: true }).then(() =>
				write(indexPath, boot)
			);
		})
	);

	return {
		svelteClientPaths: roots.map(({ client }) => {
			const rel = dirname(relative(join(outRoot, clientFolder), client));

			return join(outRoot, indexFolder, rel, basename(client));
		}),
		svelteServerPaths: roots.map(({ ssr }) => ssr)
	};
};
