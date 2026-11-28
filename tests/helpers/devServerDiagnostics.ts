import { appendFileSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';

/* What a dev server said, kept for the test that fails next to it.
 *
 * An HMR test that times out says what it was waiting for and nothing
 * about why it never came. "Received: []" is the same message whether
 * the file watcher never saw the edit, a rebuild started and stalled,
 * or the test's own socket had closed — and those are three different
 * bugs. The dev server knows which: it logs every edit it sees and
 * answers `/hmr-status` with what it has queued. This keeps its output
 * where a failing wait can quote it, and, on CI, where the run's logs
 * are uploaded from. */

type Recorded = {
	lines: string[];
	logFile: string | undefined;
	startedAt: number;
};

const servers = new Map<number, Recorded>();
const REPORT_LINES = 40;
const STATUS_TIMEOUT_MS = 2000;

/* The test file that started the server, for the log's name. */
const callerName = () => {
	const frame = (new Error().stack ?? '')
		.split('\n')
		.find(
			(line) =>
				line.includes('/tests/') && !line.includes('/tests/helpers/')
		);
	const [, file = 'unknown'] =
		/([^/\s()]+\.test\.tsx?)/.exec(frame ?? '') ?? [];

	return basename(file).replace(/\.test\.tsx?$/, '');
};

/* On CI every dev server's whole output is kept beside the shard logs
 * (.github/scripts/keep-shard-logs.sh), which the job uploads. */
const logFileFor = (port: number) => {
	const root = process.env.RUNNER_TEMP;
	if (!root) return undefined;
	const directory = join(root, 'shard-logs', 'dev-servers');
	try {
		mkdirSync(directory, { recursive: true });

		return join(directory, `${callerName()}-${port}-${Date.now()}.log`);
	} catch {
		return undefined;
	}
};

const statusOf = async (port: number, protocol: 'http' | 'https') => {
	try {
		const response = await fetch(
			`${protocol}://localhost:${port}/hmr-status`,
			{
				signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
				tls: { rejectUnauthorized: false }
			}
		);

		return await response.text();
	} catch (error) {
		return `unreachable (${error instanceof Error ? error.message : String(error)})`;
	}
};

/** What the dev server on `port` is doing and has just said, for the
 *  message of a wait that timed out. */
export const devServerReport = async (
	port: number,
	protocol: 'http' | 'https' = 'http'
) => {
	const recorded = servers.get(port);
	const elapsed = recorded
		? `${Date.now() - recorded.startedAt}ms`
		: 'unknown';
	const lines = recorded?.lines.slice(-REPORT_LINES) ?? [];

	return [
		`Dev server on port ${port}, ${elapsed} after it was started.`,
		`hmr-status: ${await statusOf(port, protocol)}`,
		lines.length > 0
			? `Its last ${lines.length} lines:\n${lines.join('\n')}`
			: 'It was not started by this test process, so its output is not known.'
	].join('\n');
};

export const forgetDevServer = (port: number) => {
	servers.delete(port);
};

/** Starts recording a dev server's output. Returns what to call with
 *  each line it prints. */
export const recordDevServer = (port: number) => {
	const recorded: Recorded = {
		lines: [],
		logFile: logFileFor(port),
		startedAt: Date.now()
	};
	servers.set(port, recorded);

	return (line: string) => {
		const stamped = `[+${Date.now() - recorded.startedAt}ms] ${line}`;
		recorded.lines.push(stamped);
		if (!recorded.logFile) return;
		try {
			appendFileSync(recorded.logFile, `${stamped}\n`);
		} catch {
			// The log is a convenience; a full disk must not fail a test.
		}
	};
};
