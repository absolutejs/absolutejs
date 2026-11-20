import type { MessageTree } from '../../types/i18n';

/* Checking a catalog against the one the types are built from.
 *
 * A broken message is not an error anywhere today — it reaches the
 * visitor as its own source:
 *
 *   '{count, plural, one {# article} other {# articles}'  (a brace short)
 *     renders as  {count, plural, one {# article} other {# articles}
 *   'Bonjour {name}' called without `name`
 *     renders as  Bonjour {name}
 *
 * `absolute typecheck` already covers a catalog the type system can see:
 * a loader typed `Translation<typeof en>` must carry every key with the
 * right parameters. It cannot see a catalog read at runtime —
 * `Bun.file('fr.json').json()` is `any` — and it does not parse ICU
 * syntax, so an unbalanced brace passes. That is what these checks are
 * for. */

export type CatalogIssue = {
	key: string;
	kind: 'extra' | 'icu' | 'mismatch' | 'missing';
	detail: string;
};

/** Every message in a catalog, keyed by its dotted path. */
export const flattenCatalog = (tree: MessageTree, prefix = '') => {
	const flat = new Map<string, string>();
	for (const [key, value] of Object.entries(tree)) {
		const path = prefix ? `${prefix}.${key}` : key;
		if (typeof value === 'string') flat.set(path, value);
		else if (value && typeof value === 'object')
			for (const [nested, message] of flattenCatalog(value, path))
				flat.set(nested, message);
	}

	return flat;
};

/* ICU argument names, and whether the braces balance.
 *
 * An argument is the identifier that opens a `{…}` group at the top
 * level: `{name}` and `{count, plural, …}` both contribute their first
 * token. Names inside a plural's options (`one {# article}`) are not
 * arguments, so only depth 1 is collected.
 *
 * Not handled, deliberately: ICU's apostrophe escaping (`'{'` as a
 * literal brace), which would read as an unbalanced brace here. A
 * message that needs a literal brace is rare enough to be worth a false
 * report rather than a parser. */
type ScanState = {
	balanced: boolean;
	capturing: boolean;
	current: string;
	depth: number;
	names: Set<string>;
};

/* One character at a time, as a fold: the `{`/`}`/`,` cases each return
 * the next state, which keeps this a flat set of branches rather than a
 * loop with nested conditionals. */
const stepScan = (state: ScanState, character: string): ScanState => {
	if (character === '{')
		return {
			...state,
			capturing: state.depth === 0,
			current: '',
			depth: state.depth + 1
		};
	if (character === '}') {
		const names =
			state.capturing && state.current.trim()
				? new Set([...state.names, state.current.trim()])
				: state.names;

		return {
			...state,
			balanced: state.balanced && state.depth > 0,
			capturing: false,
			depth: state.depth - 1,
			names
		};
	}
	if (!state.capturing) return state;
	if (character === ',')
		return {
			...state,
			capturing: false,
			names: state.current.trim()
				? new Set([...state.names, state.current.trim()])
				: state.names
		};

	return { ...state, current: state.current + character };
};

const scanMessage = (message: string) => {
	const state = [...message].reduce<ScanState>(stepScan, {
		balanced: true,
		capturing: false,
		current: '',
		depth: 0,
		names: new Set<string>()
	});

	return {
		balanced: state.balanced && state.depth === 0,
		names: state.names
	};
};

/** Messages whose braces do not balance, in any catalog. */
export const findIcuIssues = (flat: Map<string, string>) => {
	const issues: CatalogIssue[] = [];
	for (const [key, message] of flat) {
		if (scanMessage(message).balanced) continue;
		issues.push({
			detail: `unbalanced braces in ${JSON.stringify(message)}`,
			key,
			kind: 'icu'
		});
	}

	return issues;
};

/** The ICU argument names a message takes. */
export const messageArguments = (message: string) => scanMessage(message).names;

const sameArguments = (left: Set<string>, right: Set<string>) =>
	left.size === right.size && [...left].every((name) => right.has(name));

/* One key of the default catalog against the locale's. Returned as an
 * issue or undefined, so the caller stays a flat map/filter rather than a
 * loop with branches inside it. */
const compareKey = (
	key: string,
	message: string,
	translated: string | undefined
): CatalogIssue | undefined => {
	if (translated === undefined)
		return {
			detail: 'not translated; the default locale is served instead',
			key,
			kind: 'missing'
		};
	const expected = messageArguments(message);
	const actual = messageArguments(translated);
	if (sameArguments(expected, actual)) return undefined;

	return {
		detail: `takes ${[...actual].join(', ') || 'no arguments'}, the default takes ${[...expected].join(', ') || 'none'}`,
		key,
		kind: 'mismatch'
	};
};

/** A locale's catalog against the default's: keys it is missing, keys it
 *  adds, and keys whose ICU arguments differ — `{count}` translated as
 *  `{n}` formats as the literal text `{n}` for every visitor. */
export const compareCatalogs = (
	defaultFlat: Map<string, string>,
	localeFlat: Map<string, string>
) => {
	const compared = [...defaultFlat]
		.map(([key, message]) => compareKey(key, message, localeFlat.get(key)))
		.filter((issue) => issue !== undefined);
	const unused: CatalogIssue[] = [...localeFlat.keys()]
		.filter((key) => !defaultFlat.has(key))
		.map((key) => ({
			detail: 'not in the default locale, so nothing reads it',
			key,
			kind: 'extra'
		}));

	return [...compared, ...unused];
};

/** Everything wrong with one locale's catalog. `icu` and the comparison
 *  are separate passes so a malformed message is reported as malformed
 *  rather than as an argument mismatch it causes. */
export const validateCatalog = (
	defaultTree: MessageTree,
	localeTree: MessageTree
) => {
	const defaultFlat = flattenCatalog(defaultTree);
	const localeFlat = flattenCatalog(localeTree);

	return [
		...findIcuIssues(localeFlat),
		...compareCatalogs(defaultFlat, localeFlat)
	];
};
