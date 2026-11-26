import type { BuildConfig } from '../../types/build';
import { nearestName } from './nearestName';

/* Every key an AbsoluteJS app config has, as a value, so a config can be
 * checked when it is loaded and not only when it is typed.
 *
 * `defineConfig` infers its argument, and TypeScript does no
 * excess-property check on an inferred type: a misspelt key and a key
 * that was removed both passed, and the setting they were meant to make
 * silently did not happen. The type now rejects them; this list is for
 * the config that is not type-checked at all — plain JavaScript, or a
 * build nobody ran the checker on.
 *
 * `satisfies` keeps a key that is not on the type out of the list, and
 * the assertion below keeps a key that is on the type from being left
 * out, so adding a config key without adding it here fails typecheck. */
export const CONFIG_KEYS = [
	'angular',
	'angularDirectory',
	'assetsDirectory',
	'autoprefixer',
	'basePath',
	'basePathShared',
	'bench',
	'browsers',
	'buildDirectory',
	'bunBuild',
	'clientBoundary',
	'clientModules',
	'cluster',
	'command',
	'compile',
	'config',
	'cwd',
	'dependsOn',
	'dev',
	'emberDirectory',
	'entry',
	'env',
	'fileRoutes',
	'fonts',
	'headers',
	'health',
	'htmlDirectory',
	'htmxDirectory',
	'images',
	'incrementalFiles',
	'islands',
	'kind',
	'links',
	'logging',
	'mobile',
	'mode',
	'navigation',
	'openapi',
	'options',
	'port',
	'postcss',
	'publicDirectory',
	'pwa',
	'rateLimit',
	'reactDirectory',
	'reactServerComponentsDirectory',
	'ready',
	'redirects',
	'rendering',
	'rewrites',
	'shutdown',
	'sitemap',
	'sizeBudgets',
	'sourcemaps',
	'static',
	'stylePreprocessors',
	'stylesConfig',
	'svelteDirectory',
	'tailwind',
	'telemetry',
	'tls',
	'trustProxy',
	'visibility',
	'vitals',
	'vueDirectory'
] as const satisfies readonly (keyof BuildConfig)[];

type UnlistedConfigKey = Exclude<
	keyof BuildConfig,
	(typeof CONFIG_KEYS)[number]
>;

const everyConfigKeyIsListed: [UnlistedConfigKey] extends [never]
	? true
	: UnlistedConfigKey = true;
void everyConfigKeyIsListed;

const KNOWN: ReadonlySet<string> = new Set(CONFIG_KEYS);

/** One line for each top-level key of an app config that nothing reads,
 *  naming the key it was probably meant to be when one is close. */
export const describeUnknownConfigKeys = (config: Record<string, unknown>) =>
	Object.keys(config)
		.filter((key) => !KNOWN.has(key))
		.map((key) => {
			const suggestion = nearestName(key, CONFIG_KEYS);
			const meant =
				suggestion === undefined
					? ''
					: ` Did you mean "${suggestion}"?`;

			return `absolute.config.ts sets "${key}", which is not a config key, so it is ignored.${meant}`;
		});
