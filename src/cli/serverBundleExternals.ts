import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { BunPlugin } from 'bun';
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

// The optional peers the app's direct dependencies declare, whether or not
// they are installed.
const collectOptionalPeers = (projectRoot: string) => {
	const app = readManifest(join(projectRoot, 'package.json'));

	return [
		...new Set(
			Object.keys(app?.dependencies ?? {}).flatMap((dependency) =>
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
			)
		)
	];
};

const escapeRegExp = (text: string) =>
	text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A dependency's optional peer that the app did not install is a feature
 *  the app does not use (e.g. @absolutejs/auth's SAML provider and
 *  @node-saml/node-saml). The package reaches it with a guarded dynamic
 *  import, but the production bundler resolves every import up front and
 *  failed the whole server bundle on the missing module. Left external, the
 *  import fails only if that feature is ever used, which is what optional
 *  means.
 *
 *  "Missing" is decided per import, from the importing file: under Bun's
 *  isolated installs a peer the dependency does have is linked beside that
 *  dependency, not at the project root, and Bun's `external` list applies to
 *  every importer. Checking only `<root>/node_modules` once left
 *  `@neondatabase/serverless` and `zod` external although installed, and the
 *  production server could not resolve them at startup. */
export const createOptionalPeerPlugin = (
	projectRoot = process.cwd()
): BunPlugin => ({
	name: 'absolute-optional-peers',
	setup(build) {
		const peers = collectOptionalPeers(projectRoot);
		if (peers.length === 0) return;
		const filter = new RegExp(
			`^(?:${peers.map(escapeRegExp).join('|')})(?:/.*)?$`
		);
		build.onResolve({ filter }, (args) => {
			const from = args.importer ? dirname(args.importer) : projectRoot;
			try {
				Bun.resolveSync(args.path, from);

				return undefined;
			} catch {
				return { external: true, path: args.path };
			}
		});
	}
});

export const resolveServerBundleExternals = (buildConfig: BuildConfig) => [
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
	...collectUserServerExternals(buildConfig)
];
