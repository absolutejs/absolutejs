/*
 * What a production server needs from absolute.config.ts, written next to
 * the build so the server never imports the config at runtime.
 *
 * Importing the config in production evaluated it from source: the
 * framework's own unbundled package, and everything the config itself
 * imports. The AbsoluteJS docs site's config imported its sitemap routes,
 * which pulled in every docs page, its data and its highlighter, so each
 * boot held a second, unbundled copy of the whole site beside the server
 * bundle: 735 modules, about 70 MB of the server's memory and about 55 MB of
 * the `absolute start` controller's (2026-11-01). The build already knows
 * the resolved config; it writes the parts the runtime reads, and the
 * runtime reads them as JSON.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BuildConfig } from '../../types/build';

export const PRODUCTION_RUNTIME_FILE = 'absolute-runtime.json';
const PRODUCTION_RUNTIME_VERSION = 1;

/* The fields production `prepare()` and `absolute start --prebuilt` read,
 * besides the build directory, which is wherever this file is found.
 * Every one is plain data; `images.loader`, the only function among them,
 * is a client component option the server never calls, and JSON drops it. */
const RUNTIME_KEYS = [
	'angularDirectory',
	'assetsDirectory',
	'astroDirectory',
	'emberDirectory',
	'htmlDirectory',
	'htmxDirectory',
	'images',
	'islands',
	'mobile',
	'openapi',
	'publicDirectory',
	'reactDirectory',
	'static',
	'svelteDirectory',
	'telemetry',
	'vitals',
	'vueDirectory'
] as const satisfies readonly (keyof BuildConfig)[];

export type ProductionRuntimeConfig = Pick<
	BuildConfig,
	(typeof RUNTIME_KEYS)[number]
>;

type ProductionRuntimeFile = {
	config: ProductionRuntimeConfig;
	version: number;
};

export const productionRuntimeConfigOf = (config: BuildConfig) => {
	const picked: Record<string, unknown> = {};
	for (const key of RUNTIME_KEYS)
		if (config[key] !== undefined) picked[key] = config[key];

	// Through JSON on the way out, so what is written is exactly what is read.
	const runtime: ProductionRuntimeConfig = JSON.parse(JSON.stringify(picked));

	return runtime;
};

export const writeProductionRuntime = (
	config: BuildConfig,
	buildDirectory: string
) => {
	const file: ProductionRuntimeFile = {
		config: productionRuntimeConfigOf(config),
		version: PRODUCTION_RUNTIME_VERSION
	};
	writeFileSync(
		join(buildDirectory, PRODUCTION_RUNTIME_FILE),
		`${JSON.stringify(file)}\n`
	);
};

const isRuntimeFile = (value: unknown): value is ProductionRuntimeFile =>
	typeof value === 'object' &&
	value !== null &&
	'version' in value &&
	value.version === PRODUCTION_RUNTIME_VERSION &&
	'config' in value &&
	typeof value.config === 'object' &&
	value.config !== null;

/** The build's runtime config, or null when this build has none (built by
 *  an older framework, or not through `absolute start`/`prepare`), in which
 *  case the caller loads absolute.config.ts as before. */
export const readProductionRuntime = (buildDirectory: string) => {
	const path = join(buildDirectory, PRODUCTION_RUNTIME_FILE);
	if (!existsSync(path)) return null;
	const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'));
	if (!isRuntimeFile(parsed)) return null;
	// Where the build is now, not where it was written: a build can be
	// copied (a release artifact, a standalone executable's temp dir).
	const config: BuildConfig = { ...parsed.config, buildDirectory };

	return config;
};
