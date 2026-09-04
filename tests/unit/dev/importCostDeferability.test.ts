import { describe, expect, test } from 'bun:test';
import { analyzeEntryImports } from '../../../src/dev/importCost/deferability';

const verdicts = (source: string) =>
	Object.fromEntries(
		analyzeEntryImports(source, '/app/src/server.ts').map((item) => [
			item.specifier,
			item.verdict
		])
	);

describe('import-cost static safety check', () => {
	test('a bare import is never deferrable', () => {
		expect(
			verdicts('import "reflect-metadata";\n')['reflect-metadata']
		).toBe('side-effect import');
	});

	test('bindings used only inside function bodies are deferrable', () => {
		const source = `
			import { plugin } from './plugin';
			import { helper } from './helper';
			export const build = () => plugin(helper());
			export function other() { return helper(); }
		`;

		expect(verdicts(source)).toEqual({
			'./helper': 'deferrable',
			'./plugin': 'deferrable'
		});
	});

	test('a binding called at module scope is not deferrable', () => {
		const source = `
			import { makeApp } from './app';
			export const app = makeApp();
		`;

		expect(verdicts(source)['./app']).toBe('used at module scope');
	});

	test('a binding used in a decorator is not deferrable', () => {
		const source = `
			import { Injectable } from './di';
			@Injectable()
			class Service {}
			export const create = () => new Service();
		`;

		expect(verdicts(source)['./di']).toBe('used at module scope');
	});

	test('a method decorator on a top-level class is not deferrable', () => {
		const source = `
			import { Log } from './log';
			class Service {
				@Log()
				run() { return 1; }
			}
			export const create = () => new Service();
		`;

		expect(verdicts(source)['./log']).toBe('used at module scope');
	});

	test('a class field initializer is not deferrable', () => {
		const source = `
			import { makeStore } from './store';
			class Holder {
				store = makeStore();
			}
			export const create = () => new Holder();
		`;

		expect(verdicts(source)['./store']).toBe('used at module scope');
	});

	test('type-only imports never load and are reported as such', () => {
		const source = `
			import type { User } from './user';
			import { type Post } from './post';
			export const show = (user: User, post: Post) => [user, post];
		`;

		expect(verdicts(source)).toEqual({
			'./post': 'type-only',
			'./user': 'type-only'
		});
	});

	test('a value import used only in type position is still deferrable', () => {
		const source = `
			import { Schema } from './schema';
			export const make = (): typeof Schema => Schema;
			export type Alias = Schema;
		`;

		expect(verdicts(source)['./schema']).toBe('deferrable');
	});

	test('a re-exported binding is not deferrable', () => {
		const source = `
			import { token } from './token';
			export { token };
		`;

		expect(verdicts(source)['./token']).toBe('used at module scope');
	});

	test('an `export … from` is a runtime import that cannot move', () => {
		expect(verdicts('export { thing } from "./thing";\n')['./thing']).toBe(
			'used at module scope'
		);
	});

	test('a property named like the import does not count as a use', () => {
		const source = `
			import { auth } from './auth';
			export const config = { name: 'x' };
			export const shape = { auth: 1 };
			export const read = (value: { auth: number }) => value.auth + auth(0);
		`;

		expect(verdicts(source)['./auth']).toBe('deferrable');
	});

	test('a class inside a function defers its decorators with it', () => {
		const source = `
			import { Injectable } from './di';
			export const make = () => {
				@Injectable()
				class Inner {}

				return new Inner();
			};
		`;

		expect(verdicts(source)['./di']).toBe('deferrable');
	});

	test('a use inside a parameter default is deferred to call time', () => {
		const source = `
			import { fallback } from './fallback';
			export const read = (value = fallback()) => value;
		`;

		expect(verdicts(source)['./fallback']).toBe('deferrable');
	});

	test('the entry line number comes back for each import', () => {
		const analyzed = analyzeEntryImports(
			'import "a";\nimport { b } from "b";\n',
			'/app/src/server.ts'
		);

		expect(analyzed.map((item) => item.line)).toEqual([1, 2]);
	});
});
