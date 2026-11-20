import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "Stock Bun ignores `reactFastRefresh` on Bun.Transpiler (oven-sh/bun#32919), so React cannot keep component state across an edit and the 29 tests across five files that assert it guard themselves with describe.skipIf. They therefore ran nowhere but a maintainer's own machine, which for a headline dev-loop feature meant a regression would have been found by a user in their dev loop. The nightly integration workflow now has a third job that installs the pinned patched build with bvm, which verifies its signature and checksum, and runs those files. It runs beside the stock-Bun battery rather than instead of it, because stock Bun is what most users have and the counterpart tests asserting the degraded behaviour have to keep running there. The job asserts the Fast Refresh probe before running any test: a missing patched build would otherwise skip all 29 and pass, which is the failure this job exists to prevent. The guarded files are discovered rather than listed, and a unit test holds that discovery to the five that exist, so a renamed guard fails a test instead of quietly emptying the job.",
	kind: 'internal',
	summary: 'The nightly runs the Fast Refresh tests on the patched Bun build'
};
