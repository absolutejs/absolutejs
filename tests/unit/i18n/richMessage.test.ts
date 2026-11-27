import { describe, expect, spyOn, test } from 'bun:test';
import { defineMessages } from '../../../src/i18n/defineMessages';
import {
	basicTags,
	formatRichMessage,
	messageTags,
	renderRichText
} from '../../../src/i18n/richMessage';
import { createTranslator } from '../../../src/i18n/translator';
import { validateCatalog } from '../../../src/i18n/validateCatalog';
import type { I18nPayload, RichTags } from '../../../types/i18n';

/* A message with tags in it, as HTML. What is trusted is what a tag
 * function returns, and nothing else. */

const tags: RichTags = {
	...basicTags,
	link: (text) => `<a href="/terms">${text}</a>`
};
const rich = (message: string, params: Record<string, unknown> = {}) =>
	formatRichMessage('en', message, params, tags);

describe('a tag', () => {
	test('becomes what its function returns, around what it holds', () => {
		expect(rich('Accept our <link>terms of service</link>.')).toBe(
			'Accept our <a href="/terms">terms of service</a>.'
		);
	});

	test('may hold another, and may close itself', () => {
		expect(rich('<link>Read <b>this</b></link><br/>now')).toBe(
			'<a href="/terms">Read <b>this</b></a><br>now'
		);
	});

	test('works inside a plural’s branches', () => {
		const message =
			'{count, plural, one {<b>#</b> item} other {<b>#</b> items}}';

		expect(rich(message, { count: 1 })).toBe('<b>1</b> item');
		expect(rich(message, { count: 3 })).toBe('<b>3</b> items');
	});

	test('with no function given becomes its text, and says so once', () => {
		const spy = spyOn(console, 'warn').mockImplementation(() => undefined);
		const first = rich('<nope>kept</nope>');
		const second = rich('<nope>again</nope>');
		const warnings = spy.mock.calls.length;
		spy.mockRestore();

		expect(first).toBe('kept');
		expect(second).toBe('again');
		expect(warnings).toBe(1);
	});
});

describe('what is not a tag', () => {
	test('is escaped: the message’s own text', () => {
		expect(rich('1 < 2 & "three" > \'two\'')).toBe(
			'1 &lt; 2 &amp; &quot;three&quot; &gt; &#39;two&#39;'
		);
	});

	test('is escaped: a parameter’s value', () => {
		expect(
			rich('Hello {name}', { name: '<img src=x onerror=alert(1)>' })
		).toBe('Hello &lt;img src=x onerror=alert(1)&gt;');
	});

	/* A value cannot stand in for one of the message's tags. */
	test('a tag arriving in a value is text, not the message’s tag', () => {
		expect(
			rich('Hello {name}, <link>terms</link>', {
				name: '<link>evil</link>'
			})
		).toBe(
			'Hello &lt;link&gt;evil&lt;/link&gt;, <a href="/terms">terms</a>'
		);
	});

	test('a closing tag that closes nothing, or one left open, is text', () => {
		expect(rich('a </b> c')).toBe('a &lt;/b&gt; c');
		expect(rich('a <b>bold')).toBe('a &lt;b&gt;bold');
		expect(rich('<link>x</b></link>')).toBe(
			'<a href="/terms">x&lt;/b&gt;</a>'
		);
	});

	test('a value still chooses a select’s branch', () => {
		expect(
			rich('{kind, select, pro {<b>Pro</b>} other {Free}}', {
				kind: 'pro'
			})
		).toBe('<b>Pro</b>');
	});
});

describe('renderRichText', () => {
	test('with no tags given is the escaped text', () => {
		expect(renderRichText('a & b', {})).toBe('a &amp; b');
	});
});

describe('html() on a translator', () => {
	const messages = defineMessages({
		plain: 'No tags & no params',
		terms: 'Hi {name}, accept our <link>terms</link>.'
	});
	const payload: I18nPayload = {
		defaultLocale: 'en',
		dir: 'ltr',
		locale: 'en',
		messages
	};
	const { html } = createTranslator<typeof messages>(payload);

	test('formats the message at a key', () => {
		expect(html('terms', tags, { name: 'Ada & co' })).toBe(
			'Hi Ada &amp; co, accept our <a href="/terms">terms</a>.'
		);
		expect(html('plain', tags)).toBe('No tags &amp; no params');
	});

	test('a missing key is its own name, escaped', () => {
		const spy = spyOn(console, 'warn').mockImplementation(() => undefined);
		const loose = createTranslator(payload);
		const result = loose.html('missing.<key>', tags);
		spy.mockRestore();

		expect(result).toBe('missing.&lt;key&gt;');
	});
});

describe('a translation’s tags, in absolute i18n check', () => {
	test('are named', () => {
		expect([...messageTags('<link>a</link> <b>b</b><br/>')]).toEqual([
			'link',
			'b',
			'br'
		]);
	});

	test('must be the default’s', () => {
		const issues = validateCatalog(
			{ ok: '<b>Fine</b>', terms: 'Accept <link>terms</link>' },
			{ ok: '<b>Bien</b>', terms: 'Acceptez <lien>les conditions</lien>' }
		);

		expect(issues).toEqual([
			{
				detail: 'uses the tags lien, the default uses link',
				key: 'terms',
				kind: 'mismatch'
			}
		]);
	});
});
