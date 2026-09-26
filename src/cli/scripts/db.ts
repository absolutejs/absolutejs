import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { env, spawn } from 'bun';
import type {
	DbBackupFile,
	DbConnection,
	DbEngine,
	DbOptions,
	DbRow,
	DbTableMeta,
	DbTarget
} from '../../../types/db';
import { UNFOUND_INDEX } from '../../constants';
import { colors } from '../tuiPrimitives';
import { detectTarget, readOrmDialect } from './dbEngines/detect';
import { openConnection } from './dbEngines/open';
import { dependencyOrder } from './dbEngines/sqlText';
import { parseJsonText } from './dbEngines/values';

export {
	chunkRows,
	conflictClause,
	dependencyOrder,
	quoteIdent
} from './dbEngines/sqlText';
export { encodeValue } from './dbEngines/values';

const BACKUP_FORMAT_VERSION = 1;
/* The first three are the keys `absolute db` has always read; the rest cover
   the conventional variables of the other supported engines. */
const URL_ENV_KEYS = [
	'DATABASE_URL',
	'POSTGRES_URL',
	'DATABASE_URL_UNPOOLED',
	'MYSQL_URL',
	'TURSO_DATABASE_URL',
	'LIBSQL_URL',
	'MSSQL_URL'
];
/* Engines whose backups carry JSON documents as text, not parsed values. */
const TEXT_JSON_ENGINES: DbEngine[] = ['libsql', 'mssql', 'sqlite'];
const SEED_CANDIDATES = ['db/seed.ts', 'src/db/seed.ts', 'seed.ts'];
const VALUE_FLAGS = ['--out', '--url', '--only', '--exclude'];

const paint = (text: string, color: string) => `${color}${text}${colors.reset}`;

const findUrl = (explicit: string | undefined) =>
	explicit ??
	URL_ENV_KEYS.map((key) => env[key]).find(
		(value) => typeof value === 'string' && value !== ''
	);

const resolveUrl = (explicit: string | undefined) => {
	const found = findUrl(explicit);
	if (found === undefined || found === '')
		throw new Error(
			`No database URL found. Set ${URL_ENV_KEYS.join(' or ')}, or pass --url <url>.`
		);

	return found;
};

const resolveTarget = (url: string) =>
	detectTarget(url, readOrmDialect(process.cwd()));

const keepTable = (name: string, options: DbOptions) =>
	(options.only.length === 0 || options.only.includes(name)) &&
	!options.exclude.includes(name);

const withConnection = async <Result>(
	target: DbTarget,
	work: (conn: DbConnection) => Promise<Result>
) => {
	const conn = await openConnection(target, process.cwd());
	try {
		return await work(conn);
	} finally {
		await conn.close();
	}
};

const dumpTables = async (conn: DbConnection, options: DbOptions) => {
	const chosen = (await conn.listTables()).filter((name) =>
		keepTable(name, options)
	);
	const dumps = await Promise.all(
		chosen.map(async (name) => {
			const rows = await conn.readRows(await conn.tableMeta(name));

			return [name, rows] as const;
		})
	);
	const tables: Record<string, DbRow[]> = Object.fromEntries(dumps);

	return { chosen, engine: conn.engine, tables };
};

const runBackup = async (options: DbOptions) => {
	const { chosen, engine, tables } = await withConnection(
		resolveTarget(options.url),
		(conn) => dumpTables(conn, options)
	);
	const stamp = new Date().toISOString();
	// PostgreSQL backups keep the original shape byte for byte.
	const payload: DbBackupFile =
		engine === 'postgres'
			? { at: stamp, tables, v: BACKUP_FORMAT_VERSION }
			: { at: stamp, engine, tables, v: BACKUP_FORMAT_VERSION };
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
	console.log(
		paint(`  ${engine}: ${chosen.length} tables, ${total} rows`, colors.dim)
	);
};

const parseJsonColumns = (meta: DbTableMeta, row: DbRow) => {
	const parsed: DbRow = { ...row };
	meta.columns
		.filter((col) => col.isJson)
		.forEach((col) => {
			parsed[col.name] = parseJsonText(row[col.name]);
		});

	return parsed;
};

const confirmTruncate = (count: number, options: DbOptions) =>
	!options.truncate ||
	options.yes ||
	prompt(
		paint(
			`⚠ TRUNCATE ${count} tables before restore? type "yes": `,
			colors.yellow
		)
	) === 'yes';

const restoreInto = async (
	conn: DbConnection,
	payload: DbBackupFile,
	options: DbOptions
) => {
	const names = Object.keys(payload.tables).filter((name) =>
		keepTable(name, options)
	);
	const existing = new Set(await conn.listTables());
	const missing = names.filter((name) => !existing.has(name));
	if (missing.length > 0)
		throw new Error(
			`The target ${conn.engine} database has no table ${missing.join(', ')}. Create the schema first (e.g. drizzle-kit push / prisma migrate deploy) or pass --exclude ${missing.join(',')}.`
		);
	const source = payload.engine ?? 'postgres';
	if (source !== conn.engine)
		console.log(
			paint(
				`  restoring a ${source} backup into ${conn.engine}; values are re-encoded per column`,
				colors.dim
			)
		);
	const order = dependencyOrder(names, await conn.foreignLinks());
	const metas = await Promise.all(order.map((name) => conn.tableMeta(name)));
	if (!confirmTruncate(order.length, options)) {
		console.log(paint('aborted', colors.yellow));

		return undefined;
	}
	if (options.truncate) await conn.truncate([...order].reverse());
	const jsonAsText = TEXT_JSON_ENGINES.includes(source);
	await metas.reduce(async (prev, meta) => {
		await prev;
		const rows = payload.tables[meta.name] ?? [];

		return conn.insertRows(
			meta,
			jsonAsText ? rows.map((row) => parseJsonColumns(meta, row)) : rows
		);
	}, Promise.resolve());
	await conn.afterRestore(
		metas.filter((meta) => (payload.tables[meta.name]?.length ?? 0) > 0)
	);

	return order;
};

const runRestore = async (file: string, options: DbOptions) => {
	if (!existsSync(file)) throw new Error(`Backup not found: ${file}`);
	const payload: DbBackupFile = JSON.parse(readFileSync(file, 'utf-8'));
	const order = await withConnection(resolveTarget(options.url), (conn) =>
		restoreInto(conn, payload, options)
	);
	if (order === undefined) return;
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

/* The seed script owns its own driver, so seeding works on every engine.
   `--url` is handed to it as DATABASE_URL, and the detected engine family
   as ABSOLUTE_DB_ENGINE. */
const seedEnv = (explicitUrl: string | undefined) => {
	const url = findUrl(explicitUrl);
	if (url === undefined || url === '') return { ...process.env };

	return {
		...process.env,
		ABSOLUTE_DB_ENGINE: resolveTarget(url).family,
		DATABASE_URL: url
	};
};

const runSeed = async (entry: string | undefined, url: string | undefined) => {
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
		env: seedEnv(url),
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
		'  seed    [file] [--url <url>]                                       Run the project’s seed script'
	);
	console.error(
		'Engines (picked from the URL scheme): PostgreSQL + CockroachDB (postgres://), MySQL, MariaDB + SingleStore (mysql://, mariadb://, singlestore://),'
	);
	console.error(
		'  SQLite + local libSQL files (file:, sqlite:, *.db), remote libSQL/Turso (libsql://, https://; needs @libsql/client),'
	);
	console.error(
		'  SQL Server (sqlserver://, mssql://; needs mssql). MongoDB and Gel are refused.'
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
		await runSeed(positionalArgs(rest)[0], flagValue(rest, '--url'));

		return;
	}
	usage();
};
