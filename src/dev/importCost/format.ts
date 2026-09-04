/* Terminal rendering for the import-cost report.
 *
 * A developer-facing diagnostic, not a dump: the table is capped, every row
 * is a decision ("defer this and you get those milliseconds back"), and the
 * two lines under it say how much of the boot no single import can remove. */

export type ImportCostReport = {
	entryLabel: string;
	/** Modules whose exit call never ran; their self time is approximate. */
	incomplete: number;
	/** Out-of-order exits, i.e. top-level `await` interleaving. */
	interleaved: number;
	/** The entry's own body: everything it does after its imports, including
	 *  the `prepare()` the framework's boot build runs inside. */
	entryBodyMs: number;
	moduleCount: number;
	/** Time that ran outside every instrumented module: CommonJS
	 *  dependencies, native modules, and the dev server's concurrent boot
	 *  build. Deliberately not credited to any import. */
	outsideMs: number;
	/** The recorder's own read-and-rewrite time, excluded from every figure
	 *  above and reported so the numbers can be sanity-checked. */
	overheadMs: number;
	rows: readonly ImportCostRow[];
	sharedBaseCount: number;
	sharedBaseMs: number;
	totalMs: number;
};

export type ImportCostRow = {
	count: number;
	savingMs: number;
	specifier: string;
	verdict: string;
};

const MAX_ROWS = 12;
const MIN_ROW_MS = 15;
const SPECIFIER_WIDTH = 42;
const SAVING_WIDTH = 8;
const COUNT_WIDTH = 8;
const ELLIPSIS = '…';

const formatMs = (value: number) => `${Math.round(value)}ms`;

const truncate = (value: string, width: number) => {
	if (value.length <= width) return value;

	return ELLIPSIS + value.slice(value.length - width + 1);
};

const renderRow = (row: ImportCostRow) =>
	`  ${formatMs(row.savingMs).padStart(SAVING_WIDTH)}${String(
		row.count
	).padStart(
		COUNT_WIDTH
	)}  ${truncate(row.specifier, SPECIFIER_WIDTH).padEnd(SPECIFIER_WIDTH)}  ${
		row.verdict
	}`;

const visibleRows = (rows: readonly ImportCostRow[]) =>
	rows.filter((row) => row.savingMs >= MIN_ROW_MS).slice(0, MAX_ROWS);

const remainderLine = (
	rows: readonly ImportCostRow[],
	shown: readonly ImportCostRow[]
) => {
	const rest = rows.filter((row) => !shown.includes(row));
	if (rest.length === 0) return [];
	const restMs = rest.reduce((total, row) => total + row.savingMs, 0);

	return [
		`  ${`${rest.length} more`.padStart(SAVING_WIDTH)}${''.padStart(
			COUNT_WIDTH
		)}  imports below ${MIN_ROW_MS}ms — ${formatMs(restMs)} between them`
	];
};

const caveats = (report: ImportCostReport) => {
	const lines: string[] = [];
	if (report.entryBodyMs >= MIN_ROW_MS) {
		lines.push(
			`  ${formatMs(report.entryBodyMs)} was the entry's own body — the work it does after its imports,`
		);
		lines.push(
			'  including the boot build it waits on. No import can move that.'
		);
	}
	if (report.outsideMs >= MIN_ROW_MS) {
		lines.push(
			`  ${formatMs(report.outsideMs)} more ran outside the instrumented modules (CommonJS dependencies, native`
		);
		lines.push(
			'  modules, the concurrent boot build) and is credited to no import.'
		);
	}
	if (report.overheadMs >= MIN_ROW_MS) {
		lines.push(
			`  ${formatMs(report.overheadMs)} of that boot was this diagnostic reading and rewriting sources; it is excluded above.`
		);
	}
	if (report.incomplete > 0) {
		lines.push(
			`  ${report.incomplete} modules never ran their exit hook (CommonJS top-level return, or a throw); their self time is approximate.`
		);
	}
	if (report.interleaved > 0) {
		lines.push(
			`  ${report.interleaved} out-of-order module exits (top-level await); self times around those are approximate.`
		);
	}

	return lines;
};

export const formatImportCostReport = (report: ImportCostReport) => {
	const shown = visibleRows(report.rows);
	const header = `  ${'saving'.padStart(SAVING_WIDTH)}${'modules'.padStart(
		COUNT_WIDTH
	)}  ${'import'.padEnd(SPECIFIER_WIDTH)}  verdict`;

	return [
		`\nAbsoluteJS import cost — ${report.entryLabel}`,
		`${formatMs(report.totalMs)} of module evaluation across ${report.moduleCount} modules, ${report.rows.length} top-level imports.`,
		'',
		header,
		...shown.map(renderRow),
		...remainderLine(report.rows, shown),
		'',
		`  shared base: ${formatMs(report.sharedBaseMs)} across ${report.sharedBaseCount} modules — reached through more than one`,
		'  import (or loaded before the entry), so deferring any single import does not remove it.',
		...caveats(report),
		''
	].join('\n');
};
