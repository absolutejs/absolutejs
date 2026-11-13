import { describe, expect, test } from 'bun:test';
import {
	alternateLinks,
	localeDirection,
	localeFromPath,
	localizePath,
	negotiateLocale,
	parseAcceptLanguage,
	readCookie,
	stripLocalePrefix
} from '../../../src/i18n/routing';
import type { LocaleRoutingConfig } from '../../../types/i18n';

const LOCALES = ['en', 'fr', 'ar'] as const;
type Locale = (typeof LOCALES)[number];
const prefix: LocaleRoutingConfig<Locale> = {
	defaultLocale: 'en',
	locales: LOCALES
};

describe('Accept-Language negotiation', () => {
	test('orders tags by quality, then position', () => {
		expect(
			parseAcceptLanguage('fr-CH, fr;q=0.9, en;q=0.8, de;q=0.7, *;q=0.5')
		).toEqual(['fr-CH', 'fr', 'en', 'de']);
		expect(parseAcceptLanguage('en;q=0, fr')).toEqual(['fr']);
		expect(parseAcceptLanguage(null)).toEqual([]);
	});

	test('matches exactly, then by language, else the fallback', () => {
		expect(negotiateLocale(['fr-CA', 'en'], LOCALES, 'en')).toBe('fr');
		expect(negotiateLocale(['de', 'AR'], LOCALES, 'en')).toBe('ar');
		expect(negotiateLocale(['de'], LOCALES, 'en')).toBe('en');
		expect(negotiateLocale(['pt'], ['en', 'pt-BR'], 'en')).toBe('pt-BR');
	});

	test('reads a cookie', () => {
		expect(readCookie('a=1; locale=fr; b=2', 'locale')).toBe('fr');
		expect(readCookie('a=1', 'locale')).toBeUndefined();
	});
});

describe('text direction', () => {
	test('right-to-left languages and scripts', () => {
		expect(localeDirection('ar')).toBe('rtl');
		expect(localeDirection('he-IL')).toBe('rtl');
		expect(localeDirection('fa')).toBe('rtl');
		expect(localeDirection('ur')).toBe('rtl');
		expect(localeDirection('en')).toBe('ltr');
		expect(localeDirection('fr-CA')).toBe('ltr');
		expect(localeDirection('az-Arab')).toBe('rtl');
	});
});

describe('locale prefixes', () => {
	test('finds and strips the locale segment', () => {
		expect(localeFromPath('/fr/about', LOCALES)).toBe('fr');
		expect(localeFromPath('/about', LOCALES)).toBeUndefined();
		expect(localeFromPath('/french', LOCALES)).toBeUndefined();
		expect(stripLocalePrefix('/fr/about', LOCALES)).toBe('/about');
		expect(stripLocalePrefix('/fr', LOCALES)).toBe('/');
	});

	test('localizePath keeps the default locale unprefixed', () => {
		expect(localizePath('/about', 'fr', prefix)).toBe('/fr/about');
		expect(localizePath('/fr/about', 'ar', prefix)).toBe('/ar/about');
		expect(localizePath('/fr/about', 'en', prefix)).toBe('/about');
		expect(localizePath('/', 'fr', prefix)).toBe('/fr');
		expect(
			localizePath('/about', 'en', { ...prefix, prefixDefault: true })
		).toBe('/en/about');
		expect(
			localizePath('/about', 'fr', { ...prefix, strategy: 'negotiate' })
		).toBe('/about');
	});
});

describe('hreflang alternates', () => {
	test('prefix strategy: one link per locale plus x-default', () => {
		expect(
			alternateLinks('/fr/about', prefix, 'https://example.com/')
		).toEqual([
			{ href: 'https://example.com/about', hreflang: 'en' },
			{ href: 'https://example.com/fr/about', hreflang: 'fr' },
			{ href: 'https://example.com/ar/about', hreflang: 'ar' },
			{ href: 'https://example.com/about', hreflang: 'x-default' }
		]);
	});

	test('domain strategy uses each locale host', () => {
		const links = alternateLinks(
			'/about',
			{
				...prefix,
				domains: { en: 'example.com', fr: 'example.fr' },
				strategy: 'domain'
			},
			'http://localhost:3000'
		);
		expect(links).toEqual([
			{ href: 'http://example.com/about', hreflang: 'en' },
			{ href: 'http://example.fr/about', hreflang: 'fr' },
			{ href: 'http://example.com/about', hreflang: 'x-default' }
		]);
	});

	test('negotiate strategy has no alternates (one URL)', () => {
		expect(
			alternateLinks(
				'/about',
				{ ...prefix, strategy: 'negotiate' },
				'https://x'
			)
		).toEqual([]);
	});
});
