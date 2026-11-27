import type { MessageTree } from '../../types/i18n';

/* Which of a catalog's keys the project's source reads, and what a
 * locale's catalog would need added to hold every key.
 *
 * A key is read wherever a literal names it: `t('nav.home')` and its
 * relatives in script, `'nav.home' | t` in an Angular template, and
 * `data-i18n="nav.home"` / `data-i18n-attr="alt:nav.logo"` in an HTML
 * or HTMX page. That is found by reading the source as text, which is
 * right for a literal and cannot be for anything else:
 *
 *   - t(`nav.${section}`) reads some key under `nav.`; every key with
 *     that prefix is counted as read.
 *   - t(key) reads a key no scan can name. Those calls are counted, so
 *     a report of unused keys can say how sure it is.
 *
 * Reporting a key as unused because it is only reached through a
 * variable would teach people to ignore the report. */

/** What a body of source reads from a catalog. */
export type KeyUsage = {
	/** Calls whose key is not a literal and has no literal prefix. */
	dynamic: number;
	/** Keys named outright. */
	keys: Set<string>;
	/** Literal prefixes of keys built at run time. */
	prefixes: Set<string>;
};

const CALL = String.raw`(?:\$t|\bt|\.t|\bhas|\.has)\(\s*`;
const LITERAL_RE = new RegExp(
	`${CALL}(?:'([^'\\n]+)'|"([^"\\n]+)"|\`([^\`$\\n]+)\`)`,
	'g'
);
const TEMPLATE_RE = new RegExp(`${CALL}\`([^\`$\\n]*)\\$\\{`, 'g');
const VARIABLE_RE = new RegExp(`${CALL}[A-Za-z_$]`, 'g');
const PIPE_RE = /(['"])([\w.-]+)\1\s*\|\s*t\b/g;
const ATTRIBUTE_RE = /\bdata-i18n\s*=\s*(['"])([^'"]+)\1/g;
const ATTRIBUTES_RE = /\bdata-i18n-attr\s*=\s*(['"])([^'"]+)\1/g;

const captured = (source: string, pattern: RegExp) =>
	[...source.matchAll(pattern)].flatMap((match) =>
		match.slice(1).filter((group) => group !== undefined)
	);

/* `alt:nav.logo, title:nav.home` names two keys. */
const attributeKeys = (source: string) =>
	[...source.matchAll(ATTRIBUTES_RE)].flatMap(([, , list = '']) =>
		list.split(',').flatMap((pair) => {
			const key = pair.slice(pair.indexOf(':') + 1).trim();

			return pair.includes(':') && key !== '' ? [key] : [];
		})
	);

/** The keys one file's source reads. */
export const keyUsageOf = (source: string) => {
	const templates = captured(source, TEMPLATE_RE);
	const usage: KeyUsage = {
		dynamic:
			templates.filter((prefix) => prefix === '').length +
			[...source.matchAll(VARIABLE_RE)].length,
		keys: new Set([
			...captured(source, LITERAL_RE),
			...[...source.matchAll(PIPE_RE)].map(([, , key = '']) => key),
			...[...source.matchAll(ATTRIBUTE_RE)].map(([, , key = '']) => key),
			...attributeKeys(source)
		]),
		prefixes: new Set(templates.filter((prefix) => prefix !== ''))
	};

	return usage;
};

/** Several files' usage, as one. */
export const mergeKeyUsage = (usages: readonly KeyUsage[]) => {
	const merged: KeyUsage = {
		dynamic: usages.reduce((total, usage) => total + usage.dynamic, 0),
		keys: new Set(usages.flatMap((usage) => [...usage.keys])),
		prefixes: new Set(usages.flatMap((usage) => [...usage.prefixes]))
	};

	return merged;
};

/** The keys of a catalog that nothing in `usage` reads. */
export const unusedKeys = (keys: Iterable<string>, usage: KeyUsage) => {
	const prefixes = [...usage.prefixes];

	return [...keys].filter(
		(key) =>
			!usage.keys.has(key) &&
			!prefixes.some((prefix) => key.startsWith(prefix))
	);
};

type Filled = { added: string[]; tree: MessageTree };

const isTree = (
	value: string | MessageTree | undefined
): value is MessageTree => typeof value === 'object';

const fillKey = (
	filled: Filled,
	[key, source]: [string, string | MessageTree],
	locale: MessageTree,
	path: string
) => {
	const own = locale[key];
	const dotted = path === '' ? key : `${path}.${key}`;
	if (typeof source === 'string') {
		const next: Filled = {
			added: own === undefined ? [...filled.added, dotted] : filled.added,
			tree: { ...filled.tree, [key]: own ?? source }
		};

		return next;
	}
	const nested = fillFrom(source, isTree(own) ? own : {}, dotted);
	const next: Filled = {
		added: [...filled.added, ...nested.added],
		tree: { ...filled.tree, [key]: nested.tree }
	};

	return next;
};

const fillFrom = (
	source: MessageTree,
	locale: MessageTree,
	path: string
): Filled => {
	const filled = Object.entries(source).reduce<Filled>(
		(current, entry) => fillKey(current, entry, locale, path),
		{ added: [], tree: {} }
	);
	// What the locale has that the default does not is kept, after.
	const extra = Object.fromEntries(
		Object.entries(locale).filter(([key]) => !(key in source))
	);

	return { added: filled.added, tree: { ...filled.tree, ...extra } };
};

/** A locale's catalog with every key of the default's: a key it lacks
 *  is given the default's message, to be translated, and `added` names
 *  each one. Keys come out in the default's order, so two catalogs
 *  read side by side. */
export const fillCatalog = (
	defaultTree: MessageTree,
	localeTree: MessageTree
) => fillFrom(defaultTree, localeTree, '');
