import { describe, expect, spyOn, test } from 'bun:test';
import { Elysia } from 'elysia';
import {
	canonicalPathname,
	pathnameProblems,
	translatePathname
} from '../../../src/i18n/pathnames';
import {
	alternateLinks,
	localizeHref,
	localizePath
} from '../../../src/i18n/routing';
import { createTranslator } from '../../../src/i18n/translator';
import { defineI18n } from '../../../src/plugins/i18n';
import { routingRules } from '../../../src/plugins/routingRules';
import {
	type LocalizedRoutingConfig,
	withPathnameRules
} from '../../../src/utils/i18nPathnameRules';
import { defineI18nRouting } from '../../../src/utils/i18nRoutingRef';

/* Localized pathnames: `/about` in English, `/fr/a-propos` in French. */

const routing = defineI18nRouting({
	defaultLocale: 'en',
	locales: ['en', 'fr', 'de'],
	pathnames: {
		'/about': { de: '/ueber-uns', fr: '/a-propos' },
		'/blog/:slug': { fr: '/articles/:slug' }
	}
});
const { pathnames } = routing;

describe('a route’s path, as a locale addresses it', () => {
	test('is the locale’s own, with the params carried over', () => {
		expect(translatePathname('/about', 'fr', pathnames)).toBe('/a-propos');
		expect(translatePathname('/blog/hello', 'fr', pathnames)).toBe(
			'/articles/hello'
		);
	});

	test('is the route’s own where the locale has none', () => {
		expect(translatePathname('/about', 'en', pathnames)).toBe('/about');
		expect(translatePathname('/blog/hello', 'de', pathnames)).toBe(
			'/blog/hello'
		);
		expect(translatePathname('/pricing', 'fr', pathnames)).toBe('/pricing');
	});

	test('and back', () => {
		expect(canonicalPathname('/a-propos', 'fr', pathnames)).toBe('/about');
		expect(canonicalPathname('/articles/hello', 'fr', pathnames)).toBe(
			'/blog/hello'
		);
		// Another locale's word is not this locale's address.
		expect(canonicalPathname('/a-propos', 'de', pathnames)).toBe(
			'/a-propos'
		);
	});
});

describe('links', () => {
	test('are written in the locale’s own words', () => {
		expect(localizePath('/about', 'fr', routing)).toBe('/fr/a-propos');
		expect(localizePath('/about', 'de', routing)).toBe('/de/ueber-uns');
		expect(localizePath('/about', 'en', routing)).toBe('/about');
		expect(localizeHref('/blog/hello?x=1#top', 'fr', routing)).toBe(
			'/fr/articles/hello?x=1#top'
		);
	});

	test('go from one locale’s address to another’s, for a switcher', () => {
		expect(localizePath('/fr/a-propos', 'de', routing)).toBe(
			'/de/ueber-uns'
		);
		expect(localizePath('/fr/a-propos', 'en', routing)).toBe('/about');
		expect(localizePath('/fr/articles/hello', 'en', routing)).toBe(
			'/blog/hello'
		);
	});

	test('hreflang alternates use each locale’s address', () => {
		expect(alternateLinks('/about', routing, 'https://acme.test')).toEqual([
			{ href: 'https://acme.test/about', hreflang: 'en' },
			{ href: 'https://acme.test/fr/a-propos', hreflang: 'fr' },
			{ href: 'https://acme.test/de/ueber-uns', hreflang: 'de' },
			{ href: 'https://acme.test/about', hreflang: 'x-default' }
		]);
	});
});

/* The table has to reach the translator a page is handed, in the
 * payload: `href()` there is the link an author writes. */
describe('href() on a translator', () => {
	test('writes the locale’s own address, after the payload is serialized', async () => {
		const i18n = defineI18n({
			...routing,
			loaders: { de: { hello: 'Hallo' }, fr: { hello: 'Bonjour' } },
			messages: { hello: 'Hello' }
		});
		const sent: unknown = JSON.parse(
			JSON.stringify(await i18n.payload('fr'))
		);
		const { href } = createTranslator(
			sent as Awaited<ReturnType<typeof i18n.payload>>
		);

		expect(href('/blog/hello')).toBe('/fr/articles/hello');
		expect(href('/fr/a-propos', 'en')).toBe('/about');
	});
});

describe('a table that cannot be served', () => {
	test('is told why', () => {
		expect(
			pathnameProblems({
				'/blog/:slug': { fr: '/articles/:id' },
				'/ok': { fr: '/bien' },
				about: { fr: 'a-propos' }
			})
		).toEqual([
			'i18n.pathnames["/blog/:slug"].fr: "/articles/:id" must have the same params as "/blog/:slug".',
			'i18n.pathnames: "about" must start with "/".',
			'i18n.pathnames["about"].fr: "a-propos" must start with "/".'
		]);
	});

	test('adds no rules, and says so', () => {
		const spy = spyOn(console, 'log').mockImplementation(() => undefined);
		const config: LocalizedRoutingConfig = {
			i18n: { ...routing, pathnames: { '/a/:x': { fr: '/b/:y' } } }
		};
		const result = withPathnameRules(config);
		const said = spy.mock.calls.map((call) => String(call[0])).join('\n');
		spy.mockRestore();

		expect(result).toBe(config);
		expect(said).toContain('must have the same params');
	});
});

/* Requests, through the routing rules the table becomes. The app's
 * routes are registered once, at the route's own path. */
describe('requests', () => {
	const app = new Elysia();
	app.use(
		routingRules(withPathnameRules({ i18n: routing }), {
			dispatch: (request) => app.handle(request)
		})
	)
		.get(
			'/:locale?/about',
			({ params }) => `about:${params.locale ?? 'en'}`
		)
		.get(
			'/:locale?/blog/:slug',
			({ params }) => `post:${params.locale ?? 'en'}:${params.slug}`
		);
	const ask = (path: string) =>
		app.handle(new Request(`http://localhost${path}`));

	test('for a locale’s own address are served by the route', async () => {
		expect(await (await ask('/fr/a-propos')).text()).toBe('about:fr');
		expect(await (await ask('/de/ueber-uns')).text()).toBe('about:de');
		expect(await (await ask('/fr/articles/hello')).text()).toBe(
			'post:fr:hello'
		);
	});

	test('for the untranslated address are redirected to the locale’s own', async () => {
		const response = await ask('/fr/about?ref=mail');

		expect(response.status).toBe(308);
		expect(response.headers.get('location')).toBe('/fr/a-propos?ref=mail');
		expect((await ask('/fr/blog/hello')).headers.get('location')).toBe(
			'/fr/articles/hello'
		);
	});

	test('in a locale with no translation are served as they are', async () => {
		expect(await (await ask('/about')).text()).toBe('about:en');
		expect(await (await ask('/de/blog/hello')).text()).toBe(
			'post:de:hello'
		);
	});

	test('for another locale’s word are not this locale’s page', async () => {
		expect((await ask('/de/a-propos')).status).toBe(404);
	});
});

describe('a config', () => {
	test('with no table, or routing that is not by prefix, is left as it is', () => {
		const plain: LocalizedRoutingConfig = {
			i18n: { defaultLocale: 'en', locales: ['en', 'fr'] }
		};
		const spy = spyOn(console, 'log').mockImplementation(() => undefined);
		const negotiated: LocalizedRoutingConfig = {
			i18n: { ...routing, strategy: 'negotiate' }
		};
		const result = withPathnameRules(negotiated);
		spy.mockRestore();

		expect(withPathnameRules(plain)).toBe(plain);
		expect(result).toBe(negotiated);
	});

	test('keeps its own redirects and rewrites, ahead of the table’s', () => {
		const result = withPathnameRules({
			i18n: routing,
			redirects: [{ from: '/old', to: '/new' }],
			rewrites: [{ from: '/a', to: '/b' }]
		});

		expect(result.redirects?.[0]).toEqual({ from: '/old', to: '/new' });
		expect(result.rewrites?.[0]).toEqual({ from: '/a', to: '/b' });
		expect(result.redirects).toContainEqual({
			from: '/fr/about',
			to: '/fr/a-propos'
		});
		expect(result.rewrites).toContainEqual({
			from: '/fr/a-propos',
			to: '/fr/about'
		});
	});
});
