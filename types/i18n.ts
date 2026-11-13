/* Internationalization types: message catalogs, typed keys and ICU
 * parameters, the locale-routing config and the hydration payload. See
 * docs/I18N_PLAN.md. */

/** A message catalog: nested objects whose leaves are ICU MessageFormat
 *  strings. Top-level keys double as namespaces (what a page loads). */
export type MessageCatalog = {
	readonly [key: string]: string | MessageCatalog;
};

/** Runtime shape of a catalog after loading (no literal types). */
export type MessageTree = {
	[key: string]: string | MessageTree;
};

/** A value a simple `{name}` argument accepts. Numbers are formatted with
 *  `Intl.NumberFormat`, dates with `Intl.DateTimeFormat`. */
export type MessageValue = string | number | bigint | Date;

/** The same shape as `Source`, with every leaf widened to `string` — the
 *  type a non-default locale's catalog must satisfy. A missing key is a
 *  type error. */
export type Translation<Source> = {
	readonly [K in keyof Source]: Source[K] extends string
		? string
		: Translation<Source[K]>;
};

/** Every dot-separated key that leads to a message in `Catalog`. */
export type MessageKey<Catalog> = string extends keyof Catalog
	? string
	: {
			[K in keyof Catalog & string]: Catalog[K] extends string
				? K
				: `${K}.${MessageKey<Catalog[K]>}`;
		}[keyof Catalog & string];

/** The message string (literal when the catalog is `as const`) at `Key`. */
export type MessageAt<
	Catalog,
	Key extends string
> = Key extends `${infer Head}.${infer Rest}`
	? Head extends keyof Catalog
		? MessageAt<Catalog[Head], Rest>
		: never
	: Key extends keyof Catalog
		? Catalog[Key]
		: never;

/* ---------------------------------------------------------------------
 * ICU argument extraction at the type level. Walks the message the way
 * the runtime parser does — `{name}`, `{name, number|date|time[, style]}`,
 * `{name, plural|selectordinal|select, … {branch} …}` — tracking braces so
 * the words inside branch bodies are not mistaken for arguments.
 * Apostrophe quoting is ignored here (rare in practice).
 * ------------------------------------------------------------------- */

type Whitespace = ' ' | '\n' | '\t' | '\r';
type Trim<Value extends string> = Value extends `${Whitespace}${infer Rest}`
	? Trim<Rest>
	: Value extends `${infer Rest}${Whitespace}`
		? Trim<Rest>
		: Value;
type HasChar<
	Value extends string,
	Char extends string
> = Value extends `${string}${Char}${string}` ? true : false;

type ArgumentType<Kind extends string> = Kind extends
	'number' | 'plural' | 'selectordinal'
	? number
	: Kind extends 'date' | 'time'
		? Date | number
		: Kind extends 'select'
			? string
			: MessageValue;

type Branching = 'plural' | 'select' | 'selectordinal';

/** Parse the branches after `{name, plural,` up to the closing `}`. */
type ParseBranches<
	Source extends string,
	Params
> = Source extends `${infer Selector}{${infer Body}`
	? HasChar<Selector, '}'> extends true
		? Source extends `${string}}${infer After}`
			? [Params, After]
			: [Params, '']
		: ParseBody<Body, Params> extends [infer Next, infer Rest]
			? Rest extends string
				? ParseBranches<Rest, Next>
				: [Params, '']
			: [Params, '']
	: Source extends `${string}}${infer After}`
		? [Params, After]
		: [Params, ''];

/** Parse an argument; `Source` starts just after its `{`. */
type ParseArgument<
	Source extends string,
	Params
> = Source extends `${infer Head}}${infer After}`
	? HasChar<Head, ',' | '{'> extends false
		? [Params & Record<Trim<Head>, MessageValue>, After]
		: ParseTypedArgument<Source, Params>
	: [Params, ''];

type ParseTypedArgument<
	Source extends string,
	Params
> = Source extends `${infer Name},${infer Rest}`
	? Rest extends `${infer Kind},${infer Branches}`
		? Trim<Kind> extends Branching
			? ParseBranches<
					Branches,
					Params & Record<Trim<Name>, ArgumentType<Trim<Kind>>>
				>
			: ParseFormattedArgument<Name, Rest, Params>
		: ParseFormattedArgument<Name, Rest, Params>
	: [Params, ''];

/** `{name, number}` or `{name, date, short}` (a style never nests). */
type ParseFormattedArgument<
	Name extends string,
	Rest extends string,
	Params
> = Rest extends `${infer Kind}}${infer After}`
	? HasChar<Kind, ','> extends false
		? [Params & Record<Trim<Name>, ArgumentType<Trim<Kind>>>, After]
		: Rest extends `${infer StyledKind},${string}}${infer StyledAfter}`
			? [
					Params & Record<Trim<Name>, ArgumentType<Trim<StyledKind>>>,
					StyledAfter
				]
			: [Params, '']
	: [Params, ''];

/** Parse a branch body up to its closing `}`. */
type ParseBody<
	Source extends string,
	Params
> = Source extends `${infer Text}{${infer Inner}`
	? HasChar<Text, '}'> extends true
		? Source extends `${string}}${infer After}`
			? [Params, After]
			: [Params, '']
		: ParseArgument<Inner, Params> extends [infer Next, infer Rest]
			? Rest extends string
				? ParseBody<Rest, Next>
				: [Params, '']
			: [Params, '']
	: Source extends `${string}}${infer After}`
		? [Params, After]
		: [Params, ''];

type ParseMessage<
	Source extends string,
	Params
> = Source extends `${string}{${infer Inner}`
	? ParseArgument<Inner, Params> extends [infer Next, infer Rest]
		? Rest extends string
			? ParseMessage<Rest, Next>
			: Params
		: Params
	: Params;

type Flatten<Value> = { [K in keyof Value]: Value[K] } & {};

/** The parameters an ICU message string needs, e.g.
 *  `MessageParams<'{count, plural, one {# item} other {# items}}'>` is
 *  `{ count: number }`. */
export type MessageParams<Message extends string> = Flatten<
	ParseMessage<Message, Record<never, never>>
>;

/** The rest arguments `t(key, …)` takes for `Key`: nothing when the
 *  message has no arguments, the typed params object when it has. A
 *  catalog without literal types (JSON, or `MessageCatalog`) accepts any
 *  params. */
export type TranslateArgs<
	Catalog,
	Key extends string
> = string extends keyof Catalog
	? [params?: Record<string, MessageValue>]
	: LiteralTranslateArgs<MessageAt<Catalog, Key>>;

type LiteralTranslateArgs<Message> = Message extends string
	? string extends Message
		? [params?: Record<string, MessageValue>]
		: keyof MessageParams<Message> extends never
			? []
			: [params: MessageParams<Message>]
	: [params?: Record<string, MessageValue>];

export type Translate<Catalog> = <Key extends MessageKey<Catalog>>(
	key: Key,
	...args: TranslateArgs<Catalog, Key>
) => string;

export type TextDirection = 'ltr' | 'rtl';

/** What a page needs to translate on the server and hydrate in the
 *  browser: one locale's messages (optionally only some namespaces),
 *  already merged over the default locale's. Pass it as a page prop. */
export type I18nPayload<Locale extends string = string> = {
	locale: Locale;
	defaultLocale: Locale;
	dir: TextDirection;
	messages: MessageTree;
};

export type DateInput = Date | number | string;

export type Translator<Catalog = MessageCatalog> = {
	locale: string;
	dir: TextDirection;
	/** Format the message at `key` with its ICU parameters. A key missing
	 *  from the catalog renders as the key itself. */
	t: Translate<Catalog>;
	/** Whether the loaded catalog has a message at `key`. */
	has: (key: string) => boolean;
	formatNumber: (
		value: number | bigint,
		options?: Intl.NumberFormatOptions
	) => string;
	formatDate: (
		value: DateInput,
		options?: Intl.DateTimeFormatOptions
	) => string;
	formatRelativeTime: (
		value: number,
		unit: Intl.RelativeTimeFormatUnit,
		options?: Intl.RelativeTimeFormatOptions
	) => string;
	formatList: (
		items: readonly string[],
		options?: Intl.ListFormatOptions
	) => string;
};

/** `<link rel="alternate" hreflang="…" href="…">` in the document head. */
export type AlternateLink = {
	hreflang: string;
	href: string;
};

/** How the request's locale is chosen.
 *  - `prefix`: the first path segment (`/fr/about`); unprefixed paths are
 *    the default locale unless `prefixDefault` is set.
 *  - `domain`: the request host, mapped through `domains`.
 *  - `negotiate`: one URL for every locale; the locale cookie, then
 *    `Accept-Language`, then the default. */
export type LocaleStrategy = 'domain' | 'negotiate' | 'prefix';

/** The routing half of the config: everything needed to map paths and
 *  hosts to locales, shared by the server plugin and the sitemap. */
export type LocaleRoutingConfig<Locale extends string = string> = {
	locales: readonly Locale[];
	defaultLocale: Locale;
	/** Default `prefix`. */
	strategy?: LocaleStrategy;
	/** `prefix` only: put the default locale under its prefix too
	 *  (`/en/about`). Unprefixed paths then negotiate. Default `false`. */
	prefixDefault?: boolean;
	/** `domain` only: locale → host (`{ fr: 'example.fr' }`). */
	domains?: Partial<Record<Locale, string>>;
};

/** A non-default locale's catalog: the object itself, a module whose
 *  default export is it, or a loader returning either (lazy). */
export type MessageSource<Source> =
	| Translation<Source>
	| (() =>
			| Translation<Source>
			| { default: Translation<Source> }
			| Promise<Translation<Source> | { default: Translation<Source> }>);

export type I18nConfig<
	Locale extends string,
	Default extends Locale,
	Catalog extends MessageCatalog
> = Omit<LocaleRoutingConfig<Locale>, 'defaultLocale' | 'domains'> & {
	/** One of `locales`. */
	defaultLocale: Default;
	/** `domain` only: locale → host (`{ fr: 'example.fr' }`). */
	domains?: Partial<Record<NoInfer<Locale>, string>>;
	/** The default locale's catalog: the source of truth for keys and
	 *  parameter types, and the fallback for any other locale. */
	messages: Catalog;
	/** Every other locale's catalog, loaded on first use. */
	loaders: Record<Exclude<Locale, Default>, MessageSource<NoInfer<Catalog>>>;
	/** Cookie that remembers a visitor's choice (read by `negotiate` and
	 *  by unprefixed paths under `prefixDefault`). Default `locale`. */
	cookieName?: string;
	/** Route param that carries the locale (`/:locale/about`). A request
	 *  whose param is not a configured locale gets a 404. Default `locale`. */
	localeParam?: string;
	/** `prefix` + `prefixDefault` only: redirect unprefixed page
	 *  navigations to the negotiated locale's prefix. Default `false`. */
	redirect?: boolean;
	/** Origin for absolute hreflang URLs (`https://example.com`). Default:
	 *  the request's origin. */
	baseUrl?: string;
};

/** Where a request's locale came from. */
export type LocaleSource = 'cookie' | 'default' | 'domain' | 'header' | 'path';

export type LocaleResolution<Locale extends string = string> = {
	locale: Locale;
	source: LocaleSource;
};

/** What `defineI18n(config)` returns: usable on its own (prerendering,
 *  scripts, tests) and the input to `i18nPlugin()`. */
export type I18nInstance<
	Locale extends string = string,
	Default extends Locale = Locale,
	Catalog extends MessageCatalog = MessageCatalog
> = {
	config: I18nConfig<Locale, Default, Catalog>;
	locales: readonly Locale[];
	defaultLocale: Default;
	isLocale: (value: unknown) => value is Locale;
	/** Which locale `request` is in, and why. */
	resolve: (request: Request) => LocaleResolution<Locale>;
	/** The locale's messages merged over the default locale's; loaded on
	 *  first use, then cached. */
	load: (locale: Locale) => Promise<MessageTree>;
	/** The hydration payload for `locale`, optionally only the given
	 *  top-level namespaces. */
	payload: (
		locale: Locale,
		namespaces?: readonly (keyof Catalog & string)[]
	) => Promise<I18nPayload<Locale>>;
	translator: (locale: Locale) => Promise<Translator<Catalog>>;
	/** hreflang alternates for `path`, absolute against `origin` (or the
	 *  configured `baseUrl`). */
	alternates: (path: string, origin: string) => AlternateLink[];
	localizePath: (path: string, locale: Locale) => string;
	/** A `Set-Cookie` value that remembers `locale`. */
	cookie: (locale: Locale) => string;
};

/** The `i18n` object `i18nPlugin()` puts on every request's context. */
export type RequestI18n<
	Locale extends string = string,
	Catalog extends MessageCatalog = MessageCatalog
> = Translator<Catalog> & {
	locale: Locale;
	source: LocaleSource;
	/** hreflang alternates for `path` (default: this request's path). */
	alternates: (path?: string) => AlternateLink[];
	/** `path` in `locale` (default: this request's locale). */
	localizePath: (path: string, locale?: Locale) => string;
	/** This locale's messages for hydration — pass it as a page prop.
	 *  Namespaces limit it to those top-level keys, so a page ships only
	 *  what it uses. */
	payload: (
		namespaces?: readonly (keyof Catalog & string)[]
	) => I18nPayload<Locale>;
};

/** Sitemap localization: every page is listed once per locale with
 *  `xhtml:link` alternates. Routes registered as `/:locale/…` or
 *  `/:locale?/…` are picked up under their unprefixed path. */
export type SitemapI18nConfig<Locale extends string = string> =
	LocaleRoutingConfig<Locale> & {
		/** Route param that carries the locale. Default `locale`. */
		localeParam?: string;
	};
