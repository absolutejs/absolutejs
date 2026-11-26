import { getNodeEnv } from '../utils/runtimeMode';
import { logWarn } from '../utils/logger';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import {
	dirname,
	extname,
	isAbsolute,
	join,
	relative,
	resolve
} from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { BunPlugin } from 'bun';
import type {
	LessPreprocessorOptions,
	PostCSSConfig,
	SassPreprocessorOptions,
	StylePreprocessorConfig,
	StylusPreprocessorOptions
} from '../../types/build';

const CSS_EXTENSION_PATTERN = /\.css$/i;
const STYLE_EXTENSION_PATTERN = /\.(s[ac]ss|less|styl(?:us)?)$/i;
const STYLE_MODULE_EXTENSION_PATTERN = /\.module\.(s[ac]ss|less|styl(?:us)?)$/i;
const STYLE_LANGUAGE_PATTERN = /^(s[ac]ss|less|styl(?:us)?)$/i;
const importOptionalPeer = new Function(
	'specifier',
	'return import(specifier)'
) as <T>(specifier: string) => Promise<T>;
const requireOptionalPeer = new Function(
	'specifier',
	'return require(specifier)'
) as <T>(specifier: string) => T;
const requireFromCwd = createRequire(join(process.cwd(), 'package.json'));

export const getStyleBaseName = (filePath: string) =>
	filePath.replace(/\.(css|s[ac]ss|less|styl(?:us)?)$/i, '');
export const isPreprocessableStylePath = (filePath: string) =>
	STYLE_EXTENSION_PATTERN.test(filePath);
export const isStyleModulePath = (filePath: string) =>
	STYLE_MODULE_EXTENSION_PATTERN.test(filePath);
export const isStylePath = (filePath: string) =>
	/\.(css|s[ac]ss|less|styl(?:us)?)$/i.test(filePath);

const getStyleLanguage = (filePathOrLanguage: string) => {
	const normalized = filePathOrLanguage.toLowerCase();
	if (normalized === 'scss' || normalized.endsWith('.scss')) return 'scss';
	if (normalized === 'sass' || normalized.endsWith('.sass')) return 'sass';
	if (normalized === 'less' || normalized.endsWith('.less')) return 'less';
	if (
		normalized === 'styl' ||
		normalized === 'stylus' ||
		normalized.endsWith('.styl') ||
		normalized.endsWith('.stylus')
	)
		return 'stylus';

	return null;
};

const missingDependencyError = (name: string, filePath: string) =>
	new Error(
		`Unable to compile ${filePath}: install optional dependency "${name}" to use this stylesheet preprocessor.`
	);

/* A preprocessor error, for the caller to throw, with the filename + a
   one-line summary prefixed so the dev server's `[hmr] error` log doesn't print
   `Server error: undefined`. Sass / Less / Stylus all attach useful
   metadata (line, column, snippet) to their errors but the property
   names differ — we surface whatever's available. */
type PreprocessorErrorDetail = Error & {
	column?: number;
	filename?: string;
	formatted?: string;
	line?: number;
	span?: {
		start?: { column?: number; line?: number };
		url?: URL | string;
	};
};

const isSameFile = (reported: URL | string | undefined, filePath: string) => {
	if (reported === undefined) return true;
	const text = String(reported);
	const reportedPath = text.startsWith('file:') ? fileURLToPath(text) : text;

	return resolve(reportedPath) === resolve(filePath);
};

/* Where in `filePath` the compiler says the error is, as `:line:column`
 * counted from 1, or '' when it did not say.
 *
 * Read per compiler, never from a bare `error.line`: JavaScriptCore puts
 * `line` and `column` on EVERY Error — the position in the JavaScript
 * that threw. For Sass and Stylus that is a line inside the compiler
 * (`bad.scss:8310:24` for a four-line file), and it used to be printed
 * as if it were a line of the stylesheet. Less is the one whose own
 * `line` is the stylesheet's.
 *
 * An error inside an imported partial is located in THAT file, which
 * the compiler's own message names; printing its line after this
 * file's path would point at the wrong text, so it is left out. */
const stylesheetLocation = (
	detail: PreprocessorErrorDetail,
	filePath: string,
	language: StyleLanguage
) => {
	if (language === 'scss' || language === 'sass') {
		const start = detail.span?.start;
		if (typeof start?.line !== 'number') return '';
		if (!isSameFile(detail.span?.url, filePath)) return '';
		const column =
			typeof start.column === 'number' ? `:${start.column + 1}` : '';

		// Sass counts both from 0.
		return `:${start.line + 1}${column}`;
	}
	if (language !== 'less') return '';
	if (typeof detail.line !== 'number') return '';
	if (!isSameFile(detail.filename, filePath)) return '';
	const column =
		typeof detail.column === 'number' ? `:${detail.column + 1}` : '';

	// Less counts lines from 1 and columns from 0.
	return `:${detail.line}${column}`;
};

const preprocessorError = (
	error: unknown,
	filePath: string,
	language: StyleLanguage
) => {
	if (!(error instanceof Error))
		return new Error(
			`${language} compile failed in ${filePath}: ${String(error)}`
		);

	const detail: PreprocessorErrorDetail = error;
	const location = stylesheetLocation(detail, filePath, language);
	const message = detail.formatted ?? detail.message;
	const wrapped = new Error(
		`${language} compile failed in ${filePath}${location}\n${message}`
	);
	wrapped.cause = error;

	return wrapped;
};

const requireOptionalPeerSync = <T>(specifier: string) => {
	try {
		return requireFromCwd(specifier) as T;
	} catch {
		return requireOptionalPeer<T>(specifier);
	}
};

const normalizeLoadPaths = (filePath: string, paths: string[] = []) => [
	dirname(filePath),
	process.cwd(),
	...paths.map((path) => resolve(process.cwd(), path))
];

type StyleLanguage = NonNullable<ReturnType<typeof getStyleLanguage>>;

type AliasEntry = {
	pattern: string;
	replacements: string[];
};

type TsconfigAliases = { aliases: AliasEntry[]; baseUrl: string; cwd: string };

let tsconfigAliasCache: TsconfigAliases | undefined;

const stripJsonComments = (source: string) =>
	source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const normalizeAliasEntries = (
	aliases: Record<string, string | string[]> | undefined
) =>
	Object.entries(aliases ?? {}).map(([pattern, value]) => ({
		pattern,
		replacements: Array.isArray(value) ? value : [value]
	}));

const readTsconfigAliases = () => {
	const cwd = process.cwd();
	if (tsconfigAliasCache?.cwd === cwd) return tsconfigAliasCache;

	const tsconfigPath = resolve(cwd, 'tsconfig.json');
	const empty: TsconfigAliases = { aliases: [], baseUrl: cwd, cwd };
	if (!existsSync(tsconfigPath)) {
		tsconfigAliasCache = empty;

		return empty;
	}

	try {
		const parsed = JSON.parse(
			stripJsonComments(readFileSync(tsconfigPath, 'utf-8'))
		);
		const compilerOptions = parsed.compilerOptions ?? {};
		const baseUrl = resolve(cwd, compilerOptions.baseUrl ?? '.');
		tsconfigAliasCache = {
			aliases: normalizeAliasEntries(compilerOptions.paths),
			baseUrl,
			cwd
		};
	} catch {
		tsconfigAliasCache = empty;
	}

	return tsconfigAliasCache;
};

const getAliasEntries = (config: StylePreprocessorConfig | undefined) => {
	const tsconfig = readTsconfigAliases();

	return {
		aliases: [
			...normalizeAliasEntries(config?.aliases),
			...tsconfig.aliases
		],
		baseUrl: tsconfig.baseUrl
	};
};

const aliasPatternToRegExp = (pattern: string) =>
	new RegExp(
		`^${pattern
			.split('*')
			.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
			.join('(.+)')}$`
	);

const resolveAliasTargets = (
	specifier: string,
	config: StylePreprocessorConfig | undefined
) => {
	const { aliases, baseUrl } = getAliasEntries(config);
	const targets: string[] = [];

	for (const alias of aliases) {
		const match = specifier.match(aliasPatternToRegExp(alias.pattern));
		if (!match) continue;
		const wildcard = match[1] ?? '';
		targets.push(
			...alias.replacements.map((replacement) =>
				resolve(baseUrl, replacement.replace('*', wildcard))
			)
		);
	}

	return targets;
};

const getLanguageExtensions = (language: StyleLanguage) => {
	if (language === 'less') return ['.less', '.css'];
	if (language === 'stylus') return ['.styl', '.stylus', '.css'];

	return ['.scss', '.sass', '.css'];
};

const getCandidatePaths = (basePath: string, language: StyleLanguage) => {
	const ext = extname(basePath);
	const paths = ext
		? [basePath]
		: getLanguageExtensions(language).flatMap((extension) => [
				`${basePath}${extension}`,
				join(basePath, `index${extension}`)
			]);

	if (language === 'scss' || language === 'sass') {
		return paths.flatMap((path) => {
			const dir = dirname(path);
			const base = path.slice(dir.length + 1);

			return [path, join(dir, `_${base}`)];
		});
	}

	return paths;
};

const resolveImportPath = (
	specifier: string,
	fromDirectory: string,
	loadPaths: string[],
	language: StyleLanguage,
	config: StylePreprocessorConfig | undefined
) => {
	const rawCandidates = [
		...resolveAliasTargets(specifier, config),
		isAbsolute(specifier) ? specifier : resolve(fromDirectory, specifier),
		...loadPaths.map((path) => resolve(path, specifier))
	];

	for (const candidate of rawCandidates.flatMap((path) =>
		getCandidatePaths(path, language)
	)) {
		if (existsSync(candidate)) return candidate;
	}

	return null;
};

const isExternalCssUrl = (url: string) =>
	/^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\/)/i.test(url);

const splitCssUrl = (url: string) => {
	const markerIndex = url.search(/[?#]/);
	if (markerIndex === -1) return { marker: '', path: url };

	return {
		marker: url.slice(markerIndex),
		path: url.slice(0, markerIndex)
	};
};

const rebaseCssUrls = (
	contents: string,
	sourceFile: string,
	entryFile: string
) => {
	const sourceDir = dirname(sourceFile);
	const entryDir = dirname(entryFile);
	if (sourceDir === entryDir) return contents;

	return contents.replace(
		/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi,
		(match, quote: string, rawUrl: string) => {
			const trimmedUrl = rawUrl.trim();
			if (!trimmedUrl || isExternalCssUrl(trimmedUrl)) return match;
			const { marker, path } = splitCssUrl(trimmedUrl);
			const rebased = relative(
				entryDir,
				resolve(sourceDir, path)
			).replace(/\\/g, '/');
			const normalized = rebased.startsWith('.')
				? rebased
				: `./${rebased}`;
			const nextQuote = quote || '"';

			return `url(${nextQuote}${normalized}${marker}${nextQuote})`;
		}
	);
};

const rewriteAliasedStyleImports = (
	contents: string,
	sourceFile: string,
	loadPaths: string[],
	language: StyleLanguage,
	config: StylePreprocessorConfig | undefined
) =>
	contents.replace(
		/(@(?:use|forward|import|require)\s+)(["'])([^"']+)\2/g,
		(match, prefix: string, quote: string, specifier: string) => {
			if (
				specifier.startsWith('.') ||
				isAbsolute(specifier) ||
				isExternalCssUrl(specifier)
			)
				return match;

			const resolved = resolveImportPath(
				specifier,
				dirname(sourceFile),
				loadPaths,
				language,
				config
			);

			return resolved ? `${prefix}${quote}${resolved}${quote}` : match;
		}
	);

const preprocessLoadedStyle = (
	contents: string,
	sourceFile: string,
	entryFile: string,
	loadPaths: string[] = [],
	language?: StyleLanguage,
	config?: StylePreprocessorConfig
) => {
	const rebased = rebaseCssUrls(contents, sourceFile, entryFile);

	return language
		? rewriteAliasedStyleImports(
				rebased,
				sourceFile,
				loadPaths,
				language,
				config
			)
		: rebased;
};

const extractCssModuleExports = (css: string) => {
	const exports: Record<string, string> = {};
	const nextCss = css.replace(/:export\s*\{([^}]*)\}/g, (_, body: string) => {
		for (const declaration of body.split(';')) {
			const separator = declaration.indexOf(':');
			if (separator === -1) continue;
			const key = declaration.slice(0, separator).trim();
			const value = declaration.slice(separator + 1).trim();
			if (key && value) exports[key] = value;
		}

		return '';
	});

	return { css: nextCss, exports };
};

const getSassOptions = (
	config: StylePreprocessorConfig | undefined,
	language: 'sass' | 'scss'
): SassPreprocessorOptions => ({
	...(config?.sass ?? {}),
	...(language === 'scss' ? (config?.scss ?? {}) : {})
});

const NO_LESS_OPTIONS: LessPreprocessorOptions = {};
const NO_STYLUS_OPTIONS: StylusPreprocessorOptions = {};

const getLessOptions = (config: StylePreprocessorConfig | undefined) =>
	config?.less ?? NO_LESS_OPTIONS;

const getStylusOptions = (config: StylePreprocessorConfig | undefined) =>
	config?.stylus ?? NO_STYLUS_OPTIONS;

type BrowserTargetConfig = {
	autoprefixer?: boolean;
	browsers?: string | string[];
};

const toAutoprefixerConfig = (targets: BrowserTargetConfig | undefined) => {
	if (targets?.autoprefixer === false) return false;
	if (targets?.browsers === undefined) return undefined;

	return { browsers: targets.browsers };
};

export const createStyleTransformConfig = (
	stylePreprocessors?: StylePreprocessorConfig,
	postcss?: PostCSSConfig,
	targets?: BrowserTargetConfig
): StylePreprocessorConfig | undefined => {
	const autoprefixer = toAutoprefixerConfig(targets);
	if (postcss === undefined && autoprefixer === undefined)
		return stylePreprocessors;

	return {
		...(stylePreprocessors ?? {}),
		...(postcss === undefined ? {} : { postcss }),
		...(autoprefixer === undefined ? {} : { autoprefixer })
	};
};

const withAdditionalData = (
	contents: string,
	additionalData: string | undefined
) => (additionalData ? `${additionalData}\n${contents}` : contents);

type PostCSSRuntimeConfig = {
	options?: Record<string, unknown>;
	plugins?: unknown[] | Record<string, unknown>;
};

const normalizePostcssModule = (mod: unknown) => {
	if (mod && typeof mod === 'object' && 'default' in mod) {
		return (mod as { default?: unknown }).default ?? mod;
	}

	return mod;
};

const loadPostcssConfigFile = async (configPath: string) => {
	const resolved = resolve(process.cwd(), configPath);
	const loaded =
		resolved.endsWith('.cjs') || resolved.endsWith('.cts')
			? requireOptionalPeerSync<unknown>(resolved)
			: await importOptionalPeer<unknown>(
					`${new URL(`file://${resolved}`).href}?t=${Date.now()}`
				);
	const config = normalizePostcssModule(loaded);
	const value =
		typeof config === 'function'
			? await (
					config as (context: {
						cwd: string;
						env?: string;
					}) => unknown
				)({
					cwd: process.cwd(),
					env: getNodeEnv()
				})
			: config;

	return (normalizePostcssModule(value) ?? {}) as PostCSSRuntimeConfig;
};

const normalizePostcssPlugins = (
	plugins: unknown[] | Record<string, unknown> | undefined
) => {
	if (!plugins) return [];
	if (Array.isArray(plugins)) return plugins.filter(Boolean);

	const resolved: unknown[] = [];
	for (const [specifier, options] of Object.entries(plugins)) {
		if (options === false) continue;
		const mod = normalizePostcssModule(
			requireOptionalPeerSync<unknown>(specifier)
		);
		const plugin =
			typeof mod === 'function'
				? (mod as (options?: unknown) => unknown)(
						options === true ? undefined : options
					)
				: mod;
		if (plugin) resolved.push(plugin);
	}

	return resolved;
};

const resolvePostcssConfig = async (
	config: StylePreprocessorConfig | undefined
) => {
	const inlineConfig = config?.postcss;
	if (!inlineConfig) return null;

	const fileConfig = inlineConfig.config
		? await loadPostcssConfigFile(inlineConfig.config)
		: {};
	const plugins = [
		...normalizePostcssPlugins(fileConfig.plugins),
		...normalizePostcssPlugins(inlineConfig.plugins)
	];

	if (plugins.length === 0) return null;

	return {
		options: {
			...(fileConfig.options ?? {}),
			...(inlineConfig.options ?? {})
		},
		plugins
	};
};

/* ---- default vendor prefixing --------------------------------------
 *
 * Bun's CSS bundler lowers modern SYNTAX — nesting, `oklch()`, range
 * media queries, `color-mix()` — but adds no vendor prefixes, and has no
 * setting for which browsers to target. `user-select`, `backdrop-filter`,
 * `mask-image`, `text-size-adjust` and `hyphens` all came out bare, and
 * some Safari versions only understand the `-webkit-` forms.
 *
 * `autoprefixer` is an OPTIONAL peer, like sass, less and postcss: when a
 * project has it, prefixing is on by default; when it does not, nothing
 * changes. A hard dependency would have cost every install about 6MB
 * (4.2MB of it browser data) and made postcss mandatory, for a feature
 * some projects do not want.
 *
 * It is cheap where it runs. Measured: 146ms once per process, almost
 * all of it loading the module; then 0.75ms for the example app's 13
 * stylesheets and 4.4ms for a 109KB one. */
type AutoprefixerFactory = (options?: {
	overrideBrowserslist?: string | string[];
	remove?: boolean;
}) => unknown;

let autoprefixerFactory: AutoprefixerFactory | null | undefined;

const loadAutoprefixer = () => {
	if (autoprefixerFactory !== undefined) return autoprefixerFactory;
	try {
		const mod = normalizePostcssModule(
			requireOptionalPeerSync<unknown>('autoprefixer')
		);
		autoprefixerFactory =
			typeof mod === 'function' ? (mod as AutoprefixerFactory) : null;
	} catch {
		autoprefixerFactory = null;
	}

	return autoprefixerFactory;
};

const prefixerByTargets = new Map<string, unknown>();

const isAutoprefixerPlugin = (plugin: unknown) =>
	(typeof plugin === 'object' || typeof plugin === 'function') &&
	plugin !== null &&
	Reflect.get(plugin, 'postcssPlugin') === 'autoprefixer';

/* Properties that some browsers in a normal support range only
 * understand prefixed. Used for ONE thing: telling a project that has no
 * prefixer installed that its CSS would have been changed by one. */
const PREFIX_PRONE_PROPERTIES = [
	'user-select',
	'backdrop-filter',
	'mask-image',
	'text-size-adjust',
	'hyphens',
	'box-decoration-break',
	'print-color-adjust'
];

const findUnprefixedProperty = (css: string) =>
	PREFIX_PRONE_PROPERTIES.find(
		(property) =>
			new RegExp(`(?:^|[;{\\s])${property}\\s*:`).test(css) &&
			!css.includes(`-webkit-${property}`)
	);

let missingPrefixerNoted = false;

/* Said once per process, and only when it would have mattered: the
 * project wrote a property that needs a prefix somewhere and nothing is
 * installed to add it. Without this, "on when installed" would mean a
 * project that never heard of the option ships unprefixed CSS silently. */
const noteMissingPrefixer = (css: string, filePath: string) => {
	if (missingPrefixerNoted) return;
	const property = findUnprefixedProperty(css);
	if (property === undefined) return;
	missingPrefixerNoted = true;
	logWarn(
		`${relative(process.cwd(), filePath)} uses \`${property}\`, which some browsers only understand with a vendor prefix. Install \`autoprefixer\` and \`postcss\` to have prefixes added at build time, or set \`autoprefixer: false\` in absolute.config.ts to silence this.`
	);
};

/** The prefixer to run after the project's own PostCSS plugins, or
 *  `null` when it is off, not installed, or already among them. */
const resolveDefaultPrefixer = (
	config: StylePreprocessorConfig | undefined,
	userPlugins: unknown[],
	css: string,
	filePath: string
) => {
	const setting = config?.autoprefixer;
	if (setting === false) return null;
	if (userPlugins.some(isAutoprefixerPlugin)) return null;

	const factory = loadAutoprefixer();
	if (factory === null) {
		noteMissingPrefixer(css, filePath);

		return null;
	}

	const browsers = setting?.browsers;
	const key = JSON.stringify(browsers ?? null);
	const cached = prefixerByTargets.get(key);
	if (cached !== undefined) return cached;

	/* Add-only. Left to its default, autoprefixer also DELETES prefixes
	 * it judges outdated for the target browsers — it removed a
	 * hand-written `-webkit-backdrop-filter` from the example app. For
	 * something that is on without being asked for, taking out what the
	 * author wrote is the wrong way to be wrong. */
	const plugin = factory({
		remove: false,
		...(browsers === undefined ? {} : { overrideBrowserslist: browsers })
	});
	prefixerByTargets.set(key, plugin);

	return plugin;
};

/** For tests: forget whether `autoprefixer` was found and what was said. */
export const resetAutoprefixerState = (
	factory?: AutoprefixerFactory | null
) => {
	autoprefixerFactory = factory;
	prefixerByTargets.clear();
	missingPrefixerNoted = false;
};

type PostcssModule = typeof import('postcss') & {
	default?: typeof import('postcss');
};

const runPostcss = async (
	css: string,
	filePath: string,
	config: StylePreprocessorConfig | undefined
) => {
	const postcssConfig = await resolvePostcssConfig(config);
	const userPlugins = postcssConfig?.plugins ?? [];
	const prefixer = resolveDefaultPrefixer(config, userPlugins, css, filePath);
	if (!postcssConfig && prefixer === null) return css;

	let postcssModule: PostcssModule;
	try {
		postcssModule = await importOptionalPeer<PostcssModule>('postcss');
	} catch {
		/* The project asked for PostCSS and does not have it: an error,
		 * as before. Only the default prefixer wanting it is not — a
		 * missing peer must not fail a build that never configured one. */
		if (postcssConfig) throw missingDependencyError('postcss', filePath);

		return css;
	}
	const postcss = postcssModule.default ?? postcssModule;
	const plugins =
		prefixer === null ? userPlugins : [...userPlugins, prefixer];
	const result = await postcss(
		plugins as import('postcss').AcceptedPlugin[]
	).process(css, {
		from: filePath,
		map: false,
		...(postcssConfig?.options ?? {})
	});

	return result.css;
};

/* The synchronous compile path has no PostCSS — a project's plugins may
 * be async — but the prefixer is a synchronous plugin, so it can run
 * here. It has to: this path compiles Angular component styles during
 * fast HMR, and leaving it out would mean prefixes in a production build
 * that the same component did not have in dev. */
const runPrefixerSync = (
	css: string,
	filePath: string,
	config: StylePreprocessorConfig | undefined
) => {
	const prefixer = resolveDefaultPrefixer(config, [], css, filePath);
	if (prefixer === null) return css;

	let postcssModule: PostcssModule;
	try {
		postcssModule = requireOptionalPeerSync<PostcssModule>('postcss');
	} catch {
		return css;
	}
	const postcss = postcssModule.default ?? postcssModule;

	return postcss([prefixer as import('postcss').AcceptedPlugin]).process(
		css,
		{ from: filePath, map: false }
	).css;
};

const createSassImporter = (
	entryFile: string,
	loadPaths: string[],
	language: 'sass' | 'scss',
	config: StylePreprocessorConfig | undefined,
	deps?: Set<string>
) => ({
	canonicalize(specifier: string, options: { containingUrl?: URL | null }) {
		const fromDirectory = options.containingUrl
			? dirname(fileURLToPath(options.containingUrl))
			: dirname(entryFile);
		const resolved = resolveImportPath(
			specifier,
			fromDirectory,
			loadPaths,
			language,
			config
		);

		return resolved ? new URL(pathToFileURL(resolve(resolved)).href) : null;
	},
	load(canonicalUrl: URL) {
		const filePath = fileURLToPath(canonicalUrl);
		deps?.add(filePath);
		const fileLanguage = getStyleLanguage(filePath);
		if (
			fileLanguage !== 'scss' &&
			fileLanguage !== 'sass' &&
			fileLanguage !== null
		)
			return null;

		return {
			contents: preprocessLoadedStyle(
				readFileSync(filePath, 'utf-8'),
				filePath,
				entryFile,
				loadPaths,
				language,
				config
			),
			syntax: filePath.endsWith('.sass')
				? ('indented' as const)
				: ('scss' as const)
		};
	}
});

const createLessFileManager = (
	entryFile: string,
	loadPaths: string[],
	config: StylePreprocessorConfig | undefined,
	deps?: Set<string>
) => ({
	install(
		less: { FileManager: new () => Record<string, unknown> },
		pluginManager: { addFileManager(manager: unknown): void }
	) {
		const baseManager = new less.FileManager();
		const manager = Object.create(baseManager) as Record<string, unknown>;
		manager.supports = (filename: string, currentDirectory: string) =>
			Boolean(
				resolveImportPath(
					filename,
					resolve(currentDirectory),
					loadPaths,
					'less',
					config
				)
			);
		manager.loadFile = async (
			filename: string,
			currentDirectory: string
		) => {
			const resolved = resolveImportPath(
				filename,
				resolve(currentDirectory),
				loadPaths,
				'less',
				config
			);
			if (!resolved) {
				throw new Error(`Unable to resolve Less import "${filename}"`);
			}
			deps?.add(resolved);

			return {
				contents: preprocessLoadedStyle(
					await readFile(resolved, 'utf-8'),
					resolved,
					entryFile,
					loadPaths,
					'less',
					config
				),
				filename: resolved
			};
		};
		pluginManager.addFileManager(manager);
	}
});

const renderStylus = async (
	contents: string,
	filePath: string,
	loadPaths: string[],
	options: StylusPreprocessorOptions,
	deps?: Set<string>
) => {
	let stylus: typeof import('stylus');
	try {
		const stylusModule = await importOptionalPeer<
			typeof import('stylus') & { default?: typeof import('stylus') }
		>('stylus');
		stylus = stylusModule.default ?? stylusModule;
	} catch {
		throw missingDependencyError('stylus', filePath);
	}

	return new Promise<string>((_resolve, reject) => {
		const renderer = stylus(contents);
		renderer.set('filename', filePath);
		for (const [key, value] of Object.entries(options.options ?? {})) {
			renderer.set(key, value);
		}
		for (const path of loadPaths) renderer.include(path);
		renderer.render((error, css) => {
			if (error) {
				reject(error);

				return;
			}
			// Stylus exposes its dependency list after a successful render.
			const stylusDeps = deps
				? (renderer as unknown as { deps?: () => string[] }).deps?.()
				: undefined;
			if (deps && Array.isArray(stylusDeps))
				stylusDeps.forEach((dep) => deps.add(resolve(dep)));
			_resolve(css ?? '');
		});
	});
};

/* Compile-time bookkeeping shared with the dev server.

   `styleDependencyGraph` maps every entry stylesheet (anything that ran
   through `compileStyleSource`) to the absolute paths of every partial
   it imported during that compile. The dev rebuild trigger reads this to
   know which entries to invalidate when a partial like `_tokens.scss`
   changes.

   `styleOutputHashes` records the SHA-1 of each entry's last-emitted CSS
   so callers can skip re-broadcasting / re-writing identical output. */
const styleDependencyGraph = new Map<string, Set<string>>();
const styleOutputHashes = new Map<string, string>();

const recordStyleDeps = (entry: string, deps: Set<string>) => {
	const key = resolve(entry);
	const stripped = new Set<string>();
	for (const dep of deps) {
		const resolved = resolve(dep);
		if (resolved !== key) stripped.add(resolved);
	}
	styleDependencyGraph.set(key, stripped);
};

/* Record that a JS/TS/Vue/Svelte/etc. file imports a stylesheet (typically
   a `.module.scss` or other style import via JS). This is the JS-side dep
   tracking that complements the CSS-side `@import` graph: when the style
   file changes, the dev server uses `findStyleEntriesImporting` to find
   the JS file that imports it and queues that for rebuild. Without this,
   editing `Foo.module.scss` would only re-emit the CSS module's own
   compiled output without re-running the bundler against the importing
   component, so the new hashed class names never reach the bundle. */
export const addStyleImporter = (importerPath: string, stylePath: string) => {
	const key = resolve(importerPath);
	const target = resolve(stylePath);
	const deps = styleDependencyGraph.get(key) ?? new Set<string>();
	deps.add(target);
	styleDependencyGraph.set(key, deps);
};
export const findStyleEntriesImporting = (changedPath: string) => {
	const target = resolve(changedPath);
	const importers: string[] = [];
	for (const [entry, deps] of styleDependencyGraph) {
		if (deps.has(target)) importers.push(entry);
	}

	return importers;
};
export const forgetStyleEntry = (entry: string) => {
	const key = resolve(entry);
	styleDependencyGraph.delete(key);
	styleOutputHashes.delete(key);
};
export const recordStyleOutput = (entry: string, css: string) => {
	const key = resolve(entry);
	const hash = createHash('sha1').update(css).digest('hex');
	const previous = styleOutputHashes.get(key);
	styleOutputHashes.set(key, hash);

	return previous !== hash;
};

/* Add what Sass says it loaded to `deps`.
 *
 * When Sass resolves a relative `@use './partial'` via the built-in
 * filesystem loader (which it does whenever the source has a `url:` set,
 * which we always do), the custom importer's `canonicalize`/`load`
 * callbacks don't fire — so `deps` would otherwise be empty.
 * `loadedUrls` always reflects every file Sass actually touched,
 * including the entry, so the entry is filtered out and the rest added. */
const sassDependencies = (loadedUrls: URL[] | undefined, filePath: string) =>
	(loadedUrls ?? [])
		.filter((url) => url.protocol === 'file:')
		.map((url) => fileURLToPath(url))
		.filter((dep) => resolve(dep) !== resolve(filePath));

const loadSass = async (packageName: string, filePath: string) => {
	try {
		return await importOptionalPeer<typeof import('sass')>(packageName);
	} catch {
		throw missingDependencyError(packageName, filePath);
	}
};

const compileSassSource = async (
	filePath: string,
	rawContents: string,
	language: 'sass' | 'scss',
	config: StylePreprocessorConfig | undefined,
	deps: Set<string>
) => {
	const options = getSassOptions(config, language);
	const sass = await loadSass(options.implementation ?? 'sass', filePath);
	const contents = withAdditionalData(rawContents, options.additionalData);
	const loadPaths = normalizeLoadPaths(filePath, options.loadPaths);
	try {
		const result = sass.compileString(contents, {
			importers: [
				createSassImporter(filePath, loadPaths, language, config, deps)
			],
			loadPaths,
			style: 'expanded',
			syntax: language === 'sass' ? 'indented' : 'scss',
			url: new URL(pathToFileURL(resolve(filePath)).href)
		});

		const css = await runPostcss(result.css, filePath, config);
		for (const dep of sassDependencies(result.loadedUrls, filePath))
			deps.add(dep);
		recordStyleDeps(filePath, deps);

		return css;
	} catch (error) {
		throw preprocessorError(error, filePath, language);
	}
};

type LessRender = typeof import('less').render;
type LessModule = { default?: { render: LessRender }; render?: LessRender };

const loadLessRender = async (filePath: string) => {
	try {
		const lessModule = await importOptionalPeer<LessModule>('less');

		return (lessModule.render ? lessModule : lessModule.default)?.render;
	} catch {
		throw missingDependencyError('less', filePath);
	}
};

const compileLessSource = async (
	filePath: string,
	rawContents: string,
	config: StylePreprocessorConfig | undefined,
	deps: Set<string>
) => {
	const options = getLessOptions(config);
	const render = await loadLessRender(filePath);
	if (!render) throw missingDependencyError('less', filePath);

	const contents = withAdditionalData(rawContents, options.additionalData);
	const loadPaths = normalizeLoadPaths(filePath, options.paths);
	try {
		const result = await render(contents, {
			...(options.options ?? {}),
			filename: filePath,
			paths: loadPaths,
			plugins: [
				...((options.options?.plugins as unknown[]) ?? []),
				createLessFileManager(filePath, loadPaths, config, deps)
			]
		});

		const css = await runPostcss(result.css, filePath, config);
		recordStyleDeps(filePath, deps);

		return css;
	} catch (error) {
		throw preprocessorError(error, filePath, 'less');
	}
};

const compileStylusSource = async (
	filePath: string,
	rawContents: string,
	config: StylePreprocessorConfig | undefined,
	deps: Set<string>
) => {
	const options = getStylusOptions(config);
	const loadPaths = normalizeLoadPaths(filePath, options.paths);
	const contents = withAdditionalData(
		preprocessLoadedStyle(
			rawContents,
			filePath,
			filePath,
			loadPaths,
			'stylus',
			config
		),
		options.additionalData
	);

	try {
		const css = await runPostcss(
			await renderStylus(contents, filePath, loadPaths, options, deps),
			filePath,
			config
		);
		recordStyleDeps(filePath, deps);

		return css;
	} catch (error) {
		throw preprocessorError(error, filePath, 'stylus');
	}
};

export const compileStyleSource = async (
	filePath: string,
	source?: string,
	languageHint?: string,
	config?: StylePreprocessorConfig
) => {
	const language = getStyleLanguage(languageHint ?? filePath);
	const rawContents = source ?? (await readFile(filePath, 'utf-8'));
	// Collect every partial / @import / @use that the compiler touches.
	// Stored on `styleDependencyGraph` after compile so the dev server
	// can invalidate this entry when one of its imports changes.
	const deps = new Set<string>();

	if (language === 'scss' || language === 'sass')
		return compileSassSource(filePath, rawContents, language, config, deps);
	if (language === 'less')
		return compileLessSource(filePath, rawContents, config, deps);
	if (language === 'stylus')
		return compileStylusSource(filePath, rawContents, config, deps);

	return runPostcss(rawContents, filePath, config);
};

export const createStylePreprocessorPlugin = (
	config?: StylePreprocessorConfig
): BunPlugin => ({
	name: 'absolute-style-preprocessor',
	setup(build) {
		const cssModuleSources = new Map<
			string,
			{ css: string; exports: Record<string, string> }
		>();

		build.onResolve({ filter: /^absolute-style-module:/ }, ({ path }) => ({
			namespace: 'absolute-style-module',
			path: path.slice('absolute-style-module:'.length)
		}));

		build.onLoad(
			{ filter: /\.module\.css$/i, namespace: 'absolute-style-module' },
			async ({ path }) => {
				const source = cssModuleSources.get(path);
				if (!source) {
					throw new Error(
						`Unable to resolve CSS module source for ${path}`
					);
				}

				return {
					contents: source.css,
					loader: 'css'
				};
			}
		);

		build.onLoad({ filter: STYLE_EXTENSION_PATTERN }, async ({ path }) => {
			if (isStyleModulePath(path)) {
				const cssModulePath = path.replace(
					STYLE_EXTENSION_PATTERN,
					'.css'
				);
				const compiled = await compileStyleSource(
					path,
					undefined,
					undefined,
					config
				);
				const { css, exports } = extractCssModuleExports(compiled);
				cssModuleSources.set(cssModulePath, { css, exports });
				const exportSource =
					Object.keys(exports).length > 0
						? `import styles from ${JSON.stringify(`absolute-style-module:${cssModulePath}`)}; export default Object.assign({}, styles, ${JSON.stringify(exports)});`
						: `export { default } from ${JSON.stringify(`absolute-style-module:${cssModulePath}`)};`;

				return {
					contents: exportSource,
					loader: 'js'
				};
			}

			return {
				contents: await compileStyleSource(
					path,
					undefined,
					undefined,
					config
				),
				loader: 'css'
			};
		});

		build.onLoad({ filter: CSS_EXTENSION_PATTERN }, async ({ path }) => ({
			contents: await compileStyleSource(
				path,
				undefined,
				undefined,
				config
			),
			loader: 'css'
		}));
	}
});

export const stylePreprocessorPlugin = createStylePreprocessorPlugin();

/* `lang="scss"`, or the older `type="text/scss"`. */
const languageOfStyleTag = (attributes: Record<string, string | boolean>) => {
	if (typeof attributes.lang === 'string') return attributes.lang;

	return typeof attributes.type === 'string'
		? attributes.type.replace(/^text\//, '')
		: null;
};

export const createSvelteStylePreprocessor = (
	config?: StylePreprocessorConfig
) => ({
	style: async ({
		attributes,
		content,
		filename
	}: {
		attributes: Record<string, string | boolean>;
		content: string;
		filename?: string;
	}) => {
		const language = languageOfStyleTag(attributes);
		if (!language || !STYLE_LANGUAGE_PATTERN.test(language))
			return undefined;

		const path = filename ?? `style.${language}`;

		return {
			code: await compileStyleSource(path, content, language, config)
		};
	}
});

/* Pattern shared by `resolveCssImports{Sync,Async}` — top-level
 * `@import "<path>";` only. `@import url(...)` and media-qualified
 * imports pass through unchanged. */

/* The statement must END after the path: either at its `;`, or — for the
 * unterminated form this has always accepted — with no `;` before the
 * next block. Anything between the path and a `;` is a media query,
 * `layer()` or `supports()`; matching just the path there inlined the
 * file unconditionally and left the qualifier behind as stray text
 * (`@import "print.css" print;` became the print rules, for every
 * medium, followed by `print;`). Those now pass through whole. */
const CSS_IMPORT_PATTERN = /@import\s+["']([^"']+)["']\s*(?:;|(?![^;{}]*;))/g;

/* Async counterpart to `resolveCssImportsSync`. Reads imported files
 * via `node:fs/promises.readFile` so the call doesn't block the dev
 * server's event loop on a deep `@import` chain. Same failure modes:
 * `@import url(...)` and media-qualified imports pass through. */

/* What one `@import "<path>";` is replaced with: nothing when the file
 * is already being inlined further up (a cycle), the statement itself
 * when the file does not exist — and otherwise the file to inline, as a
 * path for the caller to read. */
const importReplacement = (
	match: RegExpExecArray,
	baseDir: string,
	visited: Set<string>
) => {
	const [statement, importPath] = match;
	if (importPath === undefined) return statement;
	const fullPath = isAbsolute(importPath)
		? importPath
		: resolve(baseDir, importPath);
	if (visited.has(fullPath)) return '';

	return existsSync(fullPath) ? { fullPath } : statement;
};

const resolveCssImportsAsync = async (
	content: string,
	baseDir: string,
	visited: Set<string>
): Promise<string> => {
	const matches = Array.from(content.matchAll(CSS_IMPORT_PATTERN));
	if (matches.length === 0) return content;

	// Each import is read independently of the others (its `visited` set
	// is a copy), so they are read together and stitched back in order.
	const replacements = await Promise.all(
		matches.map(async (match) => {
			const replacement = importReplacement(match, baseDir, visited);
			if (typeof replacement === 'string') return replacement;
			const { fullPath } = replacement;

			return resolveCssImportsAsync(
				await readFile(fullPath, 'utf-8'),
				dirname(fullPath),
				new Set([...visited, fullPath])
			);
		})
	);
	let cursor = 0;
	const parts: string[] = [];
	matches.forEach((match, index) => {
		const start = match.index ?? 0;
		parts.push(content.slice(cursor, start), replacements[index] ?? '');
		cursor = start + match[0].length;
	});
	parts.push(content.slice(cursor));

	return parts.join('');
};

export const compileStyleFileIfNeeded = async (
	filePath: string,
	config?: StylePreprocessorConfig
) => {
	if (!isPreprocessableStylePath(filePath)) {
		const raw = await readFile(filePath, 'utf-8');
		const processed = await runPostcss(raw, filePath, config);

		// PostCSS only resolves `@import` when configured with
		// `postcss-import`. We always resolve them here so the inlined
		// `ɵcmp.styles` content is self-contained — no browser-side
		// fetch of bare CSS paths that would hit the dev server's
		// SPA wildcard route and trip Angular's router.
		return resolveCssImportsAsync(
			processed,
			dirname(filePath),
			new Set([filePath])
		);
	}

	const compiled = await compileStyleSource(
		filePath,
		undefined,
		undefined,
		config
	);

	// Sass leaves plain `.css` `@import` statements as-is per CSS spec;
	// post-Sass output may still contain them.
	return resolveCssImportsAsync(
		compiled,
		dirname(filePath),
		new Set([filePath])
	);
};

/* Resolve top-level CSS `@import "<path>";` statements by reading the
 * imported file and inlining its content recursively. Necessary for
 * the sync styleUrls path because Angular component styles get
 * baked into `ɵcmp.styles[]` as plain strings — any unresolved
 * `@import` survives to the rendered `<style>` tag, where the browser
 * tries to fetch the bare path. The dev server has no static file at
 * that path (component CSS is bundled as JS in dev), so the request
 * falls through to the SSR catch-all and Angular's router throws
 * NG04002.
 *
 * Sass / SCSS files don't need this — Sass compiles its own
 * `@import / @use` graph in `sass.compileString`. This helper only
 * applies to plain `.css` content (and the post-Sass output, which
 * may itself contain plain CSS `@import "x.css"` statements that
 * Sass leaves as-is when the path ends in `.css`).
 *
 * Tracks visited paths to break cycles. Skips `@import url(...)`,
 * `@import "..." screen`, and other forms that need media-query
 * preservation — those fall through unchanged for now (Phase 3
 * follow-up). */

const resolveCssImportsSync = (
	content: string,
	baseDir: string,
	visited: Set<string>
): string =>
	content.replace(CSS_IMPORT_PATTERN, (match, importPath) => {
		const fullPath = isAbsolute(importPath)
			? importPath
			: resolve(baseDir, importPath);
		if (visited.has(fullPath)) return '';
		if (!existsSync(fullPath)) return match;

		const nextVisited = new Set(visited);
		nextVisited.add(fullPath);
		const imported = readFileSync(fullPath, 'utf-8');

		return resolveCssImportsSync(imported, dirname(fullPath), nextVisited);
	});

const requireSass = (packageName: string, filePath: string) => {
	try {
		return requireOptionalPeerSync<typeof import('sass')>(packageName);
	} catch {
		throw missingDependencyError(packageName, filePath);
	}
};

const compileSassSync = (
	filePath: string,
	rawContents: string,
	language: 'sass' | 'scss',
	config: StylePreprocessorConfig | undefined
) => {
	const options = getSassOptions(config, language);
	const sass = requireSass(options.implementation ?? 'sass', filePath);
	const contents = withAdditionalData(rawContents, options.additionalData);
	const loadPaths = normalizeLoadPaths(filePath, options.loadPaths);
	const result = sass.compileString(contents, {
		importers: [createSassImporter(filePath, loadPaths, language, config)],
		loadPaths,
		style: 'expanded',
		syntax: language === 'sass' ? 'indented' : 'scss',
		url: new URL(pathToFileURL(resolve(filePath)).href)
	});
	// Track every `@use` / `@import` dependency Sass loaded so
	// downstream HMR can find the entry stylesheet that needs to
	// re-emit when a shared partial (`_shared.scss`, `_tokens.scss`)
	// changes. `result.loadedUrls` includes the entry itself plus
	// everything it pulled in. Without this, editing a shared partial
	// silently keeps the entry's stale CSS until a full restart.
	for (const dep of sassDependencies(result.loadedUrls, filePath))
		addStyleImporter(filePath, dep);

	// Sass leaves plain `.css` `@import` statements alone (per CSS
	// spec, those are runtime-resolved). Resolve them here so the
	// inlined `ɵcmp.styles` content is self-contained.
	return resolveCssImportsSync(
		result.css,
		dirname(filePath),
		new Set([filePath])
	);
};

const compileStyleFileSyncUnprefixed = (
	filePath: string,
	config?: StylePreprocessorConfig
) => {
	const rawContents = readFileSync(filePath, 'utf-8');
	const language = getStyleLanguage(filePath);
	if (config?.postcss) {
		throw new Error(
			`Unable to compile ${filePath}: PostCSS preprocessing is async-only.`
		);
	}
	if (language === 'scss' || language === 'sass')
		return compileSassSync(filePath, rawContents, language, config);
	if (language === 'less') {
		throw new Error(
			`Unable to compile ${filePath} synchronously: Less only has an async compiler. Compile it with compileStyleFileIfNeeded() instead.`
		);
	}
	if (language === 'stylus') {
		throw new Error(
			`Unable to compile ${filePath} synchronously: Stylus only has an async compiler. Compile it with compileStyleFileIfNeeded() instead.`
		);
	}

	return resolveCssImportsSync(
		rawContents,
		dirname(filePath),
		new Set([filePath])
	);
};

export const compileStyleFileIfNeededSync = (
	filePath: string,
	config?: StylePreprocessorConfig
) =>
	runPrefixerSync(
		compileStyleFileSyncUnprefixed(filePath, config),
		filePath,
		config
	);

export const getCssOutputExtension = (filePath: string) =>
	isPreprocessableStylePath(filePath) ? '.css' : extname(filePath);
