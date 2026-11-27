import { describe, expect, spyOn, test } from 'bun:test';
import {
	localeRoutes,
	withStaticLocales
} from '../../../src/utils/staticLocales';
import type { StaticConfig } from '../../../types/build';
import type { I18nRoutingConfig } from '../../../types/i18n';

/* `static.locales`: each listed route, at every locale's address. */

const routing: I18nRoutingConfig = {
	defaultLocale: 'en',
	locales: ['en', 'fr'],
	pathnames: { '/about': { fr: '/a-propos' } }
};

describe('the routes to pre-render', () => {
	test('gain each locale’s address, in its own words', () => {
		expect(localeRoutes(['/about', '/pricing'], routing)).toEqual([
			{ asked: true, route: '/about' },
			{ asked: true, route: '/pricing' },
			{ asked: false, route: '/fr/a-propos' },
			{ asked: false, route: '/fr/pricing' }
		]);
	});

	test('keep a locale’s address that was listed outright as asked for', () => {
		expect(localeRoutes(['/about', '/fr/a-propos'], routing)).toEqual([
			{ asked: true, route: '/about' },
			{ asked: true, route: '/fr/a-propos' }
		]);
	});

	test('are as listed without locales', () => {
		expect(localeRoutes(['/about'], undefined)).toEqual([
			{ asked: true, route: '/about' }
		]);
		expect(localeRoutes(['/about'], false)).toEqual([
			{ asked: true, route: '/about' }
		]);
	});
});

describe('static.locales: true', () => {
	const config: StaticConfig = { locales: true, routes: ['/about'] };
	const quietly = <Result>(run: () => Result) => {
		const spy = spyOn(console, 'log').mockImplementation(() => undefined);
		const result = run();
		const said = spy.mock.calls.map((call) => String(call[0])).join('\n');
		spy.mockRestore();

		return { result, said };
	};

	test('stands for the config’s i18n', () => {
		expect(withStaticLocales(config, routing)).toEqual({
			locales: routing,
			routes: ['/about']
		});
	});

	test('is dropped, with the reason, when there is no i18n to stand for', () => {
		const { result, said } = quietly(() =>
			withStaticLocales(config, undefined)
		);

		expect(result).toEqual({ routes: ['/about'] });
		expect(said).toContain('the config has no i18n key');
	});

	test('is dropped under a strategy with one address for every locale', () => {
		const { result, said } = quietly(() =>
			withStaticLocales(config, { ...routing, strategy: 'negotiate' })
		);

		expect(result).toEqual({ routes: ['/about'] });
		expect(said).toContain('"prefix" i18n strategy');
	});

	test('leaves a config that does not ask alone', () => {
		const plain: StaticConfig = { routes: ['/about'] };

		expect(withStaticLocales(plain, routing)).toBe(plain);
		expect(withStaticLocales(undefined, routing)).toBeUndefined();
	});
});
