import {
	mkdirSync,
	readFileSync,
	readdirSync,
	unlinkSync,
	writeFileSync
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import type { InstanceRecord, InstanceSource } from '../../types/cli';

// Each running `absolute dev` writes one `<pid>.json` here on boot and a
// sibling `<pid>.log` for its tee'd output. Living under the user's home
// (not the project's `.absolutejs/`) is what lets `absolute ps` aggregate
// every dev server on the machine regardless of which project launched it.
const registeredPids = new Set<number>();
let exitHandlerRegistered = false;

export const instanceFilePath = (pid: number) =>
	join(instanceRegistryDir(), `${pid}.json`);

export const instanceLogPath = (pid: number) =>
	join(instanceRegistryDir(), `${pid}.log`);

export const instanceRegistryDir = () =>
	join(homedir(), '.absolutejs', 'instances');

const removeInstanceFilesSync = (pid: number) => {
	try {
		unlinkSync(instanceFilePath(pid));
	} catch {
		/* already gone */
	}
	try {
		unlinkSync(instanceLogPath(pid));
	} catch {
		/* already gone */
	}
};

const registerExitHandlerOnce = () => {
	if (exitHandlerRegistered) return;
	exitHandlerRegistered = true;

	// Safety net only: a graceful `absolute dev` shutdown calls
	// `deregisterInstance` itself. This catches hard exits so a crashed
	// process doesn't leave a phantom row — `listLiveInstances` also prunes
	// dead pids on read as a second line of defense.
	process.on('exit', () => {
		for (const pid of registeredPids) {
			removeInstanceFilesSync(pid);
		}
		registeredPids.clear();
	});
};

const isProcessAlive = (pid: number) => {
	try {
		// Signal 0 is a no-op liveness probe.
		process.kill(pid, 0);

		return true;
	} catch (error) {
		const code =
			error instanceof Error && 'code' in error ? error.code : undefined;
		if (code === 'ESRCH') return false;

		// EPERM → alive but owned by another user; anything else → assume alive.
		return true;
	}
};

const readJsonFile = (path: string) => {
	try {
		return JSON.parse(readFileSync(path, 'utf-8'));
	} catch {
		return null;
	}
};

const SOURCES: InstanceSource[] = [
	'compiled',
	'dev',
	'standalone',
	'start',
	'workspace'
];

const toStringArray = (value: unknown) =>
	Array.isArray(value)
		? value.filter((item): item is string => typeof item === 'string')
		: [];

const coerceSource = (value: unknown) =>
	SOURCES.find((item) => item === value) ?? 'standalone';

const coerceRecord = (parsed: ReturnType<typeof readJsonFile>) => {
	if (typeof parsed !== 'object' || parsed === null) return null;
	if (typeof parsed.pid !== 'number') return null;

	return {
		command: toStringArray(parsed.command),
		configPath:
			typeof parsed.configPath === 'string' ? parsed.configPath : null,
		controllerPid:
			typeof parsed.controllerPid === 'number'
				? parsed.controllerPid
				: parsed.pid,
		cwd: typeof parsed.cwd === 'string' ? parsed.cwd : '',
		frameworks: toStringArray(parsed.frameworks),
		host: typeof parsed.host === 'string' ? parsed.host : 'localhost',
		https: parsed.https === true,
		logFile: typeof parsed.logFile === 'string' ? parsed.logFile : null,
		name: typeof parsed.name === 'string' ? parsed.name : 'unknown',
		pid: parsed.pid,
		port: typeof parsed.port === 'number' ? parsed.port : null,
		ppid: typeof parsed.ppid === 'number' ? parsed.ppid : 0,
		source: coerceSource(parsed.source),
		startedAt:
			typeof parsed.startedAt === 'string'
				? parsed.startedAt
				: new Date().toISOString()
	} satisfies InstanceRecord;
};

const readRecordFile = (path: string) => coerceRecord(readJsonFile(path));

const compareInstances = (left: InstanceRecord, right: InstanceRecord) => {
	const leftPort = left.port ?? Number.MAX_SAFE_INTEGER;
	const rightPort = right.port ?? Number.MAX_SAFE_INTEGER;
	if (leftPort !== rightPort) return leftPort - rightPort;

	return left.name.localeCompare(right.name);
};

export const deregisterInstance = (pid: number) => {
	registeredPids.delete(pid);
	removeInstanceFilesSync(pid);
};

/** Read every registered instance, pruning any whose process has died, and
 *  return the survivors sorted by port then name. */
export const listLiveInstances = () => {
	const directory = instanceRegistryDir();
	let entries: string[];
	try {
		entries = readdirSync(directory);
	} catch {
		return [];
	}

	const live = entries
		.filter((entry) => entry.endsWith('.json'))
		.map((entry) => readRecordFile(join(directory, entry)))
		.filter((record): record is InstanceRecord => record !== null)
		.filter((record) => {
			if (isProcessAlive(record.pid)) return true;
			removeInstanceFilesSync(record.pid);

			return false;
		});

	return live.sort(compareInstances);
};

export const registerInstance = (record: InstanceRecord) => {
	mkdirSync(instanceRegistryDir(), { recursive: true });
	writeFileSync(
		instanceFilePath(record.pid),
		JSON.stringify(record, null, 2)
	);
	registeredPids.add(record.pid);
	registerExitHandlerOnce();

	return record;
};

/** Read the project label without a config flag: package.json `name`, falling
 *  back to the directory name. */
export const resolveProjectName = (cwd: string) => {
	const parsed = readJsonFile(join(cwd, 'package.json'));
	if (
		parsed !== null &&
		typeof parsed === 'object' &&
		typeof parsed.name === 'string' &&
		parsed.name.trim().length > 0
	) {
		return parsed.name;
	}

	return basename(cwd) || 'unknown';
};

export const updateInstance = (
	pid: number,
	updates: Partial<InstanceRecord>
) => {
	const current = readRecordFile(instanceFilePath(pid));
	if (!current) return;

	const next = { ...current, ...updates } satisfies InstanceRecord;
	try {
		writeFileSync(instanceFilePath(pid), JSON.stringify(next, null, 2));
	} catch {
		/* best effort */
	}
};
