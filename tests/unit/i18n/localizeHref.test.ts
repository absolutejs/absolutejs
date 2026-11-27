import { describe, expect, test } from 'bun:test';
import { localizeHref } from '../../../src/i18n/routing';
import { createTranslator } from '../../../src/i18n/translator';
import { defineI18n } from '../../../src/plugins/i18n';
import type { LocaleRoutingConfig } from '../../../types/i18n';

/* A link to the same page in a locale: what `href()` on a translator
 * returns, on the server and in the browser alike. */

const prefix: LocaleRoutingConfig = {
	defaultLocale: 'en',
	locales: ['en', 'fr', 'ar']
};

describe('under prefix routing', () => {
	test('adds the locale, and leaves the default locale without one', () => {
		expect(localizeHref('/about', 'fr', prefix)).toBe('/fr/about');
		expect(localizeHref('/about', 'en', prefix)).toBe('/about');
		expect(localizeHref('/', 'fr', prefix)).toBe('/fr');
	});

	test('swaps a locale the address already has', () => {
		expect(localizeHref('/fr/about', 'ar', prefix)).toBe('/ar/about');
		expect(localizeHref('/fr/about', 'en', prefix)).toBe('/about');
	});

	test('prefixes the default locale too when asked', () => {
		expect(
			localizeHref('/about', 'en', { ...prefix, prefixDefault: true })
		).toBe('/en/about');
	});

	test('keeps the query and the fragment', () => {
		expect(localizeHref('/blog?page=2#top', 'fr', prefix)).toBe(
			'/fr/blog?page=2#top'
		);
		expect(localizeHref('/#pricing', 'fr', prefix)).toBe('/fr#pricing');
	});
});

describe('an address that is not a page of this site', () => {
	test('is returned as it is', () => {
		for (const href of [
			'https://example.com/about',
			'//cdn.example.com/about',
			'mailto:hello@example.com',
			'#top',
			'about',
			'../about',
			'/logo.png',
			'/files/report.pdf?v=2'
		])
			expect(localizeHref(href, 'fr', prefix)).toBe(href);
	});
});

describe('under domain routing', () => {
	const domain: LocaleRoutingConfig = {
		...prefix,
		domains: { en: 'acme.com', fr: 'acme.fr' },
		strategy: 'domain'
	};

	test('a link to another locale goes to its host', () => {
		expect(localizeHref('/about?x=1', 'fr', domain, 'en')).toBe(
			'//acme.fr/about?x=1'
		);
	});

	test('a link to the current locale, or one with no host, stays', () => {
		expect(localizeHref('/about', 'en', domain, 'en')).toBe('/about');
		expect(localizeHref('/about', 'ar', domain, 'en')).toBe('/about');
	});
});

describe('under negotiate routing', () => {
	test('every locale shares one address', () => {
		expect(
			localizeHref('/about', 'fr', { ...prefix, strategy: 'negotiate' })
		).toBe('/about');
	});
});

describe('href() on a translator', () => {
	const i18n = defineI18n({
		defaultLocale: 'en',
		loaders: { fr: { hello: 'Bonjour' } },
		locales: ['en', 'fr'],
		messages: { hello: 'Hello' }
	});

	test('is for the page’s own locale, from the payload the page was sent', async () => {
		const french = createTranslator(await i18n.payload('fr'));
		const english = createTranslator(await i18n.payload('en'));

		expect(french.href('/about')).toBe('/fr/about');
		expect(english.href('/about')).toBe('/about');
	});

	test('can be for another locale, for a language switcher', async () => {
		const french = createTranslator(await i18n.payload('fr'));

		expect(french.href('/fr/about', 'en')).toBe('/about');
	});

	test('survives the payload being serialized into the page', async () => {
		const sent: unknown = JSON.parse(
			JSON.stringify(await i18n.payload('fr'))
		);
		const hydrated = createTranslator(
			sent as Awaited<ReturnType<typeof i18n.payload>>
		);

		expect(hydrated.href('/about')).toBe('/fr/about');
	});

	test('carries only what is not a default', async () => {
		expect((await i18n.payload('fr')).routing).toEqual({
			locales: ['en', 'fr']
		});
	});

	test('returns the path as given for a payload made by hand', () => {
		expect(
			createTranslator({
				defaultLocale: 'en',
				dir: 'ltr',
				locale: 'fr',
				messages: {}
			}).href('/about')
		).toBe('/about');
	});
});
