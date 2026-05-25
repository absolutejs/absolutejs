import { LIST_TUI_DEFAULT_WIDTH } from '../../constants';
import {
	aggregates,
	fetchRequests,
	findServer,
	formatRequestRow,
	pathColumnWidth,
	requestHeader
} from '../inspectData';
import { runInspectTui } from '../inspectTui';
import { colors } from '../tuiPrimitives';

const SNAPSHOT_ROWS = 30;

const printDim = (message: string) =>
	process.stdout.write(`${colors.dim}${message}${colors.reset}\n`);

// Live TUI by default; a one-shot snapshot when piped or asked for --json.
export const runInspect = async (args: string[]) => {
	if (!args.includes('--json') && process.stdout.isTTY) {
		await runInspectTui();

		return;
	}

	const server = await findServer();
	if (!server || server.url === null) {
		printDim(
			'No running server found. Start one with `absolute dev`, then run `absolute inspect`.'
		);

		return;
	}

	const records = await fetchRequests(server.url);
	if (!records) {
		printDim(
			`Could not read requests from ${server.name} — the inspector needs a dev server.`
		);

		return;
	}

	if (args.includes('--json')) {
		process.stdout.write(`${JSON.stringify(records, null, 2)}\n`);

		return;
	}

	if (records.length === 0) {
		printDim('No requests captured yet — hit your app, then run it again.');

		return;
	}

	const width = process.stdout.columns ?? LIST_TUI_DEFAULT_WIDTH;
	const pathWidth = pathColumnWidth(width);
	const lines = records
		.slice(-SNAPSHOT_ROWS)
		.map((record) => `  ${formatRequestRow(record, pathWidth)}`);
	const { avgMs, count, p95Ms } = aggregates(records);
	process.stdout.write(
		`  ${requestHeader(pathWidth)}\n${lines.join('\n')}\n\n${colors.dim}${count} requests · ${avgMs}ms avg · ${p95Ms}ms p95 · ${server.name}${colors.reset}\n`
	);
};
