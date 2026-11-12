export type FontStyle = 'normal' | 'italic';

export type FontDisplay = 'auto' | 'block' | 'swap' | 'fallback' | 'optional';

/** The generic family the size-adjusted fallback face is built from:
 *  Arial for `sans-serif`, Times New Roman for `serif`, Courier New for
 *  `monospace`. */
export type FontFallbackCategory = 'sans-serif' | 'serif' | 'monospace';

/** A face to preload. Omitted fields match any value. */
export type FontPreloadSelector = {
	weight?: number | string;
	style?: FontStyle;
	subset?: string;
};

/** One font file from the project, for a family with `src`. */
export type LocalFontSource = {
	/** Path to a `.woff2`, `.woff`, `.ttf` or `.otf` file, relative to the
	 *  project root. */
	path: string;
	/** A number (`400`) or, for a variable font, a range (`'100 900'`).
	 *  Defaults to 400. */
	weight?: number | string;
	/** Defaults to `normal`. */
	style?: FontStyle;
};

export type FontFamilyConfig = {
	/** The family name, e.g. `'Poppins'` or `'Open Sans'`. */
	family: string;
	/** Local font files. When set, the family is self-hosted from these
	 *  files instead of downloaded from Google Fonts. */
	src?: LocalFontSource[];
	/** Google Fonts weights: numbers (`[400, 700]`) or one variable range
	 *  (`'100..900'`). Defaults to `[400]`. */
	weights?: Array<number | string> | string;
	/** Google Fonts styles. Defaults to `['normal']`. */
	styles?: FontStyle[];
	/** Google Fonts subsets to keep. Defaults to `['latin']`. */
	subsets?: string[];
	/** `font-display` for this family. Defaults to the top-level `display`. */
	display?: FontDisplay;
	/** Which faces to preload. `true` (the default) preloads the first
	 *  weight and style in the latin subset (or the first subset); `false`
	 *  preloads nothing; a list picks faces explicitly. */
	preload?: boolean | FontPreloadSelector[];
	/** Generic family for the metric-matched fallback face. Inferred from
	 *  the family name when omitted (`Mono` -> monospace, `Serif` -> serif,
	 *  otherwise sans-serif). */
	fallback?: FontFallbackCategory;
	/** Generate the size-adjusted fallback `@font-face`. Defaults to true. */
	adjustFallback?: boolean;
	/** CSS custom property name. Defaults to `--font-<family-kebab>`. */
	variable?: string;
	/** Class name that applies the family. Defaults to `font-<family-kebab>`. */
	className?: string;
};

export type FontsConfig = {
	families: FontFamilyConfig[];
	/** Default `font-display` for every family. Defaults to `swap`. */
	display?: FontDisplay;
	/** When a Google Fonts download fails (offline, blocked), link the
	 *  remote stylesheet instead of failing the build. Defaults to false. */
	fallbackToRemote?: boolean;
	/** Where downloads are cached between builds. Defaults to
	 *  `.absolutejs/cache/fonts` under the project root. */
	cacheDirectory?: string;
	/** Add the font stylesheet and preloads to the `<head>` of HTML and
	 *  HTMX pages. Defaults to true. */
	injectHtml?: boolean;
};

/** What a page needs in its `<head>` to use the built fonts. Plain data,
 *  so it can be passed as a page prop and serialized for hydration. */
export type FontAssets = {
	preload: string[];
	stylesheets: string[];
};

/** Vertical and horizontal metrics read from a font file. */
export type FontMetrics = {
	ascent: number;
	descent: number;
	lineGap: number;
	unitsPerEm: number;
	/** Average advance width of latin text, weighted by letter frequency. */
	averageWidth: number;
};

export type FontFetch = (
	url: string,
	init?: { headers?: Record<string, string>; signal?: AbortSignal }
) => Promise<Response>;
