import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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

export const isPreprocessableStylePath = (filePath: string) =>
	STYLE_EXTENSION_PATTERN.test(filePath);

export const isStyleModulePath = (filePath: string) =>
	STYLE_MODULE_EXTENSION_PATTERN.test(filePath);

export const isStylePath = (filePath: string) =>
	/\.(css|s[ac]ss|less|styl(?:us)?)$/i.test(filePath);

export const getStyleBaseName = (filePath: string) =>
	filePath.replace(/\.(css|s[ac]ss|less|styl(?:us)?)$/i, '');

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

let tsconfigAliasCache:
	| { cwd: string; aliases: AliasEntry[]; baseUrl: string }
	| undefined;

const stripJsonComments = (source: string) =>
	source
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/(^|[^:])\/\/.*$/gm, '$1');

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
	const empty = { aliases: [], baseUrl: cwd, cwd };
	if (!existsSync(tsconfigPath)) {
		tsconfigAliasCache = empty;
		return empty;
	}

	try {
		const parsed = JSON.parse(stripJsonComments(readFileSync(tsconfigPath, 'utf-8')));
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
		aliases: [...normalizeAliasEntries(config?.aliases), ...tsconfig.aliases],
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
		for (const replacement of alias.replacements) {
			targets.push(resolve(baseUrl, replacement.replace('*', wildcard)));
		}
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
			const normalized = rebased.startsWith('.') ? rebased : `./${rebased}`;
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

const getLessOptions = (
	config: StylePreprocessorConfig | undefined
): LessPreprocessorOptions => config?.less ?? {};

const getStylusOptions = (
	config: StylePreprocessorConfig | undefined
): StylusPreprocessorOptions => config?.stylus ?? {};

export const createStyleTransformConfig = (
	stylePreprocessors?: StylePreprocessorConfig,
	postcss?: PostCSSConfig
): StylePreprocessorConfig | undefined =>
	postcss === undefined
		? stylePreprocessors
		: { ...(stylePreprocessors ?? {}), postcss };

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

const loadPostcssConfigFile = async (
	configPath: string
): Promise<PostCSSRuntimeConfig> => {
	const resolved = resolve(process.cwd(), configPath);
	const loaded = resolved.endsWith('.cjs') || resolved.endsWith('.cts')
		? requireOptionalPeerSync<unknown>(resolved)
		: await importOptionalPeer<unknown>(
				`${new URL(`file://${resolved}`).href}?t=${Date.now()}`
			);
	const config = normalizePostcssModule(loaded);
	const value =
		typeof config === 'function'
			? await (config as (context: {
					cwd: string;
					env?: string;
			  }) => unknown)({
					cwd: process.cwd(),
					env: process.env.NODE_ENV
				})
			: config;

	return (normalizePostcssModule(value) ?? {}) as PostCSSRuntimeConfig;
};

const normalizePostcssPlugins = (plugins: unknown[] | Record<string, unknown> | undefined) => {
	if (!plugins) return [];
	if (Array.isArray(plugins)) return plugins.filter(Boolean);

	const resolved: unknown[] = [];
	for (const [specifier, options] of Object.entries(plugins)) {
		if (options === false) continue;
		const mod = normalizePostcssModule(requireOptionalPeerSync<unknown>(specifier));
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

const runPostcss = async (
	css: string,
	filePath: string,
	config: StylePreprocessorConfig | undefined
) => {
	const postcssConfig = await resolvePostcssConfig(config);
	if (!postcssConfig) return css;

	let postcssModule: typeof import('postcss') & {
		default?: typeof import('postcss');
	};
	try {
		postcssModule = await importOptionalPeer<typeof postcssModule>('postcss');
	} catch {
		throw missingDependencyError('postcss', filePath);
	}
	const postcss = postcssModule.default ?? postcssModule;
	const result = await postcss(
		postcssConfig.plugins as import('postcss').AcceptedPlugin[]
	).process(css, {
		from: filePath,
		map: false,
		...postcssConfig.options
	});

	return result.css;
};

const createSassImporter = (
	entryFile: string,
	loadPaths: string[],
	language: 'sass' | 'scss',
	config: StylePreprocessorConfig | undefined
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
		return resolved ? new URL(`file://${resolved}`) : null;
	},
	load(canonicalUrl: URL) {
		const filePath = fileURLToPath(canonicalUrl);
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
	config: StylePreprocessorConfig | undefined
) => ({
	install(less: { FileManager: new () => Record<string, unknown> }, pluginManager: { addFileManager(manager: unknown): void }) {
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
		manager.loadFile = async (filename: string, currentDirectory: string) => {
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
	options: StylusPreprocessorOptions
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

	return new Promise<string>((resolveCss, reject) => {
		const renderer = stylus(contents);
		renderer.set('filename', filePath);
		for (const [key, value] of Object.entries(options.options ?? {})) {
			renderer.set(key, value);
		}
		for (const path of loadPaths) renderer.include(path);
		renderer.render((error, css) => {
			if (error) reject(error);
			else resolveCss(css ?? '');
		});
	});
};

export const compileStyleSource = async (
	filePath: string,
	source?: string,
	languageHint?: string,
	config?: StylePreprocessorConfig
) => {
	const language = getStyleLanguage(languageHint ?? filePath);
	const rawContents = source ?? (await readFile(filePath, 'utf-8'));

	if (language === 'scss' || language === 'sass') {
		const options = getSassOptions(config, language);
		const packageName = options.implementation ?? 'sass';
		let sass: typeof import('sass');
		try {
			sass =
				await importOptionalPeer<typeof import('sass')>(packageName);
		} catch {
			throw missingDependencyError(packageName, filePath);
		}

		const contents = withAdditionalData(
			rawContents,
			options.additionalData
		);
		const loadPaths = normalizeLoadPaths(filePath, options.loadPaths);
		const result = sass.compileString(contents, {
			importers: [
				createSassImporter(filePath, loadPaths, language, config)
			],
			loadPaths,
			style: 'expanded',
			syntax: language === 'sass' ? 'indented' : 'scss',
			url: new URL(`file://${filePath}`)
		});

		return runPostcss(result.css, filePath, config);
	}

	if (language === 'less') {
		const options = getLessOptions(config);
		type LessRender = typeof import('less').render;
		let lessModule: {
			default?: { render: LessRender };
			render?: LessRender;
		};
		try {
			lessModule = await importOptionalPeer<typeof lessModule>('less');
		} catch {
			throw missingDependencyError('less', filePath);
		}
		const less = lessModule.render ? lessModule : lessModule.default;
		const render = less?.render;
		if (!render) throw missingDependencyError('less', filePath);

		const contents = withAdditionalData(
			rawContents,
			options.additionalData
		);
		const loadPaths = normalizeLoadPaths(filePath, options.paths);
		const result = await render(contents, {
			...(options.options ?? {}),
			filename: filePath,
			paths: loadPaths,
			plugins: [
				...((options.options?.plugins as unknown[]) ?? []),
				createLessFileManager(filePath, loadPaths, config)
			]
		});

		return runPostcss(result.css, filePath, config);
	}

	if (language === 'stylus') {
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

		return runPostcss(
			await renderStylus(contents, filePath, loadPaths, options),
			filePath,
			config
		);
	}

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
		const language =
			typeof attributes.lang === 'string'
				? attributes.lang
				: typeof attributes.type === 'string'
					? attributes.type.replace(/^text\//, '')
					: null;
		if (!language || !STYLE_LANGUAGE_PATTERN.test(language)) return;

		const path = filename ?? `style.${language}`;

		return {
			code: await compileStyleSource(path, content, language, config)
		};
	}
});

export const compileStyleFileIfNeeded = async (
	filePath: string,
	config?: StylePreprocessorConfig
) => {
	if (!isPreprocessableStylePath(filePath)) {
		return runPostcss(await readFile(filePath, 'utf-8'), filePath, config);
	}

	return compileStyleSource(filePath, undefined, undefined, config);
};

export const compileStyleFileIfNeededSync = (
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
	if (language === 'scss' || language === 'sass') {
		const options = getSassOptions(config, language);
		const packageName = options.implementation ?? 'sass';
		let sass: typeof import('sass');
		try {
			sass =
				requireOptionalPeerSync<typeof import('sass')>(packageName);
		} catch {
			throw missingDependencyError(packageName, filePath);
		}

		const contents = withAdditionalData(
			rawContents,
			options.additionalData
		);
		const loadPaths = normalizeLoadPaths(filePath, options.loadPaths);
		return sass.compileString(contents, {
			importers: [
				createSassImporter(filePath, loadPaths, language, config)
			],
			loadPaths,
			style: 'expanded',
			syntax: language === 'sass' ? 'indented' : 'scss',
			url: new URL(`file://${filePath}`)
		}).css;
	}
	if (language === 'less') {
		throw new Error(
			`Unable to compile ${filePath}: Less styleUrl preprocessing is async-only. Import the Less file from a bundled entrypoint or use SCSS/CSS for Angular styleUrl.`
		);
	}
	if (language === 'stylus') {
		throw new Error(
			`Unable to compile ${filePath}: Stylus styleUrl preprocessing is async-only. Import the Stylus file from a bundled entrypoint or use SCSS/CSS for Angular styleUrl.`
		);
	}

	return rawContents;
};

export const getCssOutputExtension = (filePath: string) =>
	isPreprocessableStylePath(filePath) ? '.css' : extname(filePath);
