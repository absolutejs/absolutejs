import { resolve } from 'node:path';
import type { BuildConfig, FrameworkConfig } from '../../types/build';

/** Normalize and default build paths so HMR works outside the example app. */
export const resolveBuildPaths = (config: BuildConfig) => {
	const cwd = process.cwd();
	// Normalize to forward slashes for cross-platform compatibility (Windows uses backslashes)
	const normalize = (path: string) => path.replace(/\\/g, '/');
	const withDefault = (value: string | undefined, fallback: string) =>
		normalize(resolve(cwd, value ?? fallback));
	const optional = (value: string | undefined) =>
		value ? normalize(resolve(cwd, value)) : undefined;

	const resolveFramework = (value: string | FrameworkConfig | undefined) => {
		if (!value) return { dir: undefined, pagesDir: undefined };
		const raw = typeof value === 'string' ? value : value.directory;
		const pages =
			typeof value === 'object' && value.pages ? value.pages : 'pages';
		const dir = normalize(resolve(cwd, raw));
		const pagesDir = normalize(resolve(cwd, raw, pages));
		return { dir, pagesDir };
	};

	const react = resolveFramework(config.reactConfig);
	const svelte = resolveFramework(config.svelteConfig);
	const vue = resolveFramework(config.vueConfig);
	const angular = resolveFramework(config.angularConfig);
	const html = resolveFramework(config.htmlConfig);
	const htmx = resolveFramework(config.htmxConfig);

	return {
		angularDir: angular.dir,
		angularPagesDir: angular.pagesDir,
		assetsDir: optional(config.assetsDirectory),
		buildDir: withDefault(config.buildDirectory, 'build'),
		htmlDir: html.dir,
		htmlPagesDir: html.pagesDir,
		htmxDir: htmx.dir,
		htmxPagesDir: htmx.pagesDir,
		reactDir: react.dir,
		reactPagesDir: react.pagesDir,
		stylesDir: optional(
			typeof config.stylesConfig === 'string'
				? config.stylesConfig
				: config.stylesConfig?.path
		),
		svelteDir: svelte.dir,
		sveltePagesDir: svelte.pagesDir,
		vueDir: vue.dir,
		vuePagesDir: vue.pagesDir
	};
};

export type ResolvedBuildPaths = ReturnType<typeof resolveBuildPaths>;
