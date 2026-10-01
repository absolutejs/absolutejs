import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BuildConfig } from '../../types/build';

const FRAMEWORK_EXTERNALS = [
	'react',
	'react/jsx-runtime',
	'react-dom',
	'react-dom/*',
	'vue',
	'vue/*',
	'@vue/compiler-sfc',
	'@vue/server-renderer',
	'svelte',
	'svelte/*',
	'@angular/compiler',
	'@angular/compiler-cli',
	'@angular/core',
	'@angular/common',
	'@angular/platform-browser',
	'@angular/platform-server',
	'typescript'
] as const;

// User-declared externals from `bunBuild` (override form `{ external }` or
// pass-config form `{ default: { external } }`) must apply to both `start` and
// `compile`. These are commonly optional native addons or lazy server-only
// packages whose runtime fallback is valid but whose sources cannot be safely
// inlined by Bun's production bundler.
const collectUserServerExternals = (buildConfig: BuildConfig) => {
	const { bunBuild } = buildConfig;
	if (!bunBuild) return [];
	const override =
		'external' in bunBuild && Array.isArray(bunBuild.external)
			? bunBuild.external
			: [];
	const defaultBuild = 'default' in bunBuild ? bunBuild.default : undefined;
	const fromDefault = Array.isArray(defaultBuild?.external)
		? defaultBuild.external
		: [];

	return [...override, ...fromDefault];
};

type PackageManifest = {
	dependencies?: Record<string, string>;
	peerDependenciesMeta?: Record<string, { optional?: boolean }>;
};

const readManifest = (file: string) => {
	if (!existsSync(file)) return undefined;
	try {
		const manifest: PackageManifest = JSON.parse(
			readFileSync(file, 'utf-8')
		);

		return manifest;
	} catch {
		return undefined;
	}
};

const isInstalled = (specifier: string, projectRoot: string) =>
	existsSync(join(projectRoot, 'node_modules', specifier, 'package.json'));

// A dependency's optional peer that the app did not install is a feature
// the app does not use (e.g. @absolutejs/auth's SAML provider and
// @node-saml/node-saml). The package reaches it with a guarded dynamic
// import, but the production bundler resolves every import up front and
// failed the whole server bundle on the missing module. Left external, the
// import fails only if that feature is ever used, which is what optional
// means.
export const collectMissingOptionalPeers = (projectRoot: string) => {
	const app = readManifest(join(projectRoot, 'package.json'));
	const optionalPeers = Object.keys(app?.dependencies ?? {}).flatMap(
		(dependency) =>
			Object.entries(
				readManifest(
					join(
						projectRoot,
						'node_modules',
						dependency,
						'package.json'
					)
				)?.peerDependenciesMeta ?? {}
			)
				.filter(([, meta]) => meta.optional === true)
				.map(([peer]) => peer)
	);
	const missing = new Set(
		optionalPeers.filter((peer) => !isInstalled(peer, projectRoot))
	);

	return [...missing].flatMap((peer) => [peer, `${peer}/*`]);
};

export const resolveServerBundleExternals = (
	buildConfig: BuildConfig,
	projectRoot = process.cwd()
) => [
	...FRAMEWORK_EXTERNALS.filter((specifier) => {
		if (
			buildConfig.reactDirectory &&
			(specifier === 'react' ||
				specifier.startsWith('react/') ||
				specifier.startsWith('react-dom'))
		)
			return false;
		if (
			buildConfig.vueDirectory &&
			(specifier === 'vue' ||
				specifier.startsWith('vue/') ||
				specifier === '@vue/server-renderer')
		)
			return false;
		if (
			buildConfig.svelteDirectory &&
			(specifier === 'svelte' || specifier.startsWith('svelte/'))
		)
			return false;

		return true;
	}),
	...collectUserServerExternals(buildConfig),
	...collectMissingOptionalPeers(projectRoot)
];
