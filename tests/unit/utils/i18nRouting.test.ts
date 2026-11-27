import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Elysia } from 'elysia';
import { defineI18n, i18nPlugin } from '../../../src/plugins/i18n';
import { generateSitemap } from '../../../src/utils/generateSitemap';
import {
	currentI18nRouting,
	defineI18nRouting,
	i18nRoutingDifferences,
	setI18nRouting
} from '../../../src/utils/i18nRoutingRef';
import { withConfigI18n } from '../../../src/utils/sitemapI18n';
import type { I18nRoutingConfig } from '../../../types/i18n';

/* The config's `i18n`: the app's locale routing, declared where the
 * build and the CLI can read it, and compared with what `defineI18n`
 * was given. */

const routing = defineI18nRouting({
	defaultLocale: 'en',
	locales: ['en', 'fr']
});

afterEach(() => setI18nRouting(undefined));

const warnings = () => {
	const spy = spyOn(console, 'log').mockImplementation(() => undefined);

	return {
		restore: () => spy.mockRestore(),
		said: () => spy.mock.calls.map((call) => String(call[0]))
	};
};

describe('defineI18nRouting', () => {
	test('returns what it is given, for the config and defineI18n to share', () => {
		expect(routing).toEqual({ defaultLocale: 'en', locales: ['en', 'fr'] });

		const i18n = defineI18n({
			...routing,
			loaders: { fr: { hello: 'Bonjour' } },
			messages: { hello: 'Hello' }
		});

		expect(i18n.locales).toEqual(['en', 'fr']);
	});
});

describe('two declarations of the routing', () => {
	test('agree however they spell a default', () => {
		expect(
			i18nRoutingDifferences(routing, {
				...routing,
				localeParam: 'locale',
				prefixDefault: false,
				strategy: 'prefix'
			})
		).toEqual([]);
	});

	test('differ by the settings named', () => {
		expect(
			i18nRoutingDifferences(routing, {
				defaultLocale: 'fr',
				locales: ['en', 'fr', 'de'],
				strategy: 'negotiate'
			})
		).toEqual(['locales', 'defaultLocale', 'strategy']);
		expect(
			i18nRoutingDifferences(
				{ ...routing, domains: { fr: 'acme.fr' } },
				{ ...routing, domains: { fr: 'acme.be' } }
			)
		).toEqual(['domains']);
	});
});

describe('the sitemap’s locales', () => {
	test('are the config’s i18n when sitemap.i18n does not say', () => {
		expect(withConfigI18n(undefined, routing)).toEqual({ i18n: routing });
		expect(
			withConfigI18n({ baseUrl: 'https://acme.test' }, routing)
		).toEqual({ baseUrl: 'https://acme.test', i18n: routing });
		expect(withConfigI18n({ baseUrl: 'x' }, undefined)).toEqual({
			baseUrl: 'x'
		});
	});

	test('are sitemap.i18n when both say, with a warning if they differ', () => {
		const own: I18nRoutingConfig = {
			defaultLocale: 'en',
			locales: ['en', 'de']
		};
		const { restore, said } = warnings();
		const chosen = withConfigI18n({ i18n: own }, routing);
		const same = withConfigI18n({ i18n: { ...routing } }, routing);
		const messages = said();
		restore();

		expect(chosen?.i18n).toBe(own);
		expect(same?.i18n).toEqual(routing);
		expect(messages).toHaveLength(1);
		expect(messages[0]).toContain(
			'i18n and sitemap.i18n in the config disagree on locales'
		);
	});

	test('list a page once per locale from the config’s i18n alone', async () => {
		const out = mkdtempSync(join(tmpdir(), 'absolute-i18n-sitemap-'));
		await generateSitemap(
			[
				{
					handlerSource: 'handleReactPageRequest',
					method: 'GET',
					path: '/:locale?/about'
				}
			],
			'https://acme.test',
			out,
			withConfigI18n({ baseUrl: 'https://acme.test' }, routing)
		);
		const xml = readFileSync(join(out, 'sitemap.xml'), 'utf8');
		rmSync(out, { force: true, recursive: true });

		expect(xml).toContain('<loc>https://acme.test/about</loc>');
		expect(xml).toContain('<loc>https://acme.test/fr/about</loc>');
		expect(xml).toContain('hreflang="fr"');
	});
});

describe('the i18n plugin', () => {
	const french = () =>
		new Elysia()
			.use(
				i18nPlugin(
					defineI18n({
						...routing,
						loaders: { fr: { hello: 'Bonjour' } },
						messages: { hello: 'Hello' }
					})
				)
			)
			.get('/', () => 'ok');
	const german = () =>
		new Elysia()
			.use(
				i18nPlugin(
					defineI18n({
						defaultLocale: 'en',
						loaders: { de: { hello: 'Hallo' } },
						locales: ['en', 'de'],
						messages: { hello: 'Hello' }
					})
				)
			)
			.get('/', () => 'ok');

	const ask = async (app: {
		handle: (request: Request) => Promise<Response>;
	}) => {
		await app.handle(new Request('http://localhost/'));
		await app.handle(new Request('http://localhost/'));
	};

	test('says once when the config and defineI18n disagree', async () => {
		setI18nRouting(routing);
		const { restore, said } = warnings();
		await ask(german());
		const messages = said().filter((line) => line.includes('disagree'));
		restore();

		expect(messages).toHaveLength(1);
		expect(messages[0]).toContain(
			'i18n in the config and defineI18n() disagree on locales'
		);
	});

	test('says nothing when they agree, or when the config has none', async () => {
		const { restore, said } = warnings();
		setI18nRouting(routing);
		await ask(french());
		setI18nRouting(undefined);
		await ask(german());
		const messages = said().filter((line) => line.includes('disagree'));
		restore();

		expect(messages).toEqual([]);
		expect(currentI18nRouting()).toBeUndefined();
	});
});
