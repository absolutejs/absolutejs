import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, spyOn, test } from 'bun:test';
import autoprefixer from 'autoprefixer';
import type {
	PostCSSConfig,
	StylePreprocessorConfig
} from '../../../types/build';
import {
	compileStyleFileIfNeeded,
	compileStyleFileIfNeededSync,
	createStyleTransformConfig,
	resetAutoprefixerState
} from '../../../src/build/stylePreprocessor';

/* Bun's CSS bundler lowers modern syntax but adds no vendor prefixes and
 * has no browser-target setting, so `user-select`, `backdrop-filter` and
 * friends shipped bare. Prefixing is now on by default WHEN the project
 * has `autoprefixer` installed — an optional peer, like sass and postcss
 * — and unchanged when it does not.
 *
 * Every test names its browsers. The default list depends on how old the
 * installed browser data is, and a test that passes or fails with the
 * calendar is not a test. */

process.env.BROWSERSLIST_IGNORE_OLD_DATA = '1';

const NEEDS_PREFIX_IN_SAFARI = 'safari 15';
const NEEDS_NO_PREFIX = 'last 1 chrome version';

const roots: string[] = [];

const writeCss = async (css: string) => {
	const root = await mkdtemp(join(tmpdir(), 'absolute-prefix-'));
	roots.push(root);
	const file = join(root, 'styles.css');
	await writeFile(file, css);

	return file;
};

const targeting = (browsers: string): StylePreprocessorConfig => ({
	autoprefixer: { browsers }
});

afterEach(() => {
	resetAutoprefixerState();
});

afterAll(async () => {
	await Promise.all(
		roots.map((root) => rm(root, { force: true, recursive: true }))
	);
});

describe('with autoprefixer installed', () => {
	test('a property that needs a prefix gets one', async () => {
		const file = await writeCss('.a { user-select: none; }');
		const css = await compileStyleFileIfNeeded(
			file,
			targeting(NEEDS_PREFIX_IN_SAFARI)
		);

		expect(css).toContain('-webkit-user-select: none');
		expect(css).toContain('user-select: none');
	});

	/* `browsers` is the whole point of the setting: the same stylesheet,
	 * a different answer. */
	test('the browser list decides which prefixes are added', async () => {
		const file = await writeCss('.a { user-select: none; }');
		const css = await compileStyleFileIfNeeded(
			file,
			targeting(NEEDS_NO_PREFIX)
		);

		expect(css).not.toContain('-webkit-');
		expect(css).toContain('user-select: none');
	});

	/* Left to its default, autoprefixer also deletes prefixes it judges
	 * outdated for the targets — it took a hand-written
	 * `-webkit-backdrop-filter` out of the example app. Something that
	 * runs without being asked for must not remove what the author
	 * wrote. */
	test('never removes a prefix the author wrote', async () => {
		const file = await writeCss(
			'.a { -webkit-backdrop-filter: blur(4px); backdrop-filter: blur(4px); }'
		);
		const css = await compileStyleFileIfNeeded(
			file,
			targeting(NEEDS_NO_PREFIX)
		);

		expect(css).toContain('-webkit-backdrop-filter: blur(4px)');
	});

	test('`autoprefixer: false` leaves the stylesheet as written', async () => {
		const source = '.a { user-select: none; }';
		const file = await writeCss(source);

		expect(
			await compileStyleFileIfNeeded(file, { autoprefixer: false })
		).toBe(source);
	});

	/* A project that already runs autoprefixer through its own PostCSS
	 * config has made its own choice of browsers. Running a second one
	 * after it, with different targets, would override that choice. */
	test('stands down when the project already runs its own', async () => {
		const file = await writeCss('.a { user-select: none; }');
		const css = await compileStyleFileIfNeeded(file, {
			autoprefixer: { browsers: NEEDS_PREFIX_IN_SAFARI },
			postcss: {
				plugins: [
					autoprefixer({ overrideBrowserslist: NEEDS_NO_PREFIX })
				]
			}
		});

		expect(css).not.toContain('-webkit-');
	});

	/* The synchronous path compiles Angular component styles during fast
	 * HMR. Without prefixing there, a component would have prefixes in a
	 * production build that it did not have in dev. */
	test('the synchronous compile path prefixes too', async () => {
		const file = await writeCss('.a { user-select: none; }');

		expect(
			compileStyleFileIfNeededSync(
				file,
				targeting(NEEDS_PREFIX_IN_SAFARI)
			)
		).toContain('-webkit-user-select: none');
	});
});

describe('without autoprefixer installed', () => {
	const captureWarnings = () => {
		const lines: string[] = [];
		const log = spyOn(console, 'log').mockImplementation(
			(...args: unknown[]) => {
				lines.push(args.map(String).join(' '));
			}
		);

		return { lines, restore: () => log.mockRestore() };
	};

	test('the stylesheet is emitted exactly as written', async () => {
		resetAutoprefixerState(null);
		const capture = captureWarnings();
		const source = '.a { user-select: none; }';
		const file = await writeCss(source);
		const css = await compileStyleFileIfNeeded(file);
		capture.restore();

		expect(css).toBe(source);
	});

	/* "On when installed" would otherwise mean a project that never heard
	 * of the option ships unprefixed CSS without a word. */
	test('says so once, naming the property and the file', async () => {
		resetAutoprefixerState(null);
		const capture = captureWarnings();
		await compileStyleFileIfNeeded(
			await writeCss('.a { user-select: none; }')
		);
		await compileStyleFileIfNeeded(
			await writeCss('.b { backdrop-filter: blur(2px); }')
		);
		capture.restore();

		const notices = capture.lines.filter((line) =>
			line.includes('autoprefixer')
		);
		expect(notices).toHaveLength(1);
		expect(notices[0]).toContain('user-select');
		expect(notices[0]).toContain('styles.css');
	});

	test('says nothing about a stylesheet that needs no prefixes', async () => {
		resetAutoprefixerState(null);
		const capture = captureWarnings();
		await compileStyleFileIfNeeded(
			await writeCss('.a { color: red; display: grid; }')
		);
		capture.restore();

		expect(
			capture.lines.filter((line) => line.includes('autoprefixer'))
		).toHaveLength(0);
	});

	test('says nothing when the author already wrote the prefix', async () => {
		resetAutoprefixerState(null);
		const capture = captureWarnings();
		await compileStyleFileIfNeeded(
			await writeCss(
				'.a { -webkit-user-select: none; user-select: none; }'
			)
		);
		capture.restore();

		expect(
			capture.lines.filter((line) => line.includes('autoprefixer'))
		).toHaveLength(0);
	});

	test('and says nothing when prefixing is turned off', async () => {
		resetAutoprefixerState(null);
		const capture = captureWarnings();
		await compileStyleFileIfNeeded(
			await writeCss('.a { user-select: none; }'),
			{ autoprefixer: false }
		);
		capture.restore();

		expect(
			capture.lines.filter((line) => line.includes('autoprefixer'))
		).toHaveLength(0);
	});
});

describe('the config a project writes', () => {
	test('`browsers` becomes the prefixer targets', () => {
		expect(
			createStyleTransformConfig(undefined, undefined, {
				browsers: ['defaults']
			})
		).toEqual({ autoprefixer: { browsers: ['defaults'] } });
	});

	test('`autoprefixer: false` wins over `browsers`', () => {
		expect(
			createStyleTransformConfig(undefined, undefined, {
				autoprefixer: false,
				browsers: 'defaults'
			})
		).toEqual({ autoprefixer: false });
	});

	/* A project that sets neither gets back exactly what it passed, so
	 * nothing downstream sees a config object where there was none. */
	test('setting neither changes nothing', () => {
		const preprocessors: StylePreprocessorConfig = { scss: {} };

		expect(createStyleTransformConfig(undefined, undefined, {})).toBe(
			undefined
		);
		expect(createStyleTransformConfig(preprocessors, undefined, {})).toBe(
			preprocessors
		);
	});

	test('it sits alongside a PostCSS config rather than replacing it', () => {
		const postcss: PostCSSConfig = { plugins: [] };

		expect(
			createStyleTransformConfig(undefined, postcss, {
				browsers: 'defaults'
			})
		).toEqual({ autoprefixer: { browsers: 'defaults' }, postcss });
	});
});
