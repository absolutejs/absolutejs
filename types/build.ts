import { build } from '../src/core/build';
import { devBuild } from '../src/core/devBuild';

export type BuildOptions = {
	preserveIntermediateFiles?: boolean;
	/** When true, build() throws on error instead of exit(1) - used by HMR rebuilds */
	throwOnError?: boolean;
	/** When true, HMR client code is injected into built assets. Set by devBuild(). */
	injectHMR?: boolean;
	hmr?: {
		debounceMs?: number;
	};
	/** Base manifest to merge into for incremental builds */
	baseManifest?: Record<string, string>;
};

export type StylesConfig = {
	path: string;
	ignore?: string[];
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
	stylesConfig?: string | StylesConfig;
	tailwind?: {
		input: string;
		output: string;
	};
	options?: BuildOptions;
	// Optional: List of files to rebuild incrementally (absolute paths)
	// When provided, only these files and their dependencies will be rebuilt
	incrementalFiles?: string[];
	// Tracks which command triggered the build for telemetry
	mode?: 'production' | 'development';
	// Dev server options (only used in development)
	dev?: {
		// Enable HTTPS for HTTP/2 multiplexing (faster HMR on import-heavy components)
		https?: boolean;
	};
};

export type BuildResult = ReturnType<typeof build>;
export type DevBuildResult = ReturnType<typeof devBuild>;
export type Result = BuildResult | DevBuildResult;

export type Prettify<T> = { [K in keyof T]: T[K] } & {};
