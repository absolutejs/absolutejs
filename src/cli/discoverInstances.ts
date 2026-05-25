import { listLiveInstances } from '../utils/instanceRegistry';
import { scanListeners, type PortListener } from '../utils/portScan';
import type { InstanceRecord } from '../../types/cli';

const MS_PER_SECOND = 1000;

// Only surface JS runtimes — the things `absolute dev`/`start`/`compile`
// produce (and that AI agents spin up and forget). Skips postgres, docker,
// sshd, and other non-server listeners.
const isJsRuntime = (command: string) => /\b(bun|deno|node)\b/.test(command);

// Derive a readable label from a hand-run server's command, e.g.
// `bun run /repo/dealroom/dist/server.js` -> `dealroom`.
const untrackedName = (command: string) => {
	const entry = command
		.split(/\s+/)
		.find((token) => /\.(cjs|js|mjs|ts)$/.test(token));
	if (entry === undefined) return 'untracked';

	const segments = entry.split('/').filter(Boolean);
	segments.pop();
	let dir = segments.pop();
	if (dir === 'build' || dir === 'dist' || dir === 'src') dir = segments.pop();

	return dir ?? 'untracked';
};

const toUntrackedRecord = (listener: PortListener): InstanceRecord => ({
	command: listener.command.split(/\s+/),
	configPath: null,
	controllerPid: listener.pid,
	cwd: '',
	frameworks: [],
	host: 'localhost',
	https: false,
	logFile: null,
	name: untrackedName(listener.command),
	pid: listener.pid,
	port: listener.port,
	ppid: 0,
	source: 'untracked',
	startedAt: new Date(
		Date.now() - listener.etimes * MS_PER_SECOND
	).toISOString()
});

const compareInstances = (left: InstanceRecord, right: InstanceRecord) => {
	const leftPort = left.port ?? Number.MAX_SAFE_INTEGER;
	const rightPort = right.port ?? Number.MAX_SAFE_INTEGER;
	if (leftPort !== rightPort) return leftPort - rightPort;

	return left.name.localeCompare(right.name);
};

/** Registry-tracked instances unioned with any JS server listening on a port
 *  that the registry doesn't know about — so `absolute ps` shows orphans
 *  (dead controllers, hand-run builds) the file registry alone would miss. */
export const discoverInstances = async () => {
	const registered = listLiveInstances();
	const knownPids = new Set(
		registered.flatMap((record) => [record.pid, record.controllerPid])
	);
	// A registered dev's listener is often a grandchild process, so also skip
	// any scanned listener whose port a registered instance already owns —
	// otherwise the same server shows twice (once tracked, once "untracked").
	const knownPorts = new Set(
		registered
			.map((record) => record.port)
			.filter((port): port is number => port !== null)
	);
	const listeners = await scanListeners();

	const untracked: InstanceRecord[] = [];
	const seen = new Set<number>();
	for (const listener of listeners) {
		if (knownPids.has(listener.pid) || seen.has(listener.pid)) continue;
		if (knownPorts.has(listener.port)) continue;
		if (!isJsRuntime(listener.command)) continue;
		seen.add(listener.pid);
		untracked.push(toUntrackedRecord(listener));
	}

	return [...registered, ...untracked].sort(compareInstances);
};
