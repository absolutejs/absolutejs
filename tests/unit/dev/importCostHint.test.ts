import { describe, expect, test } from 'bun:test';
import {
	DEFAULT_HINT_THRESHOLD_MS,
	entryGraphMsFrom,
	formatImportCostHint,
	importCostHintThresholdMs,
	shouldHintImportCost,
	type ImportCostHintConditions
} from '../../../src/dev/importCost/hint';
import type { BootMark } from '../../../src/utils/bootTimeline';

const SLOW_MS = 2713;
const FAST_MS = 400;

/** A boot that should be hinted about: slow, interactive, nothing opted out. */
const slowBoot = (
	overrides: Partial<ImportCostHintConditions> = {}
): ImportCostHintConditions => ({
	eager: false,
	entryGraphMs: SLOW_MS,
	hotReevaluation: false,
	importCostEnabled: false,
	inCi: false,
	override: undefined,
	thresholdMs: DEFAULT_HINT_THRESHOLD_MS,
	tty: true,
	...overrides
});

describe('import-cost hint: what it measures', () => {
	test('is the window between the two boot marks', () => {
		const marks: BootMark[] = [
			{ atMs: 0, label: 'child process start' },
			{ atMs: 581, label: 'server entry import start' },
			{ atMs: 3294, label: 'framework runtime imported' },
			{ atMs: 6016, label: 'server entry import done' }
		];

		expect(entryGraphMsFrom(marks)).toBe(2713);
	});

	test('is null when the boot recorded no such window', () => {
		expect(entryGraphMsFrom([])).toBeNull();
	});
});

describe('import-cost hint: when it fires', () => {
	test('fires on a slow, interactive boot', () => {
		expect(shouldHintImportCost(slowBoot())).toBe(true);
	});

	test('exactly at the threshold counts as slow', () => {
		expect(
			shouldHintImportCost(
				slowBoot({ entryGraphMs: DEFAULT_HINT_THRESHOLD_MS })
			)
		).toBe(true);
	});
});

describe('import-cost hint: when it stays silent', () => {
	test('a fast boot', () => {
		expect(shouldHintImportCost(slowBoot({ entryGraphMs: FAST_MS }))).toBe(
			false
		);
	});

	test('a boot that recorded nothing', () => {
		expect(shouldHintImportCost(slowBoot({ entryGraphMs: null }))).toBe(
			false
		);
	});

	test('the flag is already on', () => {
		expect(
			shouldHintImportCost(slowBoot({ importCostEnabled: true }))
		).toBe(false);
	});

	test('a bun --hot re-evaluation', () => {
		expect(shouldHintImportCost(slowBoot({ hotReevaluation: true }))).toBe(
			false
		);
	});

	test('--eager', () => {
		expect(shouldHintImportCost(slowBoot({ eager: true }))).toBe(false);
	});

	test('CI', () => {
		expect(shouldHintImportCost(slowBoot({ inCi: true }))).toBe(false);
	});

	test('a non-interactive stdout', () => {
		expect(shouldHintImportCost(slowBoot({ tty: false }))).toBe(false);
	});

	test('explicitly silenced, however slow the boot was', () => {
		expect(
			shouldHintImportCost(
				slowBoot({ entryGraphMs: 60_000, override: '0' })
			)
		).toBe(false);
	});

	test('silencing beats every other reason to fire', () => {
		expect(shouldHintImportCost(slowBoot({ override: 'false' }))).toBe(
			false
		);
	});
});

describe('import-cost hint: the force override', () => {
	test('fires through a pipe, in CI, with --eager', () => {
		expect(
			shouldHintImportCost(
				slowBoot({ eager: true, inCi: true, override: '1', tty: false })
			)
		).toBe(true);
	});

	test('does not force past the threshold — the number has to be real', () => {
		expect(
			shouldHintImportCost(
				slowBoot({ entryGraphMs: FAST_MS, override: '1' })
			)
		).toBe(false);
	});

	test('does not force past the flag already being on', () => {
		expect(
			shouldHintImportCost(
				slowBoot({ importCostEnabled: true, override: '1' })
			)
		).toBe(false);
	});
});

describe('import-cost hint: threshold override', () => {
	test('unset falls back to the default', () => {
		expect(importCostHintThresholdMs(undefined)).toBe(
			DEFAULT_HINT_THRESHOLD_MS
		);
		expect(importCostHintThresholdMs('  ')).toBe(DEFAULT_HINT_THRESHOLD_MS);
	});

	test('a number is taken as milliseconds', () => {
		expect(importCostHintThresholdMs('250')).toBe(250);
		expect(importCostHintThresholdMs('0')).toBe(0);
	});

	test('nonsense falls back rather than disabling the hint', () => {
		expect(importCostHintThresholdMs('soon')).toBe(
			DEFAULT_HINT_THRESHOLD_MS
		);
		expect(importCostHintThresholdMs('-1')).toBe(DEFAULT_HINT_THRESHOLD_MS);
	});
});

describe('import-cost hint: the line', () => {
	const line = formatImportCostHint(SLOW_MS);

	test('names the measured cost and the flag, on one line', () => {
		expect(line).toContain('2.71s');
		expect(line).toContain('ABSOLUTE_DEV_IMPORT_COST=1');
		expect(line.split('\n')).toHaveLength(1);
	});

	test('claims no saving', () => {
		expect(line).not.toContain('save');
		expect(line).not.toContain('faster');
	});
});
