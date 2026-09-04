/* One line, at the end of a slow dev boot, naming the flag that explains it.
 *
 * `ABSOLUTE_DEV_IMPORT_COST=1` answers the only question a developer can act
 * on — "if I deferred this import, how much boot time would actually go
 * away?" — but nobody runs a flag they have never heard of, and nobody
 * re-runs it a year later when a colleague adds a heavy import. So the boot
 * that would benefit from it says so itself.
 *
 * ## What is measured
 *
 * Not the wall clock. Most of a dev boot is the framework's build, which no
 * import can move, so pointing at an import-level diagnostic because the
 * build was slow would be a lie. The measured window is
 * `server entry import start` → `framework runtime imported`: it opens when
 * the bootstrap begins importing the user's entry and closes when the
 * framework runtime's own module body starts, which is strictly before the
 * entry's body can reach `prepare()`. Everything inside it is module
 * evaluation — the developer's imports and the framework's, competing for
 * one thread — and none of it is build work.
 *
 * It is a *lower* bound on the entry graph: the entry keeps importing after
 * the framework runtime lands (on a large app, for another second or more).
 * Under-reporting is the right direction. A hint that fires when there is
 * nothing to find becomes noise; one that stays quiet on a boot that still
 * had a second of imports to find costs nothing but a missed opportunity.
 *
 * ## Why it stays quiet
 *
 * A hint printed on every boot is read once and ignored forever, so this one
 * only prints for a developer it can actually help. See
 * `shouldHintImportCost` — every gate there is a case where the measurement
 * would be wrong, unwanted, or unread. */

import {
	bootIntervalBetween,
	bootIntervalMs,
	type BootMark
} from '../../utils/bootTimeline';
import { getDurationString } from '../../utils/getDurationString';

/** The bootstrap starts importing the user's entry. */
const ENTRY_GRAPH_START = 'server entry import start';
/** `dist/index.js` begins evaluating its own body: everything either side of
 *  it had to load to get here, and `prepare()` cannot have run yet. */
const ENTRY_GRAPH_END = 'framework runtime imported';

const HINT_ENV = 'ABSOLUTE_DEV_IMPORT_COST_HINT';
const THRESHOLD_ENV = 'ABSOLUTE_DEV_IMPORT_COST_HINT_MS';
const IMPORT_COST_ENV = 'ABSOLUTE_DEV_IMPORT_COST';
const EAGER_ENV = 'ABSOLUTE_DEV_EAGER';
/** Set by the CLI parent when *its* stdout is a terminal. The dev child's own
 *  stdout is a pipe by construction — the parent prefixes and forwards it —
 *  so `process.stdout.isTTY` here is always false and says nothing about
 *  whether a human is watching. */
const TTY_ENV = 'ABSOLUTE_DEV_TTY';

export type ImportCostHintConditions = {
	/** `--eager` / `ABSOLUTE_DEV_EAGER=1`. */
	eager: boolean;
	/** The measured window, or `null` when this boot did not record it. */
	entryGraphMs: number | null;
	/** A `bun --hot` re-evaluation rather than a cold boot. */
	hotReevaluation: boolean;
	/** `process.env.CI` is set to anything. */
	inCi: boolean;
	/** `ABSOLUTE_DEV_IMPORT_COST=1` — the full report is already coming. */
	importCostEnabled: boolean;
	/** `ABSOLUTE_DEV_IMPORT_COST_HINT`: `0` silences, `1` forces past the
	 *  interactivity gates (never past the threshold). */
	override: string | undefined;
	thresholdMs: number;
	/** A human is watching this boot. */
	tty: boolean;
};

/* Chosen, not guessed:
 *
 * - below about a second a restart still reads as continuous, so there is no
 *   slow boot to explain and no attention worth spending;
 * - the window measured is a lower bound (see above), so 1500ms of it means
 *   at least 1500ms of module evaluation and usually rather more. The margin
 *   over one second is deliberate: one boot on a loaded machine must not be
 *   able to trip a hint the app does not deserve;
 * - the diagnostic being suggested costs a slower boot to run — it
 *   instruments every module and turns off the build/import overlap. Spending
 *   that on a sub-second graph asks for more time than could ever be
 *   recovered.
 *
 * Overridable with `ABSOLUTE_DEV_IMPORT_COST_HINT_MS` for anyone whose idea
 * of slow is not this one. */
export const DEFAULT_HINT_THRESHOLD_MS = 1500;

const isTruthy = (value: string | undefined) =>
	value === '1' || value === 'true';

const isFalsy = (value: string | undefined) =>
	value === '0' || value === 'false';

/** The measured window, from a boot's marks. Exported for tests; the live
 *  path reads this process's own marks. */
export const entryGraphMsFrom = (marks: readonly BootMark[]) =>
	bootIntervalBetween(marks, ENTRY_GRAPH_START, ENTRY_GRAPH_END);

/** Names the measured cost and the flag, and claims nothing else. It does not
 *  say a saving is available — only the report can know that, and on plenty
 *  of apps the honest answer is "none". */
export const formatImportCostHint = (entryGraphMs: number) =>
	`[absolute] ${getDurationString(
		entryGraphMs
	)} of this boot was your server entry's imports — ABSOLUTE_DEV_IMPORT_COST=1 shows which ones own it.`;

/** `ABSOLUTE_DEV_IMPORT_COST_HINT_MS`, falling back to the default for
 *  anything that is not a finite, non-negative number. */
export const importCostHintThresholdMs = (raw: string | undefined) => {
	if (raw === undefined || raw.trim() === '') {
		return DEFAULT_HINT_THRESHOLD_MS;
	}
	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed < 0) {
		return DEFAULT_HINT_THRESHOLD_MS;
	}

	return parsed;
};

/** Called once at the end of a dev boot. Suppressed, it is a handful of
 *  environment reads and one scan of ~20 marks. */
export const printImportCostHint = ({
	hotReevaluation
}: {
	hotReevaluation: boolean;
}) => {
	const entryGraphMs = bootIntervalMs(ENTRY_GRAPH_START, ENTRY_GRAPH_END);
	const show = shouldHintImportCost({
		eager: isTruthy(process.env[EAGER_ENV]),
		entryGraphMs,
		hotReevaluation,
		importCostEnabled: isTruthy(process.env[IMPORT_COST_ENV]),
		inCi: (process.env.CI ?? '') !== '',
		override: process.env[HINT_ENV],
		thresholdMs: importCostHintThresholdMs(process.env[THRESHOLD_ENV]),
		tty: isTruthy(process.env[TTY_ENV]) || process.stdout.isTTY === true
	});
	if (!show || entryGraphMs === null) return;
	console.log(formatImportCostHint(entryGraphMs));
};

/** Every reason this stays silent, in one place.
 *
 * - **explicitly off** — `ABSOLUTE_DEV_IMPORT_COST_HINT=0`.
 * - **the flag is already on** — the full report is about to print; a line
 *   telling a developer to run what they are running is pure noise.
 * - **nothing was measured** — no mark pair, so there is no honest number.
 * - **the boot was not slow** — under the threshold there is nothing to
 *   explain and nothing worth the interruption.
 * - **`bun --hot` re-evaluation** — a hot restart re-runs the entry against
 *   an already-warm module graph. That number describes nothing anyone can
 *   act on, and it would repeat all day.
 * - **`--eager`** — the developer deliberately asked for one long boot that
 *   builds every page. They are not being surprised by a slow one.
 * - **CI** — nobody is reading, and nobody would run a dev-server flag in
 *   response.
 * - **no terminal** — the same, for a piped or redirected boot: a log
 *   scraper, a supervisor, a benchmark harness.
 *
 * `ABSOLUTE_DEV_IMPORT_COST_HINT=1` forces past the last three, so the hint
 * can be demonstrated and tested through a pipe. It never forces past the
 * threshold: the number has to be real. */
export const shouldHintImportCost = ({
	eager,
	entryGraphMs,
	hotReevaluation,
	importCostEnabled,
	inCi,
	override,
	thresholdMs,
	tty
}: ImportCostHintConditions) => {
	if (isFalsy(override)) return false;
	if (importCostEnabled) return false;
	if (entryGraphMs === null) return false;
	if (entryGraphMs < thresholdMs) return false;
	if (hotReevaluation) return false;
	if (isTruthy(override)) return true;

	return !inCi && !eager && tty;
};
