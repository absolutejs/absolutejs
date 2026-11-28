import { relative, resolve } from 'node:path';
import { Glob } from 'bun';

/* The unit gate: one `bun test` for the files that can share a process,
 * and one process each for the files that cannot.
 *
 * `bun test tests/unit` runs every file in a single process, so module
 * state is shared across them. Most of that is harmless, but two things
 * are not: a file that registers a DOM (`GlobalRegistrator`) takes the
 * document away from any other file that registered one, and mounting a
 * framework leaves its own module state behind — a React root, its
 * scheduler, an act queue. A React hook test written against happy-dom
 * made `tests/unit/react/link.test.tsx` fail with "React Router did not
 * commit the matched route", in both file orders, which is why there were
 * no React hook tests at all until this runner existed.
 *
 * `tests/integration` has the same need and solves it in
 * `scripts/shardedTests.ts` (`EXCLUSIVE_TEST_FILES`). That runner rsyncs
 * the repository per shard, which is right for a suite measured in
 * minutes and wrong for this one: the shared run here finishes in about
 * twenty seconds. */

const REPO_ROOT = resolve(import.meta.dir, '..');
const UNIT_DIR = 'tests/unit';

/** Files that get a process to themselves. Keep the reason with the
 *  entry: an isolated file is slower and easy to add by reflex. */
const ISOLATED_TEST_FILES = new Set([
	// Registers happy-dom and mounts React through react-dom/client.
	'tests/unit/react/useFormAction.test.ts',
	// The same: happy-dom, and React mounted through react-dom/client.
	'tests/unit/react/useResource.test.ts'
]);

const collectTestFiles = async () => {
	const glob = new Glob('**/*.test.{ts,tsx}');
	const files: string[] = [];
	for await (const file of glob.scan({
		cwd: resolve(REPO_ROOT, UNIT_DIR)
	})) {
		files.push(`${UNIT_DIR}/${file}`);
	}

	return files.sort();
};

/* Output goes straight to the terminal, so a failure reads exactly as
 * `bun test` prints it. */
const runTests = async (files: readonly string[]) => {
	const proc = Bun.spawn(
		['bun', 'test', '--max-concurrency', '1', ...files],
		{
			cwd: REPO_ROOT,
			stderr: 'inherit',
			stdout: 'inherit'
		}
	);

	return proc.exited;
};

const runIsolated = (files: readonly string[]) =>
	files.reduce<Promise<string[]>>(async (pending, file) => {
		const failed = await pending;
		console.log(`\n── ${relative('.', file)} (its own process)`);
		const exitCode = await runTests([file]);

		return exitCode === 0 ? failed : [...failed, file];
	}, Promise.resolve([]));

const main = async () => {
	const files = await collectTestFiles();
	if (files.length === 0) {
		console.error(`No test files found under ${UNIT_DIR}`);
		process.exit(1);
	}
	const isolated = files.filter((file) => ISOLATED_TEST_FILES.has(file));
	const shared = files.filter((file) => !ISOLATED_TEST_FILES.has(file));
	const missing = [...ISOLATED_TEST_FILES].filter(
		(file) => !files.includes(file)
	);
	if (missing.length > 0) {
		// A renamed or deleted file would otherwise sit in the list
		// forever, silently isolating nothing.
		console.error(
			`These files are listed as isolated but do not exist:\n  ${missing.join('\n  ')}`
		);
		process.exit(1);
	}

	console.log(
		`Running ${shared.length} unit test file(s) together, ` +
			`${isolated.length} in isolation…`
	);
	const sharedExit = await runTests(shared);
	const isolatedFailures = await runIsolated(isolated);
	if (sharedExit === 0 && isolatedFailures.length === 0) process.exit(0);
	if (isolatedFailures.length > 0) {
		console.error(
			`\nFailed in isolation:\n  ${isolatedFailures.join('\n  ')}`
		);
	}
	process.exit(1);
};

await main();
