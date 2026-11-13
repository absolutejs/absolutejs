/* Compile-time checks: `absolute typecheck` (tsc) fails if any
 * `@ts-expect-error` below stops being an error or a valid call breaks. The
 * runtime assertions only keep bun test honest about the values. */

import { describe, expect, test } from 'bun:test';
import { createTranslator } from '../../../src/i18n/translator';
import { defineMessages } from '../../../src/i18n/defineMessages';
import { defineI18n } from '../../../src/plugins/i18n';
import type {
	MessageKey,
	MessageParams,
	Translation
} from '../../../types/i18n';

const en = defineMessages({
	home: {
		greeting: 'Hello {name}',
		items: '{count, plural, =0 {none} one {# item} other {# items}}',
		mixed: '{gender, select, male {He} female {She} other {They}} posted on {when, date, short} ({n, number, integer})',
		nested: '{count, plural, one {{name} has one} other {{name} has #}}',
		plain: 'Welcome'
	},
	title: 'Absolute'
});

const fr: Translation<typeof en> = {
	home: {
		greeting: 'Bonjour {name}',
		items: '{count, plural, =0 {aucun} one {# article} other {# articles}}',
		mixed: '{gender, select, male {Il} female {Elle} other {Iel}} a publié le {when, date, short} ({n, number, integer})',
		nested: '{count, plural, one {{name} en a un} other {{name} en a #}}',
		plain: 'Bienvenue'
	},
	title: 'Absolute'
};

const missingKey: Translation<typeof en> = {
	// @ts-expect-error a locale missing a key is a type error
	home: { greeting: 'x' },
	title: 'x'
};

const keys: MessageKey<typeof en>[] = ['home.greeting', 'title'];
// @ts-expect-error not a key
const badKey: MessageKey<typeof en> = 'home.nope';
// @ts-expect-error a namespace is not a message
const namespaceKey: MessageKey<typeof en> = 'home';

const mixed: MessageParams<(typeof en)['home']['mixed']> = {
	gender: 'female',
	n: 2,
	when: new Date(0)
};
const branchWord: MessageParams<(typeof en)['home']['mixed']> = {
	...mixed,
	// @ts-expect-error branch words (He/She/They) are not parameters
	He: 'x'
};
// @ts-expect-error plural arguments are numbers
const wrongType: MessageParams<(typeof en)['home']['items']> = { count: '2' };

const { t } = createTranslator<typeof en>({
	defaultLocale: 'en',
	dir: 'ltr',
	locale: 'fr',
	messages: fr
});

describe('i18n types', () => {
	test('typed t() accepts exactly the declared parameters', () => {
		expect(t('home.plain')).toBe('Bienvenue');
		expect(t('home.greeting', { name: 'Ada' })).toBe('Bonjour Ada');
		expect(t('home.items', { count: 0 })).toBe('aucun');
		expect(t('home.nested', { count: 2, name: 'Ada' })).toBe('Ada en a 2');
		// @ts-expect-error missing params
		expect(t('home.greeting')).toBe('Bonjour {name}');
		// @ts-expect-error unknown key
		expect(t('home.missing')).toBe('home.missing');
		// @ts-expect-error a message without parameters takes none
		expect(t('home.plain', { x: 1 })).toBe('Bienvenue');
		expect(keys).toHaveLength(2);
		expect([
			missingKey,
			badKey,
			namespaceKey,
			branchWord,
			wrongType
		]).toHaveLength(5);
	});

	test('an untyped translator accepts any key and params', () => {
		const loose = createTranslator({
			defaultLocale: 'en',
			dir: 'ltr',
			locale: 'en',
			messages: { a: { b: 'Hi {name}' } }
		});
		expect(loose.t('a.b', { name: 'x' })).toBe('Hi x');
		expect(loose.t('a.b')).toBe('Hi {name}');
	});

	test('defineI18n requires a complete catalog for every locale', () => {
		const i18n = defineI18n({
			defaultLocale: 'en',
			loaders: { fr: () => ({ default: fr }) },
			locales: ['en', 'fr'],
			messages: en
		});
		expect(i18n.locales).toEqual(['en', 'fr']);
		defineI18n({
			defaultLocale: 'en',
			// @ts-expect-error fr is missing home.plain
			loaders: { fr: { home: { greeting: 'x' }, title: 'x' } },
			locales: ['en', 'fr'],
			messages: en
		});
		defineI18n({
			defaultLocale: 'en',
			// @ts-expect-error every non-default locale needs a loader
			loaders: {},
			locales: ['en', 'fr'],
			messages: en
		});
	});
});
