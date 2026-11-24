import { build } from '../src/core/build';
import { devBuild } from '../src/core/devBuild';
import type { BuildConfig as BunBuildConfig } from 'bun';
import type { ClusterConfig } from './cluster';
import type { FileRoutesConfig } from './fileRoutes';
import type { FontsConfig } from './fonts';
import type { HealthConfig } from './health';
import type { ImageConfig } from './image';
import type { LinksConfig } from './links';
import type { LoggingConfig } from './logging';
import type { RateLimitConfig } from './rateLimit';
import type { ShutdownConfig } from './shutdown';
import type { SitemapConfig } from './sitemap';
import type { VitalsSummaryConfig } from './vitals';
import type { SizeBudgets } from '../src/utils/sizeBudgets';
import type { BenchConfig } from './bench';

/** How Angular pages run change detection. `'zoneless'` (the default)
 *  uses signals and explicit scheduling; `'zone'` loads zone.js on the
 *  server and in the browser for apps and libraries that rely on NgZone. */
export type AngularChangeDetection = 'zone' | 'zoneless';

export type BunBuildPassKey =
	| 'server'
	| 'reactClient'
	| 'nonReactClient'
	| 'islandClient'
	| 'globalCss'
	| 'vueCss';

export type ReservedBunBuildConfigKey =
	| 'entrypoints'
	| 'outdir'
	| 'outfile'
	| 'root'
	| 'target'
	| 'format'
	| 'throw'
	| 'compile';

type DistributivePartialOmit<T, K extends PropertyKey> = T extends unknown
	? Partial<Omit<T, Extract<keyof T, K>>>
	: never;

export type BunBuildConfigOverride = DistributivePartialOmit<
	BunBuildConfig,
	ReservedBunBuildConfigKey
>;

export type BunBuildPassConfig = {
	default?: BunBuildConfigOverride;
} & Partial<Record<BunBuildPassKey, BunBuildConfigOverride>>;

export type BuildOptions = {
	/** Escalates build warnings that are survivable into thrown errors —
	 *  today that is the SSR Angular `@angular/core` multi-instance
	 *  guardrail, which logs a warning on its own and throws under this
	 *  flag. A build *failure* (a failed Bun pass, a manifest key
	 *  collision) always throws, with or without this, so a library caller
	 *  can catch it; it does not end the host process. */
	throwOnError?: boolean;
	/** When true, HMR client code is injected into built assets. Set by devBuild(). */
	injectHMR?: boolean;
	hmr?: {
		debounceMs?: number;
	};
	/** Base manifest to merge into for incremental builds */
	baseManifest?: Record<string, string>;
	/** DEV ONLY (ignored unless `injectHMR` is set). Build pages on demand:
	 *  every page entry (React hydration indexes, Vue/Svelte/Angular/Ember
	 *  pages) is skipped unless its source file is in `except`, while
	 *  everything else — conventions, vendor bundles, CSS/Tailwind, workers,
	 *  islands, HTML/HTMX pages — still builds. The dev server passes the
	 *  live set of pages that have been requested so far, so a full rebuild
	 *  (server entry reload, cold-start recovery) only re-emits the pages
	 *  someone actually opened. Set by `devBuild`, never by user config. */
	deferPageEntries?: {
		except: ReadonlySet<string>;
	};
};

export type DevPageFramework = 'angular' | 'ember' | 'react' | 'svelte' | 'vue';

/** One page entry discovered by the build's entry scan. Returned from dev
 *  builds so the on-demand page path can map a manifest key (`PortalIndex`,
 *  `Portal`, `PortalCSS`, …) back to the source file to build. */
export type DevPageEntry = {
	framework: DevPageFramework;
	/** PascalCase manifest base name, e.g. `Portal` for `portal.vue`. */
	name: string;
	/** Absolute path of the page source (`pages/Portal.vue`, `pages/Portal.tsx`). */
	source: string;
};

export type MobilePlatform = 'android' | 'ios';

export type PwaConfig = {
	/** Optional web-app manifest. `path` defaults to `/manifest.webmanifest`. */
	manifest?: import('@absolutejs/pwa').WebAppManifestConfig & {
		path?: string;
	};
	/** Service-worker behavior. Sync is controlled by the sibling `sync` field. */
	serviceWorker?: Omit<
		import('@absolutejs/pwa').ServiceWorkerOptions,
		'resubscribe' | 'sync'
	>;
	/** Public worker URL. Defaults to `/sw.js`. */
	serviceWorkerPath?: string;
	/** Provision Auth-aware IndexedDB/background Sync without page-level code. */
	sync?:
		| boolean
		| Omit<
				import('@absolutejs/pwa/client').PwaSyncOptions,
				'storageSchema'
		  >;
	/** Provision provider-neutral Web Push behind @absolutejs/devices. This is
	 * automatic when pushNotifications is imported; set false to opt out. The
	 * public VAPID key defaults to VAPID_PUBLIC_KEY at build time. */
	push?:
		| boolean
		| {
				applicationServerKey?: string;
				/** Root-relative trusted Auth route. Defaults to /auth/push. */
				route?: string;
		  };
};

type MobileSharedConfig = {
	/** Native application identifier, for example `com.example.app`. */
	appId: string;
	/** Human-facing native application name. */
	appName: string;
	/** Initial canonical application route. Defaults to `/`. */
	entry?: string;
	/** One provider-neutral source of truth for native icons and launch artwork. */
	branding?: {
		/** Project-relative 1024x1024 PNG used for iOS and legacy Android icons. */
		icon: string;
		/** Android adaptive-icon layers. Unspecified layers derive from `icon` and a color. */
		android?: {
			/** Opaque 1024x1024 PNG. Defaults to a generated solid color. */
			backgroundImage?: string;
			/** Adaptive-icon background. Defaults to white. */
			backgroundColor?: string;
			/** Transparent 1024x1024 PNG whose artwork stays inside Android's safe zone. */
			foreground?: string;
			/** Transparent monochrome 1024x1024 PNG used for themed icons. */
			monochrome?: string;
		};
		/** Optional iOS 18+ appearance variants. */
		ios?: {
			/** 1024x1024 PNG for dark appearance. */
			darkIcon?: string;
			/** 1024x1024 PNG for tinted appearance. */
			tintedIcon?: string;
		};
		/** Native launch-screen artwork and colors. */
		splash?: {
			/** Light launch background. Defaults to white. */
			backgroundColor?: string;
			/** Dark launch background. Defaults to #111111. */
			darkBackgroundColor?: string;
			/** Optional precomposed square PNG, at least 2732x2732. */
			image?: string;
			/** Optional dark precomposed square PNG, at least 2732x2732. */
			darkImage?: string;
			/** Centered-logo scale when precomposed artwork is omitted. Defaults to 0.2. */
			logoScale?: number;
		};
	};
	/** Native projects generated and synchronized by AbsoluteJS. */
	platforms?: readonly MobilePlatform[];
	server: {
		/** Deployed AbsoluteJS origin used for page envelopes and API calls. */
		productionOrigin: string;
	};
	/** Native-store and immutable-channel release policy. Production defaults
	 * require installed Android evidence and store-delivered iOS evidence. */
	release?: {
		certification?:
			| false
			| {
					/** Evidence required when an immutable release channel is moved. */
					channels?: Readonly<
						Record<
							string,
							{
								android?: false | 'installed';
								ios?: false | 'device' | 'simulator' | 'store';
							}
						>
					>;
					/** Evidence required before committing a Google Play track. */
					googlePlayTracks?: Readonly<
						Record<string, false | 'installed'>
					>;
			  };
	};
	/** Shell-owned production error capture for web-rendered and Expo-native routes.
	 * Events go only to the configured route on the trusted production origin. */
	observability?: {
		/** Public project identity expected by the application's observability relay. */
		project: string;
		/** Deployment environment attached to reports, for example `production`. */
		environment?: string;
		/** Root-relative trusted-server error route. Defaults to `/api/observability/errors`. */
		route?: string;
		/** Fraction of errors retained, from 0 through 1. Defaults to 1. */
		sampleRate?: number;
	};
	/** Signed over-the-air web-bundle updates. Native capability changes still require a store build. */
	updates?: {
		/** Maximum time an activated bundle may take to render its first page before native rollback. Defaults to 20 seconds. */
		bootTimeoutMs?: number;
		/** Release channel. Defaults to `production`. */
		channel?: string;
		/** Exact signed-manifest URL. Defaults to the AbsoluteJS production origin. */
		manifestUrl?: string;
		/** ECDSA P-256 SPKI public keys, encoded as base64 DER and keyed by rotation ID. */
		publicKeys: Readonly<Record<string, string>>;
		/** Expo's native end-to-end manifest verification. The public certificate is embedded in store builds; its private key stays on the trusted update server. */
		expoCodeSigning?: {
			/** Project-relative PEM X.509 root certificate path. */
			certificatePath: string;
			/** Rotation identity. Defaults to `main`. */
			keyId?: string;
		};
		/** Trusted-server update endpoint provisioning. Native clients receive only
		 * the manifest URL and public verification material. */
		server?: {
			/** Mount the update endpoint in the AbsoluteJS runtime. Defaults to true. */
			autoMount?: boolean;
			/** Anonymous fleet-health receipts and automatic rollout protection. Enabled by default. */
			health?:
				| false
				| {
						/** Failure fraction that pauses a promotion. Defaults to 0.2. */
						failureRate?: number;
						/** Terminal activation/rollback sample required before pausing. Defaults to 20. */
						minimumReports?: number;
						/** Trusted-server secret environment variable. */
						secretEnv?: string;
				  };
			/** Health-gated staged rollout orchestration. Disabled unless configured. */
			rollout?:
				| false
				| {
						/** Advance qualifying stages from health reports. Defaults to false. */
						automatic?: boolean;
						/** Defaults to recommended 5%, 25%, and 100% stages. */
						stages?: readonly {
							/** Failure ceiling for advancement. Defaults to 0.05. */
							maximumFailureRate?: number;
							/** Cumulative terminal reports required. Defaults to 20. */
							minimumReports?: number;
							/** Time at this stage before advancement. Defaults to 60 minutes. */
							observationMinutes?: number;
							/** Installation cohort fraction, greater than 0 and at most 1. */
							rollout: number;
						}[];
				  };
			/** Project-relative registry module. Defaults to `mobile.update.ts`. */
			registry?: string;
			/** Environment variable containing the Expo RSA private key PEM. */
			expoPrivateKeyEnv?: string;
			/** Older Expo certificate/private-key references retained while binaries
			 * signed with those certificates are still supported. */
			expoCodeSigningKeys?: Readonly<
				Record<
					string,
					{
						certificatePath: string;
						privateKeyEnv: string;
					}
				>
			>;
		};
	};
	/** Capacitor webDir output. Defaults to `.absolutejs/mobile/web`. */
	bundleDirectory?: string;
	/** Durable history of mobile releases. Builds keep serving the three most
	 * recent releases to installed apps; without a store that history lives
	 * only in the build directory, so a fresh checkout (such as CI) starts
	 * with none and every installed app is asked to update. */
	compatibility?: {
		/** Project-relative module whose default export is a blob store, such
		 * as `awsS3BlobStore` from `@absolutejs/blob/aws-s3`. */
		store: string;
		/** Key prefix inside the store. Defaults to `absolutejs/mobile-compatibility`. */
		prefix?: string;
	};
	nativeProject?: {
		/** v1 keeps native projects as committed, editable source. */
		mode?: 'source';
		/** Parent directory for generated iOS and Android projects. */
		directory?: string;
	};
	ios?: {
		/** App Store marketing version written to CFBundleShortVersionString. */
		version: string;
	};
	/** Provider setup for portable push notifications. Page code still uses @absolutejs/devices. */
	pushNotifications?: {
		android?: {
			/** Firebase config copied into the native app module. Defaults to `google-services.json`. */
			googleServicesFile?: string;
		};
	};
	deepLinks?: {
		/** Optional custom URL scheme in addition to HTTPS app/universal links. */
		scheme?: string;
		/** HTTPS hosts that may enter the local AbsoluteJS router. */
		hosts?: readonly string[];
		apple?: {
			/** Apple Application Identifier Prefix, commonly the ten-character Team ID. */
			appIdPrefix: string;
		};
		android?: {
			/** SHA-256 fingerprints for every certificate that signs an installed build. */
			sha256CertificateFingerprints: readonly string[];
		};
	};
};

export type CapacitorMobileConfig = MobileSharedConfig & {
	/** Capacitor is the default, universal all-framework mobile engine. */
	engine?: 'capacitor';
};

export type ExpoMobileConfig = MobileSharedConfig & {
	/** Experimental hybrid Expo Router shell. Capacitor remains the default. */
	engine: 'expo';
	/** Explicit route ownership for React Native replacement screens. */
	routes?: {
		/** Unclaimed routes remain ordinary AbsoluteJS web routes. */
		default?: 'web';
		/**
		 * Absolute route pattern to a React Native module, relative to the app root.
		 * Named `:params` match one segment; a final `*` matches one or more.
		 */
		native?: Readonly<Record<string, string>>;
	};
	expo?: {
		/** Expo SDK line used by the generated shell. Currently only 57 is supported. */
		sdkVersion?: 57;
	};
};

export type MobileConfig = CapacitorMobileConfig | ExpoMobileConfig;

/* A single failed bundling pass in a dev/HMR build. In dev, one
 * unresolvable reference (a bad CSS `@import`, a broken component
 * import) must NOT abort the whole build — the pass that failed is
 * recorded here and the build continues with a partial manifest so
 * every other route keeps serving. Production builds still fail hard
 * (they never populate this). */
export type BuildPassError = {
	/** Internal pass id, e.g. `global-css`, `non-react-client`. */
	pass: string;
	/** Human label used in logs/overlay, e.g. `Global CSS`. */
	label: string;
	/** Best-effort human-readable message (specifier + referrer when known). */
	message: string;
	/** Source file the failure was reported against, if Bun provided it. */
	file?: string;
	/** The unresolved import specifier / missing reference, if known. */
	specifier?: string;
	line?: number;
	column?: number;
	/** Raw Bun build logs for the failing pass (drives the error overlay). */
	logs?: unknown[];
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

export type CompileNativeAssetConfig = {
	/**
	 * Static import specifier for a native asset that Bun must embed only when
	 * producing a standalone executable, e.g.
	 * "@scope/native-linux-x64/native.node".
	 */
	import: string;
	/**
	 * Environment variable set to the embedded asset's runtime path before the
	 * compiled server bundle is imported.
	 */
	env: string;
};

export type CompileConfig = {
	/**
	 * Native assets to embed with Bun's `with { type: "file" }` compile import.
	 * These are injected into Absolute's generated compile entrypoint, so dev
	 * and start never evaluate `.node` files as ESM imports.
	 */
	nativeAssets?: CompileNativeAssetConfig[];
	/**
	 * Bun bundler plugins applied to the standalone server bundle produced by
	 * `absolute compile`. The server `compile` pass runs its own `Bun.build`,
	 * which does NOT pick up `bunBuild.plugins` (those target the client
	 * bundles only). This is the escape hatch for deps whose published source
	 * is bundle-hostile under `bun build --compile` — register an `onLoad`
	 * plugin here to rewrite their source so the standalone binary can embed
	 * them (e.g. shimming a CJS `debug` default-import interop, or stubbing a
	 * lazy `require`). Runs after Absolute's internal compile plugins.
	 */
	plugins?: NonNullable<BunBuildConfig['plugins']>;
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
	/**
	 * The URL prefix the app is served under, behind a proxy that strips it
	 * before the request reaches the app (`/studio/projects/abc`). Every URL
	 * the framework hands the browser carries it, and an import map moves
	 * root-absolute module specifiers under it. `ABSOLUTE_BASE_PATH` sets
	 * it per process and wins over this. See `withBasePath()` for URLs the
	 * app renders itself (a stylesheet `<link>`).
	 */
	basePath?: string;
	/** Module prefixes (`'/react/vendor/'`) an app under `basePath` loads
	 *  from the app at the origin's root instead of its own, so the page
	 *  runs on that app's copy (one React). Both apps must build them from
	 *  the same versions, in the same mode. Per process:
	 *  `ABSOLUTE_BASE_PATH_SHARED`, comma separated. */
	basePathShared?: readonly string[];
	buildDirectory?: string;
	assetsDirectory?: string;
	publicDirectory?: string;
	islands?: {
		registry: string;
		bootstrap?: string;
	};
	/** React modules this app builds for another page to import, by name:
	 *  `{ ProjectSettings: 'src/frontend/embeds/ProjectSettings.tsx' }`.
	 *  Each is built with the React pages (sharing their React and chunks),
	 *  keeps its named exports, and is served at
	 *  `asset(manifest, 'ProjectSettingsModule')` — from source under the
	 *  dev server. For rendering part of this app inside a page another app
	 *  serves on the same origin, with this app's own React, no iframe.
	 *  Requires `reactDirectory`. */
	clientModules?: Record<string, string>;
	reactDirectory?: string;
	/** Opt-in React Server Components. Pages are the files directly in
	 *  `<dir>/pages`; serve one with `handleReactServerPageRequest({ page:
	 *  asset(manifest, '<Page>RSC') })`; a file whose name already ends in
	 *  RSC keeps its name (pages/HomeRSC.tsx → `'HomeRSC'`). Requires
	 *  react-server-dom-webpack at the version of react. */
	reactServerComponentsDirectory?: string;
	vueDirectory?: string;
	angularDirectory?: string;
	/** Per-framework Angular config. `providers` is the global default
	 *  DI provider array every page gets at SSR + client bootstrap.
	 *  Write it as a real typed value (`providers: appProviders`) so
	 *  TypeScript catches a missing import or renamed binding at
	 *  compile time. The framework AST-parses absolute.config.ts at
	 *  build time to find the import path of the binding referenced
	 *  here, then bakes a matching import into every per-page generated
	 *  providers file. Per-page additions (e.g. `provideRouter(routes)`)
	 *  come from page-level `export const routes` and are auto-wired by
	 *  the build — users never write `provideRouter` themselves. */
	angular?: {
		/** `'zone'` opts every Angular page into zone.js change detection
		 *  (zone.js must be installed in the app). Defaults to `'zoneless'`. */
		changeDetection?: AngularChangeDetection;
		/** How the router the build wires up for a page that exports
		 *  `routes` behaves. */
		router?: AngularRouterConfig;
		providers?: ReadonlyArray<
			| import('@angular/core').Provider
			| import('@angular/core').EnvironmentProviders
		>;
	};
	astroDirectory?: string;
	svelteDirectory?: string;
	emberDirectory?: string;
	htmlDirectory?: string;
	htmxDirectory?: string;
	/** Build metadata and retained server producers for installed applications. */
	mobile?: MobileConfig;
	/** Generate and bootstrap one framework-agnostic installable web app. */
	pwa?: PwaConfig;
	/** Install the cross-framework navigation layer from every hydration
	 *  index, so a link between two pages of any framework swaps in place
	 *  without each page component calling `enableNavigation()` itself.
	 *
	 *  The layer stays opt-in per page without this — that is right for a
	 *  page that wants to stay out of it — but repeating the call in every
	 *  page's effect/`onMount`/`ngOnInit` is a papercut, and forgetting it
	 *  on one page silently turns every link out of that page into a full
	 *  document load.
	 *
	 *  A static HTML or HTMX page that is the ENTRY point is not covered:
	 *  it has no hydration index to inject into, so it still imports
	 *  `@absolutejs/absolute/client/navigation` and calls
	 *  `enableNavigation()` itself. One swapped in by another page needs
	 *  nothing. */
	navigation?: boolean;
	/** What the build enforces at the server/client boundary.
	 *
	 *  A module that must never reach a browser bundle says so with
	 *  `import '@absolutejs/absolute/server-only'`, and that is not
	 *  configurable: shipping it to a browser is always a build error. */
	clientBoundary?: {
		/** `process.env.X` in your own client code. Bun does not inline it,
		 *  so the reference survives into the bundle and throws
		 *  `ReferenceError: process is not defined` in the browser —
		 *  nothing leaks, but the page breaks. `'error'` fails the build,
		 *  `'warn'` logs the file and line, `'off'` skips the check.
		 *
		 *  Default: `'error'` for `absolute build`, `'warn'` under
		 *  `absolute dev`, where failing a bundling pass would take down
		 *  every page in it rather than the one module at fault.
		 *
		 *  `process.env.NODE_ENV` is always allowed (Bun substitutes it),
		 *  as is any key the pass's `define` substitutes, and any read
		 *  tested with `typeof process !== 'undefined'`. */
		processEnv?: 'error' | 'off' | 'warn';
	};
	stylesConfig?: string | StylesConfig;
	stylePreprocessors?: StylePreprocessorConfig;
	postcss?: PostCSSConfig;
	tailwind?: TailwindConfig;
	/**
	 * Bun build options applied to Absolute's app output build passes.
	 * Framework-owned fields such as entrypoints, outdir, root, target,
	 * format, throw, and compile are intentionally not user-configurable.
	 */
	bunBuild?: BunBuildConfigOverride | BunBuildPassConfig;
	options?: BuildOptions;
	// Optional: List of files to rebuild incrementally (absolute paths)
	// When provided, only these files and their dependencies will be rebuilt
	incrementalFiles?: string[];
	// Tracks which command triggered the build for telemetry
	mode?: 'production' | 'development';
	// Dev server options (only used in development)
	dev?: {
		/** Dev server port (env: ABSOLUTE_PORT, default 3000). */
		port?: number;
		/** When `port` is busy, probe up to `portRange-1` neighboring ports
		 *  before failing (env: ABSOLUTE_PORT_RANGE, default 10). */
		portRange?: number;
		/** When true, refuse to start if `port` is busy instead of falling
		 *  through to the next free port (env: ABSOLUTE_STRICT_PORT, default false). */
		strictPort?: boolean;
		/** Bind host (env: ABSOLUTE_HOST, default "localhost"). */
		host?: string;
		// Enable HTTPS for HTTP/2 multiplexing (faster HMR on import-heavy components)
		// (env: ABSOLUTE_HTTPS, default false).
		https?: boolean;
		/** Extra directories to watch in addition to framework, conventional source
		 *  and workspace package directories. */
		watchDirs?: string[];
		/** Automatically watch other non-hidden project-root directories (default true).
		 * Set false to keep reports and offline asset candidates out of HMR.
		 * Framework, conventional source, workspace, Angular resource and explicit
		 * watchDirs paths remain watched. This is not an exclusion for nested files
		 * inside those source roots. */
		autoWatchDirectories?: boolean;
		/** DEV ONLY. Server-side (SSR) page bundles leave resolvable
		 *  `node_modules` packages as bare imports instead of inlining them —
		 *  the dev server resolves one shared copy at request time, which
		 *  keeps the per-page bundles small and the sourcemap chain limited to
		 *  your own modules. Packages that ship `.vue`/`.svelte` files, unbuilt
		 *  TypeScript, or a Svelte export condition are detected and stay
		 *  bundled automatically. List extra package names (`three`), scoped
		 *  globs (`@scope/*`, `pkg/*`) or exact specifiers here to force-bundle
		 *  them; `'*'` restores the legacy inline-everything behaviour.
		 *  Production builds are unaffected. */
		bundleServerDependencies?: string[];
		/** Expose the dev server to the public internet through a self-hosted
		 *  AbsoluteJS reverse-tunnel relay (for webhooks: Twilio, Stripe, OAuth).
		 *  Run the relay with `absolute tunnel-relay` on a public host; point a
		 *  dev client at it here. Prints a `Public:` URL on start. */
		tunnel?: {
			/** Relay base URL, e.g. `https://my-relay.ondigitalocean.app`
			 *  (env: ABSOLUTE_TUNNEL_RELAY). */
			relay?: string;
			/** Shared secret matching the relay's token (env: ABSOLUTE_TUNNEL_TOKEN). */
			token?: string;
		};
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
	// Standalone executable generation options
	compile?: CompileConfig;
	// Image optimization — on-demand resizing, format conversion, caching
	images?: ImageConfig;
	/** Build-time font optimization: self-hosts Google Fonts or local font
	 *  files with hashed names, preloads the critical faces and adds
	 *  metric-matched fallback faces. Use `fontAssets(manifest)` to put them
	 *  in a page's head. See docs/FONTS.md. */
	fonts?: FontsConfig;
	/** What `absolute bench` measures and how strictly `--check` judges it
	 *  against the saved baseline.
	 *
	 *      bench: {
	 *          pages: [{ label: 'react', path: '/react' }],
	 *          sizeTolerance: 1.05,
	 *          timeTolerance: 1.25
	 *      }
	 *
	 *  `pages` has to be given: only your server knows which path renders
	 *  which framework, so the framework cannot guess. Without it, bench
	 *  measures sizes and build time and skips throughput. */
	bench?: BenchConfig;
	/** Size budgets `absolute analyze --check` enforces, exiting 1 when
	 *  something is over. Values are `'250kb'`, `'1.5 MB'` or raw bytes.
	 *
	 *      sizeBudgets: {
	 *          categories: { 'Shared chunks': '600kb', Hydration: '150kb' },
	 *          perEntry: '500kb',
	 *          total: '4mb'
	 *      }
	 *
	 *  Category names are the ones `absolute analyze` prints. A category
	 *  the build has no assets for counts as zero and passes; a category
	 *  the build has that this does not name is simply unbudgeted. */
	sizeBudgets?: SizeBudgets;
	/** Opt-in Core Web Vitals reporting (LCP, INP, CLS, FCP, TTFB) from real
	 *  visits. See docs/WEB_VITALS.md. */
	vitals?: VitalsConfig;
	/** Liveness and readiness endpoints, on by default at
	 *  `/__absolute/live` and `/__absolute/ready`. `false` removes them;
	 *  an object renames the paths, turns on per-check details or changes
	 *  the per-check timeout. See docs/HEALTH.md. */
	health?: boolean | HealthConfig;
	/** Rate limiting. The framework's own vitals endpoint is limited by
	 *  default when it is mounted; app routes only when `limit` or `rules`
	 *  say so. The health endpoints are never limited — a 429 to a
	 *  readiness probe takes the process out of rotation. See
	 *  docs/RATE_LIMITING.md. */
	/** Run several server processes sharing one port, so requests use more
	 *  than one core. Off by default.
	 *
	 *      cluster: true              // one worker per CPU core
	 *      cluster: { workers: 4 }
	 *
	 *  Linux only, and it says so rather than pretending: clustering rides
	 *  SO_REUSEPORT, which load-balances on Linux and does not on macOS,
	 *  where one socket would take every connection. On anything else this
	 *  runs a single process and prints why.
	 *
	 *  Per-process state is divided between workers — rate-limit counters,
	 *  the vitals summary, caches. See docs/CLUSTERING.md. */
	cluster?: boolean | ClusterConfig;
	rateLimit?: RateLimitConfig;
	/** Finish the requests already in flight before the process exits.
	 *
	 *  On by default in production. Without it a request interrupted by
	 *  SIGTERM reaches the client as a connection error, which happens on
	 *  every deploy and scale-down. Readiness starts reporting
	 *  `shutting-down` the moment the signal arrives, so a load balancer
	 *  takes the process out of rotation while the drain runs.
	 *
	 *  `shutdown: false` restores the old behaviour — the process stops
	 *  the instant it is signalled. See docs/GRACEFUL_SHUTDOWN.md. */
	shutdown?: boolean | ShutdownConfig;
	/** Opt-in per-request logging with a correlation id.
	 *
	 *      logging: { requests: 'json' }
	 *
	 *  Off by default: writing to a project's stdout uninvited is not the
	 *  framework's call. See docs/LOGGING.md. */
	logging?: LoggingConfig;
	// Sitemap generation — auto-discovers page routes on server start
	sitemap?: SitemapConfig;
	/** Opt-in file-system routing: route files under each framework
	 *  directory's `routes/` folder become GET routes (React and Svelte for
	 *  now). Explicit routes stay the default and take precedence. See
	 *  docs/FILE_ROUTER_PLAN.md. */
	fileRoutes?: boolean | FileRoutesConfig;
	/** The dead-link check (build/auditLinks.ts). It reads every literal
	 *  `<a href="/…">` in the project's source and warns about ones no
	 *  route serves — the typo `route()` cannot catch, since a template
	 *  attribute is not a typed position and an HTML route is not a typed
	 *  language.
	 *
	 *  `ignore` names paths it should not ask about. A path with a file
	 *  extension is already skipped (the asset plugin serves those), so
	 *  this is for routes no scan of the project's source can see: the
	 *  ones an installed plugin mounts (`/auth/*` from
	 *  `@absolutejs/auth`), or a path something in front of the app
	 *  rewrites. A trailing `*` matches by prefix. */
	links?: LinksConfig;
	// OpenAPI docs via @elysia/openapi. `true` serves a Scalar UI at /openapi
	// derived from your route schemas; an object customizes it. On by default in
	// dev, opt-in for production builds.
	openapi?: boolean | OpenApiConfig;
	// OpenTelemetry via @elysia/opentelemetry (opt-in). Requires the package +
	// an OTLP collector; configure the service name here.
	telemetry?: boolean | OtelConfig;
	// Browser source maps for production observability/symbolication. Dev always
	// uses inline maps regardless of this. In PRODUCTION:
	//   - `'external'` / `true` — emit external client `.js.map`s, chain them back
	//     to original `.vue`/`.ts` source, then move them out of the served build
	//     dir into a private `sourcemaps/` dir and strip the `sourceMappingURL`
	//     comment from the shipped JS (source is NOT publicly exposed). The
	//     private dir is what a server-side symbolicator (e.g. @absolutejs/errors)
	//     reads, keyed by the JS file's basename.
	//   - `'inline'` — inline maps in production too (exposes source; debugging).
	//   - `false` / unset — no production maps (the default).
	sourcemaps?: 'external' | 'inline' | boolean;
	/** How long a page render may take before it is cut off. Default
	 *  30000ms; `false` leaves a render unbounded.
	 *
	 *  Without a bound, a render that never finishes never answers: a
	 *  Suspense boundary that never resolves streams its shell and then
	 *  nothing, until Bun's `idleTimeout` reaps the socket with no error.
	 *  An abort instead sends the page with its fallback in place. */
	rendering?: RenderingConfig;
};

export type AngularRouterConfig = {
	/** Restore the scroll position on back and forward, and scroll to a
	 *  `#fragment` after navigation. On by default.
	 *
	 *  Angular's router does neither on its own, so an in-page navigation
	 *  landed wherever the previous page happened to be scrolled to — a
	 *  behaviour this framework's own cross-framework navigation layer
	 *  has always got right, which made Angular pages the odd ones out. */
	scrollRestoration?: boolean;
	/** `'all'` preloads every lazy route after the first render;
	 *  `'none'` (the default) loads one when it is navigated to.
	 *  Preloading everything spends bandwidth a visitor may never use, so
	 *  it is opt-in. */
	preloading?: 'all' | 'none';
};

export type RenderingConfig = {
	/** Milliseconds, or `false` for no limit. */
	timeout?: number | false;
};

export type OpenApiConfig = {
	documentation?: {
		description?: string;
		title?: string;
		version?: string;
	};
	path?: string;
	provider?: 'scalar' | 'swagger';
};

export type OtelConfig = {
	serviceName?: string;
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

export type VitalsConfig = {
	/** Where the browser sends each page's batch. A path is served by the
	 *  built-in route (handlers registered with `onVital()`); a full URL
	 *  posts elsewhere. Default `/__absolute/vitals`. */
	endpoint?: string;
	/** Share of page loads that report, 0–1. Default 1. */
	sampleRate?: number;
	/** Report from `absolute dev` too. Default false. */
	dev?: boolean;
	/** Aggregate the reports into per-route 75th percentiles and serve them
	 *  as JSON. On in dev; off in production unless set, because it is an
	 *  unauthenticated read of every route that reported and how slow it
	 *  is. `onVital()` feeds a metrics backend without exposing anything. */
	summary?: boolean | VitalsSummaryConfig;
};
