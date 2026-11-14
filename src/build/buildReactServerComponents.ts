import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import {
	build as bunBuild,
	type BuildArtifact,
	type BunPlugin,
	Glob,
	Transpiler
} from 'bun';
import {
	REACT_SERVER_CLIENT_MANIFEST_KEY,
	REACT_SERVER_PAGE_MANIFEST_SUFFIX,
	REACT_SERVER_PAYLOAD_GLOBAL,
	REACT_SERVER_RENDERER_MANIFEST_KEY,
	REACT_SERVER_RUNTIME_FILE
} from '../react/serverComponents/constants';
import { logWarn } from '../utils/logger';
import { normalizePath } from '../utils/normalizePath';
import { toPascal } from '../utils/stringModifiers';
import { validateSafePath } from '../utils/validateSafePath';

/* React Server Components build pass (docs/REACT_SERVER_COMPONENTS_PLAN.md).
 *
 * Three Bun.build passes, run in order because the second and third need the
 * "use client" modules the first one discovers:
 *
 *  1. react-server (target bun, `react-server` condition): one entry per page
 *     in `<reactServerComponentsDirectory>/pages`. A plugin swaps every
 *     "use client" module for client references, so server components and
 *     React itself are bundled in their server build and nothing from a client
 *     component runs here.
 *  2. ssr (target bun, default conditions): every client module plus the
 *     Flight client and react-dom/server, so the HTML render turns the Flight
 *     stream into HTML with the same React copy the client components use.
 *  3. client (target browser): a hydration entry that maps each client module
 *     id to a lazy import() chunk.
 *
 * react-server-dom-webpack is resolved from the application (a peer the app
 * installs at the version of its own react). Its `__webpack_require__` /
 * `__webpack_chunk_load__` hooks are provided by the generated entries. */

type BuildLog = BuildMessage | ResolveMessage;

type ClientModule = {
	exports: string[];
	id: string;
	path: string;
};

export type ReactServerBuildResult = {
	logs: BuildLog[];
	manifest: Record<string, string>;
	outputPaths: string[];
	success: boolean;
};

type ReactServerBuildOptions = {
	buildPath: string;
	directory: string;
	isDev: boolean;
	projectRoot: string;
};

const PAGE_PATTERN = '*.{tsx,jsx,ts,js}';
const SOURCE_FILTER = /\.[cm]?[jt]sx?$/;
const USE_CLIENT_PATTERN =
	/^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*(['"])use client\1/;
const MANIFEST_NAMESPACE = 'absolute-react-server';
const MANIFEST_SPECIFIER = 'absolute-react-server:client-manifest';
const MODULE_ID_LENGTH = 16;

const loaderFor = (path: string) => {
	const extension = extname(path);
	if (extension === '.tsx') return 'tsx';
	if (extension === '.ts' || extension === '.mts' || extension === '.cts')
		return 'ts';
	if (extension === '.jsx') return 'jsx';

	return 'js';
};

export const clientModuleId = (projectRoot: string, path: string) =>
	createHash('sha256')
		.update(relative(projectRoot, path).replace(/\\/g, '/'))
		.digest('hex')
		.slice(0, MODULE_ID_LENGTH);
export const isClientModuleSource = (source: string) =>
	USE_CLIENT_PATTERN.test(source);

const scanExportNames = (path: string, source: string) => {
	const transpiler = new Transpiler({ loader: loaderFor(path) });

	return transpiler.scan(source).exports;
};

/* `flightServer` is react-server-dom-webpack/server.edge resolved from the
 * application: the replacement source is loaded at the client module's own
 * path, and a "use client" module inside a package (this framework's Link)
 * cannot necessarily see the app's react-server-dom-webpack from there. */
const clientReferenceSource = (module: ClientModule, flightServer: string) => {
	const lines = [
		`import { registerClientReference } from ${JSON.stringify(flightServer)};`,
		`import { clientManifest } from ${JSON.stringify(MANIFEST_SPECIFIER)};`,
		`const id = ${JSON.stringify(module.id)};`,
		`clientManifest[id] = { chunks: [id, id], id, name: '' };`,
		`const reference = (name) => registerClientReference(() => { throw new Error('Client component ' + name + ' cannot be called on the server.'); }, id, name);`
	];
	for (const name of module.exports) {
		lines.push(
			name === 'default'
				? `export default reference('default');`
				: `export const ${name} = reference(${JSON.stringify(name)});`
		);
	}

	return `${lines.join('\n')}\n`;
};

const REACT_COMPONENTS_SPECIFIER = /^@absolutejs\/absolute\/react\/components$/;

/* `@absolutejs/absolute/react/components` imported from a server component
 * gets its server entry (dist/react/components/server/index.js, next to the
 * regular one): the regular entry also defines Link's context at module
 * scope, and React's react-server build has no createContext. The server
 * entry renders the slots on the server and takes Link from a "use client"
 * file, which the onLoad hook below turns into a client reference. Done
 * here rather than as a `react-server` export condition, which would have to
 * precede `import` in package.json's key-sorted exports. Undefined (default
 * resolution) for a package version without the server entry. */
const resolveReactComponentsServerEntry = (importer: string) => {
	try {
		const regularEntry = Bun.resolveSync(
			'@absolutejs/absolute/react/components',
			dirname(importer)
		);
		const serverEntry = join(dirname(regularEntry), 'server', 'index.js');

		return existsSync(serverEntry) ? serverEntry : undefined;
	} catch {
		return undefined;
	}
};

const createClientReferencePlugin = (
	projectRoot: string,
	clientModules: Map<string, ClientModule>
) => {
	const flightServer = Bun.resolveSync(
		'react-server-dom-webpack/server.edge',
		projectRoot
	);
	const plugin: BunPlugin = {
		name: 'absolute-react-server-client-references',
		setup(builder) {
			builder.onResolve(
				{ filter: /^absolute-react-server:/ },
				(args) => ({
					namespace: MANIFEST_NAMESPACE,
					path: args.path
				})
			);
			builder.onLoad(
				{ filter: /.*/, namespace: MANIFEST_NAMESPACE },
				() => ({
					contents: 'export const clientManifest = {};\n',
					loader: 'js'
				})
			);
			builder.onResolve(
				{ filter: REACT_COMPONENTS_SPECIFIER },
				(args) => {
					const path = resolveReactComponentsServerEntry(
						args.importer
					);

					return path ? { path } : undefined;
				}
			);
			builder.onLoad({ filter: SOURCE_FILTER }, (args) => {
				const source = readFileSync(args.path, 'utf8');
				const loader = loaderFor(args.path);
				if (!isClientModuleSource(source)) {
					return { contents: source, loader };
				}
				const module: ClientModule = {
					exports: scanExportNames(args.path, source),
					id: clientModuleId(projectRoot, args.path),
					path: args.path
				};
				clientModules.set(module.id, module);

				return {
					contents: clientReferenceSource(module, flightServer),
					loader: 'js'
				};
			});
		}
	};

	return plugin;
};

const ALS_SETUP_SOURCE = `import { AsyncLocalStorage } from 'node:async_hooks';
// The Flight server's edge build looks for a global AsyncLocalStorage to
// keep per-request state (cache(), hints) across awaits.
if (typeof globalThis.AsyncLocalStorage !== 'function') {
	globalThis.AsyncLocalStorage = AsyncLocalStorage;
}
`;

/* The page component is the export named after the file (`Home` for
 * pages/Home.tsx), the same convention as React pages, or else the default
 * export. */
const resolvePageExport = (pagePath: string, pascalName: string) => {
	const exports = scanExportNames(pagePath, readFileSync(pagePath, 'utf8'));
	if (exports.includes(pascalName)) return pascalName;
	if (exports.includes('default')) return 'default';
	throw new Error(
		`React Server Components page ${pagePath} must export a component named ${pascalName} (or a default export).`
	);
};

const pageEntrySource = (pagePath: string, exportName: string) =>
	`import '../asyncLocalStorage';
export { ${exportName} as Page } from ${JSON.stringify(pagePath)};
export { renderToReadableStream } from 'react-server-dom-webpack/server.edge';
export { createElement } from 'react';
export { clientManifest } from ${JSON.stringify(MANIFEST_SPECIFIER)};
`;

const ssrEntrySource = (modules: ClientModule[]) => {
	const imports = modules.map(
		(module, index) =>
			`import * as module${index} from ${JSON.stringify(module.path)};`
	);
	const entries = modules.map(
		(module, index) => `\t${JSON.stringify(module.id)}: module${index}`
	);

	return `${imports.join('\n')}
import { createFromReadableStream } from 'react-server-dom-webpack/client.edge';
import { renderToReadableStream } from 'react-dom/server';
import { createElement, use } from 'react';

const modules = {
${entries.join(',\n')}
};
const registry = (globalThis.__absoluteReactServerModules ??= {});
Object.assign(registry, modules);
globalThis.__webpack_require__ = (id) => globalThis.__absoluteReactServerModules[id];
globalThis.__webpack_chunk_load__ = () => Promise.resolve();

const moduleMap = {};
for (const id of Object.keys(modules)) {
	moduleMap[id] = { '*': { chunks: [], id, name: '*' } };
}

export const renderHtml = (flight, options) => {
	const root = createFromReadableStream(flight, {
		serverConsumerManifest: {
			moduleLoading: null,
			moduleMap,
			serverModuleMap: null
		}
	});
	const Root = () => use(root);

	return renderToReadableStream(createElement(Root), options);
};
`;
};

/* Imported before the Flight client: its browser build reads
 * `__webpack_require__.u` while the module initialises. Each client module
 * id is its own "chunk", loaded with a lazy import(). */
const clientRuntimeSource = (modules: ClientModule[]) => {
	const loaders = modules.map(
		(module) =>
			`\t${JSON.stringify(module.id)}: () => import(${JSON.stringify(module.path)})`
	);

	return `const loaders = {
${loaders.join(',\n')}
};
const loaded = {};
const webpackRequire = (id) => loaded[id];
webpackRequire.u = (id) => id;
globalThis.__webpack_require__ = webpackRequire;
// Dev builds of the Flight client name each chunk's script for debug info.
globalThis.__webpack_get_script_filename__ = (id) => id;
globalThis.__webpack_chunk_load__ = (id) => {
	const load = loaders[id];
	if (!load) return Promise.reject(new Error('Unknown client module ' + id));

	return load().then((module) => {
		loaded[id] = module;
	});
};
`;
};

const clientEntrySource = () =>
	`import './ReactServerClientRuntime';
import { createFromReadableStream } from 'react-server-dom-webpack/client.browser';
import { hydrateRoot } from 'react-dom/client';
import { createElement, use } from 'react';

const encoder = new TextEncoder();
const stream = new ReadableStream({
	start(controller) {
		const queue = (self.${REACT_SERVER_PAYLOAD_GLOBAL} ??= []);
		for (const chunk of queue) controller.enqueue(encoder.encode(chunk));
		queue.length = 0;
		queue.push = (chunk) => {
			controller.enqueue(encoder.encode(chunk));

			return 0;
		};
		const close = () => controller.close();
		if (document.readyState === 'loading') {
			document.addEventListener('DOMContentLoaded', close, { once: true });
		} else {
			close();
		}
	}
});
const root = createFromReadableStream(stream);
const Root = () => use(root);
hydrateRoot(document, createElement(Root));
`;

const findOutput = (outputs: BuildArtifact[], name: string) =>
	outputs.find(
		(artifact) =>
			artifact.kind === 'entry-point' &&
			basename(artifact.path).startsWith(`${name}.`)
	);

const toWebPath = (buildPath: string, path: string) =>
	`/${relative(buildPath, path).replace(/\\/g, '/')}`;

const assertFlightPackage = (projectRoot: string) => {
	try {
		Bun.resolveSync('react-server-dom-webpack/package.json', projectRoot);
	} catch {
		throw new Error(
			'reactServerComponentsDirectory is set but react-server-dom-webpack is not installed. ' +
				'Add it at the same version as react (for example `bun add react-server-dom-webpack@<your react version>`).'
		);
	}
};

const emptyResult = (): ReactServerBuildResult => ({
	logs: [],
	manifest: {},
	outputPaths: [],
	success: true
});

const writeGeneratedFile = (path: string, contents: string) => {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, contents);

	return path;
};

const pageEntryName = (pagePath: string) =>
	toPascal(basename(pagePath, extname(pagePath)));

const endsWithPageSuffix = (name: string) =>
	name.length > REACT_SERVER_PAGE_MANIFEST_SUFFIX.length &&
	name.endsWith(REACT_SERVER_PAGE_MANIFEST_SUFFIX);

/* Manifest keys for each RSC page: `<Page>RSC`, without doubling the suffix
 * when the file name already ends in it (pages/HomeRSC.tsx → `HomeRSC`).
 * Such a page also keeps the doubled key (`HomeRSCRSC`) it had before
 * this release as a deprecated alias. When pages/Home.tsx exists too, it
 * owns `HomeRSC` (its key has not changed) and HomeRSC.tsx keeps only the
 * doubled key. */
const pageManifestKeys = (name: string, names: Set<string>) => {
	const doubled = `${name}${REACT_SERVER_PAGE_MANIFEST_SUFFIX}`;
	if (!endsWithPageSuffix(name)) return { keys: [doubled] };
	const base = name.slice(0, -REACT_SERVER_PAGE_MANIFEST_SUFFIX.length);
	if (!names.has(base)) return { keys: [name, doubled] };

	return {
		collision: `React Server Components pages ${base} and ${name} both map to the manifest key "${name}"; ${base} keeps it and ${name} is only reachable as "${doubled}". Rename one of them.`,
		keys: [doubled]
	};
};

export const buildReactServerComponents = async ({
	buildPath,
	directory,
	isDev,
	projectRoot
}: ReactServerBuildOptions) => {
	const pagesDir = join(directory, 'pages');
	if (!existsSync(pagesDir)) return emptyResult();
	const pages = [
		...new Glob(PAGE_PATTERN).scanSync({ absolute: true, cwd: pagesDir })
	].sort();
	if (pages.length === 0) return emptyResult();
	assertFlightPackage(projectRoot);

	const generatedDir = join(
		projectRoot,
		'.absolutejs',
		'generated',
		'react-server'
	);
	writeGeneratedFile(
		join(generatedDir, 'asyncLocalStorage.ts'),
		ALS_SETUP_SOURCE
	);
	const pageEntries = pages.map((pagePath) => {
		const name = pageEntryName(pagePath);

		return {
			entry: writeGeneratedFile(
				join(generatedDir, 'pages', `${name}.ts`),
				pageEntrySource(pagePath, resolvePageExport(pagePath, name))
			),
			name
		};
	});
	const sharedDefine: Record<string, string> = {
		'process.env.NODE_ENV': JSON.stringify(
			isDev ? 'development' : 'production'
		)
	};
	// Server stacks point at sources. The map also gives Bun a real trailing
	// sourceMappingURL: the Flight client's dev build has the text
	// "//# sourceMappingURL=" at a line start inside a template literal,
	// which Bun otherwise tries (and fails) to decode.
	const serverSourcemap = isDev ? 'inline' : 'linked';

	const clientModules = new Map<string, ClientModule>();
	const serverResult = await bunBuild({
		conditions: ['react-server'],
		define: sharedDefine,
		entrypoints: pageEntries.map((page) => page.entry),
		format: 'esm',
		naming: '[name].[hash].[ext]',
		outdir: join(buildPath, 'react', 'server', 'rsc'),
		plugins: [createClientReferencePlugin(projectRoot, clientModules)],
		root: generatedDir,
		sourcemap: serverSourcemap,
		splitting: true,
		target: 'bun',
		throw: false
	});
	if (!serverResult.success) {
		return { ...emptyResult(), logs: serverResult.logs, success: false };
	}

	const modules = [...clientModules.values()].sort((left, right) =>
		left.id.localeCompare(right.id)
	);
	const ssrEntry = writeGeneratedFile(
		join(generatedDir, 'ReactServerRenderer.ts'),
		ssrEntrySource(modules)
	);
	writeGeneratedFile(
		join(generatedDir, 'ReactServerClientRuntime.ts'),
		clientRuntimeSource(modules)
	);
	const clientEntry = writeGeneratedFile(
		join(generatedDir, 'ReactServerClient.ts'),
		clientEntrySource()
	);
	const [ssrResult, clientResult] = await Promise.all([
		bunBuild({
			define: sharedDefine,
			entrypoints: [ssrEntry],
			format: 'esm',
			naming: '[name].[hash].[ext]',
			outdir: join(buildPath, 'react', 'server', 'ssr'),
			root: generatedDir,
			sourcemap: serverSourcemap,
			target: 'bun',
			throw: false
		}),
		bunBuild({
			define: sharedDefine,
			entrypoints: [clientEntry],
			format: 'esm',
			minify: !isDev,
			naming: {
				chunk: 'chunk-[hash].[ext]',
				entry: '[name].[hash].[ext]'
			},
			outdir: join(buildPath, 'react', 'rsc'),
			root: generatedDir,
			splitting: true,
			target: 'browser',
			throw: false
		})
	]);
	const logs = [
		...serverResult.logs,
		...ssrResult.logs,
		...clientResult.logs
	];
	if (!ssrResult.success || !clientResult.success) {
		return { ...emptyResult(), logs, success: false };
	}

	const ssrOutput = findOutput(ssrResult.outputs, 'ReactServerRenderer');
	const clientOutput = findOutput(clientResult.outputs, 'ReactServerClient');
	if (!ssrOutput || !clientOutput) {
		throw new Error('React Server Components build produced no entry.');
	}
	const clientUrl = toWebPath(buildPath, clientOutput.path);
	const rscOutputDir = join(buildPath, 'react', 'server', 'rsc');
	const runtimeFile = writeGeneratedFile(
		join(rscOutputDir, REACT_SERVER_RUNTIME_FILE),
		JSON.stringify({
			client: clientUrl,
			ssr: relative(rscOutputDir, ssrOutput.path).replace(/\\/g, '/')
		})
	);

	// The renderer is listed too (by disk path) so the dev asset cleanup,
	// which keeps only hashed files the manifest names, leaves it alone.
	const manifest: Record<string, string> = {
		[REACT_SERVER_CLIENT_MANIFEST_KEY]: clientUrl,
		[REACT_SERVER_RENDERER_MANIFEST_KEY]: resolve(ssrOutput.path)
	};
	const pageKeys = reactServerPageManifestKeys(
		pageEntries.map((page) => page.name)
	);
	for (const collision of pageKeys.collisions) logWarn(collision);
	for (const page of pageEntries) {
		const output = findOutput(serverResult.outputs, page.name);
		if (!output) continue;
		for (const key of pageKeys.keys.get(page.name) ?? [])
			manifest[key] = resolve(output.path);
	}

	const result: ReactServerBuildResult = {
		logs,
		manifest,
		outputPaths: [
			...serverResult.outputs.map((artifact) => artifact.path),
			...ssrResult.outputs.map((artifact) => artifact.path),
			...clientResult.outputs.map((artifact) => artifact.path),
			runtimeFile
		],
		success: true
	};

	return result;
};

type ReactServerPassOptions = Omit<ReactServerBuildOptions, 'directory'> & {
	directory: string | undefined;
	incrementalFiles: string[] | undefined;
};

/* build()'s entry point: nothing when the directory is not configured, and
 * an incremental (HMR) build only re-runs the pass for a file inside it. */
export const buildReactServerComponentsPass = async ({
	directory,
	incrementalFiles,
	...options
}: ReactServerPassOptions) => {
	if (!directory) return undefined;
	const absoluteDirectory = validateSafePath(directory, options.projectRoot);
	const directoryPrefix = `${normalizePath(absoluteDirectory)}/`;
	const touchesDirectory =
		!incrementalFiles ||
		incrementalFiles.length === 0 ||
		incrementalFiles.some((file) =>
			normalizePath(resolve(file)).startsWith(directoryPrefix)
		);
	if (!touchesDirectory) return undefined;

	return buildReactServerComponents({
		...options,
		directory: absoluteDirectory
	});
};

export const reactServerPageManifestKeys = (pageNames: string[]) => {
	const names = new Set(pageNames);
	const keys = new Map<string, string[]>();
	const collisions: string[] = [];
	for (const name of pageNames) {
		const page = pageManifestKeys(name, names);
		keys.set(name, page.keys);
		if (page.collision) collisions.push(page.collision);
	}

	return { collisions, keys };
};
