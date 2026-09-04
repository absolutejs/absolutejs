/* Cross-process dev-boot timeline.
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
 * bundles that record them do not share module state.
 *
 * Recording is unconditional; only the printed timeline is behind
 * `ABSOLUTE_DEV_PROFILE=1`. A boot records about twenty marks, each one a
 * `Date.now()` and a two-field object, so the always-on cost is far below
 * the resolution of anything it measures — and it is what lets a diagnostic
 * that fires on a slow boot (`importCost/hint.ts`) know how slow the boot
 * actually was without asking the developer to have profiled it in
 * advance. */

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
const MARK_TIME_WIDTH = 6;
const MS_DECIMALS = 0;
const NOT_FOUND = -1;

const marks = () => (globalThis.__absoluteBootMarks ??= []);

const isBootMark = (value: unknown): value is BootMark =>
	typeof value === 'object' &&
	value !== null &&
	typeof Reflect.get(value, 'label') === 'string' &&
	typeof Reflect.get(value, 'atMs') === 'number';

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
/** Milliseconds between two marks of one boot, or `null` when this process
 *  did not record the pair.
 *
 *  The *last* `startLabel` is the one that counts — under `bun --hot` the
 *  bootstrap re-evaluates and records a second set — and the end mark has to
 *  come after it, both in insertion order and in time. A label can legitimately
 *  repeat (the framework runtime is marked once in the CLI, whose marks are
 *  adopted at the front of this array, and again in the child), so anything
 *  before that last start is ignored rather than averaged in. */
export const bootIntervalBetween = (
	entries: readonly BootMark[],
	startLabel: string,
	endLabel: string
) => {
	const startIndex = entries.findLastIndex(
		(mark) => mark.label === startLabel
	);
	if (startIndex === NOT_FOUND) return null;
	const start = entries[startIndex];
	if (start === undefined) return null;
	const end = entries
		.slice(startIndex + 1)
		.find((mark) => mark.label === endLabel);
	if (end === undefined || end.atMs < start.atMs) return null;

	return end.atMs - start.atMs;
};

export const bootIntervalMs = (startLabel: string, endLabel: string) =>
	bootIntervalBetween(marks(), startLabel, endLabel);

export const bootTimelineChildEnv = (): Record<string, string> => {
	if (!devProfileEnabled) return {};

	return {
		[MARKS_ENV]: JSON.stringify(marks()),
		[ORIGIN_ENV]: String(getBootOrigin())
	};
};
export const bootTimelineEnabled = () => devProfileEnabled;
export const formatBootTimeline = (entries: readonly BootMark[]) => {
	const sorted = [...entries].sort((left, right) => left.atMs - right.atMs);
	const lines = sorted.map((mark, index) => {
		const previous = index === 0 ? 0 : (sorted[index - 1]?.atMs ?? 0);
		const delta = mark.atMs - previous;

		return `  ${mark.label.padEnd(MARK_LABEL_WIDTH)} ${mark.atMs
			.toFixed(MS_DECIMALS)
			.padStart(MARK_TIME_WIDTH)}ms  (+${delta.toFixed(MS_DECIMALS)}ms)`;
	});

	return ['AbsoluteJS boot timeline (ms since CLI start)', ...lines].join(
		'\n'
	);
};
export const getBootMarks = () => [...marks()];
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
export const logBootTimeline = () => {
	if (!devProfileEnabled) return;
	const entries = marks();
	if (entries.length === 0) return;
	console.error(formatBootTimeline(entries));
};
export const markBoot = (label: string) => markBootAt(label, Date.now());
export const markBootAt = (label: string, epochMs: number) => {
	marks().push({ atMs: epochMs - getBootOrigin(), label });
};
export const processStartEpochMs = () =>
	Date.now() - process.uptime() * MILLISECONDS_IN_A_SECOND;
