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
