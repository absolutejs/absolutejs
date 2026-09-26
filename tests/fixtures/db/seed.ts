/* Seed script used by the `absolute db seed` live test. It receives the
   target as DATABASE_URL and the engine family as ABSOLUTE_DB_ENGINE, and
   inserts one row into `logs` with the engine's own driver. */
import { Database } from 'bun:sqlite';
import { SQL } from 'bun';
import { createClient } from '@libsql/client';
import { ConnectionPool } from 'mssql';
import type { MysqlConnectOptions } from '../../../types/db';
import { sqlitePath } from '../../../src/cli/scripts/dbEngines/detect';
import { parseMssqlUrl } from '../../../src/cli/scripts/dbEngines/mssql';

const url = process.env.DATABASE_URL ?? '';
const family = process.env.ABSOLUTE_DB_ENGINE ?? '';

const seedPostgres = async () => {
	const sql = new SQL(url.replace(/^cockroachdb:/, 'postgresql:'));
	await sql.unsafe(`insert into logs (msg) values ('seeded')`);
	await sql.end();
};

const seedMysql = async () => {
	const parsed = new URL(url);
	parsed.searchParams.delete('allowPublicKeyRetrieval');
	const options: MysqlConnectOptions = {
		allowPublicKeyRetrieval: true,
		url: parsed.toString()
	};
	const sql = new SQL(options);
	await sql.unsafe(`insert into logs (msg) values ('seeded')`);
	await sql.end();
};

const seedSqlite = () => {
	const db = new Database(sqlitePath(url, process.cwd()));
	db.run(`insert into logs (msg) values ('seeded')`);
	db.close();
};

const seedLibsql = async () => {
	const client = createClient({ url });
	await client.execute(`insert into logs (msg) values ('seeded')`);
	client.close();
};

const seedMssql = async () => {
	const target = parseMssqlUrl(url);
	const pool = new ConnectionPool({
		database: target.database,
		options: {
			encrypt: target.encrypt,
			trustServerCertificate: target.trustServerCertificate
		},
		password: target.password,
		port: target.port,
		server: target.server,
		user: target.user
	});
	await pool.connect();
	await pool.request().query(`insert into logs (msg) values (N'seeded')`);
	await pool.close();
};

if (family === 'postgres') await seedPostgres();
else if (family === 'mysql') await seedMysql();
else if (family === 'sqlite') seedSqlite();
else if (family === 'libsql') await seedLibsql();
else if (family === 'mssql') await seedMssql();
else throw new Error(`seed fixture: unexpected ABSOLUTE_DB_ENGINE "${family}"`);
