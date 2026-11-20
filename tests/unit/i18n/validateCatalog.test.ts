import { describe, expect, test } from 'bun:test';
import {
	compareCatalogs,
	findIcuIssues,
	flattenCatalog,
	messageArguments,
	validateCatalog
} from '../../../src/i18n/validateCatalog';

/* What no other gate catches. `absolute typecheck` checks a catalog the
 * type system can see — a loader typed `Translation<typeof en>` must
 * carry every key with the right parameters — but a catalog read at
 * runtime (`Bun.file('fr.json').json()`) is `any`, and nothing parses ICU
 * syntax. Both failures reach the visitor as template source: a message a
 * brace short renders as its own ICU, and `{count}` translated as `{n}`
 * renders the literal `{n}`. */

type Catalog = { home: Record<string, string> };

const english: Catalog = {
	home: {
		items: '{count, plural, one {# item} other {# items}}',
		sub: 'Subscribe',
		title: 'Welcome {name}'
	}
};

describe('flattenCatalog', () => {
	test('keys every message by its dotted path', () => {
		expect([...flattenCatalog(english).keys()]).toEqual([
			'home.items',
			'home.sub',
			'home.title'
		]);
	});
});

describe('messageArguments', () => {
	test('reads a plain placeholder', () => {
		expect([...messageArguments('Welcome {name}')]).toEqual(['name']);
	});

	test('reads the argument of a plural, not its options', () => {
		// `one` and `other` are option names, not arguments; only depth
		// one counts.
		expect([
			...messageArguments('{count, plural, one {# item} other {# items}}')
		]).toEqual(['count']);
	});

	test('reads several arguments, including a formatted one', () => {
		expect([
			...messageArguments('{name} spent {total, number, currency}')
		]).toEqual(['name', 'total']);
	});

	test('a message with no arguments takes none', () => {
		expect([...messageArguments('Subscribe')]).toEqual([]);
	});
});

describe('findIcuIssues', () => {
	test('reports a message a brace short', () => {
		const issues = findIcuIssues(
			new Map([
				['a', '{count, plural, one {# item} other {# items}'],
				['b', 'Welcome {name}']
			])
		);

		expect(issues.map((issue) => [issue.kind, issue.key])).toEqual([
			['icu', 'a']
		]);
		// The message is quoted in the detail, which is what makes it
		// findable in a catalog of hundreds.
		expect(issues[0]?.detail).toContain('{count, plural');
	});

	test('reports a stray closing brace', () => {
		expect(findIcuIssues(new Map([['a', 'Salut}']]))).toHaveLength(1);
	});

	test('passes a balanced catalog', () => {
		expect(findIcuIssues(flattenCatalog(english))).toEqual([]);
	});
});

describe('compareCatalogs', () => {
	const compare = (locale: Record<string, unknown>) =>
		compareCatalogs(
			flattenCatalog(english),
			flattenCatalog(locale as Parameters<typeof flattenCatalog>[0])
		);

	test('reports a key the locale never translated', () => {
		const issues = compare({
			home: {
				items: '{count, plural, one {# article} other {# articles}}',
				title: 'Bienvenue {name}'
			}
		});

		expect(issues.map((issue) => [issue.kind, issue.key])).toEqual([
			['missing', 'home.sub']
		]);
	});

	test('reports a renamed argument, which renders as literal text', () => {
		const issues = compare({
			home: {
				items: '{count, plural, one {# article} other {# articles}}',
				sub: 'Abonnez-vous',
				title: 'Bienvenue {nom}'
			}
		});

		expect(issues).toHaveLength(1);
		expect(issues[0]?.kind).toBe('mismatch');
		expect(issues[0]?.detail).toContain('takes nom');
		expect(issues[0]?.detail).toContain('default takes name');
	});

	test('reports a key the default does not have', () => {
		const issues = compare({
			home: {
				extra: 'Inutile',
				items: '{count, plural, one {# article} other {# articles}}',
				sub: 'Abonnez-vous',
				title: 'Bienvenue {name}'
			}
		});

		expect(issues.map((issue) => [issue.kind, issue.key])).toEqual([
			['extra', 'home.extra']
		]);
	});

	test('a faithful translation reports nothing', () => {
		expect(
			compare({
				home: {
					items: '{count, plural, one {# article} other {# articles}}',
					sub: 'Abonnez-vous',
					title: 'Bienvenue {name}'
				}
			})
		).toEqual([]);
	});
});

describe('validateCatalog', () => {
	test('reports a malformed message as malformed, not as a mismatch', () => {
		// A brace short also loses the argument, so the order of the two
		// passes decides whether the report says anything useful.
		const issues = validateCatalog(english, {
			home: {
				items: '{count, plural, one {# article} other {# articles}',
				sub: 'Abonnez-vous',
				title: 'Bienvenue {name}'
			}
		});
		const icu = issues.filter((issue) => issue.kind === 'icu');

		expect(icu.map((issue) => issue.key)).toEqual(['home.items']);
	});
});
