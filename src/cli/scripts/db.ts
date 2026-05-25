import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { env, spawn, SQL } from 'bun';
import { UNFOUND_INDEX } from '../../constants';
import { colors } from '../tuiPrimitives';

type ColumnMeta = { isJson: boolean; name: string };
type TableMeta = { columns: ColumnMeta[]; name: string; primaryKey: string[] };
type ForeignLink = { from: string; to: string };
type DbRow = Record<string, unknown>;
type BackupFile = { at: string; tables: Record<string, DbRow[]>; v: number };
type DbOptions = {
	exclude: string[];
	only: string[];
	out?: string;
	truncate: boolean;
	url: string;
	yes: boolean;
};
type NameRow = { table_name: string };
type ColumnRow = { column_name: string; data_type: string };
type KeyRow = { col: string };
type LinkRow = { child: string; parent: string };

const BACKUP_FORMAT_VERSION = 1;
const RESTORE_CHUNK_ROWS = 500;
const URL_ENV_KEYS = ['DATABASE_URL', 'POSTGRES_URL', 'DATABASE_URL_UNPOOLED'];
const JSON_DATA_TYPES = ['json', 'jsonb'];
const SEED_CANDIDATES = ['db/seed.ts', 'src/db/seed.ts', 'seed.ts'];
const VALUE_FLAGS = ['--out', '--url', '--only', '--exclude'];

const paint = (text: string, color: string) => `${color}${text}${colors.reset}`;

export const chunkRows = <Item>(items: Item[], size: number) =>
	Array.from({ length: Math.ceil(items.length / size) }, (_, idx) =>
		items.slice(idx * size, idx * size + size)
	);
export const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;

const resolveUrl = (explicit: string | undefined) => {
	const found =
		explicit ??
		URL_ENV_KEYS.map((key) => env[key]).find(
			(value) => typeof value === 'string' && value !== ''
		);
	if (found === undefined || found === '')
		throw new Error(
			`No database URL found. Set ${URL_ENV_KEYS.join(' or ')}, or pass --url <url>.`
		);

	return found;
};

const keepTable = (name: string, options: DbOptions) =>
	(options.only.length === 0 || options.only.includes(name)) &&
	!options.exclude.includes(name);

const listTables = async (sql: SQL) => {
	const rows: NameRow[] =
		await sql`select table_name from information_schema.tables where table_schema = ${'public'} and table_type = ${'BASE TABLE'} order by table_name`;

	return rows.map((row) => row.table_name);
};

const columnsFor = async (sql: SQL, name: string) => {
	const rows: ColumnRow[] = await sql.unsafe(
		`select column_name, data_type from information_schema.columns where table_schema = $1 and table_name = $2 order by ordinal_position`,
		['public', name]
	);

	return rows.map((row) => ({
		isJson: JSON_DATA_TYPES.includes(row.data_type),
		name: row.column_name
	}));
};

const primaryKeyFor = async (sql: SQL, name: string) => {
	const rows: KeyRow[] = await sql.unsafe(
		`select a.attname as col from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey) where i.indrelid = $1::regclass and i.indisprimary order by a.attnum`,
		[`public.${quoteIdent(name)}`]
	);

	return rows.map((row) => row.col);
};

const tableMeta = async (sql: SQL, name: string) => {
	const [columns, primaryKey] = await Promise.all([
		columnsFor(sql, name),
		primaryKeyFor(sql, name)
	]);

	return { columns, name, primaryKey };
};

const foreignLinks = async (sql: SQL) => {
	const rows: LinkRow[] = await sql.unsafe(
		`select tc.table_name as child, ccu.table_name as parent from information_schema.table_constraints tc join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = $1`,
		['public']
	);

	return rows.map((row) => ({
		from: row.child,
		to: row.parent
	}));
};

// Topological sort so parents are restored before the rows that reference them.
// Self-references and cycle leftovers are appended in their original order.
export const conflictClause = (meta: TableMeta) => {
	if (meta.primaryKey.length === 0) return 'on conflict do nothing';
	const target = meta.primaryKey.map(quoteIdent).join(', ');
	const updatable = meta.columns
		.map((col) => col.name)
		.filter((name) => !meta.primaryKey.includes(name));
	if (updatable.length === 0) return `on conflict (${target}) do nothing`;
	const sets = updatable
		.map((name) => `${quoteIdent(name)} = excluded.${quoteIdent(name)}`)
		.join(', ');

	return `on conflict (${target}) do update set ${sets}`;
};
export const dependencyOrder = (names: string[], links: ForeignLink[]) => {
	const present = new Set(names);
	const edges = links.filter(
		(link) =>
			present.has(link.from) &&
			present.has(link.to) &&
			link.from !== link.to
	);
	const indegree = new Map(names.map((name) => [name, 0]));
	edges.forEach((link) =>
		indegree.set(link.from, (indegree.get(link.from) ?? 0) + 1)
	);
	const ready = names.filter((name) => (indegree.get(name) ?? 0) === 0);
	const ordered: string[] = [];
	const release = (parent: string) =>
		edges
			.filter((link) => link.to === parent)
			.forEach((link) => {
				const next = (indegree.get(link.from) ?? 0) - 1;
				indegree.set(link.from, next);
				if (next === 0) ready.push(link.from);
			});
	const drain = () => {
		const head = ready.shift();
		if (head === undefined) return;
		ordered.push(head);
		release(head);
		drain();
	};
	drain();
	names.forEach((name) => {
		if (!ordered.includes(name)) ordered.push(name);
	});

	return ordered;
};
export const encodeValue = (col: ColumnMeta, value: unknown) => {
	if (value === null || value === undefined) return null;
	if (col.isJson) return JSON.stringify(value);

	return value;
};

const insertChunk = async (sql: SQL, meta: TableMeta, rows: DbRow[]) => {
	const colNames = meta.columns.map((col) => col.name);
	const groups = rows.map((_, rowIdx) => {
		const base = rowIdx * colNames.length;
		const slots = [...colNames.keys()].map(
			(colIdx) => `$${base + colIdx + 1}`
		);

		return `(${slots.join(', ')})`;
	});
	const params = rows.flatMap((row) =>
		meta.columns.map((col) => encodeValue(col, row[col.name]))
	);
	const columnList = colNames.map(quoteIdent).join(', ');
	const query = `insert into ${quoteIdent(meta.name)} (${columnList}) values ${groups.join(', ')} ${conflictClause(meta)}`;
	await sql.unsafe(query, params);
};

const restoreTable = async (
	sql: SQL,
	meta: TableMeta | undefined,
	rows: DbRow[]
) => {
	if (meta === undefined || rows.length === 0) return;
	await chunkRows(rows, RESTORE_CHUNK_ROWS).reduce(async (prev, part) => {
		await prev;

		return insertChunk(sql, meta, part);
	}, Promise.resolve());
};

const truncateAll = async (sql: SQL, names: string[]) => {
	if (names.length === 0) return;
	const list = names.map(quoteIdent).join(', ');
	await sql.unsafe(`truncate ${list} restart identity cascade`);
};

const runBackup = async (options: DbOptions) => {
	const sql = new SQL(options.url);
	const chosen = (await listTables(sql)).filter((name) =>
		keepTable(name, options)
	);
	const dumps = await Promise.all(
		chosen.map(async (name) => {
			const rows = await sql.unsafe(`select * from ${quoteIdent(name)}`);

			return [name, rows] as const;
		})
	);
	await sql.end();
	const tables: Record<string, DbRow[]> = Object.fromEntries(dumps);
	const payload: BackupFile = {
		at: new Date().toISOString(),
		tables,
		v: BACKUP_FORMAT_VERSION
	};
	const dir = options.out ?? join(process.cwd(), 'backups');
	mkdirSync(dir, { recursive: true });
	const json = JSON.stringify(payload, (_, value) =>
		typeof value === 'bigint' ? value.toString() : value
	);
	const file = join(dir, `backup-${payload.at.replace(/[:.]/g, '-')}.json`);
	writeFileSync(file, json);
	writeFileSync(join(dir, 'latest.json'), json);
	const total = chosen.reduce(
		(sum, name) => sum + (tables[name]?.length ?? 0),
		0
	);
	console.log(paint(`✓ backup → ${file}`, colors.green));
	console.log(paint(`  ${chosen.length} tables, ${total} rows`, colors.dim));
};

const runRestore = async (file: string, options: DbOptions) => {
	if (!existsSync(file)) throw new Error(`Backup not found: ${file}`);
	const payload: BackupFile = JSON.parse(readFileSync(file, 'utf-8'));
	const names = Object.keys(payload.tables).filter((name) =>
		keepTable(name, options)
	);
	const sql = new SQL(options.url);
	const order = dependencyOrder(names, await foreignLinks(sql));
	const metas = await Promise.all(order.map((name) => tableMeta(sql, name)));
	const metaByName = new Map(metas.map((meta) => [meta.name, meta]));
	const aborted =
		options.truncate &&
		!options.yes &&
		prompt(
			paint(
				`⚠ TRUNCATE ${order.length} tables before restore? type "yes": `,
				colors.yellow
			)
		) !== 'yes';
	if (aborted) {
		await sql.end();
		console.log(paint('aborted', colors.yellow));

		return;
	}
	if (options.truncate) await truncateAll(sql, [...order].reverse());
	await order.reduce(async (prev, name) => {
		await prev;

		return restoreTable(
			sql,
			metaByName.get(name),
			payload.tables[name] ?? []
		);
	}, Promise.resolve());
	await sql.end();
	const total = order.reduce(
		(sum, name) => sum + (payload.tables[name]?.length ?? 0),
		0
	);
	console.log(
		paint(
			`✓ restored ${order.length} tables, ${total} rows (idempotent upsert by primary key)`,
			colors.green
		)
	);
};

const runSeed = async (entry: string | undefined) => {
	const target =
		entry ??
		SEED_CANDIDATES.find((candidate) =>
			existsSync(join(process.cwd(), candidate))
		);
	if (target === undefined)
		throw new Error(
			`No seed script found (looked for ${SEED_CANDIDATES.join(', ')}). Pass a path: absolute db seed <file>.`
		);
	console.log(paint(`seeding via ${target}…`, colors.cyan));
	const proc = spawn(['bun', 'run', target], {
		stderr: 'inherit',
		stdin: 'inherit',
		stdout: 'inherit'
	});
	const code = await proc.exited;
	if (code !== 0) throw new Error(`Seed failed (exit ${code}).`);
};

const flagValue = (rest: string[], flag: string) => {
	const idx = rest.indexOf(flag);

	return idx === UNFOUND_INDEX ? undefined : rest[idx + 1];
};

const listValue = (rest: string[], flag: string) =>
	(flagValue(rest, flag) ?? '')
		.split(',')
		.map((part) => part.trim())
		.filter((part) => part !== '');

const parseOptions = (rest: string[]) => ({
	exclude: listValue(rest, '--exclude'),
	only: listValue(rest, '--only'),
	out: flagValue(rest, '--out'),
	truncate: rest.includes('--truncate'),
	url: resolveUrl(flagValue(rest, '--url')),
	yes: rest.includes('--yes') || rest.includes('-y')
});

const positionalArgs = (rest: string[]) =>
	rest.filter(
		(arg, idx) =>
			!arg.startsWith('-') && !VALUE_FLAGS.includes(rest[idx - 1] ?? '')
	);

const usage = () => {
	console.error('Usage: absolute db <backup|restore|seed> [options]');
	console.error(
		'  backup  [--out <dir>] [--only a,b] [--exclude a,b] [--url <url>]   Dump tables → JSON (+ latest.json)'
	);
	console.error(
		'  restore [file] [--truncate] [--only a,b] [--exclude a,b] [-y]      Idempotent upsert by primary key'
	);
	console.error(
		'  seed    [file]                                                     Run the project’s seed script'
	);
	process.exit(1);
};

export const runDb = async (args: string[]) => {
	const [sub, ...rest] = args;
	if (sub === 'backup') {
		await runBackup(parseOptions(rest));

		return;
	}
	if (sub === 'restore') {
		const file =
			positionalArgs(rest)[0] ??
			join(process.cwd(), 'backups', 'latest.json');
		await runRestore(file, parseOptions(rest));

		return;
	}
	if (sub === 'seed') {
		await runSeed(positionalArgs(rest)[0]);

		return;
	}
	usage();
};
