/* The names in a server module's `export const actions = { … }`.
 *
 * A route's named actions are registered by the generated route module,
 * one `.post()` each, and that module is written before anything is
 * run — so the names have to be read from the source, as the `action`
 * and `ssr` exports are. That is only possible when they are written
 * out, which is the rule: an object literal, its keys plain names.
 * Anything else is reported, with what to write instead, and never
 * guessed at: a name read wrong is a route registered under the wrong
 * address. */

const EXPORT_RE = /^[ \t]*export\s+const\s+actions\b([^=\n]*)=\s*/m;
const NAME_RE = /^[A-Za-z][A-Za-z0-9]*$/;
/* Comments, then string and template literals: what could hold a brace
 * or a comma that is not structure. */
const COMMENT_RE = /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;
const STRING_RE = /(['"`])(?:\\[\s\S]|(?!\1)[^\\])*\1/g;

const OPENERS = new Set(['{', '(', '[']);
const CLOSERS = new Set(['}', ')', ']']);

type Walk = {
	current: string;
	depth: number;
	/** The object's own closing brace has been reached. */
	done: boolean;
	parts: string[];
};

/* One character of the object literal's text, comments and strings
 * already blanked: the properties are what lies between commas at the
 * literal's own depth. */
const step = (walk: Walk, char: string): Walk => {
	if (walk.done) return walk;
	const depth =
		walk.depth + (OPENERS.has(char) ? 1 : 0) - (CLOSERS.has(char) ? 1 : 0);
	if (depth === 0)
		return {
			...walk,
			depth,
			done: true,
			parts: [...walk.parts, walk.current]
		};
	if (char === ',' && walk.depth === 1)
		return { ...walk, current: '', parts: [...walk.parts, walk.current] };
	// The literal's own opening brace is not part of a property.
	const current = walk.depth === 0 ? '' : walk.current + char;

	return { ...walk, current, depth };
};

const propertiesOf = (literal: string) =>
	Array.from(literal)
		.reduce<Walk>(step, { current: '', depth: 0, done: false, parts: [] })
		.parts.map((part) => part.trim())
		.filter((part) => part !== '');

/* `name: …`, or `name` alone. */
const keyOf = (property: string) => /^([^\s:(]+)\s*(?::|$)/.exec(property)?.[1];

const problemWith = (property: string) => {
	if (property.startsWith('...'))
		return `\`${property.split('\n')[0]}\` is spread in, so its actions cannot be read from the file. Write each action out as a property.`;
	const key = keyOf(property);
	if (key === undefined || !NAME_RE.test(key))
		return `\`${property.split(/[:\n(]/)[0]?.trim()}\` cannot be an action's name: it becomes a path segment (\`_name\`), so it has to be letters and digits, starting with a letter.`;

	return undefined;
};

export type NamedActions = { names: string[] } | { problem: string };

/** The named actions a server module's source exports; undefined when
 *  it exports none. */
export const namedActionsOf = (source: string) => {
	const exported = EXPORT_RE.exec(source);
	if (!exported) return undefined;
	const rest = source
		.slice(exported.index + exported[0].length)
		.replace(COMMENT_RE, '')
		.replace(STRING_RE, '""');
	if (!rest.startsWith('{')) {
		const result: NamedActions = {
			problem:
				'`actions` has to be an object written out here (`export const actions = { publish: defineAction(…) }`), so that its names can be read from the file.'
		};

		return result;
	}
	const properties = propertiesOf(rest);
	const [problem] = properties.flatMap(
		(property) => problemWith(property) ?? []
	);
	const result: NamedActions =
		problem === undefined
			? { names: properties.flatMap((property) => keyOf(property) ?? []) }
			: { problem };

	return result;
};
