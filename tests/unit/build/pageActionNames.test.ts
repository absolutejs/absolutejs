import { describe, expect, test } from 'bun:test';
import { namedActionsOf } from '../../../src/build/pageActionNames';

/* Reading the names of a route's named actions from its server module's
 * source. They are registered from generated code, written before
 * anything runs, so they are read and never guessed at. */

const names = (source: string) => {
	const found = namedActionsOf(source);

	return found && 'names' in found ? found.names : found;
};

const problem = (source: string) => {
	const found = namedActionsOf(source);

	return found && 'problem' in found ? found.problem : undefined;
};

describe('the named actions a server module exports', () => {
	test('are the keys of its `actions` object', () => {
		expect(
			names(`import { defineAction } from '@absolutejs/absolute';

export const actions = {
	publish: defineAction(t.Object({ id: t.String() }), ({ body }) => body),
	remove: defineAction(t.Object({ id: t.String() }), () => ({ ok: true }))
};
`)
		).toEqual(['publish', 'remove']);
	});

	test('include a key written as shorthand', () => {
		expect(
			names(`const publish = defineAction(schema, handler);
const remove = defineAction(schema, handler);

export const actions = { publish, remove };
`)
		).toEqual(['publish', 'remove']);
	});

	/* What is inside an action is not a key of `actions`, however much
	 * it looks like one. */
	test('are not confused by what an action contains', () => {
		expect(
			names(`export const actions = {
	publish: defineAction(
		{ body: t.Object({ title: t.String(), tags: t.Array(t.String()) }), redirect: '/done' },
		({ body, fail }) => (body.title === '' ? fail({ title: 'a, b: c' }) : { ok: true, id: 1 })
	),
	// archive: not yet
	/* remove: defineAction(schema, handler), */
	rename: defineAction(schema, () => \`a, { b }\`)
};
`)
		).toEqual(['publish', 'rename']);
	});

	test('allow a type annotation and a trailing comma', () => {
		expect(
			names(`export const actions: Record<string, PageAction> = {
	publish: defineAction(schema, handler),
};
`)
		).toEqual(['publish']);
	});

	test('an empty object is none', () => {
		expect(names('export const actions = {};\n')).toEqual([]);
	});

	test('a module that exports no `actions` has none to speak of', () => {
		expect(
			namedActionsOf(
				'export const action = defineAction(schema, handler);\nexport const load = () => ({});\n'
			)
		).toBeUndefined();
		// A name that merely starts the same.
		expect(
			namedActionsOf('export const actionsTaken = 3;\n')
		).toBeUndefined();
	});
});

describe('named actions that cannot be read from the file', () => {
	test('an object that is not written out here', () => {
		expect(
			problem(
				"import { shared } from './shared';\n\nexport const actions = shared;\n"
			)
		).toContain('has to be an object written out here');
	});

	test('a spread', () => {
		expect(
			problem('export const actions = { ...shared, publish };\n')
		).toContain('is spread in');
	});

	/* The name becomes a path segment, `_name`. */
	test('a name that is not letters and digits', () => {
		expect(
			problem(
				"export const actions = { 'publish-now': defineAction(a, b) };\n"
			)
		).toContain("cannot be an action's name");
		expect(
			problem(
				'export const actions = { [dynamic]: defineAction(a, b) };\n'
			)
		).toContain("cannot be an action's name");
		expect(
			problem('export const actions = { _hidden: defineAction(a, b) };\n')
		).toContain("cannot be an action's name");
	});
});
