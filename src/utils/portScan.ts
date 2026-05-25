/** Process/port discovery for `absolute ps`, used to surface running servers
 *  the file-based instance registry can miss — orphans whose controller died,
 *  hand-run `bun dist/server.js` builds, anything that never registered.
 *
 *  Shells out via Bun's `$` to the platform's socket lister (lsof, falling
 *  back to ss on Linux) rather than trusting a registry file, so a live
 *  listener is discoverable for as long as its process is alive. */

import { $ } from 'bun';

export type PortListener = {
	command: string;
	etimes: number;
	pid: number;
	port: number;
};

type RawListener = {
	pid: number;
	port: number;
};

type ProcessDetail = {
	command: string;
	etimes: number;
};

const parsePort = (address: string) => {
	const match = address.replace(/\(LISTEN\)$/, '').match(/:(\d+)$/);

	return match ? Number(match[1]) : null;
};

// `lsof -nP -iTCP -sTCP:LISTEN` rows look like:
//   bun  3067441 alexkahn  16u IPv4 ... TCP 127.0.0.1:3000 (LISTEN)
const parseLsof = (text: string) => {
	const seen = new Set<string>();
	const listeners: RawListener[] = [];
	for (const line of text.split('\n')) {
		if (line.length === 0 || line.startsWith('COMMAND')) continue;
		const tokens = line.trim().split(/\s+/);
		const [, pidText] = tokens;
		const pid = Number(pidText);
		const address = tokens.find((token) => /:\d+$/.test(token));
		const port = address ? parsePort(address) : null;
		if (!Number.isInteger(pid) || port === null) continue;
		const key = `${pid}:${port}`;
		if (seen.has(key)) continue;
		seen.add(key);
		listeners.push({ pid, port });
	}

	return listeners;
};

// `ss -ltnpH` rows look like:
//   LISTEN 0 512 127.0.0.1:3000 0.0.0.0:* users:(("bun",pid=3067441,fd=16))
const parseSs = (text: string) => {
	const seen = new Set<string>();
	const listeners: RawListener[] = [];
	for (const line of text.split('\n')) {
		if (line.trim().length === 0) continue;
		const [, , , local] = line.trim().split(/\s+/);
		const port = local ? parsePort(local) : null;
		const pidMatch = line.match(/pid=(\d+)/);
		if (port === null || !pidMatch) continue;
		const pid = Number(pidMatch[1]);
		const key = `${pid}:${port}`;
		if (seen.has(key)) continue;
		seen.add(key);
		listeners.push({ pid, port });
	}

	return listeners;
};

const rawListeners = async () => {
	const lsof = await $`lsof -nP -iTCP -sTCP:LISTEN`.quiet().nothrow().text();
	if (lsof.trim().length > 0) return parseLsof(lsof);

	const ssOutput = await $`ss -ltnpH`.quiet().nothrow().text();
	if (ssOutput.trim().length > 0) return parseSs(ssOutput);

	return [];
};

/** Full argv + elapsed-seconds for a set of pids, in one `ps` call. */
const describeProcesses = async (pids: number[]) => {
	const details = new Map<number, ProcessDetail>();
	if (pids.length === 0) return details;

	const output = await $`ps -o pid=,etimes=,args= -p ${pids.join(',')}`
		.quiet()
		.nothrow()
		.text();
	for (const line of output.split('\n')) {
		const trimmed = line.trim();
		if (trimmed.length === 0) continue;
		const match = trimmed.match(/^(\d+)\s+(\d+)\s+(.*)$/);
		if (!match) continue;
		const [, pidText, etimesText, command = ''] = match;
		details.set(Number(pidText), { command, etimes: Number(etimesText) });
	}

	return details;
};

/** Listening TCP servers on the machine, each annotated with the owning
 *  process's full command and uptime. Skips this process and any listener
 *  whose owner we can't describe. */
export const scanListeners = async () => {
	const listeners = await rawListeners();
	const pids = [...new Set(listeners.map((listener) => listener.pid))].filter(
		(pid) => pid !== process.pid && pid > 0
	);
	const details = await describeProcesses(pids);

	return listeners.flatMap((listener) => {
		const detail = details.get(listener.pid);
		if (!detail) return [];

		return [
			{
				command: detail.command,
				etimes: detail.etimes,
				pid: listener.pid,
				port: listener.port
			} satisfies PortListener
		];
	});
};
