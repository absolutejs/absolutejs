/* Intl formatters are expensive to construct; keep one per locale and
 * options. Options are keyed by their JSON, which is stable for the plain
 * option objects callers pass. */

const numberFormats = new Map<string, Intl.NumberFormat>();
const dateTimeFormats = new Map<string, Intl.DateTimeFormat>();
const pluralRules = new Map<string, Intl.PluralRules>();
const relativeTimeFormats = new Map<string, Intl.RelativeTimeFormat>();
const listFormats = new Map<string, Intl.ListFormat>();

const cacheKey = (locale: string, options: object | undefined) =>
	`${locale}|${options ? JSON.stringify(options) : ''}`;

const cached = <Formatter>(
	cache: Map<string, Formatter>,
	key: string,
	create: () => Formatter
) => {
	const existing = cache.get(key);
	if (existing) return existing;
	const created = create();
	cache.set(key, created);

	return created;
};

export const getDateTimeFormat = (
	locale: string,
	options?: Intl.DateTimeFormatOptions
) =>
	cached(
		dateTimeFormats,
		cacheKey(locale, options),
		() => new Intl.DateTimeFormat(locale, options)
	);
export const getListFormat = (
	locale: string,
	options?: Intl.ListFormatOptions
) =>
	cached(
		listFormats,
		cacheKey(locale, options),
		() => new Intl.ListFormat(locale, options)
	);
export const getNumberFormat = (
	locale: string,
	options?: Intl.NumberFormatOptions
) =>
	cached(
		numberFormats,
		cacheKey(locale, options),
		() => new Intl.NumberFormat(locale, options)
	);
export const getPluralRules = (
	locale: string,
	options?: Intl.PluralRulesOptions
) =>
	cached(
		pluralRules,
		cacheKey(locale, options),
		() => new Intl.PluralRules(locale, options)
	);
export const getRelativeTimeFormat = (
	locale: string,
	options?: Intl.RelativeTimeFormatOptions
) =>
	cached(
		relativeTimeFormats,
		cacheKey(locale, options),
		() => new Intl.RelativeTimeFormat(locale, options)
	);
