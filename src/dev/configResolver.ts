import { resolve } from 'node:path';
import type { BuildConfig } from '../types';

type ResolvedPaths = {
	buildDir: string;
	assetsDir?: string;
	reactDir?: string;
	svelteDir?: string;
	vueDir?: string;
	angularDir?: string;
	htmlDir?: string;
	htmxDir?: string;
};

/** Normalize and default build paths so HMR works outside the example app. */
export function resolveBuildPaths(config: BuildConfig): ResolvedPaths {
	const cwd = process.cwd();
	const withDefault = (value: string | undefined, fallback: string) =>
		resolve(cwd, value ?? fallback);

	return {
		buildDir: withDefault(config.buildDirectory, 'build'),
		assetsDir: config.assetsDirectory
			? resolve(cwd, config.assetsDirectory)
			: undefined,
		reactDir: config.reactDirectory
			? resolve(cwd, config.reactDirectory)
			: undefined,
		svelteDir: config.svelteDirectory
			? resolve(cwd, config.svelteDirectory)
			: undefined,
		vueDir: config.vueDirectory ? resolve(cwd, config.vueDirectory) : undefined,
		angularDir: config.angularDirectory
			? resolve(cwd, config.angularDirectory)
			: undefined,
		htmlDir: config.htmlDirectory ? resolve(cwd, config.htmlDirectory) : undefined,
		htmxDir: config.htmxDirectory ? resolve(cwd, config.htmxDirectory) : undefined
	};
}

export type ResolvedBuildPaths = ReturnType<typeof resolveBuildPaths>;

