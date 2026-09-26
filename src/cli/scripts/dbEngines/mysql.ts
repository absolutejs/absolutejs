/* MySQL, MariaDB and SingleStore (MySQL wire) over Bun SQL. */
import { SQL } from 'bun';
import type {
	DbColumnKind,
	DbConnection,
	DbRow,
	DbTableMeta,
	LinkRow,
	MysqlColumnRow,
	MysqlConnectOptions,
	NamedRow
} from '../../../../types/db';
import {
	chunkRows,
	insertableColumns,
	mysqlInsert,
	quoteMysqlIdent,
	rowsPerChunk
} from './sqlText';
import { encodeMysqlValue, normalizeRow } from './values';

const MYSQL_PARAM_LIMIT = 65_535;
// Row aliases in `insert … on duplicate key update` arrived in MySQL 8.0.19.
const ROW_ALIAS_MIN_VERSION = '8.0.19'.split('.').map(Number);
const NOT_FOUND = -1;
/* Temporal columns are read back as text (`CAST(… AS CHAR)`) so fractional
   seconds, zero dates and session time zones round-trip exactly instead of
   via a JS Date. */
const KINDS: Record<string, DbColumnKind> = {
	binary: 'binary',
	bit: 'binary',
	blob: 'binary',
	date: 'temporal',
	datetime: 'temporal',
	json: 'json',
	longblob: 'binary',
	mediumblob: 'binary',
	time: 'temporal',
	timestamp: 'temporal',
	tinyblob: 'binary',
	varbinary: 'binary'
};
// `DEFAULT_GENERATED` marks a default expression, not a generated column.
const GENERATED_EXTRA = /\b(VIRTUAL|STORED|PERSISTENT)\b/i;
const PUBLIC_KEY_RETRIEVAL_PARAM = 'allowPublicKeyRetrieval';

type VersionRow = { v: string };
type CheckRow = { clause: string };

const kindOf = (dataType: string) => KINDS[dataType] ?? 'other';

const atLeast = (version: string, minimum: number[]) => {
	const parts = (version.match(/^(\d+)\.(\d+)\.(\d+)/) ?? [])
		.slice(1)
		.map(Number);
	const firstDiff = minimum.findIndex(
		(part, idx) => (parts[idx] ?? 0) !== part
	);

	return (
		firstDiff === NOT_FOUND ||
		(parts[firstDiff] ?? 0) > (minimum[firstDiff] ?? 0)
	);
};

/* Bun SQL takes `allowPublicKeyRetrieval` as an option, not a URL param;
   MySQL 8's caching_sha2_password needs it on non-TLS connections. */
const connectionOptions = (url: string) => {
	const parsed = new URL(url.replace(/^singlestore:/i, 'mysql:'));
	const allowPublicKeyRetrieval =
		parsed.searchParams.get(PUBLIC_KEY_RETRIEVAL_PARAM) === 'true';
	parsed.searchParams.delete(PUBLIC_KEY_RETRIEVAL_PARAM);
	const options: MysqlConnectOptions = {
		allowPublicKeyRetrieval,
		url: parsed.toString()
	};

	return options;
};

export const openMysql = async (url: string) => {
	const sql = new SQL(connectionOptions(url));
	const [version]: VersionRow[] = await sql.unsafe('select version() as v');
	const versionText = version?.v ?? '';
	const singlestoreRows: DbRow[] = await sql.unsafe(
		`show variables like 'memsql_version'`
	);
	const mariadb = /mariadb/i.test(versionText);
	const singlestore = singlestoreRows.length > 0;
	const rowAlias =
		!mariadb && !singlestore && atLeast(versionText, ROW_ALIAS_MIN_VERSION);
	const engineName = mariadb ? 'mariadb' : 'mysql';

	const listTables = async () => {
		const rows: NamedRow[] = await sql.unsafe(
			`select table_name as name from information_schema.tables where table_schema = database() and table_type = 'BASE TABLE' order by table_name`
		);

		return rows.map((row) => row.name);
	};

	/* MariaDB's JSON is LONGTEXT plus a json_valid() check; find those. */
	const mariadbJsonColumns = async (name: string) => {
		if (!mariadb) return new Set<string>();
		const rows: CheckRow[] = await sql.unsafe(
			`select check_clause as clause from information_schema.check_constraints where constraint_schema = database() and table_name = ?`,
			[name]
		);

		return new Set(
			rows.flatMap((row) =>
				[...row.clause.matchAll(/json_valid\(`([^`]+)`\)/gi)].map(
					(match) => match[1] ?? ''
				)
			)
		);
	};

	const columnsFor = async (name: string) => {
		const jsonText = await mariadbJsonColumns(name);
		const rows: MysqlColumnRow[] = await sql.unsafe(
			`select column_name as name, data_type as data_type, extra as extra from information_schema.columns where table_schema = database() and table_name = ? order by ordinal_position`,
			[name]
		);

		return rows.map((row) => ({
			generated: GENERATED_EXTRA.test(row.extra ?? ''),
			isJson:
				row.data_type.toLowerCase() === 'json' ||
				jsonText.has(row.name),
			kind: kindOf(row.data_type.toLowerCase()),
			name: row.name
		}));
	};

	const primaryKeyFor = async (name: string) => {
		const rows: NamedRow[] = await sql.unsafe(
			`select column_name as name from information_schema.key_column_usage where table_schema = database() and table_name = ? and constraint_name = 'PRIMARY' order by ordinal_position`,
			[name]
		);

		return rows.map((row) => row.name);
	};

	const tableMeta = async (name: string) => {
		const [columns, primaryKey] = await Promise.all([
			columnsFor(name),
			primaryKeyFor(name)
		]);

		return { columns, name, primaryKey };
	};

	const foreignLinks = async () => {
		const rows: LinkRow[] = await sql.unsafe(
			`select table_name as child, referenced_table_name as parent from information_schema.key_column_usage where table_schema = database() and referenced_table_name is not null`
		);

		return rows.map((row) => ({ from: row.child, to: row.parent }));
	};

	const readRows = async (meta: DbTableMeta) => {
		const list = meta.columns
			.map((col) =>
				col.kind === 'temporal'
					? `cast(${quoteMysqlIdent(col.name)} as char) as ${quoteMysqlIdent(col.name)}`
					: quoteMysqlIdent(col.name)
			)
			.join(', ');
		const rows: DbRow[] = await sql.unsafe(
			`select ${list} from ${quoteMysqlIdent(meta.name)}`
		);

		return rows.map(normalizeRow);
	};

	const insertChunk = async (meta: DbTableMeta, rows: DbRow[]) => {
		const cols = insertableColumns(meta);
		const params = rows.flatMap((row) =>
			cols.map((col) => encodeMysqlValue(col, row[col.name]))
		);
		await sql.unsafe(mysqlInsert(meta, rows.length, rowAlias), params);
	};

	const insertRows = async (meta: DbTableMeta, rows: DbRow[]) => {
		const size = rowsPerChunk(
			insertableColumns(meta).length,
			MYSQL_PARAM_LIMIT
		);
		await chunkRows(rows, size).reduce(async (prev, part) => {
			await prev;

			return insertChunk(meta, part);
		}, Promise.resolve());
	};

	/* TRUNCATE is refused on a table other tables reference, so foreign key
	   checks are paused on one reserved connection for the duration.
	   SingleStore does not enforce foreign keys and has no such switch. */
	const truncate = async (names: string[]) => {
		if (names.length === 0) return;
		const conn = await sql.reserve();
		const statements = [
			...(singlestore ? [] : ['set foreign_key_checks = 0']),
			...names.map((name) => `truncate table ${quoteMysqlIdent(name)}`)
		];
		try {
			await statements.reduce(async (prev, statement) => {
				await prev;
				await conn.unsafe(statement);
			}, Promise.resolve());
		} finally {
			if (!singlestore) await conn.unsafe('set foreign_key_checks = 1');
			conn.release();
		}
	};

	const connection: DbConnection = {
		engine: singlestore ? 'singlestore' : engineName,
		foreignLinks,
		insertRows,
		listTables,
		readRows,
		tableMeta,
		truncate,
		afterRestore: () => Promise.resolve(),
		close: () => sql.end()
	};

	return connection;
};
