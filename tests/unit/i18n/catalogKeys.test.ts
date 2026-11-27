import { describe, expect, test } from 'bun:test';
import {
	fillCatalog,
	keyUsageOf,
	mergeKeyUsage,
	unusedKeys
} from '../../../src/i18n/catalogKeys';

/* Which keys the source reads, and what a locale's catalog lacks. */

describe('the keys a file reads', () => {
	test('are the literals passed to t, in every way it is called', () => {
		const { keys } = keyUsageOf(`
			const a = t('nav.home');
			const b = $t("nav.about");
			const c = i18n.t(\`nav.plain\`);
			if (has('nav.maybe')) {}
		`);

		expect([...keys].sort()).toEqual([
			'nav.about',
			'nav.home',
			'nav.maybe',
			'nav.plain'
		]);
	});

	test('include an Angular pipe’s and an HTML page’s attributes', () => {
		const { keys } = keyUsageOf(
			`<h1>{{ 'page.title' | t }}</h1><p data-i18n="page.body"></p><img data-i18n-attr="alt:page.logo, title:page.tip">`
		);

		expect([...keys].sort()).toEqual([
			'page.body',
			'page.logo',
			'page.tip',
			'page.title'
		]);
	});

	test('count a key built at run time by its literal prefix, or as unknown', () => {
		const usage = keyUsageOf(
			'const a = t(`blog.${kind}.title`); const b = t(key); const c = t(`${a}.x`);'
		);

		expect([...usage.prefixes]).toEqual(['blog.']);
		expect(usage.dynamic).toBe(2);
	});

	test('do not include a word that only ends in t', () => {
		expect([
			...keyUsageOf(`format('x'); submit("y"); post('z')`).keys
		]).toEqual([]);
	});
});

describe('the keys nothing reads', () => {
	test('are those not named and under no prefix', () => {
		const usage = mergeKeyUsage([
			keyUsageOf(`t('nav.home')`),
			keyUsageOf('t(`blog.${kind}`)')
		]);

		expect(
			unusedKeys(['nav.home', 'nav.old', 'blog.post', 'blog.list'], usage)
		).toEqual(['nav.old']);
	});
});

describe('a locale’s catalog, filled from the default’s', () => {
	test('gains each key it lacks, with the default’s message', () => {
		const { added, tree } = fillCatalog(
			{ nav: { about: 'About', home: 'Home' }, title: 'Acme' },
			{ nav: { home: 'Accueil' } }
		);

		expect(added).toEqual(['nav.about', 'title']);
		expect(tree).toEqual({
			nav: { about: 'About', home: 'Accueil' },
			title: 'Acme'
		});
	});

	test('comes out in the default’s order, its own extra keys after', () => {
		const { tree } = fillCatalog(
			{ a: 'A', b: 'B', c: 'C' },
			// Written out of order on purpose, as a file would be.
			JSON.parse('{"c":"c","legacy":"l","a":"a"}')
		);

		expect(Object.keys(tree)).toEqual(['a', 'b', 'c', 'legacy']);
	});

	test('with nothing missing adds nothing', () => {
		expect(fillCatalog({ a: 'A' }, { a: 'a' }).added).toEqual([]);
	});
});
