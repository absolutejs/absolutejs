import { existsSync, readFileSync } from 'node:fs';
import { formatBytes } from '../utils/formatBytes';
import { colors, padLine } from './tuiPrimitives';

// Diffs two V8 .heapsnapshot files (the format `absolute dev`'s `m` keypress
// writes) by aggregating self_size per object type, so a growing bucket across
// two snapshots points straight at a leak — the signal RSS alone can't give you.

const TOP = 15;
const STRING_TYPES = new Set([
	'concatenated string',
	'sliced string',
	'string'
]);

type Bucket = { count: number; size: number };

const aggregate = (path: string) => {
	const data = JSON.parse(readFileSync(path, 'utf-8'));
	const { nodes, strings } = data;
	const { node_fields: fields, node_types: nodeTypes } = data.snapshot.meta;
	const [typeNames] = nodeTypes;
	const stride = fields.length;
	const nameIdx = fields.indexOf('name');
	const sizeIdx = fields.indexOf('self_size');
	const typeIdx = fields.indexOf('type');
	const buckets = new Map<string, Bucket>();
	let total = 0;
	for (let offset = 0; offset < nodes.length; offset += stride) {
		const typeName = typeNames[nodes[offset + typeIdx] ?? 0] ?? 'object';
		const size = nodes[offset + sizeIdx] ?? 0;
		const key = STRING_TYPES.has(typeName)
			? '(string)'
			: strings[nodes[offset + nameIdx] ?? 0] || `(${typeName})`;
		total += size;
		const bucket = buckets.get(key) ?? { count: 0, size: 0 };
		bucket.size += size;
		bucket.count += 1;
		buckets.set(key, bucket);
	}

	return { buckets, total };
};

const signed = (value: number) => (value >= 0 ? `+${value}` : `${value}`);

const signedBytes = (value: number) =>
	value >= 0 ? `+${formatBytes(value)}` : `-${formatBytes(-value)}`;

const NAME_WIDTH = 28;
const DELTA_WIDTH = 12;

export const runHeapDiff = (beforePath?: string, afterPath?: string) => {
	if (!beforePath || !afterPath) {
		process.stdout.write(
			`${colors.red}Usage: absolute mem diff <before.heapsnapshot> <after.heapsnapshot>${colors.reset}\n`
		);
		process.exitCode = 1;

		return;
	}
	for (const path of [beforePath, afterPath]) {
		if (existsSync(path)) continue;
		process.stdout.write(
			`${colors.red}No such file: ${path}${colors.reset}\n`
		);
		process.exitCode = 1;

		return;
	}

	const before = aggregate(beforePath);
	const after = aggregate(afterPath);
	const keys = new Set([...before.buckets.keys(), ...after.buckets.keys()]);
	const rows = [...keys]
		.map((key) => {
			const a = before.buckets.get(key) ?? { count: 0, size: 0 };
			const b = after.buckets.get(key) ?? { count: 0, size: 0 };

			return {
				deltaCount: b.count - a.count,
				deltaSize: b.size - a.size,
				key
			};
		})
		.filter((row) => row.deltaSize !== 0)
		.sort((left, right) => right.deltaSize - left.deltaSize)
		.slice(0, TOP);

	const totalDelta = after.total - before.total;
	const header = `  ${colors.dim}heap  ${formatBytes(before.total)} → ${formatBytes(after.total)}  ${totalDelta >= 0 ? colors.red : colors.green}${signedBytes(totalDelta)}${colors.reset}\n`;
	const tableHead = `  ${colors.dim}${padLine('GROWTH', DELTA_WIDTH)}${padLine('COUNT', DELTA_WIDTH)}TYPE${colors.reset}`;
	const lines = rows.map((row) => {
		const color = row.deltaSize > 0 ? colors.red : colors.green;

		return `  ${color}${padLine(signedBytes(row.deltaSize), DELTA_WIDTH)}${colors.reset}${colors.dim}${padLine(signed(row.deltaCount), DELTA_WIDTH)}${colors.reset}${padLine(row.key, NAME_WIDTH)}`;
	});
	process.stdout.write(
		`${header}\n${tableHead}\n${lines.join('\n')}\n\n${colors.dim}top ${rows.length} object types by growth${colors.reset}\n`
	);
};
