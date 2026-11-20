import { afterEach, describe, expect, test } from 'bun:test';
import { translateStaticHtml } from '../../../src/core/htmlI18n';
import {
	registerRequestLocaleGetter,
	registerRequestTranslateGetter
} from '../../../src/utils/localeRef';

/* A framework page translates in its components. An HTML page is a file —
 * the same bytes for every visitor — so the markup declares what to
 * translate and the server substitutes it on the way out. */

const MESSAGES: Record<string, string> = {
	'home.greeting': 'Bonjour {name}',
	'home.hero.alt': 'Une personne au travail',
	'home.hero.title': 'Notre équipe',
	'home.items': '{count, plural, one {# article} other {# articles}}',
	'home.title': 'Bienvenue'
};

const translate = (key: string, params?: Record<string, unknown>) => {
	const message = MESSAGES[key];
	if (!message) return key;
	const count = params?.count;
	const name = params?.name;

	return message
		.replace('{name}', typeof name === 'string' ? name : '')
		.replace(
			/\{count, plural[^}]*\}[^}]*\}\}/u,
			typeof count === 'number' && count === 1
				? '1 article'
				: `${String(count)} articles`
		);
};

const withRequestLocale = () => {
	registerRequestLocaleGetter(() => ({ dir: 'ltr', locale: 'fr' }));
	registerRequestTranslateGetter(() => translate);
};

afterEach(() => {
	registerRequestLocaleGetter(() => undefined);
	registerRequestTranslateGetter(() => undefined);
});

describe('translateStaticHtml', () => {
	test('replaces the element content, placeholder and all', async () => {
		withRequestLocale();
		const html = await translateStaticHtml(
			'<h1 data-i18n="home.title">Welcome</h1>'
		);

		// The placeholder is for whoever reads the file; what ships is the
		// message, never both.
		expect(html).toContain('>Bienvenue<');
		expect(html).not.toContain('Welcome');
	});

	test('passes ICU parameters from data-i18n-params', async () => {
		withRequestLocale();
		const html = await translateStaticHtml(
			`<p data-i18n="home.greeting" data-i18n-params='{"name":"Ada"}'></p>
<p data-i18n="home.items" data-i18n-params='{"count":2}'></p>`
		);

		expect(html).toContain('Bonjour Ada');
		expect(html).toContain('2 articles');
	});

	test('translates attributes, including several on one element', async () => {
		withRequestLocale();
		const html = await translateStaticHtml(
			'<img data-i18n-attr="alt:home.hero.alt, title:home.hero.title" src="/hero.webp">'
		);

		expect(html).toContain('alt="Une personne au travail"');
		expect(html).toContain('title="Notre équipe"');
		// And leaves the rest of the element alone.
		expect(html).toContain('src="/hero.webp"');
	});

	test('fills in <html lang dir>, which an HTML file cannot do itself', async () => {
		withRequestLocale();
		const html = await translateStaticHtml(
			'<!doctype html><html><body><p>hi</p></body></html>'
		);

		expect(html).toContain('<html lang="fr" dir="ltr">');
	});

	test("keeps an author's own lang", async () => {
		withRequestLocale();
		const html = await translateStaticHtml(
			'<html lang="cy"><body></body></html>'
		);

		// A single-locale page can still say what it is.
		expect(html).toContain('lang="cy"');
		expect(html).not.toContain('lang="fr"');
	});

	test('leaves the page untouched with no i18n plugin', async () => {
		const source =
			'<h1 data-i18n="home.title">Welcome</h1><html><body></body></html>';

		expect(await translateStaticHtml(source)).toBe(source);
	});

	test('a missing message renders its key, not an empty element', async () => {
		withRequestLocale();
		const html = await translateStaticHtml(
			'<p data-i18n="home.nope">placeholder</p>'
		);

		// Visible and searchable, which is how a missing key gets noticed.
		expect(html).toContain('>home.nope<');
	});

	test('a malformed params attribute costs the parameters, not the page', async () => {
		withRequestLocale();
		const html = await translateStaticHtml(
			`<p data-i18n="home.greeting" data-i18n-params='{"name":'></p>`
		);

		expect(html).toContain('Bonjour');
	});

	test('escapes what it substitutes', async () => {
		registerRequestLocaleGetter(() => ({ dir: 'ltr', locale: 'fr' }));
		registerRequestTranslateGetter(() => () => '<script>alert(1)</script>');
		const html = await translateStaticHtml('<p data-i18n="any"></p>');

		// A message is content, and a translator is not a template engine.
		expect(html).not.toContain('<script>');
		expect(html).toContain('&lt;script&gt;');
	});
});
