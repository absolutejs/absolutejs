import { Elysia } from 'elysia';
import type {
	I18nConfig,
	I18nInstance,
	I18nPayload,
	LocaleResolution,
	MessageCatalog,
	MessageTree,
	RequestI18n
} from '../../types/i18n';
import { getCurrentAbsoluteRequest } from '../core/requestContext';
import {
	alternateLinks,
	localeDirection,
	localeFromPath,
	localizePath,
	matchLocale,
	negotiateLocale,
	parseAcceptLanguage,
	readCookie
} from '../i18n/routing';
import { createTranslator, isMessageTree } from '../i18n/translator';
import {
	registerRequestLocaleGetter,
	type RequestLocale
} from '../utils/localeRef';

/* Internationalization on the server.
 *
 *   export const i18n = defineI18n({
 *     locales: ['en', 'fr', 'ar'],
 *     defaultLocale: 'en',
 *     messages: en,
 *     loaders: { ar: () => import('./messages/ar'), fr: () => import('./messages/fr') }
 *   });
 *   new Elysia().use(absolutejs).use(i18nPlugin(i18n))
 *     .get('/:locale?/about', ({ i18n }) => handleReactPageRequest({
 *       …, props: { i18n: i18n.payload(['about']) }
 *     }));
 *
 * See docs/I18N_PLAN.md. */

const DEFAULT_COOKIE = 'locale';
const DEFAULT_PARAM = 'locale';
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/** An `import()` result, or a plain `{ default: catalog }` (a catalog
 *  whose only namespace is called `default` reads as the latter). */
const isModuleNamespace = (value: object) =>
	Reflect.get(value, Symbol.toStringTag) === 'Module' ||
	(Object.keys(value).length === 1 && 'default' in value);

/** A loaded catalog source: the catalog, or a module whose default export
 *  is it. */
const unwrapCatalog = (value: unknown) => {
	if (typeof value !== 'object' || value === null) return undefined;
	const candidate: unknown = isModuleNamespace(value)
		? Reflect.get(value, 'default')
		: value;

	return isMessageTree(candidate) ? candidate : undefined;
};

const mergeCatalogs = (fallback: MessageTree, primary: MessageTree) => {
	const merged: MessageTree = { ...fallback };
	for (const [key, value] of Object.entries(primary)) {
		const base = merged[key];
		merged[key] =
			typeof value === 'object' && typeof base === 'object'
				? mergeCatalogs(base, value)
				: value;
	}

	return merged;
};

const pickNamespaces = (
	messages: MessageTree,
	namespaces: readonly string[] | undefined
) => {
	if (!namespaces) return messages;
	const picked: MessageTree = {};
	for (const namespace of namespaces) {
		const value = messages[namespace];
		if (value !== undefined) picked[namespace] = value;
	}

	return picked;
};

const hostOf = (request: Request) => {
	const header = request.headers.get('host');
	const host = header ?? new URL(request.url).host;

	return host.replace(/:\d+$/, '').toLowerCase();
};

const appendVary = (current: unknown, values: string[]) => {
	const existing =
		typeof current === 'string'
			? current
					.split(',')
					.map((value) => value.trim())
					.filter(Boolean)
			: [];
	const lower = existing.map((value) => value.toLowerCase());
	const added = values.filter(
		(value) => !lower.includes(value.toLowerCase())
	);

	return [...existing, ...added].join(', ');
};

const resolveSourceValue = async (source: unknown) =>
	typeof source === 'function' ? source() : source;

export const defineI18n = <
	const Locale extends string,
	const Default extends Locale,
	const Catalog extends MessageCatalog
>(
	config: I18nConfig<Locale, Default, Catalog>
) => {
	const {
		cookieName = DEFAULT_COOKIE,
		defaultLocale,
		locales,
		messages
	} = config;
	const strategy = config.strategy ?? 'prefix';
	const defaultTree = unwrapCatalog(messages);
	if (!defaultTree)
		throw new Error(
			'[i18n] `messages` must be a catalog of nested string messages'
		);
	if (!locales.includes(defaultLocale))
		throw new Error(
			`[i18n] defaultLocale "${defaultLocale}" is not in locales`
		);
	const catalogs = new Map<string, Promise<MessageTree>>();
	catalogs.set(defaultLocale, Promise.resolve(defaultTree));

	const isLocale = (value: unknown): value is Locale =>
		typeof value === 'string' && locales.some((locale) => locale === value);

	const sourceFor = (locale: Locale) => {
		const entries = Object.entries(config.loaders);

		return entries.find(([key]) => key === locale)?.[1];
	};

	const loadCatalog = async (locale: Locale) => {
		const loaded = unwrapCatalog(
			await resolveSourceValue(sourceFor(locale))
		);
		if (!loaded) {
			console.warn(
				`[i18n] No catalog for locale "${locale}"; using "${defaultLocale}"`
			);

			return defaultTree;
		}

		return mergeCatalogs(defaultTree, loaded);
	};

	/** The locale's messages merged over the default locale's. Loaded on
	 *  first use, then cached. */
	const load = (locale: Locale) => {
		const existing = catalogs.get(locale);
		if (existing) return existing;
		const loading = loadCatalog(locale);
		catalogs.set(locale, loading);
		loading.catch(() => catalogs.delete(locale));

		return loading;
	};

	const negotiate = (request: Request) => {
		const cookie = readCookie(request.headers.get('cookie'), cookieName);
		const fromCookie =
			cookie === undefined ? undefined : matchLocale(cookie, locales);
		if (fromCookie !== undefined) {
			const resolution: LocaleResolution<Locale> = {
				locale: fromCookie,
				source: 'cookie'
			};

			return resolution;
		}
		const requested = parseAcceptLanguage(
			request.headers.get('accept-language')
		);
		const negotiated = negotiateLocale(requested, locales, defaultLocale);
		const resolution: LocaleResolution<Locale> = {
			locale: negotiated,
			source: requested.length > 0 ? 'header' : 'default'
		};

		return resolution;
	};

	const resolveDomain = (request: Request) => {
		const host = hostOf(request);
		const entries = Object.entries(config.domains ?? {});
		const match = entries.find(
			([, domain]) =>
				typeof domain === 'string' && domain.toLowerCase() === host
		)?.[0];
		if (!isLocale(match)) return negotiate(request);
		const resolution: LocaleResolution<Locale> = {
			locale: match,
			source: 'domain'
		};

		return resolution;
	};

	/** Which locale `request` is in, and why. */
	const resolve = (request: Request) => {
		if (strategy === 'negotiate') return negotiate(request);
		if (strategy === 'domain') return resolveDomain(request);
		const fromPath = localeFromPath(new URL(request.url).pathname, locales);
		if (fromPath !== undefined) {
			const resolution: LocaleResolution<Locale> = {
				locale: fromPath,
				source: 'path'
			};

			return resolution;
		}
		if (config.prefixDefault) return negotiate(request);
		const resolution: LocaleResolution<Locale> = {
			locale: defaultLocale,
			source: 'default'
		};

		return resolution;
	};

	/** The hydration payload for `locale`: its merged messages, optionally
	 *  only the given top-level namespaces. */
	const payload = async (
		locale: Locale,
		namespaces?: readonly (keyof Catalog & string)[]
	) => {
		const tree = await load(locale);
		const result: I18nPayload<Locale> = {
			defaultLocale,
			dir: localeDirection(locale),
			locale,
			messages: pickNamespaces(tree, namespaces)
		};

		return result;
	};

	const translator = async (locale: Locale) =>
		createTranslator<Catalog>(await payload(locale));

	/** A `Set-Cookie` value that remembers `locale`. */
	const cookie = (locale: Locale) =>
		`${cookieName}=${encodeURIComponent(locale)}; Path=/; Max-Age=${COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;

	const instance: I18nInstance<Locale, Default, Catalog> = {
		config,
		cookie,
		defaultLocale,
		isLocale,
		load,
		locales,
		payload,
		resolve,
		translator,
		alternates: (path, origin) =>
			alternateLinks(path, config, config.baseUrl ?? origin),
		localizePath: (path, locale) => localizePath(path, locale, config)
	};

	return instance;
};

const requestLocales = new WeakMap<Request, RequestLocale>();

/** The current request's locale, once `i18nPlugin()` resolved it. */
export const getRequestLocale = () => {
	const request = getCurrentAbsoluteRequest();

	return request ? requestLocales.get(request) : undefined;
};

const looksLikePageNavigation = (request: Request, pathname: string) => {
	if (request.method !== 'GET' && request.method !== 'HEAD') return false;
	const lastSegment = pathname.split('/').pop() ?? '';
	if (lastSegment.includes('.')) return false;
	if (pathname.startsWith('/__') || pathname.startsWith('/hmr')) return false;

	return (request.headers.get('accept') ?? '').includes('text/html');
};

/** Resolves every request's locale into the context as `locale` and
 *  `i18n` (a translator plus `payload()`, `alternates()` and
 *  `localizePath()`), sets `Content-Language`, and 404s a `:locale` route
 *  param that is not a configured locale. */
export const i18nPlugin = <
	const Locale extends string,
	const Default extends Locale,
	const Catalog extends MessageCatalog
>(
	i18n: I18nInstance<Locale, Default, Catalog>
) => {
	const { config } = i18n;
	const localeParam = config.localeParam ?? DEFAULT_PARAM;
	const shouldRedirect =
		config.redirect === true &&
		(config.strategy ?? 'prefix') === 'prefix' &&
		config.prefixDefault === true;
	registerRequestLocaleGetter(getRequestLocale);

	const redirectToLocale = (request: Request) => {
		const url = new URL(request.url);
		if (!looksLikePageNavigation(request, url.pathname)) return undefined;
		if (localeFromPath(url.pathname, i18n.locales) !== undefined)
			return undefined;
		const { locale } = i18n.resolve(request);
		const location = `${i18n.localizePath(url.pathname, locale)}${url.search}`;

		return new Response(null, {
			headers: { location, vary: 'Accept-Language, Cookie' },
			status: 307
		});
	};

	return new Elysia({
		name: 'absolutejs-i18n',
		seed: `${config.locales.join(',')}|${config.defaultLocale}`
	})
		.onRequest(({ request }) =>
			shouldRedirect ? redirectToLocale(request) : undefined
		)
		.derive('global', async ({ request, set }) => {
			const resolution = i18n.resolve(request);
			const { locale } = resolution;
			const requestPayload = await i18n.payload(locale);
			const translator = createTranslator<Catalog>(requestPayload);
			requestLocales.set(request, { dir: translator.dir, locale });
			set.headers['content-language'] = locale;
			if (resolution.source !== 'path' && resolution.source !== 'domain')
				set.headers['vary'] = appendVary(set.headers['vary'], [
					'Accept-Language',
					'Cookie'
				]);
			const url = new URL(request.url);
			const requestI18n: RequestI18n<Locale, Catalog> = {
				...translator,
				locale,
				source: resolution.source,
				alternates: (path = url.pathname) =>
					i18n.alternates(path, url.origin),
				localizePath: (path, target = locale) =>
					i18n.localizePath(path, target),
				payload: (namespaces) => ({
					...requestPayload,
					messages: pickNamespaces(
						requestPayload.messages,
						namespaces
					)
				})
			};

			return { i18n: requestI18n, locale };
		})
		.onBeforeHandle('global', ({ params, set }) => {
			const value: unknown =
				typeof params === 'object' && params !== null
					? Reflect.get(params, localeParam)
					: undefined;
			if (value === undefined || i18n.isLocale(value)) return undefined;
			set.status = 404;

			return 'Not Found';
		})
		.as('global');
};
