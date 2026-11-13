import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';

/* In production the build directory is also the static asset root, and it
 * holds files only the server may read: the bundled server itself (and its
 * source map), the SSR page bundles, the compiled convention pages and the
 * runtime manifests. Mounted unfiltered, `GET /server.js` downloaded the
 * whole backend. These patterns keep them off the static routes; the server
 * reads all of them from disk, never over HTTP.
 *
 * `@elysia/static` matches each pattern against the file's path relative to
 * the asset dir (leading `/`), and a custom list replaces its defaults, so
 * those are repeated here. */
const STATIC_PLUGIN_DEFAULTS = ['.DS_Store', '.git', '.env'];

/** Written by the build: every file the server pass produced, relative to
 *  the build directory. */
export const SERVER_OUTPUTS_FILE = 'server-outputs.json';

const SERVER_ONLY_PATTERNS = [
	// SSR bundles and server vendors: svelte/server, vue/server,
	// angular/vendor/server, …
	/^\/(?:angular|ember|react|svelte|vue)\/(?:vendor\/)?server\//,
	/^\/conventions\//,
	/^\/(?:absolute-runtime|conventions|server-outputs|spa-routes)\.json(?:\.br|\.gz)?$/,
	// Source maps: client maps are moved to a private directory by the
	// build (`sourcemaps: 'external'`); the server bundle's map stays local.
	/\.map$/,
	/\.node$/
];

const escapeRegExp = (value: string) =>
	value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const isStringArray = (value: unknown): value is string[] =>
	Array.isArray(value) && value.every((entry) => typeof entry === 'string');

const readServerOutputs = (buildDir: string) => {
	const path = join(buildDir, SERVER_OUTPUTS_FILE);
	if (!existsSync(path)) return [];
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'));

		return isStringArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
};

/** One pattern matching exactly the files the build's server pass wrote
 *  (and their compressed copies and maps): SSR page bundles and their
 *  chunks, wherever the framework and project shape put them. */
const serverOutputsPattern = (buildDir: string) => {
	const outputs = readServerOutputs(buildDir);
	if (outputs.length === 0) return null;

	return new RegExp(
		`^/(?:${outputs.map(escapeRegExp).join('|')})(?:\\.br|\\.gz|\\.map)?$`
	);
};

/** Static-plugin ignore patterns for a production build directory.
 *  `serverBundle` is the running server's entry file (`Bun.main` under
 *  `absolute start`); when it lives inside the build directory, it and its
 *  compressed copies are excluded too. */
export const productionStaticIgnorePatterns = (
	buildDir: string,
	serverBundle: string
) => {
	const patterns: (string | RegExp)[] = [
		...STATIC_PLUGIN_DEFAULTS,
		...SERVER_ONLY_PATTERNS
	];
	const listed = serverOutputsPattern(buildDir);
	if (listed) patterns.push(listed);
	const bundlePath = relative(buildDir, serverBundle);
	const insideBuildDir =
		bundlePath !== '' &&
		!bundlePath.startsWith('..') &&
		!isAbsolute(bundlePath);
	if (insideBuildDir) {
		const urlPath = bundlePath.split(sep).join('/');
		patterns.push(
			new RegExp(`^/${escapeRegExp(urlPath)}(?:\\.br|\\.gz|\\.map)?$`)
		);
	}

	return patterns;
};
