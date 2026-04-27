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

export type SassPreprocessorOptions = {
	/**
	 * Additional directories used when resolving Sass/SCSS @use, @forward, and @import.
	 * The current file directory and project root are always included.
	 */
	loadPaths?: string[];
	/** Source prepended to every Sass/SCSS file before compilation. */
	additionalData?: string;
	/** Select the Sass implementation package. Defaults to "sass". */
	implementation?: 'sass' | 'sass-embedded';
};

export type LessPreprocessorOptions = {
	/**
	 * Additional directories used when resolving Less @import.
	 * The current file directory and project root are always included.
	 */
	paths?: string[];
	/** Source prepended to every Less file before compilation. */
	additionalData?: string;
	/** Extra Less render options forwarded to less.render(). */
	options?: Record<string, unknown>;
};

export type StylusPreprocessorOptions = {
	/**
	 * Additional directories used when resolving Stylus @import.
	 * The current file directory and project root are always included.
	 */
	paths?: string[];
	/** Source prepended to every Stylus file before compilation. */
	additionalData?: string;
	/** Extra Stylus renderer options forwarded to stylus.set(). */
	options?: Record<string, unknown>;
};

export type PostCSSConfig =
	| false
	| {
			/**
			 * Inline PostCSS plugins. Import plugins in absolute.config.ts and pass
			 * initialized plugin instances here.
			 */
			plugins?: unknown[] | Record<string, unknown>;
			/** Extra options forwarded to postcss.process(). */
			options?: Record<string, unknown>;
			/** Explicit PostCSS config file, such as ./postcss.config.cjs. */
			config?: string;
	  };

export type StylePreprocessorConfig = {
	/**
	 * Import aliases for preprocessor imports, e.g. { "@styles/*": "src/styles/*" }.
	 * tsconfig compilerOptions.paths are also loaded automatically when available.
	 */
	aliases?: Record<string, string | string[]>;
	sass?: SassPreprocessorOptions;
	scss?: SassPreprocessorOptions;
	less?: LessPreprocessorOptions;
	postcss?: PostCSSConfig;
	stylus?: StylusPreprocessorOptions;
};

export type TailwindConfig = {
	input: string;
	output: string;
};

export type StaticConfig = {
	/** Routes to pre-render at build time. Use "all" to crawl from / and discover all linked pages. */
	routes: string[] | 'all';
	/** Revalidation interval in seconds. When set, stale pages are re-rendered in the background (ISR). */
	revalidate?: number;
};

export type HttpReadyConfig = {
	type?: 'http';
	path?: string;
	url?: string;
	method?: 'GET' | 'HEAD';
	expectStatus?: number | number[];
	headers?: Record<string, string>;
	intervalMs?: number;
	timeoutMs?: number;
};

export type TcpReadyConfig = {
	type: 'tcp';
	host?: string;
	port: number;
	intervalMs?: number;
	timeoutMs?: number;
};

export type CommandReadyConfig = {
	type: 'command';
	command: string[];
	intervalMs?: number;
	timeoutMs?: number;
};

export type DelayReadyConfig = {
	type: 'delay';
	ms: number;
};

export type ServiceReadyConfig =
	| false
	| string
	| HttpReadyConfig
	| TcpReadyConfig
	| CommandReadyConfig
	| DelayReadyConfig;

export type ServiceShutdownConfig =
	| false
	| string[]
	| {
			command: string[];
			timeoutMs?: number;
	  };

export type ServiceVisibility = 'public' | 'internal';

export type BaseBuildConfig = {
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
	stylePreprocessors?: StylePreprocessorConfig;
	postcss?: PostCSSConfig;
	tailwind?: TailwindConfig;
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

export type AbsoluteServiceConfig = BaseBuildConfig & {
	kind?: 'absolute';
	cwd?: string;
	config?: string;
	dependsOn?: string[];
	entry?: string;
	env?: Record<string, string>;
	ready?: ServiceReadyConfig;
	shutdown?: ServiceShutdownConfig;
	port?: number;
	visibility?: ServiceVisibility;
	command?: never;
};

export type CommandServiceConfig = {
	kind: 'command';
	command: string[];
	cwd?: string;
	dependsOn?: string[];
	env?: Record<string, string>;
	ready?: ServiceReadyConfig;
	shutdown?: ServiceShutdownConfig;
	port?: number;
	visibility?: ServiceVisibility;
	entry?: never;
	config?: never;
};

export type ServiceConfig = AbsoluteServiceConfig | CommandServiceConfig;
export type WorkspaceConfig = Record<string, ServiceConfig>;
export type BuildConfig = AbsoluteServiceConfig;
export type ConfigInput = BuildConfig | WorkspaceConfig;
export type ReservedConfigKey = keyof BuildConfig;

export type BuildResult = ReturnType<typeof build>;
export type DevBuildResult = ReturnType<typeof devBuild>;
export type Result = BuildResult | DevBuildResult;

export type Prettify<T> = { [K in keyof T]: T[K] } & {};
