/* Size budgets: parsing them, and deciding what is over.
 *
 * `absolute ls --budget 50kb` already enforced one number against every
 * page and exited 1 when something was over it, which is most of what a
 * CI gate needs. What it could not do was live in the config, so the
 * budget had to be repeated in every pipeline that checked it, and there
 * was no way to hold a different number for pages than for shared
 * chunks — the two things whose sizes mean completely different things.
 *
 * Pure: sizes in, verdicts out. The CLI renders them. */

import { BYTES_PER_KILOBYTE } from '../constants';

const SIZE_UNITS: Record<string, number> = {
	b: 1,
	gb: BYTES_PER_KILOBYTE * BYTES_PER_KILOBYTE * BYTES_PER_KILOBYTE,
	kb: BYTES_PER_KILOBYTE,
	mb: BYTES_PER_KILOBYTE * BYTES_PER_KILOBYTE
};

const SIZE_PATTERN = /^([\d.]+)\s*(gb|mb|kb|b)?$/u;

/** A budget as a config may express it: `'250kb'`, `'1.5 MB'`, or bytes. */
export type SizeValue = number | string;

/** Bytes, or null when the text is not a size. A bad budget is reported
 *  rather than silently treated as zero, which would fail every build, or
 *  as infinity, which would enforce nothing. */
export const parseSize = (value: SizeValue) => {
	if (typeof value === 'number')
		return Number.isFinite(value) && value >= 0 ? value : null;
	const match = SIZE_PATTERN.exec(value.trim().toLowerCase());
	if (match === null) return null;
	const amount = Number(match[1]);
	if (!Number.isFinite(amount) || amount < 0) return null;

	return amount * (SIZE_UNITS[match[2] ?? 'b'] ?? 1);
};

export type SizeBudgets = {
	/** Per category, named as `absolute analyze` groups them. */
	categories?: Record<string, SizeValue>;
	/** Largest any single manifest entry may be. */
	perEntry?: SizeValue;
	/** Largest the whole build may be. */
	total?: SizeValue;
};

export type BudgetViolation = {
	/** Bytes allowed. */
	limit: number;
	/** What was measured — a category name, an entry key, or `total`. */
	subject: string;
	/** Bytes measured. */
	size: number;
	what: 'category' | 'entry' | 'total';
};

export type BudgetProblem = {
	/** The budget that could not be read, as written. */
	given: string;
	subject: string;
};

export type BudgetReport = {
	/** Budgets that were set and met, for a report that says so rather
	 *  than printing nothing and leaving you guessing whether it ran. */
	passed: { limit: number; size: number; subject: string }[];
	/** Budgets that could not be parsed. */
	problems: BudgetProblem[];
	violations: BudgetViolation[];
};

export type EvaluateBudgetsInput = {
	budgets: SizeBudgets;
	/** Totals per category, as the caller groups them. */
	categoryTotals: Record<string, number>;
	/** Every manifest entry's size, keyed by manifest key. */
	entrySizes: Record<string, number>;
};

type Check = {
	limit: SizeValue | undefined;
	size: number;
	subject: string;
	what: BudgetViolation['what'];
};

const verdictFor = (check: Check, report: BudgetReport) => {
	if (check.limit === undefined) return;
	const limit = parseSize(check.limit);
	if (limit === null) {
		report.problems.push({
			given: String(check.limit),
			subject: check.subject
		});

		return;
	}
	if (check.size > limit) {
		report.violations.push({
			limit,
			size: check.size,
			subject: check.subject,
			what: check.what
		});

		return;
	}
	report.passed.push({ limit, size: check.size, subject: check.subject });
};

/** Which budgets are met, which are not, and which could not be read.
 *
 *  A category named in the config that the build has no assets for counts
 *  as zero and therefore passes: a budget for something you have not
 *  built yet should not fail. A category the build HAS that the config
 *  does not name is simply unbudgeted. */
export const evaluateBudgets = ({
	budgets,
	categoryTotals,
	entrySizes
}: EvaluateBudgetsInput) => {
	const report: BudgetReport = {
		passed: [],
		problems: [],
		violations: []
	};
	const total = Object.values(entrySizes).reduce(
		(sum, size) => sum + size,
		0
	);

	verdictFor(
		{ limit: budgets.total, size: total, subject: 'total', what: 'total' },
		report
	);

	for (const [name, limit] of Object.entries(budgets.categories ?? {}))
		verdictFor(
			{
				limit,
				size: categoryTotals[name] ?? 0,
				subject: name,
				what: 'category'
			},
			report
		);

	/* Per-entry is one limit against many subjects, so only the entries
	 * that break it are reported — a project has hundreds of chunks and a
	 * passing line for each would bury the failures. */
	const perEntry =
		budgets.perEntry === undefined ? null : parseSize(budgets.perEntry);
	if (budgets.perEntry !== undefined && perEntry === null) {
		report.problems.push({
			given: String(budgets.perEntry),
			subject: 'perEntry'
		});

		return report;
	}
	if (perEntry === null) return report;

	const over = Object.entries(entrySizes)
		.filter(([, size]) => size > perEntry)
		.sort(([, left], [, right]) => right - left);
	for (const [key, size] of over)
		report.violations.push({
			limit: perEntry,
			size,
			subject: key,
			what: 'entry'
		});
	if (over.length === 0)
		report.passed.push({
			limit: perEntry,
			size: Math.max(0, ...Object.values(entrySizes)),
			subject: 'largest entry'
		});

	return report;
};
