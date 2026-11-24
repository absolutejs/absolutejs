import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	moduleGraphFor,
	modulePreloadLinkHeader
} from '../../../src/build/modulePreload';

/* A browser discovers a module graph by walking it: it fetches the entry,
 * parses it, finds its imports, and only then fetches those. Measured on
 * the example app's own build, a React page's entry pulls in nine modules
 * across three levels, so the code the page needs is two round trips
 * behind the HTML with nothing in the markup to start it earlier. */

let dir = '';

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), 'abs-preload-'));
});

afterEach(async () => {
	await rm(dir, { force: true, recursive: true });
});

const write = async (name: string, source: string) => {
	await mkdir(join(dir, name, '..'), { recursive: true });
	await writeFile(join(dir, name), source);

	return join(dir, name);
};

describe('walking the graph', () => {
	test('follows imports past the first level', async () => {
		await write('leaf.js', 'export const leaf = 1;');
		await write('middle.js', 'import{leaf}from"./leaf.js";export{leaf};');
		const entry = await write('entry.js', 'import{leaf}from"./middle.js";');

		expect(moduleGraphFor(dir, entry)).toEqual(['/middle.js', '/leaf.js']);
	});

	/* The pattern has to match EMITTED code, not source. The bundler
	 * minifies, so there is no space in `}from"./chunk.js"` — the first
	 * version of this expected one and returned an empty graph against the
	 * real build. */
	test('reads minified imports, with no space before from', async () => {
		await write('chunk.js', 'export const a = 1;');
		const entry = await write(
			'entry.js',
			'import{a}from"./chunk.js";export{a};'
		);

		expect(moduleGraphFor(dir, entry)).toEqual(['/chunk.js']);
	});

	test('reads a bare side-effect import', async () => {
		await write('polyfill.js', 'globalThis.x = 1;');
		const entry = await write('entry.js', 'import"./polyfill.js";');

		expect(moduleGraphFor(dir, entry)).toEqual(['/polyfill.js']);
	});

	/* A dynamic import is code the page has said it does not need yet.
	 * Preloading it would spend the bandwidth this exists to save. */
	test('does not follow a dynamic import', async () => {
		await write('lazy.js', 'export const lazy = 1;');
		const entry = await write(
			'entry.js',
			'const go = () => import("./lazy.js");export{go};'
		);

		expect(moduleGraphFor(dir, entry)).toEqual([]);
	});

	test('the entry itself is not preloaded', async () => {
		await write('chunk.js', 'export const a = 1;');
		const entry = await write('entry.js', 'import{a}from"./chunk.js";');

		expect(moduleGraphFor(dir, entry)).not.toContain('/entry.js');
	});

	/* A bare specifier is a package the bundler already resolved, and a
	 * remote URL is not ours to preload. */
	test('ignores anything that is not a file in the build', async () => {
		const entry = await write(
			'entry.js',
			'import"react";import"https://cdn.example.com/x.js";import"data:text/javascript,0";'
		);

		expect(moduleGraphFor(dir, entry)).toEqual([]);
	});

	/* A cycle is normal in emitted output and must not hang the build. */
	test('a cycle is walked once', async () => {
		await write('a.js', 'import"./b.js";');
		await write('b.js', 'import"./a.js";');
		const entry = await write('entry.js', 'import"./a.js";');

		expect(moduleGraphFor(dir, entry).sort()).toEqual(['/a.js', '/b.js']);
	});

	/* An import that resolves to nothing on disk is not worth failing a
	 * build over; it simply does not get preloaded. */
	test('a missing file is skipped, not thrown', async () => {
		const entry = await write('entry.js', 'import"./gone.js";');

		expect(() => moduleGraphFor(dir, entry)).not.toThrow();
	});

	/* Nothing outside the build directory is ever preloaded, however a
	 * specifier is written. */
	test('cannot escape the build directory', async () => {
		const entry = await write('entry.js', 'import"../../etc/passwd";');

		expect(moduleGraphFor(dir, entry)).toEqual([]);
	});
});

describe('the Link header', () => {
	/* One header, not many: a response may carry several and some proxies
	 * keep only the first. */
	test('joins every url into a single value', () => {
		expect(modulePreloadLinkHeader(['/a.js', '/b.js'])).toBe(
			'</a.js>; rel=modulepreload, </b.js>; rel=modulepreload'
		);
	});

	test('is empty when there is nothing to preload', () => {
		expect(modulePreloadLinkHeader([])).toBe('');
	});
});
