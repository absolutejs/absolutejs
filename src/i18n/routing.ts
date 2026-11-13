/* Locale routing helpers shared by the server plugin, the sitemap and
 * browser code (language switchers): path prefixes, hreflang alternates,
 * Accept-Language negotiation and text direction. No server imports. */

import type {
	AlternateLink,
	LocaleRoutingConfig,
	TextDirection
} from '../../types/i18n';

const RTL_SCRIPTS = new Set([
	'Adlm',
	'Arab',
	'Aran',
	'Hebr',
	'Mand',
	'Nkoo',
	'Rohg',
	'Samr',
	'Syrc',
	'Thaa'
]);

const RTL_LANGUAGES = new Set([
	'ar',
	'arc',
	'ckb',
	'dv',
	'fa',
	'he',
	'iw',
	'ps',
	'sd',
	'syr',
	'ug',
	'ur',
	'yi'
]);

const scriptOf = (locale: string) => {
	try {
		return new Intl.Locale(locale).maximize().script;
	} catch {
		return undefined;
	}
};

/** `rtl` for locales written right to left (Arabic, Hebrew, Persian,
 *  Urdu, … or any tag with an RTL script subtag), else `ltr`. */
export const localeDirection = (locale: string) => {
	const script = scriptOf(locale);
	const direction: TextDirection =
		(script !== undefined && RTL_SCRIPTS.has(script)) ||
		(script === undefined &&
			RTL_LANGUAGES.has(locale.split(/[-_]/)[0]?.toLowerCase() ?? ''))
			? 'rtl'
			: 'ltr';

	return direction;
};

type WeightedTag = { tag: string; quality: number; order: number };

/** Language tags from an `Accept-Language` header, best first. */
export const parseAcceptLanguage = (header: string | null | undefined) => {
	if (!header) return [];
	const tags: WeightedTag[] = header
		.split(',')
		.map((part, order) => {
			const [rawTag = '', ...params] = part.trim().split(';');
			const qualityParam = params
				.map((param) => param.trim())
				.find((param) => param.startsWith('q='));
			const quality = qualityParam ? Number(qualityParam.slice(2)) : 1;

			return {
				order,
				quality: Number.isFinite(quality) ? quality : 0,
				tag: rawTag.trim()
			};
		})
		.filter((entry) => entry.tag !== '' && entry.tag !== '*')
		.filter((entry) => entry.quality > 0);

	return tags
		.sort(
			(left, right) =>
				right.quality - left.quality || left.order - right.order
		)
		.map((entry) => entry.tag);
};

const languageOf = (tag: string) => tag.split(/[-_]/)[0]?.toLowerCase() ?? '';

/** The locale named by the path's first segment, if it is one. */
export const localeFromPath = <Locale extends string>(
	pathname: string,
	locales: readonly Locale[]
) => {
	const segment = pathname.split('/')[1] ?? '';

	return locales.find((locale) => locale === segment);
};
/** The configured locale that best matches one requested tag: an exact
 *  (case-insensitive) match, then the same language (`fr-CA` → `fr`, or
 *  `fr` → `fr-FR`). */
export const matchLocale = <Locale extends string>(
	tag: string,
	locales: readonly Locale[]
) => {
	const lower = tag.toLowerCase();
	const exact = locales.find((locale) => locale.toLowerCase() === lower);
	if (exact) return exact;
	const language = languageOf(tag);

	return locales.find((locale) => languageOf(locale) === language);
};
/** The first requested tag that matches a configured locale, else
 *  `fallback`. */
export const negotiateLocale = <Locale extends string>(
	requested: readonly string[],
	locales: readonly Locale[],
	fallback: Locale
) => {
	for (const tag of requested) {
		const match = matchLocale(tag, locales);
		if (match) return match;
	}

	return fallback;
};
/** A cookie's value from a `Cookie` header. */
export const readCookie = (header: string | null | undefined, name: string) => {
	if (!header) return undefined;
	for (const part of header.split(';')) {
		const separator = part.indexOf('=');
		if (separator === -1) continue;
		if (part.slice(0, separator).trim() !== name) continue;
		try {
			return decodeURIComponent(part.slice(separator + 1).trim());
		} catch {
			return undefined;
		}
	}

	return undefined;
};
/** `pathname` without a leading locale segment (`/fr/about` → `/about`). */
export const stripLocalePrefix = (
	pathname: string,
	locales: readonly string[]
) => {
	const locale = localeFromPath(pathname, locales);
	if (locale === undefined) return pathname;
	const rest = pathname.slice(locale.length + 1);

	return rest === '' ? '/' : rest;
};

const resolveStrategy = (routing: LocaleRoutingConfig) =>
	routing.strategy ?? 'prefix';

/** `path` as it is addressed in `locale`. Under `prefix` this swaps or
 *  adds the locale segment (the default locale stays unprefixed unless
 *  `prefixDefault`); other strategies keep one path for every locale. */
export const localizePath = <Locale extends string>(
	path: string,
	locale: Locale,
	routing: LocaleRoutingConfig<Locale>
) => {
	if (resolveStrategy(routing) !== 'prefix') return path;
	const base = stripLocalePrefix(path, routing.locales);
	if (locale === routing.defaultLocale && !routing.prefixDefault) return base;

	return base === '/' ? `/${locale}` : `/${locale}${base}`;
};

const trimOrigin = (origin: string) => origin.replace(/\/+$/, '');

const domainHref = (origin: string, host: string, path: string) => {
	const protocol = /^(https?:)\/\//.exec(origin)?.[1] ?? 'https:';

	return `${protocol}//${host}${path}`;
};

const domainAlternates = <Locale extends string>(
	base: string,
	routing: LocaleRoutingConfig<Locale>,
	origin: string
) => {
	const hosts: Partial<Record<Locale, string>> = routing.domains ?? {};
	const links: AlternateLink[] = routing.locales.flatMap((locale) => {
		const host = hosts[locale];

		return host
			? [{ href: domainHref(origin, host, base), hreflang: locale }]
			: [];
	});
	const defaultHost = hosts[routing.defaultLocale];
	if (defaultHost)
		links.push({
			href: domainHref(origin, defaultHost, base),
			hreflang: 'x-default'
		});

	return links;
};

/** hreflang alternates for `path` (with or without a locale prefix): one
 *  per locale plus `x-default`. Empty under `negotiate`, where every
 *  locale shares one URL. `origin` makes the hrefs absolute, as search
 *  engines require. */
export const alternateLinks = <Locale extends string>(
	path: string,
	routing: LocaleRoutingConfig<Locale>,
	origin: string
) => {
	const strategy = resolveStrategy(routing);
	const base = stripLocalePrefix(path, routing.locales);
	const links: AlternateLink[] = [];
	if (strategy === 'negotiate') return links;
	if (strategy === 'domain') return domainAlternates(base, routing, origin);
	const root = trimOrigin(origin);
	for (const locale of routing.locales) {
		links.push({
			href: `${root}${localizePath(base, locale, routing)}`,
			hreflang: locale
		});
	}
	links.push({ href: `${root}${base}`, hreflang: 'x-default' });

	return links;
};
