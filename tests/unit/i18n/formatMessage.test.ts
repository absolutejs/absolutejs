import { describe, expect, test } from 'bun:test';
import { formatMessage, parseMessage } from '../../../src/i18n/formatMessage';

describe('formatMessage', () => {
	test('returns plain text untouched', () => {
		expect(formatMessage('en', 'Hello world')).toBe('Hello world');
	});

	test('substitutes simple arguments and formats numbers per locale', () => {
		expect(formatMessage('en', 'Hi {name}!', { name: 'Ada' })).toBe(
			'Hi Ada!'
		);
		expect(formatMessage('en', '{n} points', { n: 1234.5 })).toBe(
			'1,234.5 points'
		);
		expect(formatMessage('de', '{n} Punkte', { n: 1234.5 })).toBe(
			'1.234,5 Punkte'
		);
	});

	test('leaves a missing parameter visible', () => {
		expect(formatMessage('en', 'Hi {name}')).toBe('Hi {name}');
	});

	test('plural: exact matches, categories and #', () => {
		const message =
			'{count, plural, =0 {No items} one {# item} other {# items}}';
		expect(formatMessage('en', message, { count: 0 })).toBe('No items');
		expect(formatMessage('en', message, { count: 1 })).toBe('1 item');
		expect(formatMessage('en', message, { count: 1200 })).toBe(
			'1,200 items'
		);
	});

	test('plural uses the locale rules (Arabic few/many, French 0 is one)', () => {
		const arabic =
			'{n, plural, zero {z} one {o} two {t} few {f} many {m} other {x}}';
		expect(formatMessage('ar', arabic, { n: 3 })).toBe('f');
		expect(formatMessage('ar', arabic, { n: 11 })).toBe('m');
		expect(formatMessage('ar', arabic, { n: 2 })).toBe('t');
		expect(
			formatMessage('fr', '{n, plural, one {un} other {plusieurs}}', {
				n: 0
			})
		).toBe('un');
	});

	test('plural offset', () => {
		const message =
			'{guests, plural, offset:1 =0 {nobody} =1 {{host}} one {{host} and # other} other {{host} and # others}}';
		expect(formatMessage('en', message, { guests: 1, host: 'Ann' })).toBe(
			'Ann'
		);
		expect(formatMessage('en', message, { guests: 2, host: 'Ann' })).toBe(
			'Ann and 1 other'
		);
		expect(formatMessage('en', message, { guests: 5, host: 'Ann' })).toBe(
			'Ann and 4 others'
		);
	});

	test('selectordinal', () => {
		const message =
			'{n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}';
		expect(
			[1, 2, 3, 4, 11, 22].map((n) => formatMessage('en', message, { n }))
		).toEqual(['1st', '2nd', '3rd', '4th', '11th', '22nd']);
	});

	test('select with nested plural and arguments', () => {
		const message =
			'{gender, select, female {She has {count, plural, one {# cat} other {# cats}}} other {They have {count, plural, one {# cat} other {# cats}}}}';
		expect(
			formatMessage('en', message, { count: 1, gender: 'female' })
		).toBe('She has 1 cat');
		expect(formatMessage('en', message, { count: 3, gender: 'x' })).toBe(
			'They have 3 cats'
		);
	});

	test('number, date and time styles', () => {
		expect(formatMessage('en', '{p, number, percent}', { p: 0.25 })).toBe(
			'25%'
		);
		expect(formatMessage('en', '{n, number, integer}', { n: 3.7 })).toBe(
			'4'
		);
		expect(
			formatMessage('en', '{v, number, ::currency/EUR}', { v: 5 })
		).toBe('€5.00');
		const date = new Date(Date.UTC(2024, 0, 15, 12));
		expect(formatMessage('en', '{d, date, long}', { d: date })).toBe(
			new Intl.DateTimeFormat('en', { dateStyle: 'long' }).format(date)
		);
		expect(formatMessage('en', '{d, time, short}', { d: date })).toBe(
			new Intl.DateTimeFormat('en', { timeStyle: 'short' }).format(date)
		);
	});

	test('apostrophe quoting', () => {
		expect(formatMessage('en', "It''s {name}", { name: 'me' })).toBe(
			"It's me"
		);
		expect(formatMessage('en', "Use '{braces}' literally")).toBe(
			'Use {braces} literally'
		);
		expect(formatMessage('en', "Don't")).toBe("Don't");
		expect(
			formatMessage('en', "{n, plural, other {'#' is #}}", { n: 2 })
		).toBe('# is 2');
	});

	test('a malformed message renders as written instead of throwing', () => {
		expect(
			formatMessage('en', 'Broken {n, plural, one {x}', { n: 1 })
		).toBe('Broken {n, plural, one {x}');
		expect(() => parseMessage('{n, plural, one {x}}')).toThrow(/other/);
	});
});
