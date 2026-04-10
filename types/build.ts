import { build } from '../src/core/build';
import { devBuild } from '../src/core/devBuild';
import type { ImageConfig } from './image';
import type { SitemapConfig } from './sitemap';

export type BuildOptions = {
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

export type StaticConfig = {
	/** Routes to pre-render at build time. Use "all" to crawl from / and discover all linked pages. */
	routes: string[] | 'all';
	/** Revalidation interval in seconds. When set, stale pages are re-rendered in the background (ISR). */
	revalidate?: number;
};

export type BuildConfig = {
	buildDirectory?: string;
	assetsDirectory?: string;
	publicDirectory?: string;
	islands?: {
		registry: string;
		bootstrap?: string;
	};
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
		devtools?: {
			// Override the workspace root reported to Chrome DevTools.
			projectRoot?: string;
			// Use a fixed workspace UUID instead of a generated one.
			uuid?: string;
			// Persist the generated UUID outside the default build cache location.
			uuidCachePath?: string;
			// Rewrite Linux paths to UNC form for Chrome running on Windows via WSL/Docker.
			normalizeForWindowsContainer?: boolean;
		};
	};
	// Static site generation — pre-render routes at build time
	static?: StaticConfig;
	// Image optimization — on-demand resizing, format conversion, caching
	images?: ImageConfig;
	// Sitemap generation — auto-discovers page routes on server start
	sitemap?: SitemapConfig;
};

export type BuildResult = ReturnType<typeof build>;
export type DevBuildResult = ReturnType<typeof devBuild>;
export type Result = BuildResult | DevBuildResult;

export type Prettify<T> = { [K in keyof T]: T[K] } & {};
