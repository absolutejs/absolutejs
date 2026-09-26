/* Decide which engine family a database URL belongs to, using the project's
   ORM config (drizzle.config.* `dialect`, Prisma datasource `provider`) only
   where the URL alone cannot say. Unsupported engines are refused here with
   a clear message instead of failing later inside a driver. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DbFamily, DbTarget, OrmDialectHint } from '../../../../types/db';

const DRIZZLE_CONFIGS = [
	'drizzle.config.ts',
	'drizzle.config.mts',
	'drizzle.config.js',
	'drizzle.config.mjs',
	'drizzle.config.cjs'
];
const PRISMA_SCHEMAS = ['prisma/schema.prisma', 'schema.prisma'];
const SQLITE_FILE_PATTERN = /\.(db|db3|sqlite|sqlite3)$/i;

export const SUPPORTED_SCHEMES =
	'postgres://, postgresql://, cockroachdb://, mysql://, mariadb://, singlestore://, file:, sqlite:, libsql://, http(s)://, ws(s)://, sqlserver://, mssql://';

const SCHEME_FAMILIES: Record<string, DbFamily> = {
	'cockroachdb:': 'postgres',
	'file:': 'sqlite',
	'http:': 'libsql',
	'https:': 'libsql',
	'libsql:': 'libsql',
	'mariadb:': 'mysql',
	'mssql:': 'mssql',
	'mysql:': 'mysql',
	'postgres:': 'postgres',
	'postgresql:': 'postgres',
	'singlestore:': 'mysql',
	'sqlite:': 'sqlite',
	'sqlite3:': 'sqlite',
	'sqlserver:': 'mssql',
	'ws:': 'libsql',
	'wss:': 'libsql'
};

const REFUSED_SCHEMES: Record<string, string> = {
	'edgedb:': 'Gel (EdgeDB)',
	'gel:': 'Gel (EdgeDB)',
	'mongodb:': 'MongoDB',
	'mongodb+srv:': 'MongoDB'
};

/* ORM dialect names that map to a family when the URL has no scheme. */
const DIALECT_FAMILIES: Record<string, DbFamily> = {
	cockroach: 'postgres',
	cockroachdb: 'postgres',
	mssql: 'mssql',
	mysql: 'mysql',
	postgresql: 'postgres',
	singlestore: 'mysql',
	sqlite: 'sqlite',
	sqlserver: 'mssql',
	turso: 'sqlite'
};

const REFUSED_DIALECTS: Record<string, string> = {
	gel: 'Gel (EdgeDB)',
	mongodb: 'MongoDB'
};

const readText = (path: string) =>
	existsSync(path) ? readFileSync(path, 'utf-8') : undefined;

const drizzleHint = (cwd: string) =>
	DRIZZLE_CONFIGS.map((name) => {
		const text = readText(join(cwd, name));
		const dialect = text?.match(/dialect\s*:\s*['"`](\w+)['"`]/)?.[1];

		return dialect === undefined ? undefined : { dialect, source: name };
	}).find((hint) => hint !== undefined);

const prismaHint = (cwd: string) =>
	PRISMA_SCHEMAS.map((name) => {
		const text = readText(join(cwd, name));
		const block = text?.match(/datasource\s+\w+\s*\{[^}]*\}/)?.[0];
		const provider = block?.match(/provider\s*=\s*"(\w+)"/)?.[1];

		return provider === undefined
			? undefined
			: { dialect: provider, source: name };
	}).find((hint) => hint !== undefined);

export const readOrmDialect = (cwd: string) =>
	drizzleHint(cwd) ?? prismaHint(cwd);

const refuse = (engine: string, origin: string) =>
	new Error(
		`absolute db does not support ${engine} (${origin}): backup/restore works on SQL databases only — PostgreSQL, CockroachDB, MySQL, MariaDB, SingleStore, SQLite, libSQL/Turso and SQL Server.`
	);

const schemeOf = (url: string) => {
	const match = url.match(/^([a-z][a-z0-9+.-]*:)/i);

	return match?.[1]?.toLowerCase();
};

const familyForSchemeless = (url: string, hint: OrmDialectHint | undefined) => {
	const hinted =
		hint === undefined ? undefined : DIALECT_FAMILIES[hint.dialect];
	if (hinted === 'sqlite' || SQLITE_FILE_PATTERN.test(url)) return 'sqlite';

	return undefined;
};

export const detectTarget = (
	url: string,
	hint: OrmDialectHint | undefined
): DbTarget => {
	const scheme = schemeOf(url);
	const refusedScheme =
		scheme === undefined ? undefined : REFUSED_SCHEMES[scheme];
	if (refusedScheme !== undefined)
		throw refuse(refusedScheme, `${scheme}// URL`);
	// A Windows drive letter (`C:\…`) parses as a one-letter scheme.
	const family =
		scheme === undefined || scheme.length === 2
			? familyForSchemeless(url, hint)
			: SCHEME_FAMILIES[scheme];
	const refusedDialect =
		hint === undefined ? undefined : REFUSED_DIALECTS[hint.dialect];
	if (family === undefined && refusedDialect !== undefined && hint)
		throw refuse(
			refusedDialect,
			`${hint.source} declares "${hint.dialect}"`
		);
	if (family === undefined)
		throw new Error(
			`Unrecognised database URL${scheme === undefined ? '' : ` scheme "${scheme}"`}. absolute db understands ${SUPPORTED_SCHEMES}, or a path to a .db/.sqlite file.`
		);

	return { family, url };
};

/* Resolve a SQLite URL (`file:x.db`, `sqlite://x.db`, `file:///abs.db`,
   a bare path) to a filesystem path. Prisma resolves relative `file:` URLs
   against the schema directory, so that location is tried second. */
export const sqlitePath = (url: string, cwd: string) => {
	const withoutScheme = url
		.replace(/^(sqlite3?|file):(\/\/)?/i, '')
		.replace(/\?.*$/, '');
	const decoded = decodeURIComponent(withoutScheme);
	if (decoded === ':memory:')
		throw new Error(
			'An in-memory SQLite database (:memory:) has nothing to back up or restore; point --url at a database file.'
		);
	const candidates = decoded.startsWith('/')
		? [decoded]
		: [join(cwd, decoded), join(cwd, 'prisma', decoded)];
	const found = candidates.find((candidate) => existsSync(candidate));
	if (found === undefined)
		throw new Error(
			`SQLite database file not found: ${candidates[0]}. Create it (run your migrations) first — absolute db never creates an empty database.`
		);

	return found;
};
