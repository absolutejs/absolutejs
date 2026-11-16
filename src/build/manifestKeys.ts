import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import type { BuildConfig } from '../../types/build';
import { ISLAND_BOOTSTRAP_MANIFEST_KEY } from '../core/islandManifest';
import {
	REACT_SERVER_CLIENT_MANIFEST_KEY,
	REACT_SERVER_RENDERER_MANIFEST_KEY
} from '../react/serverComponents/constants';
import {
	FONT_PRELOAD_MANIFEST_PREFIX,
	FONTS_REMOTE_CSS_MANIFEST_PREFIX
} from '../utils/fontAssets';
import { normalizePath } from '../utils/normalizePath';
import { toKebab, toPascal } from '../utils/stringModifiers';
import { scanFileRoutes } from './fileRoutes';
import { manifestKeyForOutput } from './generateManifest';
import { DEFAULT_ISLAND_BOOTSTRAP_NAME } from './islandBootstrap';
import { loadIslandRegistryBuildInfo } from './islandEntries';
import { scanConventions } from './scanConventions';
import { scanCssEntryPoints } from './scanCssEntryPoints';
import { scanEntryPoints } from './scanEntryPoints';

/* The manifest keys a build of this project writes, derived from its source
 * tree without building — so `asset(manifest, 'Abuot')` can be a type error
 * before anything has been built, in a dev server that builds pages lazily,
 * and in CI that only runs `absolute typecheck`.
 *
 * Every key comes from the same inputs the build reads (the page and style
 * scanners, the convention filter, file routes, the island registry) and,
 * wherever the build names an output, from the build's own naming function
 * (`manifestKeyForOutput`) applied to the path the output is written at.
 * tests/integration/build/manifest-keys.test.ts builds a project using every
 * framework and fails if the two key sets drift.
 *
 * Two kinds of key are reported:
 *   - `definite`: the build always writes it for this source tree;
 *   - `possible`: the build writes it only when something it can't know
 *     without bundling holds — a page's styles (`<Page>BundledCSS` when a
 *     page imports CSS, `<Page>CompiledCSS` when a Vue page or any child
 *     has a <style>), an island's stylesheet, a worker. These are accepted
 *     by the type too: rejecting a key the build does write would be worse
 *     than accepting one it may not.
 *
 * Keys no source file determines are typed by pattern instead (`patterns`):
 * shared chunks (`Chunk<hash>`) and the self-hosted font entries
 * (`AbsoluteFontPreload<n>`).
 *
 * The declaration is rewritten by dev, build and typecheck only, so an
 * editor with none of them running can lag the source until one does: see
 * docs/MANIFEST_KEYS_EDITOR_LAG.md. */

export type DerivedManifestKeys = {
	definite: Set<string>;
	patterns: string[];
	possible: Set<string>;
};

const GENERATED = '.absolutejs/generated';
const STYLE_EXTENSION = /\.(?:css|scss|sass|less|styl|stylus)$/;

const stemOf = (path: string) => basename(path, extname(path));

const toPosix = (path: string) => normalizePath(path);

/** `src/pages/Home.vue` → `src/pages/Home.js`, the way the build renames
 *  each compiled module. */
const asJs = (path: string) =>
	toPosix(path).replace(/\.(?:vue|svelte|ts|tsx|jsx|js|mjs)$/, '.js');

export const deriveManifestKeys = async (
	config: BuildConfig,
	projectRoot = process.cwd()
): Promise<DerivedManifestKeys> => {
	const definite = new Set<string>();
	const possible = new Set<string>();
	const patterns = ['Chunk${string}'];
	const at = (dir: string | undefined) =>
		dir === undefined ? undefined : resolve(projectRoot, dir);
	const fromRoot = (path: string) => toPosix(relative(projectRoot, path));
	/* Through the build's naming function, as the build does. */
	const add = (target: Set<string>, outputPath: string) => {
		const output = manifestKeyForOutput(outputPath);
		if (output) target.add(output.key);
	};

	const reactDir = at(config.reactDirectory);
	const svelteDir = at(config.svelteDirectory);
	const vueDir = at(config.vueDirectory);
	const angularDir = at(config.angularDirectory);
	const emberDir = at(config.emberDirectory);
	const htmlDir = at(config.htmlDirectory);
	const htmxDir = at(config.htmxDirectory);
	const assetsDir = at(config.assetsDirectory);
	const fileRoutes = scanFileRoutes(config).routes;

	// React: one hydration index per page (generateReactIndexFiles names
	// it by the file name up to its first dot) and per React file route.
	if (reactDir) {
		const pagesDir = join(reactDir, 'pages');
		const pages = existsSync(pagesDir)
			? (await scanConventions(pagesDir, '*.{jsx,tsx}')).pageFiles
			: [];
		const names = [
			...pages.map((page) => basename(page).split('.')[0] ?? ''),
			...fileRoutes
				.filter((route) => route.framework === 'react')
				.map((route) => route.name)
		].filter(Boolean);
		for (const name of names) {
			add(definite, `${GENERATED}/react/indexes/${name}.js`);
			add(possible, `${GENERATED}/react/indexes/${name}.css`);
		}
	}

	// React Server Components: `<Page>RSC` per page, plus the runtime.
	const rscDir = at(config.reactServerComponentsDirectory);
	if (rscDir && existsSync(join(rscDir, 'pages'))) {
		const { reactServerPageManifestKeys } =
			await import('./buildReactServerComponents');
		const names = (
			await scanEntryPoints(join(rscDir, 'pages'), '*.{tsx,jsx,ts,js}')
		).map((page) => toPascal(stemOf(page)));
		if (names.length > 0) {
			definite.add(REACT_SERVER_CLIENT_MANIFEST_KEY);
			definite.add(REACT_SERVER_RENDERER_MANIFEST_KEY);
		}
		for (const keys of reactServerPageManifestKeys(names).keys.values())
			for (const key of keys) definite.add(key);
	}

	// Svelte: the SSR module, its hydration index and its client module.
	if (svelteDir) {
		const { pageFiles } = await scanConventions(
			join(svelteDir, 'pages'),
			'*.svelte'
		);
		for (const page of pageFiles) {
			const name = stemOf(page);
			definite.add(toPascal(name));
			add(definite, `svelte/server/pages/${name}.js`);
			add(definite, `${GENERATED}/svelte/indexes/pages/${name}.js`);
			add(definite, `${GENERATED}/svelte/client/pages/${name}.js`);
			add(possible, `${GENERATED}/svelte/indexes/pages/${name}.css`);
		}
		for (const route of fileRoutes.filter(
			(entry) => entry.framework === 'svelte'
		)) {
			for (const key of [
				route.name,
				`${route.name}Index`,
				`${route.name}Client`
			])
				possible.add(key);
		}
	}

	// Vue: the SSR module, index and client module (both mirrored under
	// `sources/<path from the project root>`), and the page's compiled
	// styles with the SSR sidecar that inlines them.
	if (vueDir) {
		const { pageFiles } = await scanConventions(
			join(vueDir, 'pages'),
			'*.vue'
		);
		const cssDir = assetsDir ? basename(assetsDir) : 'assets';
		for (const page of pageFiles) {
			const name = stemOf(page);
			const mirrored = asJs(fromRoot(page));
			definite.add(toPascal(name));
			add(definite, `vue/server/sources/${mirrored}`);
			add(definite, `${GENERATED}/vue/indexes/${name}.js`);
			add(definite, `${GENERATED}/vue/client/sources/${mirrored}`);
			add(possible, `${cssDir}/css/${toKebab(name)}-compiled.css`);
			possible.add(`${name}Css`);
			if (readFileSync(page, 'utf-8').includes('defineRoutes'))
				possible.add(`${name}SpaManifest`);
		}
	}

	// Angular: the SSR module (mirrored from the project root) and its
	// hydration index.
	if (angularDir) {
		const { pageFiles } = await scanConventions(
			join(angularDir, 'pages'),
			'**/*.ts'
		);
		for (const page of pageFiles) {
			const name = stemOf(page);
			definite.add(toPascal(name));
			add(definite, `angular/${asJs(fromRoot(page))}`);
			add(definite, `${GENERATED}/angular/indexes/${name}.js`);
			add(possible, `${GENERATED}/angular/indexes/${name}.css`);
		}
	}

	// Ember: the self-contained SSR bundle, by file name.
	if (emberDir) {
		const { pageFiles } = await scanConventions(
			join(emberDir, 'pages'),
			'*.{gjs,gts,ts}'
		);
		for (const page of pageFiles) {
			definite.add(toPascal(stemOf(page)));
			possible.add(`${toPascal(stemOf(page))}Index`);
		}
	}

	// Static HTML and HTMX pages: keyed by file name, as written.
	for (const dir of [htmlDir, htmxDir]) {
		if (!dir) continue;
		for (const page of await scanEntryPoints(join(dir, 'pages'), '*.html'))
			definite.add(basename(page, '.html'));
		for (const script of await scanEntryPoints(
			join(dir, 'scripts'),
			'*.{js,ts}'
		))
			add(definite, asJs(fromRoot(script)));
	}

	// Global stylesheets: built under `<build>/<styles folder name>/`.
	const stylesPath =
		typeof config.stylesConfig === 'string'
			? config.stylesConfig
			: config.stylesConfig?.path;
	const stylesDir = at(stylesPath);
	if (stylesDir) {
		const ignore =
			typeof config.stylesConfig === 'object'
				? config.stylesConfig.ignore
				: undefined;
		for (const sheet of await scanCssEntryPoints(stylesDir, ignore)) {
			const path = toPosix(relative(stylesDir, sheet)).replace(
				STYLE_EXTENSION,
				'.css'
			);
			add(definite, `${basename(stylesDir)}/${path}`);
		}
	}

	// Islands: one client entry per registered component, under
	// `islands/<framework>/`, and the bootstrap that starts them.
	const registryPath = at(config.islands?.registry);
	const bootstrapPath = at(config.islands?.bootstrap);
	if (registryPath && existsSync(registryPath)) {
		const { definitions } = await loadIslandRegistryBuildInfo(registryPath);
		for (const { component, framework } of definitions) {
			add(definite, `islands/${framework}/${component}.js`);
			add(possible, `islands/${framework}/${component}.css`);
		}
		if (!bootstrapPath && definitions.length > 0)
			add(definite, `islands/${DEFAULT_ISLAND_BOOTSTRAP_NAME}.js`);
	}
	if (bootstrapPath && existsSync(bootstrapPath)) {
		definite.add(ISLAND_BOOTSTRAP_MANIFEST_KEY);
		add(definite, asJs(fromRoot(bootstrapPath)));
	}

	// Workers (`new URL('./worker.ts', import.meta.url)`): bundled when a
	// page references one.
	const frameworkDirs = [
		reactDir,
		svelteDir,
		vueDir,
		angularDir,
		htmlDir,
		htmxDir
	].filter((dir): dir is string => dir !== undefined && existsSync(dir));
	if (frameworkDirs.length > 0) {
		const { scanWorkerReferences } = await import('../core/build');
		for (const worker of await scanWorkerReferences(frameworkDirs))
			possible.add(toPascal(stemOf(worker)));
	}

	if (config.fonts) {
		patterns.push(
			`${FONT_PRELOAD_MANIFEST_PREFIX}\${number}`,
			`${FONTS_REMOTE_CSS_MANIFEST_PREFIX}\${number}`
		);
	}

	for (const key of definite) possible.delete(key);

	return { definite, patterns, possible };
};

/** Where the declaration is written, relative to the project root. */
export const MANIFEST_KEYS_DECLARATION = '.absolutejs/types/manifest.d.ts';

const PACKAGE = '@absolutejs/absolute';

/** The declaration that types `asset(manifest, key)`: it adds every key to
 *  the package's `AbsoluteManifestKeys` interface. */
export const manifestKeysDeclarationSource = ({
	definite,
	patterns,
	possible
}: DerivedManifestKeys) => {
	const keys = [...new Set([...definite, ...possible])].sort();
	const members = [
		...keys.map((key) => `\t\t${JSON.stringify(key)}: true;`),
		...patterns.map((pattern) => `\t\t[key: \`${pattern}\`]: true;`)
	];

	return `// Generated by AbsoluteJS from the project's pages, styles and islands
// (absolute dev, absolute build, absolute typecheck). Do not edit.
export {};

declare module '${PACKAGE}' {
	interface AbsoluteManifestKeys {
${members.join('\n')}
	}
}
`;
};

const mergeKeys = (all: DerivedManifestKeys[]): DerivedManifestKeys => {
	const definite = new Set(all.flatMap((keys) => [...keys.definite]));
	const possible = new Set(
		all
			.flatMap((keys) => [...keys.possible])
			.filter((key) => !definite.has(key))
	);
	const patterns = [...new Set(all.flatMap((keys) => keys.patterns))];

	return { definite, patterns, possible };
};

/** Derives the key set and writes the declaration, unless it already says
 *  exactly that (an unchanged file keeps its mtime, so editors and watchers
 *  see nothing). Several configs sharing a project root (workspace
 *  services) get one declaration with all their keys. A project with no
 *  keys at all (no pages yet, or a plain library) gets no declaration, so
 *  `asset` accepts any string there. Never throws: a project the
 *  derivation can't read keeps the declaration it had.
 *
 *  Returns the declaration's path when one exists afterwards. */
export const writeManifestKeysDeclaration = async (
	configs: BuildConfig | BuildConfig[],
	projectRoot = process.cwd()
) => {
	const path = join(projectRoot, MANIFEST_KEYS_DECLARATION);
	try {
		const derived = mergeKeys(
			await Promise.all(
				(Array.isArray(configs) ? configs : [configs]).map((config) =>
					deriveManifestKeys(config, projectRoot)
				)
			)
		);
		if (derived.definite.size === 0 && derived.possible.size === 0) {
			await rm(path, { force: true });

			return null;
		}
		const source = manifestKeysDeclarationSource(derived);
		const current = existsSync(path)
			? await readFile(path, 'utf-8')
			: undefined;
		if (current === source) return path;
		await mkdir(dirname(path), { recursive: true });
		const staging = `${path}.${process.pid}.tmp`;
		await writeFile(staging, source);
		await rename(staging, path);

		return path;
	} catch {
		return existsSync(path) ? path : null;
	}
};
