import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { absoluteRequestContext } from '../../../src/core/requestContext';
import { defineMessages } from '../../../src/i18n/defineMessages';
import { defineI18n, i18nPlugin } from '../../../src/plugins/i18n';
import { htmlLangAttributes } from '../../../src/utils/localeRef';
import type { MessageCatalog, Translation } from '../../../types/i18n';

const en = defineMessages({
	about: { title: 'About {site}' },
	common: {
		greeting: 'Hello',
		items: '{count, plural, one {# item} other {# items}}'
	}
});

const fr: Translation<typeof en> = {
	about: { title: 'À propos de {site}' },
	common: {
		greeting: 'Bonjour',
		items: '{count, plural, one {# article} other {# articles}}'
	}
};

const ar: Translation<typeof en> = {
	about: { title: 'حول {site}' },
	common: {
		greeting: 'مرحبا',
		items: '{count, plural, zero {لا عناصر} one {عنصر واحد} two {عنصران} few {# عناصر} many {# عنصرًا} other {# عنصر}}'
	}
};

const createI18n = (
	overrides: Partial<{
		prefixDefault: boolean;
		redirect: boolean;
		strategy: 'domain' | 'negotiate' | 'prefix';
	}> = {}
) => {
	const loads: string[] = [];
	const i18n = defineI18n({
		defaultLocale: 'en',
		domains: { en: 'example.com', fr: 'example.fr' },
		loaders: {
			ar: () => {
				loads.push('ar');

				return { default: ar };
			},
			fr: async () => {
				loads.push('fr');

				return { default: fr };
			}
		},
		locales: ['en', 'fr', 'ar'],
		messages: en,
		...overrides
	});

	return { i18n, loads };
};

const createApp = (i18n: ReturnType<typeof createI18n>['i18n']) =>
	new Elysia()
		.use(absoluteRequestContext)
		.use(i18nPlugin(i18n))
		.get('/:locale?/about', ({ i18n: ctx, locale }) => ({
			alternates: ctx.alternates(),
			dir: ctx.dir,
			greeting: ctx.t('common.greeting'),
			items: ctx.t('common.items', { count: 3 }),
			lang: htmlLangAttributes(),
			locale,
			payload: ctx.payload(['about']),
			source: ctx.source,
			title: ctx.t('about.title', { site: 'Absolute' })
		}))
		.get('/plain', ({ locale }) => locale);

const get = async (
	app: ReturnType<typeof createApp>,
	path: string,
	headers: Record<string, string> = {}
) => app.handle(new Request(`http://localhost${path}`, { headers }));

describe('i18nPlugin — prefix strategy', () => {
	test('unprefixed paths are the default locale', async () => {
		const { i18n } = createI18n();
		const response = await get(createApp(i18n), '/about');
		const body = await response.json();
		expect(body.locale).toBe('en');
		expect(body.source).toBe('default');
		expect(body.title).toBe('About Absolute');
		expect(body.items).toBe('3 items');
		expect(body.lang).toBe(' lang="en" dir="ltr"');
		expect(response.headers.get('content-language')).toBe('en');
	});

	test('a locale prefix selects the locale, lazily loading it once', async () => {
		const { i18n, loads } = createI18n();
		const app = createApp(i18n);
		const response = await get(app, '/fr/about');
		const body = await response.json();
		expect(body.locale).toBe('fr');
		expect(body.source).toBe('path');
		expect(body.title).toBe('À propos de Absolute');
		expect(body.items).toBe('3 articles');
		expect(response.headers.get('content-language')).toBe('fr');
		expect(response.headers.get('vary')).toBeNull();
		await get(app, '/fr/about');
		expect(loads).toEqual(['fr']);
	});

	test('RTL locale: dir, plural rules and the html lang attributes', async () => {
		const { i18n } = createI18n();
		const body = await (await get(createApp(i18n), '/ar/about')).json();
		expect(body.dir).toBe('rtl');
		expect(body.lang).toBe(' lang="ar" dir="rtl"');
		expect(body.items).toBe('3 عناصر');
	});

	test('payload carries only the requested namespaces', async () => {
		const { i18n } = createI18n();
		const body = await (await get(createApp(i18n), '/fr/about')).json();
		expect(body.payload).toEqual({
			defaultLocale: 'en',
			dir: 'ltr',
			locale: 'fr',
			messages: { about: { title: 'À propos de {site}' } }
		});
	});

	test('hreflang alternates are absolute, with x-default', async () => {
		const { i18n } = createI18n();
		const body = await (await get(createApp(i18n), '/fr/about')).json();
		expect(body.alternates).toEqual([
			{ href: 'http://localhost/about', hreflang: 'en' },
			{ href: 'http://localhost/fr/about', hreflang: 'fr' },
			{ href: 'http://localhost/ar/about', hreflang: 'ar' },
			{ href: 'http://localhost/about', hreflang: 'x-default' }
		]);
	});

	test('a :locale param that is not a locale is a 404', async () => {
		const { i18n } = createI18n();
		const response = await get(createApp(i18n), '/de/about');
		expect(response.status).toBe(404);
	});

	test('routes without a locale param still get the locale', async () => {
		const { i18n } = createI18n();
		const response = await get(createApp(i18n), '/plain');
		expect(await response.text()).toBe('en');
	});

	test('prefixDefault negotiates unprefixed paths and can redirect', async () => {
		const { i18n } = createI18n({ prefixDefault: true, redirect: true });
		const app = createApp(i18n);
		const redirect = await get(app, '/about?x=1', {
			accept: 'text/html',
			'accept-language': 'fr-CA,fr;q=0.9'
		});
		expect(redirect.status).toBe(307);
		expect(redirect.headers.get('location')).toBe('/fr/about?x=1');
		const cookieRedirect = await get(app, '/about', {
			accept: 'text/html',
			cookie: 'locale=ar'
		});
		expect(cookieRedirect.headers.get('location')).toBe('/ar/about');
		const asset = await get(app, '/plain', { accept: 'application/json' });
		expect(asset.status).toBe(200);
		expect(asset.headers.get('vary')).toBe('Accept-Language, Cookie');
	});
});

describe('i18nPlugin — negotiate and domain strategies', () => {
	test('negotiate: cookie, then Accept-Language, then default', async () => {
		const { i18n } = createI18n({ strategy: 'negotiate' });
		const app = createApp(i18n);
		const fromHeader = await (
			await get(app, '/about', { 'accept-language': 'ar,en;q=0.5' })
		).json();
		expect(fromHeader.locale).toBe('ar');
		expect(fromHeader.source).toBe('header');
		expect(fromHeader.alternates).toEqual([]);
		const fromCookie = await (
			await get(app, '/about', {
				'accept-language': 'ar',
				cookie: 'locale=fr'
			})
		).json();
		expect(fromCookie.locale).toBe('fr');
		expect(fromCookie.source).toBe('cookie');
		const response = await get(app, '/about');
		expect((await response.json()).locale).toBe('en');
		expect(response.headers.get('vary')).toBe('Accept-Language, Cookie');
	});

	test('domain: the host selects the locale', async () => {
		const { i18n } = createI18n({ strategy: 'domain' });
		const app = createApp(i18n);
		const body = await (
			await app.handle(new Request('https://example.fr/about'))
		).json();
		expect(body.locale).toBe('fr');
		expect(body.source).toBe('domain');
		expect(body.alternates).toContainEqual({
			href: 'https://example.fr/about',
			hreflang: 'fr'
		});
	});
});

describe('defineI18n', () => {
	test('missing keys in a locale fall back to the default catalog', async () => {
		const loose: MessageCatalog = {
			home: { extra: 'Only in English', title: 'Home' }
		};
		const i18n = defineI18n({
			defaultLocale: 'en',
			loaders: { fr: { home: { title: 'Accueil' } } },
			locales: ['en', 'fr'],
			messages: loose
		});
		const translator = await i18n.translator('fr');
		expect(translator.t('home.title')).toBe('Accueil');
		expect(translator.t('home.extra')).toBe('Only in English');
		expect(translator.t('home.missing')).toBe('home.missing');
		expect(i18n.cookie('fr')).toBe(
			'locale=fr; Path=/; Max-Age=31536000; SameSite=Lax'
		);
	});

	test('rejects a default locale outside locales', () => {
		expect(() =>
			defineI18n({
				// @ts-expect-error defaultLocale must be one of locales
				defaultLocale: 'de',
				loaders: { en: {} },
				locales: ['en'],
				messages: {}
			})
		).toThrow(/defaultLocale/);
	});
});
