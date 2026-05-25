import {
	closeSync,
	existsSync,
	openSync,
	readSync,
	statSync,
	watchFile
} from 'node:fs';
import { LIST_LOG_TAIL_MAX_BYTES, UNFOUND_INDEX } from '../../constants';
import { discoverInstances } from '../discoverInstances';
import { enrichInstances } from '../instanceStatus';
import { colors } from '../tuiPrimitives';
import type { LiveInstance } from '../../../types/cli';

const DEFAULT_LINES = 40;
const POLL_MS = 250;
const LINES_FLAG_SPAN = 2;

const readFrom = (path: string, start: number, length: number) => {
	if (length <= 0) return '';
	const descriptor = openSync(path, 'r');
	try {
		const buffer = Buffer.alloc(length);
		readSync(descriptor, buffer, 0, length, start);

		return buffer.toString('utf-8');
	} finally {
		closeSync(descriptor);
	}
};

const tailLines = (path: string, maxLines: number) => {
	const { size } = statSync(path);
	const start = Math.max(0, size - LIST_LOG_TAIL_MAX_BYTES);
	const lines = readFrom(path, start, size - start).split('\n');

	return lines.slice(Math.max(0, lines.length - maxLines)).join('\n');
};

const parseLines = (args: string[]) => {
	const index = args.findIndex(
		(arg) => arg === '-n' || arg === '--lines'
	);
	if (index === UNFOUND_INDEX) return DEFAULT_LINES;
	const value = Number(args[index + 1]);

	return Number.isInteger(value) && value > 0 ? value : DEFAULT_LINES;
};

// Strip `-n N` so the remaining bare token is the server name.
const targetName = (args: string[]) => {
	const index = args.findIndex(
		(arg) => arg === '-n' || arg === '--lines'
	);
	const cleaned =
		index === UNFOUND_INDEX
			? args
			: [...args.slice(0, index), ...args.slice(index + LINES_FLAG_SPAN)];

	return cleaned.find((arg) => !arg.startsWith('-'));
};

const followFile = (path: string) => {
	let offset = statSync(path).size;
	watchFile(path, { interval: POLL_MS }, (current) => {
		if (current.size > offset) {
			process.stdout.write(readFrom(path, offset, current.size - offset));
		}
		offset = current.size;
	});
};

const printDim = (message: string) => {
	process.stdout.write(`${colors.dim}${message}${colors.reset}\n`);
};

const printAvailable = (instances: LiveInstance[]) => {
	const named = instances.filter((instance) => instance.logFile !== null);
	if (named.length === 0) {
		printDim('No running servers have a captured log.');

		return;
	}
	printDim('Servers with logs:');
	named.forEach((instance) => printDim(`  ${instance.name}`));
};

export const runLogs = async (args: string[]) => {
	const instances = await enrichInstances(await discoverInstances());
	const name = targetName(args);

	if (name === undefined) {
		printDim('Usage: absolute logs <name> [-f] [-n <lines>]');
		printAvailable(instances);

		return;
	}

	const match = instances.find((instance) => instance.name === name);
	if (!match) {
		printDim(`No running server named "${name}".`);
		printAvailable(instances);

		return;
	}

	if (match.logFile === null || !existsSync(match.logFile)) {
		printDim(
			`"${name}" has no captured log (untracked, or started outside the CLI).`
		);

		return;
	}

	process.stdout.write(`${tailLines(match.logFile, parseLines(args))}\n`);

	if (args.includes('-f') || args.includes('--follow')) {
		printDim(`— following ${match.name} · ctrl+c to stop —`);
		followFile(match.logFile);
	}
};
