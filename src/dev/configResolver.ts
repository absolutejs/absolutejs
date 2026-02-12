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
	// Normalize to forward slashes for cross-platform compatibility (Windows uses backslashes)
	const normalize = (path: string) => path.replace(/\\/g, '/');
	const withDefault = (value: string | undefined, fallback: string) =>
		normalize(resolve(cwd, value ?? fallback));
	const optional = (value: string | undefined) =>
		value ? normalize(resolve(cwd, value)) : undefined;

	return {
		buildDir: withDefault(config.buildDirectory, 'build'),
		assetsDir: optional(config.assetsDirectory),
		reactDir: optional(config.reactDirectory),
		svelteDir: optional(config.svelteDirectory),
		vueDir: optional(config.vueDirectory),
		angularDir: optional(config.angularDirectory),
		htmlDir: optional(config.htmlDirectory),
		htmxDir: optional(config.htmxDirectory)
	};
}

export type ResolvedBuildPaths = ReturnType<typeof resolveBuildPaths>;
