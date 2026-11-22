import { describe, expect, test } from 'bun:test';
import { evaluateBudgets, parseSize } from '../../../src/utils/sizeBudgets';

/* `absolute ls --budget 50kb` already enforced one number against every
 * page and exited 1, which covers an interactive check. What it could not
 * do was live in the config — so the number had to be repeated in every
 * pipeline that checked it — and pages and shared chunks, whose sizes
 * mean entirely different things, had to share one limit. */

const KB = 1024;

describe('parseSize', () => {
	test.each([
		['512', 512],
		['512b', 512],
		['1kb', KB],
		['1 KB', KB],
		['1.5mb', 1.5 * KB * KB],
		['2GB', 2 * KB * KB * KB],
		[0, 0],
		[4096, 4096]
	])('%p → %p bytes', (given, expected) => {
		expect(parseSize(given)).toBe(expected);
	});

	/* A budget nobody can read is reported, never guessed at. Treating it
	 * as zero would fail every build; treating it as infinity would
	 * enforce nothing while looking like it did, which is worse. */
	test.each([
		['quite small'],
		['50 kilobytes'],
		['kb'],
		[''],
		['-5kb'],
		[-1]
	])('%p is not a size', (given) => {
		expect(parseSize(given)).toBeNull();
	});
});

describe('evaluateBudgets', () => {
	const entrySizes: Record<string, number> = {
		ChunkBig: 600 * KB,
		ChunkSmall: 10 * KB,
		HomeCSS: 20 * KB,
		HomePage: 30 * KB
	};
	const categoryTotals: Record<string, number> = {
		CSS: 20 * KB,
		Pages: 30 * KB,
		'Shared chunks': 610 * KB
	};

	test('reports nothing at all when no budgets are set', () => {
		const report = evaluateBudgets({
			budgets: {},
			categoryTotals,
			entrySizes
		});

		expect(report).toEqual({ passed: [], problems: [], violations: [] });
	});

	test('a met total budget is reported as met', () => {
		const report = evaluateBudgets({
			budgets: { total: '1mb' },
			categoryTotals,
			entrySizes
		});

		expect(report.violations).toEqual([]);
		expect(report.passed).toEqual([
			{ limit: KB * KB, size: 660 * KB, subject: 'total' }
		]);
	});

	test('an exceeded total names the overage', () => {
		const report = evaluateBudgets({
			budgets: { total: '500kb' },
			categoryTotals,
			entrySizes
		});

		expect(report.violations).toEqual([
			{
				limit: 500 * KB,
				size: 660 * KB,
				subject: 'total',
				what: 'total'
			}
		]);
	});

	/* The reason categories exist: one number for pages and chunks alike
	 * is either too loose for pages or too tight for chunks. */
	test('categories are judged independently', () => {
		const report = evaluateBudgets({
			budgets: {
				categories: { CSS: '25kb', 'Shared chunks': '400kb' }
			},
			categoryTotals,
			entrySizes
		});

		expect(report.passed.map((entry) => entry.subject)).toEqual(['CSS']);
		expect(report.violations.map((entry) => entry.subject)).toEqual([
			'Shared chunks'
		]);
	});

	/* A budget for something not built yet must not fail the build. */
	test('a category the build has no assets for counts as zero', () => {
		const report = evaluateBudgets({
			budgets: { categories: { Islands: '10kb' } },
			categoryTotals,
			entrySizes
		});

		expect(report.violations).toEqual([]);
		expect(report.passed[0]).toEqual({
			limit: 10 * KB,
			size: 0,
			subject: 'Islands'
		});
	});

	test('per-entry reports only the entries that break it, biggest first', () => {
		const report = evaluateBudgets({
			budgets: { perEntry: '25kb' },
			categoryTotals,
			entrySizes
		});

		expect(report.violations.map((entry) => entry.subject)).toEqual([
			'ChunkBig',
			'HomePage'
		]);
		expect(report.violations.every((entry) => entry.what === 'entry')).toBe(
			true
		);
	});

	/* Hundreds of chunks with a passing line each would bury the
	 * failures, so a met per-entry budget is one line. */
	test('a met per-entry budget is a single line naming the largest', () => {
		const report = evaluateBudgets({
			budgets: { perEntry: '1mb' },
			categoryTotals,
			entrySizes
		});

		expect(report.violations).toEqual([]);
		expect(report.passed).toEqual([
			{ limit: KB * KB, size: 600 * KB, subject: 'largest entry' }
		]);
	});

	test('an unreadable budget is a problem, not a pass', () => {
		const report = evaluateBudgets({
			budgets: { categories: { CSS: 'smallish' }, total: '1mb' },
			categoryTotals,
			entrySizes
		});

		expect(report.problems).toEqual([
			{ given: 'smallish', subject: 'CSS' }
		]);
		/* And the readable one beside it is still judged. */
		expect(report.passed.map((entry) => entry.subject)).toEqual(['total']);
	});

	test('an unreadable per-entry budget does not silently pass every entry', () => {
		const report = evaluateBudgets({
			budgets: { perEntry: 'tiny' },
			categoryTotals,
			entrySizes
		});

		expect(report.problems).toEqual([
			{ given: 'tiny', subject: 'perEntry' }
		]);
		expect(report.passed).toEqual([]);
	});

	test('all three kinds of budget can fail at once', () => {
		const report = evaluateBudgets({
			budgets: {
				categories: { 'Shared chunks': '100kb' },
				perEntry: '100kb',
				total: '100kb'
			},
			categoryTotals,
			entrySizes
		});

		expect(report.violations.map((entry) => entry.what)).toEqual([
			'total',
			'category',
			'entry'
		]);
	});
});
