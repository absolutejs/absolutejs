/* Types for `absolute db` (backup / restore / seed across SQL engines). */

/* The connection families `absolute db` can open. A family is decided from
   the URL before connecting; the concrete engine (for example MariaDB versus
   MySQL, or CockroachDB versus PostgreSQL) is confirmed from the server. */
export type DbFamily = 'libsql' | 'mssql' | 'mysql' | 'postgres' | 'sqlite';

export type DbEngine =
	| 'cockroach'
	| 'libsql'
	| 'mariadb'
	| 'mssql'
	| 'mysql'
	| 'postgres'
	| 'singlestore'
	| 'sqlite';

/* How a column's values must be re-encoded on restore. `other` passes the
   backed-up JSON value straight through as a bound parameter. */
export type DbColumnKind = 'array' | 'binary' | 'json' | 'other' | 'temporal';

export type DbColumnMeta = {
	/* Generated/computed columns are backed up but never written back. */
	generated?: boolean;
	/* SQL Server identity or PostgreSQL `generated always as identity`. */
	identity?: boolean;
	isJson: boolean;
	kind?: DbColumnKind;
	name: string;
	/* Engine-native column type, used where a dialect must cast parameters. */
	sqlType?: string;
};

export type DbTableMeta = {
	columns: DbColumnMeta[];
	name: string;
	primaryKey: string[];
};

export type DbForeignLink = { from: string; to: string };

export type DbRow = Record<string, unknown>;

/* `engine` is omitted for PostgreSQL so its backups stay byte-identical to
   the files written before other engines were supported. */
export type DbBackupFile = {
	at: string;
	engine?: DbEngine;
	tables: Record<string, DbRow[]>;
	v: number;
};

export type DbOptions = {
	exclude: string[];
	only: string[];
	out?: string;
	truncate: boolean;
	url: string;
	yes: boolean;
};

export type DbConnection = {
	/* Runs after every table is restored (for example sequence resync). */
	afterRestore: (restored: DbTableMeta[]) => Promise<void>;
	close: () => Promise<void>;
	engine: DbEngine;
	foreignLinks: () => Promise<DbForeignLink[]>;
	insertRows: (meta: DbTableMeta, rows: DbRow[]) => Promise<void>;
	listTables: () => Promise<string[]>;
	readRows: (meta: DbTableMeta) => Promise<DbRow[]>;
	tableMeta: (name: string) => Promise<DbTableMeta>;
	/* Empties the tables; names arrive children-first. */
	truncate: (names: string[]) => Promise<void>;
};

export type DbTarget = { family: DbFamily; url: string };

export type OrmDialectHint = { dialect: string; source: string };

/* Bun SQL accepts this option but its type declarations omit it. */
export type MysqlConnectOptions = {
	allowPublicKeyRetrieval: boolean;
	url: string;
};

export type MssqlTarget = {
	database?: string;
	encrypt: boolean;
	instanceName?: string;
	password?: string;
	port?: number;
	server: string;
	trustServerCertificate: boolean;
	user?: string;
};

/* Minimal executor over bun:sqlite or a remote libSQL client, so both share
   one SQLite-dialect implementation. */
export type SqliteExecutor = {
	all: (query: string, params: unknown[]) => Promise<DbRow[]>;
	batch: (statements: string[]) => Promise<void>;
	close: () => Promise<void>;
	run: (query: string, params: unknown[]) => Promise<void>;
};

/* Raw catalog rows read back from each engine. */
export type PgColumnRow = {
	column_default: string | null;
	column_name: string;
	data_type: string;
	identity_generation: string | null;
	is_generated: string | null;
	is_identity: string | null;
};
export type MysqlColumnRow = {
	data_type: string;
	extra: string | null;
	name: string;
};
export type SqliteColumnRow = {
	hidden: unknown;
	name: string;
	pk: unknown;
	type: string | null;
};
export type MssqlColumnRow = {
	is_computed: boolean;
	is_identity: boolean;
	max_length: number;
	name: string;
	precision: number;
	scale: number;
	type: string;
};
export type NamedRow = { name: string };
export type LinkRow = { child: string; parent: string };
