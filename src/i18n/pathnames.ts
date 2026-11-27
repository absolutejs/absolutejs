import type { LocalePathnames } from '../../types/i18n';

/* Localized pathnames: a page's address written in its locale's own
 * words, `/about` in English and `/fr/a-propos` in French.
 *
 * The table (`pathnames` in the i18n routing) is keyed by the path the
 * route is registered at, with its `:params`, and names the path each
 * locale uses instead. A locale the table does not name uses the
 * route's own path. Both sides are written without a locale prefix:
 * the prefix is the routing strategy's business, and is added after.
 *
 * Two directions, and nothing else knows the table:
 *
 *   - `translatePathname` is for writing an address: the route's path,
 *     as a locale addresses it.
 *   - `canonicalPathname` is for reading one: a locale's address, back
 *     to the route's path.
 *
 * A request for a translated address is served by rewriting it to the
 * route's path before any route is looked up, and a request for the
 * untranslated address in a locale that has a translation is redirected
 * to it, so each page has one address per locale (`pathnameRules`). */

const PARAM = ':';

const partsOf = (path: string) => path.split('/').filter((part) => part !== '');

const isParam = (part: string) => part.startsWith(PARAM);

/* The values a path has where a pattern has params, or nothing when
 * the path is not one the pattern describes. */
const paramsOf = (pattern: string, path: string) => {
	const expected = partsOf(pattern);
	const given = partsOf(path);
	if (expected.length !== given.length) return undefined;
	const params: Record<string, string> = {};
	const matches = expected.every((part, index) => {
		const value = given[index] ?? '';
		if (!isParam(part)) return part === value;
		params[part.slice(PARAM.length)] = value;

		return true;
	});

	return matches ? params : undefined;
};

const fill = (pattern: string, params: Record<string, string>) =>
	`/${partsOf(pattern)
		.map((part) =>
			isParam(part) ? (params[part.slice(PARAM.length)] ?? part) : part
		)
		.join('/')}`;

type Entry = { canonical: string; translated: string };

const entriesFor = (pathnames: LocalePathnames | undefined, locale: string) =>
	Object.entries(pathnames ?? {}).flatMap(([canonical, byLocale]) => {
		const translated = byLocale[locale];
		const entry: Entry[] =
			translated === undefined || translated === canonical
				? []
				: [{ canonical, translated }];

		return entry;
	});

const rewritten = (
	path: string,
	entries: readonly Entry[],
	source: keyof Entry,
	target: keyof Entry
) => {
	const hit = entries
		.map((entry) => ({ entry, params: paramsOf(entry[source], path) }))
		.find((candidate) => candidate.params !== undefined);

	return hit?.params ? fill(hit.entry[target], hit.params) : undefined;
};

/** A locale's address for a page, back to the path its route is
 *  registered at. `path` has no locale prefix. Returned as given when
 *  the locale has no translation for it. */
export const canonicalPathname = (
	path: string,
	locale: string,
	pathnames: LocalePathnames | undefined
) =>
	rewritten(path, entriesFor(pathnames, locale), 'translated', 'canonical') ??
	path;

const paramNames = (pattern: string) =>
	partsOf(pattern)
		.filter(isParam)
		.map((part) => part.slice(PARAM.length))
		.sort()
		.join(',');

/** What is wrong with a pathnames table, one message each: a path not
 *  written from the root, and a translation whose params are not the
 *  route's — which could not be filled in from a request. */
export const pathnameProblems = (pathnames: LocalePathnames | undefined) =>
	Object.entries(pathnames ?? {}).flatMap(([canonical, byLocale]) => [
		...(canonical.startsWith('/')
			? []
			: [`i18n.pathnames: "${canonical}" must start with "/".`]),
		...Object.entries(byLocale).flatMap(([locale, translated]) => {
			if (translated === undefined) return [];
			if (!translated.startsWith('/'))
				return [
					`i18n.pathnames["${canonical}"].${locale}: "${translated}" must start with "/".`
				];

			return paramNames(translated) === paramNames(canonical)
				? []
				: [
						`i18n.pathnames["${canonical}"].${locale}: "${translated}" must have the same params as "${canonical}".`
					];
		})
	]);

type PathnameRule = { from: string; to: string };

/** The requests localized pathnames change, for the routing rules
 *  (plugins/routingRules.ts): each translated address is REWRITTEN to
 *  the route's path, and each untranslated address in a locale that has
 *  a translation is REDIRECTED to it. `prefixOf` is the locale's prefix
 *  under the app's routing — `'/fr'`, or `''` for an unprefixed default
 *  locale. */
export const pathnameRules = (
	pathnames: LocalePathnames | undefined,
	locales: readonly string[],
	prefixOf: (locale: string) => string
) => {
	const pairs = locales.flatMap((locale) =>
		entriesFor(pathnames, locale).map((entry) => ({
			canonical: `${prefixOf(locale)}${entry.canonical}`,
			translated: `${prefixOf(locale)}${entry.translated}`
		}))
	);
	const redirects: PathnameRule[] = pairs.map((pair) => ({
		from: pair.canonical,
		to: pair.translated
	}));
	const rewrites: PathnameRule[] = pairs.map((pair) => ({
		from: pair.translated,
		to: pair.canonical
	}));

	return { redirects, rewrites };
};

/** The path a route is registered at, as `locale` addresses it. `path`
 *  has no locale prefix. Returned as given when the locale has no
 *  translation for it. */
export const translatePathname = (
	path: string,
	locale: string,
	pathnames: LocalePathnames | undefined
) =>
	rewritten(path, entriesFor(pathnames, locale), 'canonical', 'translated') ??
	path;
