import { afterEach, describe, expect, test } from 'bun:test';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	createFile,
	mutateFile,
	mutateFileInPlace,
	renameFile,
	restoreAllFiles,
	restoreFile,
	withFileMutation
} from '../../../src/testing/files';
import { getAvailablePort } from '../../../src/testing/ports';
import { startProject } from '../../../src/testing/project';
import { waitForServer } from '../../../src/testing/http';

/* The harness this repository tests itself with, now published as
 * `@absolutejs/absolute/testing`. It had always been wired to this
 * repository — project root derived from the helper's own location, entry
 * and config defaulting to `example/`, children running `src/` from
 * source — so a project that installs the package had no supported way to
 * boot its own app in a test.
 *
 * `startProject` against a real installed project is verified end to end
 * outside this repo, where that is the only thing it proves anything
 * about. What is pinned here is the part a unit test can reach: that it
 * refuses honestly when the package is not installed, and that the
 * file-restore registry puts a tree back exactly as it found it —
 * including when the body throws, which is when it matters. */

const roots: string[] = [];

const tempRoot = () => {
	const root = mkdtempSync(join(tmpdir(), 'absolute-harness-'));
	roots.push(root);

	return root;
};

afterEach(() => {
	restoreAllFiles();
	for (const root of roots) rmSync(root, { force: true, recursive: true });
	roots.length = 0;
});

describe('startProject', () => {
	/* The failure a user hits first. Spawning anyway would produce
	 * "command not found" from a shell, which says nothing about why. */
	test('says the package is not installed rather than spawning nothing', async () => {
		const root = tempRoot();

		await expect(startProject({ projectRoot: root })).rejects.toThrow(
			/Could not find @absolutejs\/absolute installed from/u
		);
	});

	test('names cliPath as the way out', async () => {
		const root = tempRoot();

		await expect(startProject({ projectRoot: root })).rejects.toThrow(
			/cliPath/u
		);
	});
});

describe('waitForServer', () => {
	/* A test that hangs tells you nothing, so the probe has to give up and
	 * say what it was waiting for. */
	test('gives up naming the url and the attempt count', async () => {
		const port = await getAvailablePort();

		await expect(
			waitForServer(`http://127.0.0.1:${port}/`, {
				delayMs: 1,
				maxRetries: 2
			})
		).rejects.toThrow(/did not become ready after 2 attempts/u);
	});
});

describe('the file registry', () => {
	test('restores a mutated file byte for byte', () => {
		const root = tempRoot();
		const path = join(root, 'page.tsx');
		createFile(path, 'const one = 1;\n');
		const before = readFileSync(path, 'utf-8');

		mutateFile(path, (text) => `${text}const two = 2;\n`);
		expect(readFileSync(path, 'utf-8')).not.toBe(before);

		restoreFile(path);
		expect(readFileSync(path, 'utf-8')).toBe(before);
	});

	/* Both write paths exist because a watcher does not see them the same
	 * way: atomic replace is a `rename`, in-place is a `change`. Both must
	 * restore. */
	test('restores an in-place write too', () => {
		const root = tempRoot();
		const path = join(root, 'page.tsx');
		createFile(path, 'original\n');

		mutateFileInPlace(path, () => 'changed\n');
		expect(readFileSync(path, 'utf-8')).toBe('changed\n');

		restoreFile(path);
		expect(readFileSync(path, 'utf-8')).toBe('original\n');
	});

	test('removes a created file and the directories it had to make', () => {
		const root = tempRoot();
		const nested = join(root, 'deep', 'deeper', 'page.tsx');

		createFile(nested, 'x\n');
		expect(existsSync(nested)).toBe(true);

		restoreAllFiles();
		expect(existsSync(nested)).toBe(false);
		expect(existsSync(join(root, 'deep'))).toBe(false);
	});

	/* A directory that picked up something else is left alone rather than
	 * forced, because the test did not create that. */
	test('keeps a created directory that something else is using', () => {
		const root = tempRoot();
		createFile(join(root, 'deep', 'a.tsx'), 'a\n');
		mkdirSync(join(root, 'deep', 'kept'), { recursive: true });

		restoreAllFiles();
		expect(existsSync(join(root, 'deep', 'a.tsx'))).toBe(false);
		expect(existsSync(join(root, 'deep', 'kept'))).toBe(true);
	});

	test('refuses to overwrite an existing file with createFile', () => {
		const root = tempRoot();
		const path = join(root, 'page.tsx');
		createFile(path, 'real source\n');

		expect(() => createFile(path, 'clobbered\n')).toThrow(
			/refusing to overwrite/u
		);
		expect(readFileSync(path, 'utf-8')).toBe('real source\n');
	});

	/* Written with plain `fs`, not `createFile`: this stands for a source
	 * file that was already in the tree, which is the only case where
	 * "put it back" means restoring content rather than deleting. */
	test('reverses a rename of a pre-existing file', () => {
		const root = tempRoot();
		const from = join(root, 'Old.tsx');
		const to = join(root, 'New.tsx');
		writeFileSync(from, 'body\n');

		renameFile(from, to);
		expect(existsSync(from)).toBe(false);
		expect(existsSync(to)).toBe(true);

		restoreAllFiles();
		expect(readFileSync(from, 'utf-8')).toBe('body\n');
		expect(existsSync(to)).toBe(false);
	});

	/* The bug these tests found. `createFile` then `mutateFile` records
	 * two entries for one path; `restoreFile` took the FIRST, so it undid
	 * the creation — deleting a file the caller only wanted un-mutated —
	 * and left the mutation entry behind for `restoreAllFiles` to
	 * resurrect the file from. */
	test('restoreFile undoes the latest edit, not the first', () => {
		const root = tempRoot();
		const path = join(root, 'page.tsx');
		createFile(path, 'created\n');

		mutateFile(path, () => 'mutated\n');
		restoreFile(path);

		expect(existsSync(path)).toBe(true);
		expect(readFileSync(path, 'utf-8')).toBe('created\n');

		/* And the creation is still recorded, so the tree ends clean. */
		restoreAllFiles();
		expect(existsSync(path)).toBe(false);
	});

	test('survives a mutate / restore / mutate cycle on a created file', () => {
		const root = tempRoot();
		const path = join(root, 'page.tsx');
		createFile(path, 'base\n');

		for (const round of ['one', 'two', 'three']) {
			mutateFile(path, () => `${round}\n`);
			expect(readFileSync(path, 'utf-8')).toBe(`${round}\n`);
			restoreFile(path);
			expect(readFileSync(path, 'utf-8')).toBe('base\n');
		}
	});

	/* The reason to prefer `withFileMutation`: the restore happens on the
	 * throwing path too, which is exactly the path a forgotten teardown
	 * leaves a dirty tree on. */
	test('withFileMutation restores even when the body throws', async () => {
		const root = tempRoot();
		const path = join(root, 'page.tsx');
		createFile(path, 'original\n');

		await expect(
			withFileMutation(
				path,
				() => 'broken\n',
				() => {
					throw new Error('assertion failed');
				}
			)
		).rejects.toThrow('assertion failed');

		expect(readFileSync(path, 'utf-8')).toBe('original\n');
	});
});
