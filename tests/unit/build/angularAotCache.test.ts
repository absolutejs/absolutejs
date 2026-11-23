import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	aotCacheKey,
	readAotCache,
	writeAotCache
} from '../../../src/build/angularAotCache';

/* A build cache that serves a stale compile is worse than no cache, so
 * everything here is about what must count as a miss. The timings that
 * justify the cache at all are in the PR; what matters to keep is that it
 * cannot be made to hand back output for inputs it was not built from. */

let dir = '';
let previousCwd = '';

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), 'abs-aot-cache-'));
	previousCwd = process.cwd();
	/* The cache lives under `.absolutejs/` relative to the project root. */
	process.chdir(dir);
});

afterEach(async () => {
	process.chdir(previousCwd);
	delete process.env.ABSOLUTE_AOT_CACHE;
	await rm(dir, { force: true, recursive: true });
});

const sourcesFor = (entries: Record<string, string>) =>
	new Map(Object.entries(entries).map(([path, body]) => [join(dir, path), body]));

const ENTRY = 'page.ts';
const OUTPUTS = [{ content: 'export const compiled = 1;', path: 'page.js' }];

const keyFor = (
	transformed: Map<string, string>,
	optionsFingerprint = '{"target":"ES2022"}'
) =>
	aotCacheKey({
		entryPoints: [join(dir, ENTRY)],
		optionsFingerprint,
		transformedSources: transformed
	});

describe('the key', () => {
	test('is stable for the same inputs', () => {
		const sources = sourcesFor({ [ENTRY]: 'class Page {}' });

		expect(keyFor(sources)).toBe(keyFor(sources));
	});

	/* The reason the key is built from TRANSFORMED sources rather than from
	 * what is on disk. The compiler never reads a component's `.ts` from
	 * disk — it is handed a copy with the template and styles already
	 * inlined — so a key taken from disk contents would not move when a
	 * `templateUrl` file changed, and the cache would serve a component
	 * compiled against the old HTML. */
	test('moves when an inlined template changes, with the file on disk untouched', () => {
		const before = keyFor(
			sourcesFor({ [ENTRY]: 'class Page {} /* template: <p>a</p> */' })
		);
		const after = keyFor(
			sourcesFor({ [ENTRY]: 'class Page {} /* template: <p>b</p> */' })
		);

		expect(after).not.toBe(before);
	});

	test('moves when the compiler options change', () => {
		const sources = sourcesFor({ [ENTRY]: 'class Page {}' });

		expect(keyFor(sources, '{"target":"ES2020"}')).not.toBe(
			keyFor(sources)
		);
	});
});

describe('reading an entry back', () => {
	const recorded = async (files: Record<string, string>) => {
		for (const [name, body] of Object.entries(files))
			await writeFile(join(dir, name), body);
		const sources = sourcesFor({ [ENTRY]: 'class Page {}' });
		const key = keyFor(sources);
		await writeAotCache(
			key,
			Object.keys(files).map((name) => join(dir, name)),
			sources,
			OUTPUTS
		);

		return { key, sources };
	};

	test('returns the outputs when nothing it recorded has changed', async () => {
		const { key, sources } = await recorded({ 'dep.ts': 'export const a = 1;' });

		expect(await readAotCache(key, sources)).toEqual(OUTPUTS);
	});

	/* The whole point of recording the file set: a file that is not an
	 * entry point, and that the build never names, still decides whether
	 * the compile is reusable. */
	test('is a miss when a recorded file changed', async () => {
		const { key, sources } = await recorded({ 'dep.ts': 'export const a = 1;' });
		await writeFile(join(dir, 'dep.ts'), 'export const a = 2;');

		expect(await readAotCache(key, sources)).toBeUndefined();
	});

	test('is a miss when a recorded file is gone', async () => {
		const { key, sources } = await recorded({ 'dep.ts': 'export const a = 1;' });
		await rm(join(dir, 'dep.ts'));

		expect(await readAotCache(key, sources)).toBeUndefined();
	});

	test('is a miss for a key never written', async () => {
		const sources = sourcesFor({ [ENTRY]: 'class Page {}' });

		expect(await readAotCache('nothing-here', sources)).toBeUndefined();
	});

	/* A build killed midway, a truncated write, a hand-edited cache: none of
	 * them should fail a build. Everything here fails open to a compile. */
	test('is a miss, not a throw, for a corrupt entry', async () => {
		const { key, sources } = await recorded({ 'dep.ts': 'export const a = 1;' });
		await writeFile(
			join(dir, '.absolutejs', 'cache', 'angular-aot', `${key}.json`),
			'{ not json'
		);

		expect(await readAotCache(key, sources)).toBeUndefined();
	});

	test('is a miss for an entry written in another format version', async () => {
		const { key, sources } = await recorded({ 'dep.ts': 'export const a = 1;' });
		await writeFile(
			join(dir, '.absolutejs', 'cache', 'angular-aot', `${key}.json`),
			JSON.stringify({ files: {}, formatVersion: 99, outputs: OUTPUTS })
		);

		expect(await readAotCache(key, sources)).toBeUndefined();
	});

	/* A file that cannot be read when the entry is written would invalidate
	 * that entry on every later build, so no entry is written at all. */
	test('writes nothing when a recorded file cannot be read', async () => {
		const sources = sourcesFor({ [ENTRY]: 'class Page {}' });
		const key = keyFor(sources);
		await writeAotCache(key, [join(dir, 'absent.ts')], sources, OUTPUTS);

		expect(await readAotCache(key, sources)).toBeUndefined();
	});
});

describe('the opt-out', () => {
	test('ABSOLUTE_AOT_CACHE=0 neither writes nor reads', async () => {
		const sources = sourcesFor({ [ENTRY]: 'class Page {}' });
		const key = keyFor(sources);
		await writeFile(join(dir, 'dep.ts'), 'export const a = 1;');
		process.env.ABSOLUTE_AOT_CACHE = '0';
		await writeAotCache(key, [join(dir, 'dep.ts')], sources, OUTPUTS);

		expect(await readAotCache(key, sources)).toBeUndefined();

		delete process.env.ABSOLUTE_AOT_CACHE;
		await writeAotCache(key, [join(dir, 'dep.ts')], sources, OUTPUTS);
		process.env.ABSOLUTE_AOT_CACHE = '0';

		expect(await readAotCache(key, sources)).toBeUndefined();
	});
});
