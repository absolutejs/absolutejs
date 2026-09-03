import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
	collectVueHmrOutputPaths,
	findTopLevelStatementEnd,
	injectVueComposableTracking,
	injectVueComposableTrackingIntoContent,
	isSharedChunkPath,
	resolveVueComposableModuleId
} from '../../../src/build/injectVueComposableTracking';

const resolveById = (commentPath: string | undefined) =>
	commentPath ? `/abs/${commentPath}` : '/abs/fallback.js';

const evaluate = (code: string, runtimeScope: Record<string, unknown>) => {
	const exported = code.replace(/^export \{[^}]*\};?$/m, '');
	const body = `${exported}\nreturn { useCount: typeof useCount === "function" ? useCount : undefined, useThing: typeof useThing === "function" ? useThing : undefined, useStore: typeof useStore !== "undefined" ? useStore : undefined };`;
	// eslint-disable-next-line @typescript-eslint/no-implied-eval
	const factory = new Function('globalThis', body);

	return factory(runtimeScope) as {
		useCount?: (...args: unknown[]) => unknown;
		useThing?: (...args: unknown[]) => unknown;
		useStore?: unknown;
	};
};

describe('findTopLevelStatementEnd', () => {
	test('stops at the `;` that ends the column-0 statement', () => {
		const text = [
			'var useCount = () => {',
			'  const count = ref(0);',
			'  return { count };',
			'};',
			'',
			'// src/other.ts',
			'var other = 1;'
		].join('\n');
		const start = text.indexOf('() =>');
		const end = findTopLevelStatementEnd(text, start);
		expect(text.slice(start, end)).toBe(
			'() => {\n  const count = ref(0);\n  return { count };\n}'
		);
	});

	test('handles a statement terminated at end of file', () => {
		const text = 'var useCount = () => ref(0);';
		const start = text.indexOf('() =>');
		expect(text.slice(start, findTopLevelStatementEnd(text, start))).toBe(
			'() => ref(0)'
		);
	});

	test('returns -1 when no terminator is found', () => {
		expect(findTopLevelStatementEnd('var useCount = () => {\n  x;\n', 15)).toBe(
			-1
		);
	});
});

describe('injectVueComposableTrackingIntoContent', () => {
	test('leaves output without composables untouched', () => {
		const content = '// src/a.ts\nvar helper = () => 1;\n';
		expect(injectVueComposableTrackingIntoContent(content, resolveById)).toBe(
			content
		);
	});

	test('wraps each composable with its own source-derived module id', () => {
		const content = [
			'// .absolutejs/generated/vue/client/composables/useCount.js',
			'var useCount = () => {',
			'  const count = ref(0);',
			'  return { count };',
			'};',
			'',
			'// src/frontend/composables/useThing.ts',
			'var useThing = (id) => {',
			'  return { id: ref(id) };',
			'};',
			'',
			'export { useCount, useThing };',
			''
		].join('\n');
		const result = injectVueComposableTrackingIntoContent(
			content,
			resolveById
		);
		expect(result).toContain(
			'var useCount = __hmr_wrap("/abs/.absolutejs/generated/vue/client/composables/useCount.js", "useCount", () => {'
		);
		expect(result).toContain(
			'var useThing = __hmr_wrap("/abs/src/frontend/composables/useThing.ts", "useThing", (id) => {'
		);
		// Runtime lands once, immediately before the first composable.
		expect(result.split('function __hmr_wrap(').length).toBe(2);
		expect(result.indexOf('function __hmr_wrap(')).toBeLessThan(
			result.indexOf('var useCount =')
		);
		expect(result.indexOf('function __hmr_wrap(')).toBeGreaterThan(
			result.indexOf('// .absolutejs/generated')
		);
	});

	test('is not confused by quotes in comments, regex literals or templates', () => {
		const content = [
			"// node_modules/@absolutejs/hotkeys/dist/vue.js",
			'var useHotkey = (binding, handler, options2 = {}) => {',
			"  // don't let a stray quote break the scan",
			'  const parts = binding.split(/["\'+]/);',
			'  const label = `key: ${parts.join("+")}',
			'top-level looking line inside a template`;',
			'  return { parts: ref(parts), label };',
			'};',
			'',
			'// src/composables/useCount.ts',
			'var useCount = () => ({ count: ref(1) });',
			'',
			'export { useCount, useHotkey };',
			''
		].join('\n');
		const result = injectVueComposableTrackingIntoContent(
			content,
			resolveById
		);
		expect(result).toContain(
			'var useHotkey = __hmr_wrap("/abs/node_modules/@absolutejs/hotkeys/dist/vue.js", "useHotkey", (binding, handler, options2 = {}) => {'
		);
		expect(result).toContain(
			'var useCount = __hmr_wrap("/abs/src/composables/useCount.ts", "useCount", () => ({ count: ref(1) }));'
		);
		// The half-wrapped form the old brace counter produced must never appear.
		expect(result).not.toMatch(/__hmr_wrap\([^)]*, \)/);
		// Masked spans are restored verbatim.
		expect(result).toContain("  // don't let a stray quote break the scan");
		expect(result).toContain('top-level looking line inside a template`;');
	});

	test('wrapped composables run and restore ref values across a reload', () => {
		const content = [
			'// src/composables/useCount.ts',
			'var useCount = () => {',
			'  const count = { value: 0 };',
			'  return { count };',
			'};',
			'',
			'// src/composables/useStore.ts',
			'var useStore = { notAFunction: true };',
			'',
			'export { useCount, useStore };',
			''
		].join('\n');
		const code = injectVueComposableTrackingIntoContent(
			content,
			resolveById
		);
		const scope: Record<string, unknown> = {};
		const first = evaluate(code, scope);
		const firstState = first.useCount?.() as { count: { value: number } };
		firstState.count.value = 42;
		// Non-function initializers pass through the wrapper unchanged.
		expect(first.useStore).toEqual({ notAFunction: true });

		// A second evaluation (the module server re-serving the composable
		// under the same id) sees the recorded refs and restores them.
		const second = evaluate(code, scope);
		const secondState = second.useCount?.() as { count: { value: number } };
		expect(secondState.count.value).toBe(42);
	});

	test('skips a composable whose statement end cannot be located', () => {
		const content = [
			'// src/composables/useCount.ts',
			'var useCount = () => ({ count: ref(1) })',
			''
		].join('\n');
		expect(injectVueComposableTrackingIntoContent(content, resolveById)).toBe(
			content
		);
	});
});

describe('resolveVueComposableModuleId', () => {
	test('maps generated client helpers back to their source under vueDir', () => {
		const projectRoot = mkdtempSync(join(tmpdir(), 'vue-hmr-id-'));
		const vueDir = join(projectRoot, 'src', 'frontend');
		const generatedVueDir = join(projectRoot, '.absolutejs', 'generated', 'vue');
		mkdirSync(join(vueDir, 'composables'), { recursive: true });
		writeFileSync(join(vueDir, 'composables', 'useAuth.ts'), 'export {};');
		const options = { generatedVueDir, projectRoot, vueDir };

		expect(
			resolveVueComposableModuleId(
				'.absolutejs/generated/vue/client/composables/useAuth.js',
				options
			)
		).toBe(join(vueDir, 'composables', 'useAuth.ts'));
		// Unknown extension falls back to `.ts` (the only kind the module
		// server wraps) instead of pointing at the generated intermediate.
		expect(
			resolveVueComposableModuleId(
				'.absolutejs/generated/vue/client/composables/useMissing.js',
				options
			)
		).toBe(join(vueDir, 'composables', 'useMissing.ts'));
		// Helpers outside vueDir mirror to a generated sibling directory.
		expect(
			resolveVueComposableModuleId(
				'.absolutejs/generated/vue/shared/useShared.js',
				options
			)
		).toBe(resolve(vueDir, '..', 'shared', 'useShared.ts'));
		// Anything else resolves against the project root untouched.
		expect(
			resolveVueComposableModuleId('node_modules/lib/dist/vue.js', options)
		).toBe(join(projectRoot, 'node_modules', 'lib', 'dist', 'vue.js'));
		expect(
			resolveVueComposableModuleId('src/frontend/composables/useAuth.ts', {
				projectRoot
			})
		).toBe(join(vueDir, 'composables', 'useAuth.ts'));
	});
});

describe('collectVueHmrOutputPaths', () => {
	test('follows chunk imports transitively and skips unrelated chunks', () => {
		const buildDir = mkdtempSync(join(tmpdir(), 'vue-hmr-chunks-'));
		mkdirSync(join(buildDir, 'vue', 'indexes'), { recursive: true });
		const page = join(buildDir, 'vue', 'indexes', 'Page.abc12345.js');
		const shared = join(buildDir, 'chunk-aaaaaaaa.js');
		const nested = join(buildDir, 'chunk-bbbbbbbb.js');
		const dynamic = join(buildDir, 'chunk-cccccccc.js');
		const svelteOnly = join(buildDir, 'chunk-dddddddd.js');
		writeFileSync(
			page,
			'import { a } from "../../chunk-aaaaaaaa.js";\nimport("../../chunk-cccccccc.js");\n'
		);
		writeFileSync(shared, 'import "./chunk-bbbbbbbb.js";\nexport var a = 1;\n');
		writeFileSync(nested, 'export var b = 2;\n');
		writeFileSync(dynamic, 'export var c = 3;\n');
		writeFileSync(svelteOnly, 'export var d = 4;\n');

		const result = collectVueHmrOutputPaths(
			[page],
			[shared, nested, dynamic, svelteOnly]
		);
		expect(new Set(result)).toEqual(new Set([page, shared, nested, dynamic]));
	});

	test('returns the page bundles alone when there are no chunks', () => {
		expect(collectVueHmrOutputPaths(['/b/vue/indexes/P.js'], [])).toEqual([
			'/b/vue/indexes/P.js'
		]);
	});

	test('isSharedChunkPath matches Bun chunk names only', () => {
		expect(isSharedChunkPath('/build/chunk-a1b2c3d4.js')).toBe(true);
		expect(isSharedChunkPath('/build/vue/indexes/Page.a1b2c3d4.js')).toBe(
			false
		);
		expect(isSharedChunkPath('/build/chunk-a1b2c3d4.css')).toBe(false);
	});
});

describe('injectVueComposableTracking (file)', () => {
	test('rewrites the file in place and reports the resolved ids', () => {
		const projectRoot = mkdtempSync(join(tmpdir(), 'vue-hmr-file-'));
		const outputPath = join(projectRoot, 'chunk-a1b2c3d4.js');
		writeFileSync(
			outputPath,
			'// src/composables/useCount.ts\nvar useCount = () => ({ count: ref(0) });\nexport { useCount };\n'
		);
		injectVueComposableTracking(outputPath, { projectRoot });
		const rewritten = Bun.file(outputPath);

		return rewritten.text().then((text) => {
			expect(text).toContain(
				`__hmr_wrap(${JSON.stringify(join(projectRoot, 'src', 'composables', 'useCount.ts'))}, "useCount", () => ({ count: ref(0) }))`
			);
		});
	});
});
