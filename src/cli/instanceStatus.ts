import { createConnection } from 'node:net';
import { INSTANCE_PROBE_TIMEOUT_MS } from '../constants';
import type {
	InstanceRecord,
	InstanceStatus,
	LiveInstance
} from '../../types/cli';

// Turns the registry's flat records into display-ready `LiveInstance`s: derives
// the browser URL and probes the port so the dashboard can distinguish a bound
// "ready" server from one that is still "starting".

const displayHost = (host: string) =>
	host === '0.0.0.0' || host === '::' ? 'localhost' : host;

const probePort = (host: string, port: number) => {
	const { promise, resolve } = Promise.withResolvers<boolean>();
	const socket = createConnection({ host: displayHost(host), port });
	const timeout = setTimeout(() => {
		socket.destroy();
		resolve(false);
	}, INSTANCE_PROBE_TIMEOUT_MS);

	socket.once('connect', () => {
		clearTimeout(timeout);
		socket.end();
		resolve(true);
	});
	socket.once('error', () => {
		clearTimeout(timeout);
		socket.destroy();
		resolve(false);
	});

	return promise;
};

const probeStatus = async (record: InstanceRecord) => {
	if (record.port === null) {
		return 'starting' satisfies InstanceStatus;
	}

	const reachable = await probePort(record.host, record.port);

	return (reachable ? 'ready' : 'starting') satisfies InstanceStatus;
};

export const enrichInstances = async (records: InstanceRecord[]) => {
	const now = Date.now();
	const statuses = await Promise.all(records.map(probeStatus));

	return records.map(
		(record, index) =>
			({
				...record,
				status: statuses[index] ?? 'starting',
				uptimeMs: Math.max(0, now - Date.parse(record.startedAt)),
				url: instanceUrl(record)
			}) satisfies LiveInstance
	);
};

export const instanceUrl = (record: InstanceRecord) => {
	if (record.port === null) return null;

	return `${record.https ? 'https' : 'http'}://${displayHost(record.host)}:${record.port}/`;
};
