/* SQLite dialect over two executors: bun:sqlite for local files (including
   local libSQL/Turso files, which are SQLite files) and @libsql/client for
   remote libSQL / Turso. The client is an optional peer dependency and is
   only loaded for a remote URL. */
import { Database } from 'bun:sqlite';
import type {
	DbColumnMeta,
	DbConnection,
	DbEngine,
	DbRow,
	DbTableMeta,
	SqliteColumnRow,
	SqliteExecutor
} from '../../../../types/db';
import {
	chunkRows,
	insertableColumns,
	quoteIdent,
	rowsPerChunk,
	sqliteInsert
} from './sqlText';
import { encodeSqliteValue, normalizeRow } from './values';

/* SQLITE_MAX_VARIABLE_NUMBER is 32766 since SQLite 3.32 (Bun and libSQL
   both ship newer); stay under the older 999 only if a column count forces
   single rows anyway. */
const SQLITE_PARAM_LIMIT = 32_766;
// pragma_table_xinfo `hidden`: 2 = virtual generated, 3 = stored generated.
const GENERATED_HIDDEN = 2;
const AUTH_TOKEN_ENV_KEYS = [
	'TURSO_AUTH_TOKEN',
	'LIBSQL_AUTH_TOKEN',
	'DATABASE_AUTH_TOKEN'
];

type SqliteBinding = string | number | bigint | boolean | Uint8Array | null;

const toBinding = (value: unknown) => {
	if (
		value === null ||
		typeof value === 'string' ||
		typeof value === 'number' ||
		typeof value === 'bigint' ||
		typeof value === 'boolean' ||
		value instanceof Uint8Array
	)
		return value;

	return String(value);
};

export const bunSqliteExecutor = (path: string) => {
	const db = new Database(path, {
		create: false,
		readwrite: true,
		safeIntegers: true
	});
	const executor: SqliteExecutor = {
		all: (query, params) => {
			const rows = db
				.query<DbRow, SqliteBinding[]>(query)
				.all(...params.map(toBinding));

			return Promise.resolve(rows);
		},
		batch: (statements) => {
			db.transaction(() => {
				statements.forEach((statement) => db.run(statement));
			})();

			return Promise.resolve();
		},
		close: () => {
			db.close();

			return Promise.resolve();
		},
		run: (query, params) => {
			db.query(query).run(...params.map(toBinding));

			return Promise.resolve();
		}
	};

	return executor;
};

const loadLibsql = async () => {
	try {
		return await import('@libsql/client');
	} catch {
		throw new Error(
			'Remote libSQL / Turso support needs the optional @libsql/client driver in this project: bun add @libsql/client'
		);
	}
};

const libsqlAuthToken = (url: URL) =>
	url.searchParams.get('authToken') ??
	AUTH_TOKEN_ENV_KEYS.map((key) => process.env[key]).find(
		(value) => typeof value === 'string' && value !== ''
	);

export const libsqlExecutor = async (url: string) => {
	const { createClient } = await loadLibsql();
	const parsed = new URL(url);
	const authToken = libsqlAuthToken(parsed);
	parsed.searchParams.delete('authToken');
	const client = createClient({
		authToken,
		intMode: 'bigint',
		url: parsed.toString()
	});
	const toArgs = (params: unknown[]) =>
		params.map((value) => {
			const binding = toBinding(value);

			return typeof binding === 'boolean' ? Number(binding) : binding;
		});
	const executor: SqliteExecutor = {
		all: async (query, params) => {
			const result = await client.execute({
				args: toArgs(params),
				sql: query
			});

			return result.rows.map((row) =>
				Object.fromEntries(
					result.columns.map((column, idx) => [column, row[idx]])
				)
			);
		},
		batch: async (statements) => {
			await client.batch(statements, 'write');
		},
		close: () => {
			client.close();

			return Promise.resolve();
		},
		run: async (query, params) => {
			await client.execute({ args: toArgs(params), sql: query });
		}
	};

	return executor;
};

const isInternalTable = (name: string) =>
	name.startsWith('sqlite_') || name.startsWith('libsql_');

export const openSqlite = (exec: SqliteExecutor, engine: DbEngine) => {
	const listTables = async () => {
		const rows = await exec.all(
			`select name from sqlite_master where type = 'table' order by name`,
			[]
		);

		return rows
			.map((row) => String(row.name))
			.filter((name) => !isInternalTable(name));
	};

	const tableMeta = async (name: string) => {
		const rows = await exec.all(
			'select name, type, pk, hidden from pragma_table_xinfo(?) order by cid',
			[name]
		);
		const columnRows = rows.map((row) => {
			const column: SqliteColumnRow = {
				hidden: row.hidden,
				name: String(row.name),
				pk: row.pk,
				type: typeof row.type === 'string' ? row.type : null
			};

			return column;
		});
		const primaryKey = columnRows
			.filter((row) => Number(row.pk) > 0)
			.sort((left, right) => Number(left.pk) - Number(right.pk))
			.map((row) => row.name);
		const columns = columnRows.map((row) => {
			const column: DbColumnMeta = {
				generated: Number(row.hidden) >= GENERATED_HIDDEN,
				isJson: false,
				kind: /blob/i.test(row.type ?? '') ? 'binary' : 'other',
				name: row.name
			};

			return column;
		});
		const meta: DbTableMeta = { columns, name, primaryKey };

		return meta;
	};

	const foreignLinks = async () => {
		const rows = await exec.all(
			`select m.name as child, f."table" as parent from sqlite_master m join pragma_foreign_key_list(m.name) f where m.type = 'table'`,
			[]
		);

		return rows.map((row) => ({
			from: String(row.child),
			to: String(row.parent)
		}));
	};

	const readRows = async (meta: DbTableMeta) => {
		const rows = await exec.all(
			`select * from ${quoteIdent(meta.name)}`,
			[]
		);

		return rows.map(normalizeRow);
	};

	const insertChunk = async (meta: DbTableMeta, rows: DbRow[]) => {
		const cols = insertableColumns(meta);
		const params = rows.flatMap((row) =>
			cols.map((col) => encodeSqliteValue(col, row[col.name]))
		);
		await exec.run(sqliteInsert(meta, rows.length), params);
	};

	const insertRows = async (meta: DbTableMeta, rows: DbRow[]) => {
		const size = rowsPerChunk(
			insertableColumns(meta).length,
			SQLITE_PARAM_LIMIT
		);
		await chunkRows(rows, size).reduce(async (prev, part) => {
			await prev;

			return insertChunk(meta, part);
		}, Promise.resolve());
	};

	/* One transaction with deferred foreign keys: rows may be deleted in any
	   order, and the check still runs at commit. AUTOINCREMENT counters are
	   reset like PostgreSQL's `restart identity`. */
	const truncate = async (names: string[]) => {
		if (names.length === 0) return;
		const sequence = await exec.all(
			`select name from sqlite_master where type = 'table' and name = 'sqlite_sequence'`,
			[]
		);
		const quotedNames = names
			.map((name) => `'${name.replace(/'/g, "''")}'`)
			.join(', ');
		await exec.batch([
			'pragma defer_foreign_keys = on',
			...names.map((name) => `delete from ${quoteIdent(name)}`),
			...(sequence.length > 0
				? [`delete from sqlite_sequence where name in (${quotedNames})`]
				: [])
		]);
	};

	const connection: DbConnection = {
		close: exec.close,
		engine,
		foreignLinks,
		insertRows,
		listTables,
		readRows,
		tableMeta,
		truncate,
		afterRestore: () => Promise.resolve()
	};

	return connection;
};
