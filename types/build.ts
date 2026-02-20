import { build } from '../src/core/build';
import { devBuild } from '../src/core/devBuild';

// Structural type — no @angular/core import needed
export type AngularComponent<T = unknown> = new (...args: any[]) => T;

export type BuildOptions = {
	preserveIntermediateFiles?: boolean;
	/** When true, build() throws on error instead of exit(1) - used by HMR rebuilds */
	throwOnError?: boolean;
	/** When true, HMR client code is injected into built assets. Set by devBuild(). */
	injectHMR?: boolean;
	hmr?: {
		debounceMs?: number;
	};
};

export type BuildConfig = {
	buildDirectory?: string;
	assetsDirectory?: string;
	publicDirectory?: string;
	reactDirectory?: string;
	vueDirectory?: string;
	angularDirectory?: string;
	astroDirectory?: string;
	svelteDirectory?: string;
	htmlDirectory?: string;
	htmxDirectory?: string;
	tailwind?: {
		input: string;
		output: string;
	};
	options?: BuildOptions;
	// Optional: List of files to rebuild incrementally (absolute paths)
	// When provided, only these files and their dependencies will be rebuilt
	incrementalFiles?: string[];
};

export type BuildResult = ReturnType<typeof build>;
export type DevBuildResult = ReturnType<typeof devBuild>;
export type Result = BuildResult | DevBuildResult;

export type Prettify<T> = { [K in keyof T]: T[K] } & {};

