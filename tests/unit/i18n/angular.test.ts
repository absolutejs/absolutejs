import { describe, expect, test } from 'bun:test';
import {
	Injector,
	LOCALE_ID,
	makeStateKey,
	runInInjectionContext,
	TransferState
} from '@angular/core';
import { resolve } from 'node:path';
import type { I18nPayload } from '../../../types/i18n';
import { handleAngularPageRequest } from '../../../src/angular';
import { registerRequestLocaleGetter } from '../../../src/utils/localeRef';
import {
	ABSOLUTE_I18N_PAYLOAD,
	injectI18n,
	provideAbsoluteI18n
} from '../../../src/angular/i18n';
import { ABSOLUTE_I18N } from '../../../src/angular/components/i18n.token';
import { TPipe } from '../../../src/angular/components/t.pipe';

/* Angular has no props channel, so the payload reaches the browser
 * through TransferState. These cover both call sites: the route that
 * provides a payload, and the bundled provider that hydrates from what
 * the route transferred. */

const payload: I18nPayload = {
	defaultLocale: 'en',
	dir: 'ltr',
	locale: 'fr',
	messages: {
		home: {
			items: '{count, plural, one {# article} other {# articles}}',
			title: 'Bonjour {name}'
		}
	}
};

/* The key a hydrating client reads. Spelled out here rather than
 * exported: a test that constructs it the way the browser does would
 * catch the key being renamed, which is a breaking change for a page
 * rendered by an older server. */
const STATE_KEY = makeStateKey<I18nPayload>('absolutejs.i18n');

const injectorWith = (
	providers: ReturnType<typeof provideAbsoluteI18n>,
	state = new TransferState()
) =>
	Injector.create({
		providers: [
			{ provide: TransferState, useValue: state },
			...providers.filter((provider) => 'provide' in provider)
		]
	});

describe('Angular i18n from the route', () => {
	test('provides the payload, a translator and LOCALE_ID', () => {
		const injector = injectorWith(provideAbsoluteI18n(payload));

		expect(injector.get(ABSOLUTE_I18N_PAYLOAD)).toEqual(payload);
		expect(
			injector.get(ABSOLUTE_I18N).t('home.title', { name: 'Ada' })
		).toBe('Bonjour Ada');
		// So Angular's own date, number and currency pipes format in the
		// same locale as the messages.
		expect(injector.get(LOCALE_ID)).toBe('fr');
	});

	test('injectI18n returns the full translator', () => {
		const injector = injectorWith(provideAbsoluteI18n(payload));
		const { dir, formatNumber, locale, t } = runInInjectionContext(
			injector,
			() => injectI18n()
		);

		expect(locale).toBe('fr');
		expect(dir).toBe('ltr');
		expect(t('home.items', { count: 2 })).toBe('2 articles');
		expect(formatNumber(1234.5)).toMatch(/1\s?234,5/u);
	});

	test('the t pipe translates with the provided messages', () => {
		const injector = injectorWith(provideAbsoluteI18n(payload));
		const pipe = runInInjectionContext(injector, () => new TPipe());

		expect(pipe.transform('home.title', { name: 'Ada' })).toBe(
			'Bonjour Ada'
		);
		expect(pipe.transform('home.items', { count: 1 })).toBe('1 article');
	});

	test('writes the payload into TransferState for the browser', () => {
		const state = new TransferState();
		const providers = provideAbsoluteI18n(payload);
		const initializers = providers.filter(
			(provider) =>
				'useValue' in provider &&
				typeof provider.useValue === 'function'
		);
		const injector = injectorWith(providers, state);
		// Angular runs these at bootstrap; a factory alone would only run
		// on first injection, and a page that never injects the token
		// would transfer nothing.
		initializers.forEach((provider) => {
			const run: unknown = Reflect.get(provider, 'useValue');
			if (typeof run !== 'function') return;
			const initialize: () => unknown = () => run();
			runInInjectionContext(injector, initialize);
		});

		expect(state.get(STATE_KEY, null)).toEqual(payload);
	});
});

describe('Angular i18n in the browser', () => {
	test('hydrates from what the route transferred', () => {
		const state = new TransferState();
		state.set(STATE_KEY, payload);
		const injector = injectorWith(provideAbsoluteI18n(), state);

		expect(injector.get(ABSOLUTE_I18N_PAYLOAD)).toEqual(payload);
		expect(injector.get(LOCALE_ID)).toBe('fr');
	});

	test('says what is missing when nothing was transferred', () => {
		const injector = injectorWith(provideAbsoluteI18n());

		// Not a silent fallback: the page would render its keys.
		expect(() => injector.get(ABSOLUTE_I18N_PAYLOAD)).toThrow(
			/provideAbsoluteI18n/
		);
	});
});

describe('the Angular document shell', () => {
	/* Angular emitted a bare `<html>`, as Vue did before beta.222: a
	 * screen reader announced every page in the browser's default
	 * language and an RTL locale rendered left to right. */
	const readShell = async () => {
		const response = await handleAngularPageRequest({
			headTag: '<head><title>Locale</title></head>',
			indexPath: '/angular-locale-index.js',
			pagePath: resolve(
				import.meta.dir,
				'../../fixtures/angular/streaming-page.ts'
			)
		});

		return response.text();
	};

	test('falls back to lang="en" with no request locale', async () => {
		registerRequestLocaleGetter(() => undefined);
		expect(await readShell()).toContain('<html lang="en">');
	});

	test('writes the request locale and its direction', async () => {
		registerRequestLocaleGetter(() => ({ dir: 'rtl', locale: 'ar' }));
		expect(await readShell()).toContain('<html lang="ar" dir="rtl">');
		registerRequestLocaleGetter(() => undefined);
	});
});
