import { describe, expect, test } from 'bun:test';
import {
	bootIntervalBetween,
	type BootMark
} from '../../../src/utils/bootTimeline';

const mark = (label: string, atMs: number): BootMark => ({ atMs, label });

describe('bootIntervalBetween', () => {
	test('measures the gap between two marks of one boot', () => {
		const marks = [
			mark('child process start', 0),
			mark('server entry import start', 581),
			mark('framework runtime imported', 3294)
		];

		expect(
			bootIntervalBetween(
				marks,
				'server entry import start',
				'framework runtime imported'
			)
		).toBe(2713);
	});

	test('ignores an end mark recorded before the window opened', () => {
		// The CLI's own marks are adopted at the front of the array, and the
		// CLI imports the framework runtime too. Counting that one would
		// measure a different process.
		const marks = [
			mark('framework runtime imported', 483),
			mark('server entry import start', 581),
			mark('framework runtime imported', 3294)
		];

		expect(
			bootIntervalBetween(
				marks,
				'server entry import start',
				'framework runtime imported'
			)
		).toBe(2713);
	});

	test('uses the last start mark, so a hot re-evaluation wins', () => {
		const marks = [
			mark('server entry import start', 581),
			mark('framework runtime imported', 3294),
			mark('server entry import start', 9000),
			mark('framework runtime imported', 9040)
		];

		expect(
			bootIntervalBetween(
				marks,
				'server entry import start',
				'framework runtime imported'
			)
		).toBe(40);
	});

	test('is null when the end mark never came', () => {
		const marks = [
			mark('server entry import start', 581),
			mark('framework runtime imported', 3294),
			mark('server entry import start', 9000)
		];

		expect(
			bootIntervalBetween(
				marks,
				'server entry import start',
				'framework runtime imported'
			)
		).toBeNull();
	});

	test('is null when neither mark was recorded', () => {
		expect(bootIntervalBetween([], 'a', 'b')).toBeNull();
	});

	test('is null when the end mark is out of time order', () => {
		const marks = [
			mark('server entry import start', 581),
			mark('framework runtime imported', 400)
		];

		expect(
			bootIntervalBetween(
				marks,
				'server entry import start',
				'framework runtime imported'
			)
		).toBeNull();
	});
});
