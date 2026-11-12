/* Build-time font optimization: downloads Google Fonts (or reads local
 * font files), self-hosts them under `<build>/assets/fonts/` with
 * content-hashed names, and writes one linked stylesheet holding the
 * `@font-face` rules, a metric-matched fallback face per family, and a CSS
 * variable plus class per family. The page links the stylesheet and
 * preloads the critical faces through manifest keys (see `fontAssets`). */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import type {
	FontDisplay,
	FontFamilyConfig,
	FontFetch,
	FontPreloadSelector,
	FontsConfig,
	FontStyle
} from '../../../types/fonts';
import {
	FONT_PRELOAD_MANIFEST_PREFIX,
	FONTS_CSS_MANIFEST_KEY,
	FONTS_REMOTE_CSS_MANIFEST_PREFIX
} from '../../utils/fontAssets';
import { toKebab } from '../../utils/stringModifiers';
import {
	computeFallbackOverrides,
	inferFallbackCategory
} from './fallbackMetrics';
import {
	familyStyles,
	familyWeights,
	GOOGLE_FONTS_USER_AGENT,
	googleFontsCssUrl,
	parseGoogleFontsCss
} from './googleFonts';
import { parseFontMetrics } from './parseFontMetrics';

export const FONTS_OUTPUT_DIRECTORY = 'assets/fonts';

const DOWNLOAD_TIMEOUT_MS = 20_000;
const HASH_LENGTH = 8;
const CACHE_KEY_LENGTH = 24;
const DEFAULT_SUBSET = 'latin';

type BuiltFace = {
	bytes: Uint8Array;
	family: string;
	fileName: string;
	format: string;
	style: FontStyle;
	subset?: string;
	unicodeRange?: string;
	weight: string;
};

type BuiltFamily = {
	config: FontFamilyConfig;
	faces: BuiltFace[];
	remoteCssUrl?: string;
};

export type BuildFontsInput = {
	buildPath: string;
	config: FontsConfig;
	fetch?: FontFetch;
	projectRoot: string;
	warn?: (message: string) => void;
};

type FamilyContext = {
	cacheDirectory: string;
	display: FontDisplay;
	fetch: FontFetch;
	outputDirectory: string;
	projectRoot: string;
};

const FORMAT_BY_EXTENSION: Record<string, string> = {
	'.otf': 'opentype',
	'.ttf': 'truetype',
	'.woff': 'woff',
	'.woff2': 'woff2'
};

/** An 8-character content hash that always mixes letters and digits, the
 *  shape the production server recognizes as fingerprinted (and caches
 *  immutably) and stale-output cleanup recognizes as hashed. */
export const fingerprint = (content: Uint8Array | string) => {
	const digest = createHash('sha256').update(content).digest('hex');
	for (let start = 0; start + HASH_LENGTH <= digest.length; start += 1) {
		const window = digest.slice(start, start + HASH_LENGTH);
		if (/[0-9]/.test(window) && /[a-f]/.test(window)) return window;
	}

	return `${digest.slice(0, HASH_LENGTH - 1)}a`;
};

/** File name a download is cached under: a hash of its URL and the
 *  User-Agent it was requested with. */
export const fontCacheKey = (url: string) =>
	createHash('sha256')
		.update(`${url}\n${GOOGLE_FONTS_USER_AGENT}`)
		.digest('hex')
		.slice(0, CACHE_KEY_LENGTH);

const download = async (url: string, context: FamilyContext) => {
	const cachedPath = join(context.cacheDirectory, fontCacheKey(url));
	if (existsSync(cachedPath)) return new Uint8Array(readFileSync(cachedPath));
	const response = await context.fetch(url, {
		headers: { 'user-agent': GOOGLE_FONTS_USER_AGENT },
		signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)
	});
	if (!response.ok) {
		throw new Error(`${url} responded ${response.status}`);
	}
	const bytes = new Uint8Array(await response.arrayBuffer());
	mkdirSync(context.cacheDirectory, { recursive: true });
	writeFileSync(cachedPath, bytes);

	return bytes;
};

const normalizeWeight = (weight: number | string) =>
	String(weight)
		.trim()
		.replace(/\s*\.\.\s*/, ' ')
		.replace(/\s+/g, ' ');

const writeFace = (
	face: Omit<BuiltFace, 'fileName'>,
	extension: string,
	context: FamilyContext
) => {
	const parts = [
		toKebab(face.family),
		face.subset,
		face.weight.replace(' ', '-'),
		face.style
	].filter(Boolean);
	const fileName = `${parts.join('-')}.${fingerprint(face.bytes)}${extension}`;
	writeFileSync(join(context.outputDirectory, fileName), face.bytes);
	const built: BuiltFace = { ...face, fileName };

	return built;
};

const buildLocalFamily = (
	family: FontFamilyConfig,
	sources: NonNullable<FontFamilyConfig['src']>,
	context: FamilyContext
) => {
	const faces = sources.map((source) => {
		const path = resolve(context.projectRoot, source.path);
		if (!existsSync(path)) {
			throw new Error(
				`[fonts] ${family.family}: font file not found: ${source.path}`
			);
		}
		const extension = extname(path).toLowerCase();

		return writeFace(
			{
				bytes: new Uint8Array(readFileSync(path)),
				family: family.family,
				format: FORMAT_BY_EXTENSION[extension] ?? 'woff2',
				style: source.style ?? 'normal',
				weight: normalizeWeight(source.weight ?? 400)
			},
			extension,
			context
		);
	});
	const built: BuiltFamily = { config: family, faces };

	return built;
};

const buildGoogleFamily = async (
	family: FontFamilyConfig,
	context: FamilyContext
) => {
	const display = family.display ?? context.display;
	const cssUrl = googleFontsCssUrl(family, display);
	const css = new TextDecoder().decode(await download(cssUrl, context));
	const subsets = new Set(family.subsets ?? [DEFAULT_SUBSET]);
	const remoteFaces = parseGoogleFontsCss(css).filter((face) =>
		subsets.has(face.subset)
	);
	if (remoteFaces.length === 0) {
		throw new Error(
			`Google Fonts returned no faces for subsets ${[...subsets].join(', ')}`
		);
	}
	const faces = await Promise.all(
		remoteFaces.map(async (face) =>
			writeFace(
				{
					bytes: await download(face.url, context),
					family: family.family,
					format: 'woff2',
					style: face.style,
					subset: face.subset,
					unicodeRange: face.unicodeRange,
					weight: normalizeWeight(face.weight)
				},
				'.woff2',
				context
			)
		)
	);
	const built: BuiltFamily = { config: family, faces };

	return built;
};

const buildFamily = async (
	family: FontFamilyConfig,
	context: FamilyContext,
	options: Pick<BuildFontsInput, 'warn'> & { fallbackToRemote: boolean }
) => {
	if (family.src && family.src.length > 0) {
		return buildLocalFamily(family, family.src, context);
	}
	try {
		return await buildGoogleFamily(family, context);
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		const remoteCssUrl = googleFontsCssUrl(
			family,
			family.display ?? context.display
		);
		if (!options.fallbackToRemote) {
			throw new Error(
				`[fonts] Could not download Google font "${family.family}" (${reason}). Check the network connection and the family name, or set \`fonts.fallbackToRemote: true\` to link Google Fonts at runtime instead.`,
				{ cause: error }
			);
		}
		options.warn?.(
			`[fonts] Could not download "${family.family}" (${reason}); linking ${remoteCssUrl} instead`
		);
		const built: BuiltFamily = { config: family, faces: [], remoteCssUrl };

		return built;
	}
};

const quote = (family: string) => `'${family.replace(/'/g, "\\'")}'`;

const fallbackCategoryOf = (family: FontFamilyConfig) =>
	family.fallback ?? inferFallbackCategory(family.family);

const renderFace = (face: BuiltFace, display: FontDisplay) =>
	[
		face.subset ? `/* ${face.subset} */` : undefined,
		'@font-face {',
		`  font-family: ${quote(face.family)};`,
		`  font-style: ${face.style};`,
		`  font-weight: ${face.weight};`,
		`  font-display: ${display};`,
		`  src: url(${face.fileName}) format('${face.format}');`,
		face.unicodeRange
			? `  unicode-range: ${face.unicodeRange};`
			: undefined,
		'}'
	]
		.filter((line): line is string => line !== undefined)
		.join('\n');

const matchesSelector = (face: BuiltFace, selector: FontPreloadSelector) =>
	(selector.weight === undefined ||
		normalizeWeight(selector.weight) === face.weight) &&
	(selector.style === undefined || selector.style === face.style) &&
	(selector.subset === undefined ||
		face.subset === undefined ||
		selector.subset === face.subset);

const defaultPreloadSelector = (family: BuiltFamily) => {
	const subsets = family.config.subsets ?? [DEFAULT_SUBSET];
	const [firstSource] = family.config.src ?? [];
	const firstWeight = familyWeights(family.config)[0] ?? '400';
	const selector: FontPreloadSelector = {
		style: firstSource
			? (firstSource.style ?? 'normal')
			: familyStyles(family.config)[0],
		subset: subsets.includes(DEFAULT_SUBSET) ? DEFAULT_SUBSET : subsets[0],
		weight: firstSource ? (firstSource.weight ?? 400) : firstWeight
	};

	return selector;
};

const preloadedFaces = (family: BuiltFamily) => {
	const { preload = true } = family.config;
	if (preload === false) return [];
	const selectors =
		preload === true ? [defaultPreloadSelector(family)] : preload;

	return family.faces.filter((face) =>
		selectors.some((selector) => matchesSelector(face, selector))
	);
};

const renderFallbackFace = (family: BuiltFamily, metricsFace: BuiltFace) => {
	const category = fallbackCategoryOf(family.config);
	const overrides = computeFallbackOverrides(
		parseFontMetrics(metricsFace.bytes),
		category
	);

	return [
		'@font-face {',
		`  font-family: ${quote(`${family.config.family} Fallback`)};`,
		`  src: ${overrides.local.map((name) => `local(${quote(name)})`).join(', ')};`,
		`  size-adjust: ${overrides.sizeAdjust};`,
		`  ascent-override: ${overrides.ascentOverride};`,
		`  descent-override: ${overrides.descentOverride};`,
		`  line-gap-override: ${overrides.lineGapOverride};`,
		'}'
	].join('\n');
};

const tryRenderFallbackFace = (
	family: BuiltFamily,
	warn: BuildFontsInput['warn']
) => {
	const [metricsFace] = [
		...preloadedFaces(family),
		...family.faces.filter((face) => face.subset === DEFAULT_SUBSET),
		...family.faces
	];
	if (!metricsFace || family.config.adjustFallback === false)
		return undefined;
	try {
		return renderFallbackFace(family, metricsFace);
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		warn?.(
			`[fonts] Could not read metrics from ${metricsFace.fileName} (${reason}); skipping the fallback face for "${family.config.family}"`
		);

		return undefined;
	}
};

export const familyClassName = (family: FontFamilyConfig) =>
	family.className ?? `font-${toKebab(family.family)}`;

export const familyVariable = (family: FontFamilyConfig) =>
	family.variable ?? `--font-${toKebab(family.family)}`;

const renderFamilyStack = (family: BuiltFamily, hasFallbackFace: boolean) =>
	[
		quote(family.config.family),
		hasFallbackFace ? quote(`${family.config.family} Fallback`) : undefined,
		fallbackCategoryOf(family.config)
	]
		.filter((part): part is string => part !== undefined)
		.join(', ');

const renderFamily = (
	family: BuiltFamily,
	display: FontDisplay,
	warn: BuildFontsInput['warn']
) => {
	const fallbackFace = tryRenderFallbackFace(family, warn);
	const stack = renderFamilyStack(family, fallbackFace !== undefined);
	const variable = familyVariable(family.config);

	return {
		css: [
			...family.faces.map((face) =>
				renderFace(face, family.config.display ?? display)
			),
			...(fallbackFace ? [fallbackFace] : [])
		].join('\n'),
		root: `  ${variable}: ${stack};`,
		utility: `.${familyClassName(family.config)} {\n  font-family: var(${variable});\n}`
	};
};

const renderStylesheet = (
	families: BuiltFamily[],
	display: FontDisplay,
	warn: BuildFontsInput['warn']
) => {
	const rendered = families.map((family) =>
		renderFamily(family, display, warn)
	);

	const sections = [
		...rendered.map((family) => family.css).filter(Boolean),
		`:root {\n${rendered.map((family) => family.root).join('\n')}\n}`,
		...rendered.map((family) => family.utility)
	];

	return `${sections.join('\n\n')}\n`;
};

const toWebPath = (fileName: string) =>
	`/${FONTS_OUTPUT_DIRECTORY}/${fileName}`;

/** Downloads/copies the configured fonts into the build and writes their
 *  stylesheet. Returns the manifest keys to merge and every file written
 *  (so stale-output cleanup keeps them). */
export const buildFonts = async ({
	buildPath,
	config,
	fetch: fontFetch = (url, init) => fetch(url, init),
	projectRoot,
	warn
}: BuildFontsInput) => {
	const display = config.display ?? 'swap';
	const outputDirectory = join(buildPath, FONTS_OUTPUT_DIRECTORY);
	mkdirSync(outputDirectory, { recursive: true });
	const context: FamilyContext = {
		cacheDirectory: resolve(
			projectRoot,
			config.cacheDirectory ?? join('.absolutejs', 'cache', 'fonts')
		),
		display,
		fetch: fontFetch,
		outputDirectory,
		projectRoot
	};
	const families = await Promise.all(
		config.families.map((family) =>
			buildFamily(family, context, {
				fallbackToRemote: config.fallbackToRemote === true,
				warn
			})
		)
	);
	const stylesheet = renderStylesheet(families, display, warn);
	const stylesheetName = `fonts.${fingerprint(stylesheet)}.css`;
	writeFileSync(join(outputDirectory, stylesheetName), stylesheet);

	const manifest: Record<string, string> = {
		[FONTS_CSS_MANIFEST_KEY]: toWebPath(stylesheetName)
	};
	families
		.flatMap((family) => (family.remoteCssUrl ? [family.remoteCssUrl] : []))
		.forEach((url, index) => {
			manifest[`${FONTS_REMOTE_CSS_MANIFEST_PREFIX}${index}`] = url;
		});
	families.flatMap(preloadedFaces).forEach((face, index) => {
		manifest[`${FONT_PRELOAD_MANIFEST_PREFIX}${index}`] = toWebPath(
			face.fileName
		);
	});

	return {
		manifest,
		outputPaths: [
			join(outputDirectory, stylesheetName),
			...families.flatMap((family) =>
				family.faces.map((face) => join(outputDirectory, face.fileName))
			)
		]
	};
};
