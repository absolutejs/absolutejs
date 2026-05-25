import { formatBytes } from '../utils/formatBytes';
import { discoverInstances } from './discoverInstances';
import { enrichInstances } from './instanceStatus';
import { colors, padLine, truncateText } from './tuiPrimitives';
import type { LiveInstance, RequestKind, RequestRecord } from '../../types/cli';

// Shared data + formatting for `absolute inspect` (snapshot and live TUI).

const SLOW_MS = 100;
const VERY_SLOW_MS = 500;
const HTTP_SERVER_ERROR = 500;
const HTTP_CLIENT_ERROR = 400;
const HTTP_REDIRECT = 300;
const P95 = 0.95;
const TIME_WIDTH = 8;
const METHOD_WIDTH = 6;
const STATUS_WIDTH = 6;
const MS_WIDTH = 7;
const SIZE_WIDTH = 8;
const MIN_PATH_WIDTH = 12;
const COLUMN_GAP = '  ';
const COLUMN_COUNT = 6;

const METHOD_COLOR: Record<string, string> = {
	DELETE: colors.red,
	GET: colors.green,
	PATCH: colors.yellow,
	POST: colors.cyan,
	PUT: colors.yellow
};

const statusColor = (status: number) => {
	if (status >= HTTP_SERVER_ERROR) return colors.red;
	if (status >= HTTP_CLIENT_ERROR) return colors.yellow;
	if (status >= HTTP_REDIRECT) return colors.cyan;

	return colors.green;
};

const durationColor = (durationMs: number) => {
	if (durationMs >= VERY_SLOW_MS) return colors.red;
	if (durationMs >= SLOW_MS) return colors.yellow;

	return colors.dim;
};

// Asset/HMR/internal traffic is dimmed so real page + API requests stand out.
const isDim = (kind: RequestKind) => kind !== 'api' && kind !== 'page';

const pickServer = (instances: LiveInstance[]) => {
	const withUrl = instances.filter((instance) => instance.url !== null);

	return (
		withUrl.find((instance) => instance.source === 'dev') ??
		withUrl.find((instance) => instance.source !== 'untracked') ??
		withUrl[0] ??
		null
	);
};

const clock = (epochMs: number) =>
	new Date(epochMs).toLocaleTimeString([], { hour12: false });

const tint = (text: string, color: string, dim: boolean) =>
	`${dim ? colors.dim : color}${text}${colors.reset}`;

export const aggregates = (records: RequestRecord[]) => {
	const durations = records
		.filter((record) => !isDim(record.kind))
		.map((record) => record.durationMs)
		.sort((left, right) => left - right);
	const total = durations.reduce((sum, value) => sum + value, 0);
	const avgMs = durations.length ? Math.round(total / durations.length) : 0;
	const p95Index = Math.min(
		durations.length - 1,
		Math.floor(durations.length * P95)
	);
	const p95Ms = durations.length ? Math.round(durations[p95Index] ?? 0) : 0;

	return { avgMs, count: records.length, p95Ms };
};

export const fetchRequests = async (url: string) => {
	try {
		const response = await fetch(`${url}__absolute/requests`);
		if (!response.ok) return null;
		const data = await response.json();
		if (!Array.isArray(data)) return null;

		return data.map(
			(entry): RequestRecord => ({
				at: Number(entry.at) || 0,
				durationMs: Number(entry.durationMs) || 0,
				kind: entry.kind,
				method: String(entry.method ?? ''),
				path: String(entry.path ?? ''),
				size:
					entry.size === null || entry.size === undefined
						? null
						: Number(entry.size),
				status: Number(entry.status) || 0
			})
		);
	} catch {
		return null;
	}
};

export const findServer = async () =>
	pickServer(await enrichInstances(await discoverInstances()));

export const formatRequestRow = (record: RequestRecord, pathWidth: number) => {
	const dim = isDim(record.kind);
	const size = record.size === null ? '—' : formatBytes(record.size);

	return [
		tint(padLine(clock(record.at), TIME_WIDTH), colors.dim, true),
		tint(
			padLine(record.method, METHOD_WIDTH),
			METHOD_COLOR[record.method] ?? colors.reset,
			dim
		),
		tint(
			padLine(truncateText(record.path, pathWidth), pathWidth),
			colors.reset,
			dim
		),
		tint(
			padLine(String(record.status), STATUS_WIDTH),
			statusColor(record.status),
			dim
		),
		tint(
			padLine(`${Math.round(record.durationMs)}ms`, MS_WIDTH),
			durationColor(record.durationMs),
			dim
		),
		tint(padLine(size, SIZE_WIDTH), colors.dim, true)
	].join(COLUMN_GAP);
};

export const pathColumnWidth = (totalWidth: number) => {
	const fixed =
		TIME_WIDTH + METHOD_WIDTH + STATUS_WIDTH + MS_WIDTH + SIZE_WIDTH;
	const gaps = COLUMN_GAP.length * (COLUMN_COUNT - 1);

	return Math.max(MIN_PATH_WIDTH, totalWidth - fixed - gaps);
};

export const requestHeader = (pathWidth: number) =>
	`${colors.dim}${[
		padLine('TIME', TIME_WIDTH),
		padLine('METHOD', METHOD_WIDTH),
		padLine('PATH', pathWidth),
		padLine('STATUS', STATUS_WIDTH),
		padLine('TOOK', MS_WIDTH),
		padLine('SIZE', SIZE_WIDTH)
	].join(COLUMN_GAP)}${colors.reset}`;
