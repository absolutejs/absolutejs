import { describe, expect, test } from 'bun:test';
import {
	detectFramework,
	getWatchPaths,
	shouldIgnorePath
} from '../../../src/dev/pathUtils';
import type { ResolvedBuildPaths } from '../../../src/dev/configResolver';

const makePaths = (
	overrides?: Partial<ResolvedBuildPaths>
): ResolvedBuildPaths => ({
	angularDir: '/project/example/angular',
	assetsDir: '/project/example/assets',
	buildDir: '/project/build',
	htmlDir: '/project/example/html',
	htmxDir: '/project/example/htmx',
	reactDir: '/project/example/react',
	stylesDir: '/project/example/styles',
	svelteDir: '/project/example/svelte',
	vueDir: '/project/example/vue',
	...overrides
});

describe('detectFramework', () => {
	test('detects react from resolved paths', () => {
		expect(
			detectFramework('/project/example/react/pages/App.tsx', makePaths())
		).toBe('react');
	});

	test('detects svelte from resolved paths', () => {
		expect(
			detectFramework(
				'/project/example/svelte/pages/Page.svelte',
				makePaths()
			)
		).toBe('svelte');
	});

	test('detects vue from resolved paths', () => {
		expect(
			detectFramework('/project/example/vue/pages/Page.vue', makePaths())
		).toBe('vue');
	});

	test('detects angular from resolved paths', () => {
		expect(
			detectFramework(
				'/project/example/angular/pages/app.ts',
				makePaths()
			)
		).toBe('angular');
	});

	test('detects html from resolved paths', () => {
		expect(
			detectFramework(
				'/project/example/html/pages/index.html',
				makePaths()
			)
		).toBe('html');
	});

	test('detects htmx from resolved paths', () => {
		expect(
			detectFramework(
				'/project/example/htmx/pages/page.html',
				makePaths()
			)
		).toBe('htmx');
	});

	test('detects styles directory', () => {
		expect(
			detectFramework('/project/example/styles/main.css', makePaths())
		).toBe('styles');
	});

	test('detects assets directory', () => {
		expect(
			detectFramework('/project/example/assets/logo.png', makePaths())
		).toBe('assets');
	});

	test('falls back to extension-based detection without resolved paths', () => {
		expect(detectFramework('/some/path/file.tsx')).toBe('react');
		expect(detectFramework('/some/path/file.svelte')).toBe('svelte');
		expect(detectFramework('/some/path/file.vue')).toBe('vue');
		expect(detectFramework('/some/path/file.html')).toBe('html');
	});

	test('falls back to path heuristics without resolved paths', () => {
		expect(detectFramework('/app/react/pages/App.tsx')).toBe('react');
		expect(detectFramework('/app/svelte/pages/Page.svelte')).toBe('svelte');
		expect(detectFramework('/app/vue/pages/Page.vue')).toBe('vue');
	});

	test('returns ignored for build/compiled/indexes paths', () => {
		expect(
			detectFramework('/project/example/react/build/out.js', makePaths())
		).toBe('ignored');
		expect(
			detectFramework(
				'/project/example/react/compiled/out.js',
				makePaths()
			)
		).toBe('ignored');
	});

	test('returns unknown for unrecognized files', () => {
		expect(detectFramework('/random/path/file.rs')).toBe('unknown');
	});
});

describe('shouldIgnorePath', () => {
	test('ignores build directories', () => {
		expect(shouldIgnorePath('/project/build/output.js')).toBe(true);
	});

	test('ignores compiled directories', () => {
		expect(shouldIgnorePath('/project/compiled/svelte.js')).toBe(true);
	});

	test('ignores node_modules', () => {
		expect(shouldIgnorePath('/project/node_modules/react/index.js')).toBe(
			true
		);
	});

	test('ignores .git directory', () => {
		expect(shouldIgnorePath('/project/.git/HEAD')).toBe(true);
	});

	test('ignores .log files', () => {
		expect(shouldIgnorePath('/project/debug.log')).toBe(true);
	});

	test('ignores .tmp files', () => {
		expect(shouldIgnorePath('/project/temp.tmp')).toBe(true);
	});

	test('allows styles directory when configured', () => {
		const paths = makePaths({ stylesDir: '/project/example/styles' });
		expect(
			shouldIgnorePath('/project/example/styles/main.css', paths)
		).toBe(false);
	});

	test('allows source files', () => {
		expect(shouldIgnorePath('/project/src/index.ts')).toBe(false);
	});
});

describe('getWatchPaths', () => {
	test('returns paths for configured frameworks', () => {
		const paths = getWatchPaths({
			reactDirectory: 'example/react',
			svelteDirectory: 'example/svelte'
		});
		const joined = paths.join(' ');
		expect(joined).toContain('react');
		expect(joined).toContain('svelte');
	});

	test('includes component, page, and style subdirs for react', () => {
		const paths = getWatchPaths({ reactDirectory: 'example/react' });
		expect(paths.some((p) => p.includes('components'))).toBe(true);
		expect(paths.some((p) => p.includes('pages'))).toBe(true);
		expect(paths.some((p) => p.includes('styles'))).toBe(true);
	});

	test('skips unconfigured frameworks', () => {
		const paths = getWatchPaths({ reactDirectory: 'example/react' });
		const joined = paths.join(' ');
		expect(joined).not.toContain('svelte');
		expect(joined).not.toContain('vue');
		expect(joined).not.toContain('angular');
	});

	test('includes assets directory when configured', () => {
		const paths = getWatchPaths({ assetsDirectory: 'example/assets' });
		expect(paths.some((p) => p.includes('assets'))).toBe(true);
	});
});
