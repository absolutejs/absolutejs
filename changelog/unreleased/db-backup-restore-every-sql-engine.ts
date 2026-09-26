import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: 'The engine is picked from the URL scheme (with drizzle.config dialect / Prisma provider as a fallback): PostgreSQL and CockroachDB, MySQL, MariaDB and SingleStore, SQLite and local libSQL files, remote libSQL/Turso (optional peer @libsql/client) and SQL Server (optional peer mssql). Dependency order, identifier quoting, upserts and value encoding are per dialect; generated columns are skipped and identity columns are inserted explicitly. MongoDB and Gel are refused with a clear message. `absolute db seed --url` hands the URL and engine to the seed script. PostgreSQL backups keep their exact file shape.',
	kind: 'added',
	summary:
		'`absolute db backup` and `restore` work on every SQL engine Drizzle and Prisma support, not only PostgreSQL'
};
