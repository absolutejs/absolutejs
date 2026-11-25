import { describe, expect, test } from 'bun:test';
import {
	transformIslandRegistrySource,
	type IslandRegistryTransformInfo
} from '../../../src/build/islandRegistryTransform';

/* The transform that turns an island registry's raw component imports
 * into lazy `{ source, export }` definitions, so a host page of one
 * framework can be bundled without resolving another framework's
 * sources. It had no tests of its own. Written before the file was
 * restructured to pass the lint and run against the old version first,
 * so what is pinned here is what it did — whole outputs, byte for byte. */

const info = (
	definitions: IslandRegistryTransformInfo['definitions']
): IslandRegistryTransformInfo => ({
	definitions,
	resolvedRegistryPath: '/app/islands/registry.ts'
});

const react = (component: string, exportName?: string) => ({
	buildReference: {
		source: `../react/components/${component}`,
		...(exportName === undefined ? {} : { export: exportName })
	},
	component,
	framework: 'react' as const
});

const transform = (
	source: string,
	definitions: IslandRegistryTransformInfo['definitions'],
	filePath = '/app/islands/registry.ts'
) => transformIslandRegistrySource(source, filePath, info(definitions));

describe('transformIslandRegistrySource', () => {
	test('a shorthand entry becomes a definition and its import is dropped', () => {
		const source = `import { defineIslandRegistry } from '@absolutejs/absolute/islands';
import { Counter } from '../react/components/Counter';

export const registry = defineIslandRegistry({
	react: { Counter }
});
`;

		expect(transform(source, [react('Counter', 'Counter')])).toBe(
			`import { defineIslandRegistry } from '@absolutejs/absolute/islands';


export const registry = defineIslandRegistry({
	react: { Counter: { component: null, source: "../react/components/Counter", export: "Counter" } }
});
`
		);
	});

	test('a renamed entry keeps its key and replaces only the value', () => {
		const source = `import { defineIslandRegistry } from '../core/islands';
import CounterImpl from '../react/components/Counter';

export const registry = defineIslandRegistry({
	react: { 'my-counter': CounterImpl, Plain: CounterImpl }
});
`;

		expect(
			transform(source, [react('my-counter'), react('Plain', 'default')])
		).toBe(
			`import { defineIslandRegistry } from '../core/islands';


export const registry = defineIslandRegistry({
	react: { 'my-counter': { component: null, source: "../react/components/my-counter" }, Plain: { component: null, source: "../react/components/Plain", export: "default" } }
});
`
		);
	});

	test('the helper may be a namespace import', () => {
		const source = `import * as islands from '@absolutejs/absolute/islands';
import { Counter } from '../react/components/Counter';

export default islands.defineIslandRegistry({ react: { Counter } });
`;

		expect(transform(source, [react('Counter')])).toBe(
			`import * as islands from '@absolutejs/absolute/islands';


export default islands.defineIslandRegistry({ react: { Counter: { component: null, source: "../react/components/Counter" } } });
`
		);
	});

	/* An import is only dropped when EVERY name it binds was replaced. */
	test('an import with a binding still in use is kept whole', () => {
		const source = `import { defineIslandRegistry } from '@absolutejs/absolute/islands';
import { Counter, helper } from '../react/components/Counter';

helper();
export const registry = defineIslandRegistry({ react: { Counter } });
`;
		const output = transform(source, [react('Counter')]) ?? '';

		expect(output).toContain(
			"import { Counter, helper } from '../react/components/Counter';"
		);
		expect(output).toContain(
			'react: { Counter: { component: null, source: "../react/components/Counter" } }'
		);
	});

	test('entries with no build reference, and unknown frameworks, are left alone', () => {
		const source = `import { defineIslandRegistry } from '@absolutejs/absolute/islands';
import { Counter } from '../react/components/Counter';
import { Widget } from '../svelte/Widget.svelte';
import { Thing } from '../solid/Thing';

export const registry = defineIslandRegistry({
	react: { Counter },
	solid: { Thing },
	svelte: { Widget }
});
`;
		const output =
			transform(source, [
				react('Counter'),
				{
					buildReference: null,
					component: 'Widget',
					framework: 'svelte'
				}
			]) ?? '';

		expect(output).not.toContain("from '../react/components/Counter'");
		expect(output).toContain(
			"import { Widget } from '../svelte/Widget.svelte';"
		);
		expect(output).toContain("import { Thing } from '../solid/Thing';");
		expect(output).toContain('solid: { Thing }');
		expect(output).toContain('svelte: { Widget }');
	});

	test('values that are not plain identifiers are not touched', () => {
		const source = `import { defineIslandRegistry } from '@absolutejs/absolute/islands';
import { Counter } from '../react/components/Counter';
import { wrap } from './wrap';

export const registry = defineIslandRegistry({
	react: { Counter, Wrapped: wrap(Counter), ...extra }
});
`;
		const output =
			transform(source, [react('Counter'), react('Wrapped')]) ?? '';

		expect(output).toContain('Wrapped: wrap(Counter), ...extra');
		expect(output).toContain(
			'Counter: { component: null, source: "../react/components/Counter" }'
		);
	});

	test.each([
		['no registry call at all', 'export const value = 1;\n'],
		[
			'the name mentioned but not imported from the helper',
			"import { defineIslandRegistry } from './somewhere-else';\nexport const r = defineIslandRegistry({ react: { Counter } });\n"
		],
		[
			'a call whose argument is not an object literal',
			"import { defineIslandRegistry } from '@absolutejs/absolute/islands';\nexport const r = defineIslandRegistry(entries);\n"
		],
		[
			'nothing to replace',
			"import { defineIslandRegistry } from '@absolutejs/absolute/islands';\nimport { Other } from './Other';\nexport const r = defineIslandRegistry({ react: { Other } });\n"
		]
	])('returns null with %s', (_what, source) => {
		expect(transform(source, [react('Counter')])).toBeNull();
	});

	test('reads JSX in a .tsx registry', () => {
		const source = `import { defineIslandRegistry } from '@absolutejs/absolute/islands';
import { Counter } from '../react/components/Counter';

export const Preview = () => <div />;
export const registry = defineIslandRegistry({ react: { Counter } });
`;
		const output =
			transform(
				source,
				[react('Counter')],
				'/app/islands/registry.tsx'
			) ?? '';

		expect(output).toContain('export const Preview = () => <div />;');
		expect(output).not.toContain("from '../react/components/Counter'");
	});

	test('the first registry call in the file is the one transformed', () => {
		const source = `import { defineIslandRegistry } from '@absolutejs/absolute/islands';
import { A } from './A';
import { B } from './B';

export const first = defineIslandRegistry({ react: { A } });
export const second = defineIslandRegistry({ react: { B } });
`;
		const output = transform(source, [react('A'), react('B')]) ?? '';

		expect(output).toContain(
			'first = defineIslandRegistry({ react: { A: { component: null'
		);
		expect(output).toContain(
			'second = defineIslandRegistry({ react: { B } });'
		);
		expect(output).toContain("import { B } from './B';");
	});
});
