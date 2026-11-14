import { describe, expect, test } from 'bun:test';
import {
	dedupeVueResult,
	vueShimSource
} from '../../../src/cli/scripts/typecheck';
import {
	diagnosticKeys,
	withoutReported
} from '../../../src/cli/scripts/typecheckDiagnostics';

type CheckerResult = Parameters<typeof dedupeVueResult>[0][number];

const CWD = '/project';
const HOME_KEY = '/project/src/Home.tsx:2:33:TS2322';

describe('diagnosticKeys', () => {
	test('reads every format a checker prints', () => {
		const outputs = [
			"src/Home.tsx(2,33): error TS2322: Type 'number' is not assignable to type 'string'.",
			"\x1b[96msrc/Home.tsx\x1b[0m:\x1b[93m2\x1b[0m:\x1b[93m33\x1b[0m - \x1b[91merror\x1b[0m\x1b[90m TS2322: \x1b[0mType 'number' is not assignable to type 'string'.",
			'<error file="src/Home.tsx" line="2" column="33" code="TS2322">\nType \'number\' is not assignable to type \'string\'.\n</error>',
			"1 | const x = <Card title={42} />;\nerror: TS2322: Type 'number' is not assignable to type 'string'.\n    at src/Home.tsx:2:33"
		];

		for (const output of outputs)
			expect([...diagnosticKeys(output, CWD)]).toEqual([HOME_KEY]);
	});

	test('ignores lines that are not positioned errors', () => {
		expect(
			diagnosticKeys(
				'Found 2 errors in 2 files.\n  1  src/Home.tsx:2',
				CWD
			).size
		).toBe(0);
	});
});

describe('withoutReported', () => {
	const vueCheckOutput = [
		"src/Home.tsx(2,33): error TS2322: Type 'number' is not assignable to type 'string'.",
		"src/server.ts(11,78): error TS2322: Type 'string' is not assignable to type 'number'.",
		'  The expected type comes from property userId.'
	].join('\n');

	test('drops the errors already reported, with their continuation lines', () => {
		const result = withoutReported(
			vueCheckOutput,
			new Set([HOME_KEY]),
			CWD
		);

		expect(result.dropped).toBe(1);
		expect(result.remaining).toBe(1);
		expect(result.output).not.toContain('Home.tsx');
		expect(result.output).toContain('src/server.ts(11,78)');
		expect(result.output).toContain('property userId');
	});

	test('keeps output that is not a positioned error', () => {
		const result = withoutReported(
			'vue-check: Vue codegen failed (above), so the project was NOT type-checked.',
			new Set([HOME_KEY]),
			CWD
		);

		expect(result.dropped).toBe(0);
		expect(result.output).toContain('NOT type-checked');
	});
});

describe('dedupeVueResult', () => {
	const plain: CheckerResult = {
		exitCode: 1,
		name: 'bun check',
		output: '<error file="src/Home.tsx" line="2" column="33" code="TS2322">\n</error>'
	};

	test('vue-check reports only what bun check did not', () => {
		const [, vue] = dedupeVueResult([
			plain,
			{
				exitCode: 2,
				name: 'vue-check',
				output: [
					"src/Home.tsx(2,33): error TS2322: Type 'number' is not assignable to type 'string'.",
					"src/server.ts(11,78): error TS2322: Type 'string' is not assignable to type 'number'."
				].join('\n')
			}
		]);

		expect(vue?.exitCode).toBe(2);
		expect(vue?.output).toBe(
			"src/server.ts(11,78): error TS2322: Type 'string' is not assignable to type 'number'."
		);
	});

	test('vue-check passes when every error it found is already reported', () => {
		const [, vue] = dedupeVueResult([
			plain,
			{
				exitCode: 2,
				name: 'vue-check',
				output: "src/Home.tsx(2,33): error TS2322: Type 'number' is not assignable to type 'string'."
			}
		]);

		expect(vue?.exitCode).toBe(0);
	});

	test('a vue-check run that did not check still fails', () => {
		const crashed: CheckerResult = {
			exitCode: 3,
			name: 'vue-check',
			output: 'vue-check: the checker failed (above), so the project was NOT type-checked.'
		};

		expect(dedupeVueResult([plain, crashed])[1]).toEqual(crashed);
	});

	test('other checkers are left alone', () => {
		const svelte: CheckerResult = {
			exitCode: 1,
			name: 'svelte-check',
			output: "src/Home.tsx(2,33): error TS2322: Type 'number' is not assignable to type 'string'."
		};

		expect(dedupeVueResult([plain, svelte])[1]).toEqual(svelte);
	});
});

describe('vueShimSource', () => {
	test('declares each component file name once, never the bare *.vue pattern', () => {
		const source = vueShimSource([
			'Profile.vue',
			'About.vue',
			'Profile.vue'
		]);

		expect(source.match(/declare module/g)).toHaveLength(2);
		expect(source).toContain('declare module "*/About.vue"');
		expect(source).toContain('declare module "*/Profile.vue"');
		expect(source).not.toContain('"*.vue"');
	});
});
