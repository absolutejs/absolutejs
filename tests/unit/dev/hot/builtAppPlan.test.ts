import { describe, expect, test } from 'bun:test';
import ts from 'typescript';
import { analyzeModule } from '../../../../src/dev/hot/analyze';

/* Which top-level statements the analyzer records as building an Elysia app
 * in place (`mutates`). When one of them re-runs, the runtime rebuilds the
 * app it names, because Elysia seals an app at its first request. */

const plan = (source: string) => {
	const result = analyzeModule(
		ts,
		'/virtual/entry.ts',
		source,
		() => undefined
	);
	if (!result.ok) throw new Error(result.reason);

	return result.plan;
};

describe('the analyzer records statements that build an app', () => {
	test('`.use(…)` and chains on a top-level app point at its declaration', () => {
		const entries = plan(
			[
				"import { Elysia } from 'elysia';",
				'const plugin = () => new Elysia();',
				'const app = new Elysia();',
				'app.use(plugin());',
				"app.get('/a', () => 'a').use(plugin());",
				'export const server = app.use(plugin());',
				''
			].join('\n')
		);
		// plan: [plugin, app, app.use, app.get…, server]
		expect(entries[0]?.mutates).toEqual([]);
		expect(entries[1]?.mutates).toEqual([]);
		expect(entries[2]?.mutates).toEqual([1]);
		expect(entries[3]?.mutates).toEqual([1]);
		expect(entries[4]?.mutates).toEqual([1]);
	});

	test('calls that are not Elysia builder methods are left alone', () => {
		const entries = plan(
			[
				'const db = createPool();',
				"db.execute('select 1');",
				'start();',
				'const rows = db.query();',
				''
			].join('\n')
		);
		for (const entry of entries) expect(entry.mutates).toEqual([]);
	});

	test('an app built inline in its own declaration is not a mutation of anything', () => {
		const entries = plan(
			[
				"import { Elysia } from 'elysia';",
				"const app = new Elysia().get('/', () => 'x').use(new Elysia());",
				''
			].join('\n')
		);
		expect(entries[0]?.mutates).toEqual([]);
	});
});
