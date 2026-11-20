import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Glob } from 'bun';
import {
	installPatchedBun,
	installedPatchedBun,
	PATCHED_BUN_RELEASE
} from '../src/cli/patchedBun';

/* The tests that only run on the patched Bun build.
 *
 * Stock Bun ignores `reactFastRefresh` on `Bun.Transpiler`
 * (oven-sh/bun#32919), so React cannot keep component state across an
 * edit, and every test that asserts it guards itself with
 * `describe.skipIf(!runtimeSupportsReactFastRefresh())`. On stock Bun that
 * is 29 tests across five files skipping — which is correct for a
 * contributor and means the headline dev-loop feature was verified
 * nowhere but a maintainer's own machine.
 *
 * This runs them on the patched build, beside the ordinary HMR battery
 * rather than instead of it: stock Bun is what most users have, and the
 * counterpart tests that assert the degraded behaviour ("no reload on any
 * Bun") have to keep running on it.
 *
 * The files are discovered, not listed. A sixth guarded file added later
 * is picked up without touching this script — a hand-kept list would go
 * stale silently, and silence is the thing being designed out. */

const REPO_ROOT = resolve(import.meta.dir, '..');
const GUARD = 'runtimeSupportsReactFastRefresh';
const SEARCH_DIR = 'tests';

/** The test files that guard themselves on Fast Refresh support.
 *  Exported so a renamed guard fails a test rather than silently emptying
 *  this job. */
export const guardedTestFiles = async () => {
	const glob = new Glob('**/*.test.{ts,tsx}');
	const files: string[] = [];
	for await (const file of glob.scan({
		cwd: join(REPO_ROOT, SEARCH_DIR)
	})) {
		const path = join(SEARCH_DIR, file);
		const source = readFileSync(join(REPO_ROOT, path), 'utf-8');
		if (
			source.includes(`skipIf(!${GUARD}`) ||
			source.includes('!fastRefresh')
		)
			files.push(path);
	}

	return files.sort();
};

const patchedBunPath = () => {
	const existing = installedPatchedBun();
	if (existing) return existing;
	console.log(`Installing Bun ${PATCHED_BUN_RELEASE.version} with bvm…`);

	return installPatchedBun();
};

const run = (binary: string, args: string[]) =>
	spawnSync(binary, args, { cwd: REPO_ROOT, stdio: 'inherit' }).status ?? 1;

const main = async () => {
	const files = await guardedTestFiles();
	if (files.length === 0) {
		// Either the guard was renamed or the tests were deleted; both mean
		// this job is no longer testing what it was built for.
		console.error(
			`No test file guards itself with ${GUARD}. If that guard was renamed, update this script; if the tests are gone, delete this job.`
		);
		process.exit(1);
	}
	const binary = patchedBunPath();
	console.log(`Using ${binary}`);
	// Before the tests, not after: a missing patched build would otherwise
	// show up as 29 skips and a green job.
	const asserted = run(binary, ['run', 'scripts/assertFastRefresh.ts']);
	if (asserted !== 0) process.exit(asserted);
	console.log(`\nRunning ${files.length} guarded test file(s):`);
	files.forEach((file) => console.log(`  ${file}`));
	process.exit(run(binary, ['test', '--max-concurrency', '1', ...files]));
};

// Importable for its tests; only the CI step runs it.
if (import.meta.main) await main();
