import {
	PATCHED_BUN_RELEASE,
	runtimeSupportsReactFastRefresh
} from '../src/cli/patchedBun';

/* Run by `scripts/patchedBunTests.ts` under the patched build, before any
 * test does.
 *
 * Every Fast Refresh test guards itself with
 * `describe.skipIf(!runtimeSupportsReactFastRefresh())`, which is right
 * for a contributor on stock Bun and a trap for CI: if the patched build
 * were missing or the probe stopped working, all 29 tests would skip and
 * the job would pass having run none of them. A skip that reads as a pass
 * is the failure mode this whole job exists to avoid. */

if (runtimeSupportsReactFastRefresh()) {
	console.log(
		`React Fast Refresh is available on Bun ${Bun.version}; running the guarded tests.`
	);
	process.exit(0);
}

console.error(
	[
		`This runtime (Bun ${Bun.version}) does not support React Fast Refresh, so every`,
		'guarded test would skip and this job would pass having tested nothing.',
		'',
		`Expected the patched build ${PATCHED_BUN_RELEASE.version} (${PATCHED_BUN_RELEASE.issue}).`,
		'If Bun itself has shipped the fix, raise the floor rather than the patch:',
		'`runtimeSupportsReactFastRefresh()` probes behaviour, not a version.'
	].join('\n')
);
process.exit(1);
