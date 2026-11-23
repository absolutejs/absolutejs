import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import {
	dedupeAngularResult,
	dedupeSvelteResult,
	dedupeVueResult,
	svelteCheckIncludes,
	vueShimSource
} from '../../../src/cli/scripts/typecheck';
import {
	diagnosticKeys,
	formatSvelteDiagnostics,
	parseSvelteCheckOutput,
	svelteCheckReport,
	svelteDiagnosticKey,
	withoutReported
} from '../../../src/cli/scripts/typecheckDiagnostics';

type CheckerResult = Parameters<typeof dedupeVueResult>[0][number];

const CWD = '/project';
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
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

describe('dedupeAngularResult', () => {
	const plain: CheckerResult = {
		exitCode: 1,
		name: 'bun check',
		output: '<error file="src/home.component.ts" line="9" column="2" code="TS2322">\n</error>'
	};
	// ngc prints paths relative to its config, in the cache directory.
	const cacheDir = join(process.cwd(), '.absolutejs');
	const tsError =
		"\x1b[96m../src/home.component.ts\x1b[0m:\x1b[93m9\x1b[0m:\x1b[93m2\x1b[0m - \x1b[91merror\x1b[0m\x1b[90m TS2322: \x1b[0mType 'number' is not assignable to type 'string'.\n\n9  name: string = 42;\n   ~~~~";
	const ngError =
		"../src/home.component.ts:6:4 - error NG8001: 'app-missing' is not a known element.";

	test('ngc passes when its only error is the plain checker’s', () => {
		const [, ngc] = dedupeAngularResult(
			[plain, { exitCode: 1, name: 'ngc', output: tsError }],
			cacheDir
		);

		expect(ngc?.exitCode).toBe(0);
	});

	test('ngc keeps an Angular error printed after a duplicate', () => {
		const [, ngc] = dedupeAngularResult(
			[
				plain,
				{ exitCode: 1, name: 'ngc', output: `${tsError}\n${ngError}` }
			],
			cacheDir
		);

		expect(ngc?.exitCode).toBe(1);
		expect(ngc?.output).toBe(ngError);
	});

	test('vue checkers are left to dedupeVueResult', () => {
		const vue: CheckerResult = {
			exitCode: 2,
			name: 'vue-check',
			output: 'src/home.component.ts(9,2): error TS2322: x'
		};

		expect(dedupeAngularResult([plain, vue], cacheDir)[1]).toEqual(vue);
	});
});

/* svelte-check 4's `--output machine-verbose`: positions are 0-based. */
const svelteLine = (event: Record<string, unknown>) =>
	`1794717769313 ${JSON.stringify(event)}`;
const FORMAT_TS_ERROR = svelteLine({
	code: 2322,
	end: { character: 13, line: 1 },
	filename: 'src/svelte/format.ts',
	message: "Type 'number' is not assignable to type 'string'.",
	start: { character: 1, line: 1 },
	type: 'ERROR'
});
const PAGE_TS_ERROR = svelteLine({
	code: 2322,
	end: { character: 11, line: 3 },
	filename: 'src/svelte/Home.svelte',
	message: "Type 'string' is not assignable to type 'number'.",
	source: 'ts',
	start: { character: 7, line: 3 },
	type: 'ERROR'
});
const PAGE_COMPILER_ERROR = svelteLine({
	code: 'attribute_duplicate',
	end: { character: 20, line: 5 },
	filename: 'src/svelte/Home.svelte',
	message: 'Attributes need to be unique',
	source: 'svelte',
	start: { character: 12, line: 5 },
	type: 'ERROR'
});
const svelteCheckOutput = (...events: string[]) =>
	[
		'1794717769312 START "/project"',
		...events,
		`1794717769313 COMPLETED 12 FILES ${events.length} ERRORS 1 WARNINGS 2 FILES_WITH_PROBLEMS`
	].join('\n');
const FORMAT_KEY = '/project/src/svelte/format.ts:2:2:TS2322';
const SOURCES: Record<string, string> = {
	'/project/src/svelte/Home.svelte':
		'<script lang="ts">\n\tlet { title }: { title: string } = $props();\n\n\tconst size: number = \'large\';\n</script>\n<h1 class="a" class="b">{title}</h1>\n'
};
const readSource = (file: string) => SOURCES[file] ?? null;

describe('parseSvelteCheckOutput', () => {
	test('reads errors, skips start and completion lines, keeps the rest', () => {
		const parsed = parseSvelteCheckOutput(
			svelteCheckOutput(
				FORMAT_TS_ERROR,
				svelteLine({
					code: 'a11y_missing_attribute',
					end: { character: 9, line: 6 },
					filename: 'src/svelte/Home.svelte',
					message: '<img> element should have an alt attribute',
					start: { character: 0, line: 6 },
					type: 'WARNING'
				}),
				'1794717769313 FAILURE "Cannot read tsconfig"',
				'node: some warning'
			)
		);

		expect(parsed.diagnostics).toHaveLength(1);
		expect(parsed.diagnostics[0]?.filename).toBe('src/svelte/format.ts');
		expect(parsed.failures).toEqual(['Cannot read tsconfig']);
		expect(parsed.other).toEqual(['node: some warning']);
	});
});

describe('svelteDiagnosticKey', () => {
	test('keys a TypeScript error 1-based, like the plain checker', () => {
		const [format, page] = parseSvelteCheckOutput(
			svelteCheckOutput(FORMAT_TS_ERROR, PAGE_TS_ERROR)
		).diagnostics;

		expect(format && svelteDiagnosticKey(format, CWD)).toBe(FORMAT_KEY);
		expect(page && svelteDiagnosticKey(page, CWD)).toBe(
			'/project/src/svelte/Home.svelte:4:8:TS2322'
		);
		expect(
			diagnosticKeys(
				'<error file="src/svelte/format.ts" line="2" column="2" code="TS2322">\n</error>',
				CWD
			)
		).toEqual(new Set([FORMAT_KEY]));
	});

	test('a Svelte compiler error has no key: no other checker reports it', () => {
		const [compiler] = parseSvelteCheckOutput(
			svelteCheckOutput(PAGE_COMPILER_ERROR)
		).diagnostics;

		expect(compiler && svelteDiagnosticKey(compiler, CWD)).toBeNull();
	});
});

describe('formatSvelteDiagnostics', () => {
	test('renders position, code, message and the underlined line', () => {
		const { diagnostics } = parseSvelteCheckOutput(
			svelteCheckOutput(PAGE_TS_ERROR, PAGE_COMPILER_ERROR)
		);
		const plain = formatSvelteDiagnostics(
			diagnostics,
			readSource,
			CWD
		).replace(ANSI, '');

		expect(plain).toBe(
			[
				"src/svelte/Home.svelte:4:8 - error TS2322: Type 'string' is not assignable to type 'number'.",
				'',
				"4 \tconst size: number = 'large';",
				'  \t      ~~~~',
				'',
				'src/svelte/Home.svelte:6:13 - error attribute_duplicate: Attributes need to be unique',
				'',
				'6 <h1 class="a" class="b">{title}</h1>',
				'              ~~~~~~~~',
				'',
				'Found 2 errors.'
			].join('\n')
		);
	});

	test('an unreadable file still gets its position and message', () => {
		const { diagnostics } = parseSvelteCheckOutput(
			svelteCheckOutput(FORMAT_TS_ERROR)
		);

		expect(
			formatSvelteDiagnostics(diagnostics, () => null, CWD).replace(
				ANSI,
				''
			)
		).toBe(
			"src/svelte/format.ts:2:2 - error TS2322: Type 'number' is not assignable to type 'string'.\n\nFound 1 error."
		);
	});
});

/* svelte-check reports accessibility findings as WARNINGS, which is why
 * they were invisible: `--threshold error` dropped them and the parser
 * dropped them again. */
const a11yWarning = (
	code: string,
	message: string,
	file = '/project/src/svelte/Home.svelte'
) =>
	`1794717769312 ${JSON.stringify({
		code,
		end: { character: 1, line: 4 },
		filename: file,
		message,
		source: 'svelte',
		start: { character: 1, line: 4 },
		type: 'WARNING'
	})}`;

const MISSING_ALT = a11yWarning(
	'a11y_missing_attribute',
	'`<img>` element should have an alt attribute\nhttps://svelte.dev/e/a11y_missing_attribute'
);
const OTHER_WARNING = a11yWarning(
	'state_referenced_locally',
	'This reference only captures the initial value'
);

describe('accessibility warnings', () => {
	test('are collected, and other warnings are not', () => {
		const { accessibility, diagnostics } = parseSvelteCheckOutput(
			svelteCheckOutput(MISSING_ALT, OTHER_WARNING)
		);

		expect(accessibility.map((entry) => entry.code)).toEqual([
			'a11y_missing_attribute'
		]);
		/* Errors are what fails a typecheck, and a warning is not one. */
		expect(diagnostics).toEqual([]);
	});

	/* The whole point: a project with accessibility warnings and no type
	 * errors still passes. A warning that fails a build is an error by
	 * another name, and adopting this version would turn a green project
	 * red on code it had not changed. */
	test('are reported without being counted as something that failed', () => {
		const report = svelteCheckReport(
			svelteCheckOutput(MISSING_ALT),
			new Set(),
			readSource,
			CWD
		);

		expect(report.remaining).toBe(0);
		expect(report.accessibilityOutput.replace(ANSI, '')).toContain(
			'1 accessibility warning'
		);
		expect(report.accessibilityOutput.replace(ANSI, '')).toContain(
			'src/svelte/Home.svelte:5:2'
		);
	});

	test('say which rule they came from', () => {
		const report = svelteCheckReport(
			svelteCheckOutput(MISSING_ALT),
			new Set(),
			readSource,
			CWD
		);

		expect(report.accessibilityOutput).toContain('a11y_missing_attribute');
	});

	/* The message carries a docs URL on a second line; one finding per
	 * line keeps the list scannable. */
	test('are one line each', () => {
		const report = svelteCheckReport(
			svelteCheckOutput(MISSING_ALT),
			new Set(),
			readSource,
			CWD
		);
		const body = report.accessibilityOutput
			.replace(ANSI, '')
			.split('\n')
			.slice(1);

		expect(body).toHaveLength(1);
		expect(body[0]).not.toContain('https://');
	});

	test('nothing is reported when there are none', () => {
		const report = svelteCheckReport(
			svelteCheckOutput(OTHER_WARNING),
			new Set(),
			readSource,
			CWD
		);

		expect(report.accessibilityOutput).toBe('');
	});

	/* svelte-check hands back a path already relativised against
	 * something else — `../../../../../users/you/project/src/…` — and on a
	 * case-insensitive filesystem it lowercases it too, so a plain
	 * `relative()` returns a climb out of the project instead of the path
	 * the developer typed. */
	test('a path svelte-check mangled is shown as the project sees it', () => {
		const report = svelteCheckReport(
			svelteCheckOutput(
				a11yWarning(
					'a11y_missing_attribute',
					'needs an alt',
					'../../../../../project/src/svelte/Home.svelte'
				)
			),
			new Set(),
			readSource,
			CWD
		);

		expect(report.accessibilityOutput.replace(ANSI, '')).toContain(
			'src/svelte/Home.svelte'
		);
		expect(report.accessibilityOutput).not.toContain('../../..');
	});
});

describe('svelteCheckReport', () => {
	test('drops what the plain checker reported, keeps the rest', () => {
		const report = svelteCheckReport(
			svelteCheckOutput(FORMAT_TS_ERROR, PAGE_TS_ERROR),
			new Set([FORMAT_KEY]),
			readSource,
			CWD
		);

		expect(report.dropped).toBe(1);
		expect(report.remaining).toBe(1);
		expect(report.output).not.toContain('format.ts');
		expect(report.output).toContain('Home.svelte');
	});

	test('a failure is kept even when every error was a duplicate', () => {
		const report = svelteCheckReport(
			svelteCheckOutput(
				FORMAT_TS_ERROR,
				'1794717769313 FAILURE "Cannot read tsconfig"'
			),
			new Set([FORMAT_KEY]),
			readSource,
			CWD
		);

		expect(report.remaining).toBe(1);
		expect(report.output).toContain(
			'svelte-check failed: Cannot read tsconfig'
		);
	});
});

describe('dedupeSvelteResult', () => {
	const plain: CheckerResult = {
		exitCode: 1,
		name: 'bun check',
		output: '<error file="src/svelte/format.ts" line="2" column="2" code="TS2322">\n</error>'
	};

	test('svelte-check passes when every error it found is already reported', () => {
		const [, svelte] = dedupeSvelteResult(
			[
				plain,
				{
					exitCode: 1,
					name: 'svelte-check',
					output: svelteCheckOutput(FORMAT_TS_ERROR)
				}
			],
			readSource
		);

		expect(svelte?.exitCode).toBe(0);
		expect(svelte?.output).toBe('');
	});

	test('svelte-check keeps its own errors, rendered', () => {
		const [, svelte] = dedupeSvelteResult(
			[
				plain,
				{
					exitCode: 1,
					name: 'svelte-check',
					output: svelteCheckOutput(FORMAT_TS_ERROR, PAGE_TS_ERROR)
				}
			],
			readSource
		);

		expect(svelte?.exitCode).toBe(1);
		expect(svelte?.output).toContain('Home.svelte');
		expect(svelte?.output).toContain('Found 1 error.');
		expect(svelte?.output).not.toContain('format.ts');
	});

	test('nothing is dropped when the plain checker passed', () => {
		const [, svelte] = dedupeSvelteResult(
			[
				{ exitCode: 0, name: 'tsc', output: '' },
				{
					exitCode: 1,
					name: 'svelte-check',
					output: svelteCheckOutput(FORMAT_TS_ERROR)
				}
			],
			readSource
		);

		expect(svelte?.exitCode).toBe(1);
		expect(svelte?.output).toContain('format.ts');
	});

	test('an unrecognised failing run keeps its output and its failure', () => {
		const crashed: CheckerResult = {
			exitCode: 1,
			name: 'svelte-check',
			output: ''
		};

		expect(dedupeSvelteResult([plain, crashed])[1]).toEqual(crashed);
	});
});

describe('svelteCheckIncludes', () => {
	const projectRoot = '/project';

	test('checks every root: configured directories whole, island folders by their .svelte files and the declarations the native mode generates for them', () => {
		expect(
			svelteCheckIncludes(
				projectRoot,
				['src/frontend/svelte'],
				['src/frontend/svelte', 'src/islands']
			)
		).toEqual([
			'../src/frontend/svelte/**/*',
			'../src/islands/**/*.svelte',
			'../src/islands/**/*.d.svelte.ts'
		]);
	});

	test('a root inside a configured directory is covered by it', () => {
		expect(
			svelteCheckIncludes(projectRoot, ['src/svelte'], ['src/svelte'])
		).toEqual(['../src/svelte/**/*']);
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
