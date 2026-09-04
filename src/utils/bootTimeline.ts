/* Cross-process dev-boot timeline (`ABSOLUTE_DEV_PROFILE=1`).
 *
 * `absolute dev` boots in two processes: the CLI (`dist/cli/index.js`) and
 * the `bun --hot` child that actually serves. Neither the per-step
 * `startupTimings` blocks nor the build trace can explain the gap between
 * "CLI invoked" and "Local: printed", because that gap is mostly module
 * evaluation in three separate bundles (`dist/cli/index.js`,
 * `dist/dev/serverBootstrap.js`, `dist/index.js`) plus process spawn.
 *
 * Marks are absolute offsets from ONE origin — the CLI process start — so
 * every number in the printed timeline is directly comparable. The origin
 * and the CLI's own marks cross the process boundary through the child's
 * environment; inside a process the marks live on `globalThis` because the
 * bundles that record them do not share module state. */

import { MILLISECONDS_IN_A_SECOND } from '../constants';
import { devProfileEnabled } from './startupTimings';

export type BootMark = {
	label: string;
	/** Milliseconds since the boot origin (CLI process start). */
	atMs: number;
};

const ORIGIN_ENV = 'ABSOLUTE_BOOT_ORIGIN_MS';
const MARKS_ENV = 'ABSOLUTE_BOOT_CLI_MARKS';
const MARK_LABEL_WIDTH = 34;
const MS_DECIMALS = 0;

/** Epoch ms at which the current process actually started (including the
 *  runtime's own startup and the bundle parse), not "now". */
export const processStartEpochMs = () =>
	Date.now() - process.uptime() * MILLISECONDS_IN_A_SECOND;

export const bootTimelineEnabled = () => devProfileEnabled;

export const getBootOrigin = () => {
	const existing = globalThis.__absoluteBootOrigin;
	if (typeof existing === 'number') return existing;
	const fromEnv = Number(process.env[ORIGIN_ENV]);
	const origin =
		Number.isFinite(fromEnv) && fromEnv > 0
			? fromEnv
			: processStartEpochMs();
	globalThis.__absoluteBootOrigin = origin;

	return origin;
};

const marks = () => (globalThis.__absoluteBootMarks ??= []);

/** Record a mark that happened at `epochMs` (defaults to now). Cheap and a
 *  no-op unless `ABSOLUTE_DEV_PROFILE=1`, so it is safe on hot boot paths. */
export const markBootAt = (label: string, epochMs: number) => {
	if (!devProfileEnabled) return;
	marks().push({ atMs: epochMs - getBootOrigin(), label });
};

export const markBoot = (label: string) => markBootAt(label, Date.now());

export const getBootMarks = (): BootMark[] => [...marks()];

/** Environment for the `bun --hot` child: the shared origin plus every mark
 *  the CLI recorded before the spawn. */
export const bootTimelineChildEnv = (): Record<string, string> => {
	if (!devProfileEnabled) return {};

	return {
		[MARKS_ENV]: JSON.stringify(marks()),
		[ORIGIN_ENV]: String(getBootOrigin())
	};
};

const isBootMark = (value: unknown): value is BootMark =>
	typeof value === 'object' &&
	value !== null &&
	typeof (value as BootMark).label === 'string' &&
	typeof (value as BootMark).atMs === 'number';

/** Pull the CLI's marks into this process's timeline. Called once, first
 *  thing in the dev bootstrap. */
export const adoptParentBootMarks = () => {
	if (!devProfileEnabled) return;
	if (globalThis.__absoluteBootMarksAdopted) return;
	globalThis.__absoluteBootMarksAdopted = true;
	getBootOrigin();
	const raw = process.env[MARKS_ENV];
	if (!raw) return;
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return;
		marks().unshift(...parsed.filter(isBootMark));
	} catch {
		/* malformed marks never break a boot */
	}
};

export const formatBootTimeline = (entries: readonly BootMark[]) => {
	const sorted = [...entries].sort((left, right) => left.atMs - right.atMs);
	const lines = sorted.map((mark, index) => {
		const previous = index === 0 ? 0 : (sorted[index - 1]?.atMs ?? 0);
		const delta = mark.atMs - previous;

		return `  ${mark.label.padEnd(MARK_LABEL_WIDTH)} ${mark.atMs
			.toFixed(MS_DECIMALS)
			.padStart(6)}ms  (+${delta.toFixed(MS_DECIMALS)}ms)`;
	});

	return ['AbsoluteJS boot timeline (ms since CLI start)', ...lines].join(
		'\n'
	);
};

/** Print the timeline. Goes to stderr so it never interleaves with the
 *  server's stdout (the `Local:` line is scraped by tooling). */
export const logBootTimeline = () => {
	if (!devProfileEnabled) return;
	const entries = marks();
	if (entries.length === 0) return;
	console.error(formatBootTimeline(entries));
};
