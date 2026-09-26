/* Live `absolute db backup → restore → seed` against real engines in
   Docker: PostgreSQL 17, CockroachDB (single node, insecure), MySQL 8,
   MariaDB 11, SQL Server 2022, remote libSQL (sqld), and a SQLite file.
   Each engine: create the same schema in a source and a fresh target
   database, fill the source, back it up, restore into the target, and
   compare every row through the engine's own driver. Skips (with the
   reason printed) only when Docker is unavailable. */
import { Database } from 'bun:sqlite';
import { SQL, spawnSync } from 'bun';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, test } from 'bun:test';
import { createClient } from '@libsql/client';
import { ConnectionPool } from 'mssql';
import type { MysqlConnectOptions } from '../../../types/db';
import { runDb } from '../../../src/cli/scripts/db';
import { parseMssqlUrl } from '../../../src/cli/scripts/dbEngines/mssql';

type Row = Record<string, unknown>;
type Driver = {
	rows: (url: string, query: string) => Promise<Row[]>;
	run: (url: string, statements: string[]) => Promise<void>;
};
type Databases = { admin: string; dst: string; src: string };
type EngineCase = {
	/* Statements that create the schema (run on source and target). */
	ddl: string[];
	driver: Driver;
	/* Insert that must succeed on the target after restore (sequence check). */
	freshInsert: string;
	inserts: string[];
	name: string;
	/* Tables compared after restore, with their ORDER BY. */
	tables: [string, string][];
	/* Statement run on the source before the second backup (upsert check). */
	update: string;
	up: () => Promise<Databases>;
};

const SEED_FIXTURE = resolve(import.meta.dir, '../../fixtures/db/seed.ts');
const READY_TIMEOUT_MS = 180_000;
const READY_POLL_MS = 1_000;
const ENGINE_TIMEOUT_MS = 300_000;
const CLEANUP_TIMEOUT_MS = 120_000;
const MSSQL_PASSWORD = 'Abs0lute!Backup#1';
const RUN_ID = `${process.pid}-${Date.now().toString(36)}`;
const containers: string[] = [];
const scratch = mkdtempSync(join(tmpdir(), 'absolute-db-live-'));

const docker = (args: string[]) => {
	const result = spawnSync(['docker', ...args], {
		stderr: 'pipe',
		stdout: 'pipe'
	});

	return {
		ok: result.exitCode === 0,
		stderr: result.stderr.toString().trim(),
		stdout: result.stdout.toString().trim()
	};
};

const dockerUnavailable = () => {
	const probe = spawnSync(
		['docker', 'info', '--format', '{{.ServerVersion}}'],
		{
			stderr: 'pipe',
			stdout: 'pipe'
		}
	);
	if (probe.exitCode === 0) return undefined;

	return probe.stderr.toString().trim() || 'docker info failed';
};

const skipReason = dockerUnavailable();
if (skipReason !== undefined)
	console.log(
		`[db-engines] skipping live database tests: Docker is unavailable (${skipReason})`
	);

const startContainer = (
	engine: string,
	image: string,
	containerPort: number,
	args: string[] = [],
	command: string[] = []
) => {
	const name = `absolute-db-test-${engine}-${RUN_ID}`;
	const started = docker([
		'run',
		'-d',
		'--rm',
		'--name',
		name,
		'-p',
		`127.0.0.1::${containerPort}`,
		...args,
		image,
		...command
	]);
	if (!started.ok) throw new Error(`docker run ${image}: ${started.stderr}`);
	containers.push(name);
	const mapped = docker(['port', name, `${containerPort}/tcp`]).stdout;
	const port = mapped.split('\n')[0]?.split(':').pop();
	if (port === undefined || port === '')
		throw new Error(`no host port for ${name}: ${mapped}`);

	return Number(port);
};

const waitFor = async (label: string, attempt: () => Promise<unknown>) => {
	const deadline = Date.now() + READY_TIMEOUT_MS;
	let lastError: unknown;
	while (Date.now() < deadline) {
		try {
			await attempt();

			return;
		} catch (error) {
			lastError = error;
			await Bun.sleep(READY_POLL_MS);
		}
	}
	throw new Error(`${label} never became ready: ${String(lastError)}`);
};

const bunSqlDriver = (
	options: (url: string) => MysqlConnectOptions
): Driver => ({
	rows: async (url, query) => {
		const sql = new SQL(options(url));
		try {
			const rows: Row[] = await sql.unsafe(query);

			return [...rows];
		} finally {
			await sql.end();
		}
	},
	run: async (url, statements) => {
		const sql = new SQL(options(url));
		try {
			for (const statement of statements) await sql.unsafe(statement);
		} finally {
			await sql.end();
		}
	}
});

const pgDriver = bunSqlDriver((url) => ({
	allowPublicKeyRetrieval: false,
	url: url.replace(/^cockroachdb:/, 'postgresql:')
}));
const mysqlDriver = bunSqlDriver((url) => {
	const parsed = new URL(url);
	parsed.searchParams.delete('allowPublicKeyRetrieval');

	return { allowPublicKeyRetrieval: true, url: parsed.toString() };
});

const sqliteFile = (url: string) => url.replace(/^(sqlite|file):/, '');
const sqliteDriver: Driver = {
	rows: async (url, query) => {
		const db = new Database(sqliteFile(url), { safeIntegers: true });
		const rows = db.query<Row, []>(query).all();
		db.close();

		return rows;
	},
	run: async (url, statements) => {
		const db = new Database(sqliteFile(url), { create: true });
		statements.forEach((statement) => db.run(statement));
		db.close();
	}
};

const libsqlDriver: Driver = {
	rows: async (url, query) => {
		const client = createClient({ intMode: 'bigint', url });
		const result = await client.execute(query);
		client.close();

		return result.rows.map((row) =>
			Object.fromEntries(
				result.columns.map((col, idx) => [col, row[idx]])
			)
		);
	},
	run: async (url, statements) => {
		const client = createClient({ url });
		for (const statement of statements) await client.execute(statement);
		client.close();
	}
};

const mssqlPool = async (url: string) => {
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

	return pool;
};
const mssqlDriver: Driver = {
	rows: async (url, query) => {
		const pool = await mssqlPool(url);
		try {
			const result = await pool.request().query<Row>(query);

			return [...result.recordset];
		} finally {
			await pool.close();
		}
	},
	run: async (url, statements) => {
		const pool = await mssqlPool(url);
		try {
			for (const statement of statements)
				await pool.request().query(statement);
		} finally {
			await pool.close();
		}
	}
};

const normalize = (value: unknown) => {
	if (value instanceof ArrayBuffer) return Buffer.from(value).toString('hex');
	if (value instanceof Uint8Array) return Buffer.from(value).toString('hex');
	if (value instanceof Date) return value.toISOString();
	if (typeof value === 'bigint') return value.toString();
	if (value !== null && typeof value === 'object')
		return JSON.stringify(value);

	return value;
};
const normalizeRows = (rows: Row[]) =>
	rows.map((row) =>
		Object.fromEntries(
			Object.entries(row).map(([key, value]) => [key, normalize(value)])
		)
	);

const AVATAR = [0, 1, 127, 128, 255];
const BIG = '9007199254740993';
const META =
	'{"list":[1,2,3],"nested":{"ok":true},"text":"quote \\" and \\\\"}';

const postgresCase = (name: string, image: string, cockroach: boolean) =>
	({
		ddl: [
			`create table authors (id ${cockroach ? 'int8 default unique_rowid()' : 'serial'} primary key, name text not null, meta jsonb, active boolean, created timestamptz, born date, avatar bytea, amount numeric(12,2), big bigint, tags text[], name_len int generated always as (length(name)) stored)`,
			'create table books (id int generated always as identity primary key, author_id int references authors(id), title text)',
			'create table book_tags (book_id int references books(id), tag text, primary key (book_id, tag))',
			'create table logs (msg text, at timestamp)',
			`create table "we""ird" (id int primary key, "select" text)`
		],
		driver: pgDriver,
		freshInsert: `insert into books (author_id, title) values (1, 'after restore')`,
		inserts: [
			`insert into authors (id, name, meta, active, created, born, avatar, amount, big, tags) values (1, 'Zoë 😀', '${META}', true, '2024-01-02T03:04:05.678Z', '1990-05-06', '\\x${Buffer.from(AVATAR).toString('hex')}', 1234.56, ${BIG}, '{"a","b \\"q\\"",NULL}')`,
			`insert into authors (id, name) values (2, 'nulls')`,
			`insert into books (author_id, title) values (1, 'first'), (1, 'second'), (2, 'third')`,
			`insert into book_tags values (1, 'x'), (1, 'y'), (2, 'x')`,
			`insert into logs values ('one', '2024-01-02 03:04:05'), ('two', null)`,
			`insert into "we""ird" values (1, 'reserved')`
		],
		name,
		tables: [
			['authors', 'id'],
			['books', 'id'],
			['book_tags', 'book_id, tag'],
			['logs', 'msg'],
			['"we""ird"', 'id']
		],
		update: `update authors set name = 'renamed', amount = 1 where id = 2`,
		up: async () => {
			const port = cockroach
				? startContainer(
						name,
						image,
						26257,
						[],
						['start-single-node', '--insecure']
					)
				: startContainer(name, image, 5432, [
						'-e',
						'POSTGRES_PASSWORD=pw'
					]);
			const base = cockroach
				? `postgresql://root@127.0.0.1:${port}`
				: `postgres://postgres:pw@127.0.0.1:${port}`;
			const suffix = cockroach ? '?sslmode=disable' : '';
			const admin = `${base}/${cockroach ? 'defaultdb' : 'postgres'}${suffix}`;
			await waitFor(name, () => pgDriver.rows(admin, 'select 1'));
			await pgDriver.run(admin, [
				'create database src',
				'create database dst'
			]);

			return {
				admin,
				dst: `${cockroach ? 'cockroachdb' : 'postgresql'}://${base.split('://')[1]}/dst${suffix}`,
				src: `${base}/src${suffix}`
			};
		}
	}) satisfies EngineCase;

const mysqlCase = (name: string, image: string, envKey: string) =>
	({
		ddl: [
			'create table authors (id int auto_increment primary key, name varchar(100) not null, meta json, active tinyint(1), created datetime(6), born date, avatar blob, amount decimal(12,2), big bigint, name_len int as (char_length(name)) stored)',
			'create table books (id int auto_increment primary key, author_id int, title varchar(200), foreign key (author_id) references authors(id))',
			'create table book_tags (book_id int, tag varchar(50), primary key (book_id, tag), foreign key (book_id) references books(id))',
			'create table logs (msg text, at datetime)',
			'create table `we"ird` (id int primary key, `select` text)'
		],
		driver: mysqlDriver,
		freshInsert: `insert into books (author_id, title) values (1, 'after restore')`,
		inserts: [
			`insert into authors (id, name, meta, active, created, born, avatar, amount, big) values (1, 'Zoë 😀', '${META.replace(/\\/g, '\\\\')}', 1, '2024-01-02 03:04:05.123456', '1990-05-06', x'${Buffer.from(AVATAR).toString('hex')}', 1234.56, ${BIG})`,
			`insert into authors (id, name) values (2, 'nulls')`,
			`insert into books (author_id, title) values (1, 'first'), (1, 'second'), (2, 'third')`,
			`insert into book_tags values (1, 'x'), (1, 'y'), (2, 'x')`,
			`insert into logs values ('one', '2024-01-02 03:04:05'), ('two', null)`,
			"insert into `we\"ird` values (1, 'reserved')"
		],
		name,
		tables: [
			['authors', 'id'],
			['books', 'id'],
			['book_tags', 'book_id, tag'],
			['logs', 'msg'],
			['`we"ird`', 'id']
		],
		update: `update authors set name = 'renamed', amount = 1 where id = 2`,
		up: async () => {
			const port = startContainer(name, image, 3306, [
				'-e',
				`${envKey}=pw`
			]);
			const base = `mysql://root:pw@127.0.0.1:${port}`;
			const admin = `${base}/mysql?allowPublicKeyRetrieval=true`;
			await waitFor(name, () => mysqlDriver.rows(admin, 'select 1'));
			await mysqlDriver.run(admin, [
				'create database src',
				'create database dst'
			]);
			const scheme = name === 'mariadb' ? 'mariadb' : 'mysql';

			return {
				admin,
				dst: `${scheme}://root:pw@127.0.0.1:${port}/dst?allowPublicKeyRetrieval=true`,
				src: `${base}/src?allowPublicKeyRetrieval=true`
			};
		}
	}) satisfies EngineCase;

const sqliteDdl = [
	'create table authors (id integer primary key autoincrement, name text not null, meta text, active integer, created text, born text, avatar blob, amount real, big integer, name_len integer generated always as (length(name)) stored)',
	'create table books (id integer primary key, author_id integer references authors(id), title text)',
	'create table book_tags (book_id integer references books(id), tag text, primary key (book_id, tag))',
	'create table logs (msg text, at text)',
	`create table "we""ird" (id integer primary key, "select" text)`
];
const sqliteInserts = [
	`insert into authors (id, name, meta, active, created, born, avatar, amount, big) values (1, 'Zoë 😀', '${META}', 1, '2024-01-02T03:04:05.678Z', '1990-05-06', x'${Buffer.from(AVATAR).toString('hex')}', 1234.56, ${BIG})`,
	`insert into authors (id, name) values (2, 'nulls')`,
	`insert into books (author_id, title) values (1, 'first'), (1, 'second'), (2, 'third')`,
	`insert into book_tags values (1, 'x'), (1, 'y'), (2, 'x')`,
	`insert into logs values ('one', '2024-01-02 03:04:05'), ('two', null)`,
	`insert into "we""ird" values (1, 'reserved')`
];
const sqliteTables: [string, string][] = [
	['authors', 'id'],
	['books', 'id'],
	['book_tags', 'book_id, tag'],
	['logs', 'msg'],
	['"we""ird"', 'id']
];

const sqliteCase: EngineCase = {
	ddl: sqliteDdl,
	driver: sqliteDriver,
	freshInsert: `insert into books (author_id, title) values (1, 'after restore')`,
	inserts: sqliteInserts,
	name: 'sqlite',
	tables: sqliteTables,
	update: `update authors set name = 'renamed', amount = 1 where id = 2`,
	up: async () => ({
		admin: '',
		dst: `sqlite:${join(scratch, 'dst.db')}`,
		src: `file:${join(scratch, 'src.db')}`
	})
};

const libsqlCase: EngineCase = {
	ddl: sqliteDdl,
	driver: libsqlDriver,
	freshInsert: `insert into books (author_id, title) values (1, 'after restore')`,
	inserts: sqliteInserts,
	name: 'libsql',
	tables: sqliteTables,
	update: `update authors set name = 'renamed', amount = 1 where id = 2`,
	up: async () => {
		const image = 'ghcr.io/tursodatabase/libsql-server:latest';
		const srcPort = startContainer('libsql-src', image, 8080);
		const dstPort = startContainer('libsql-dst', image, 8080);
		const src = `http://127.0.0.1:${srcPort}`;
		const dst = `ws://127.0.0.1:${dstPort}`;
		await waitFor('libsql src', () => libsqlDriver.rows(src, 'select 1'));
		await waitFor('libsql dst', () => libsqlDriver.rows(dst, 'select 1'));

		return { admin: '', dst, src };
	}
};

const mssqlCase: EngineCase = {
	ddl: [
		'create table authors (id int identity(1,1) primary key, name nvarchar(100) not null, meta nvarchar(max), active bit, created datetime2(7), stamp datetimeoffset(7), born date, avatar varbinary(max), amount decimal(12,2), cash money, big bigint, uid uniqueidentifier, name_len as (len(name)))',
		'create table books (id int identity primary key, author_id int references authors(id), title nvarchar(200))',
		'create table book_tags (book_id int references books(id), tag nvarchar(50), primary key (book_id, tag))',
		'create table logs (msg nvarchar(200), at datetime)',
		'create table [we"ird] (id int primary key, [select] nvarchar(max))'
	],
	driver: mssqlDriver,
	freshInsert: `insert into books (author_id, title) values (1, N'after restore')`,
	inserts: [
		`set identity_insert authors on; insert into authors (id, name, meta, active, created, stamp, born, avatar, amount, cash, big, uid) values (1, N'Zoë 😀', N'${META}', 1, '2024-01-02T03:04:05.1234567', '2024-01-02T03:04:05.1234567+02:00', '1990-05-06', 0x${Buffer.from(AVATAR).toString('hex')}, 1234.56, 12.3456, ${BIG}, '6F9619FF-8B86-D011-B42D-00C04FC964FF'), (2, N'nulls', null, null, null, null, null, null, null, null, null, null); set identity_insert authors off`,
		`insert into books (author_id, title) values (1, N'first'), (1, N'second'), (2, N'third')`,
		`insert into book_tags values (1, N'x'), (1, N'y'), (2, N'x')`,
		`insert into logs values (N'one', '2024-01-02T03:04:05.123'), (N'two', null)`,
		`insert into [we"ird] values (1, N'reserved')`
	],
	name: 'mssql',
	tables: [
		['authors', 'id'],
		['books', 'id'],
		['book_tags', 'book_id, tag'],
		['logs', 'msg'],
		['[we"ird]', 'id']
	],
	update: `update authors set name = N'renamed', amount = 1 where id = 2`,
	up: async () => {
		const port = startContainer(
			'mssql',
			'mcr.microsoft.com/mssql/server:2022-latest',
			1433,
			['-e', 'ACCEPT_EULA=Y', '-e', `MSSQL_SA_PASSWORD=${MSSQL_PASSWORD}`]
		);
		const admin = `sqlserver://127.0.0.1:${port};database=master;user=sa;password=${MSSQL_PASSWORD};encrypt=false;trustServerCertificate=true`;
		await waitFor('mssql', () =>
			mssqlDriver.rows(admin, 'select 1 as one')
		);
		await mssqlDriver.run(admin, [
			'create database src',
			'create database dst'
		]);

		return {
			admin,
			dst: `mssql://sa:${encodeURIComponent(MSSQL_PASSWORD)}@127.0.0.1:${port}/dst?encrypt=false&trustServerCertificate=true`,
			src: `sqlserver://127.0.0.1:${port};database=src;user=sa;password=${MSSQL_PASSWORD};encrypt=false;trustServerCertificate=true`
		};
	}
};

const CASES = [
	postgresCase('postgres', 'postgres:17', false),
	postgresCase('cockroach', 'cockroachdb/cockroach:latest', true),
	mysqlCase('mysql', 'mysql:8', 'MYSQL_ROOT_PASSWORD'),
	mysqlCase('mariadb', 'mariadb:11', 'MARIADB_ROOT_PASSWORD'),
	mssqlCase,
	libsqlCase,
	sqliteCase
];

const snapshot = async (engine: EngineCase, url: string) =>
	Promise.all(
		engine.tables.map(async ([table, order]) => [
			table,
			normalizeRows(
				await engine.driver.rows(
					url,
					`select * from ${table} order by ${order}`
				)
			)
		])
	);

const readBackup = (dir: string) =>
	JSON.parse(readFileSync(join(dir, 'latest.json'), 'utf-8'));

afterAll(() => {
	containers.forEach((name) => docker(['rm', '--force', name]));
	rmSync(scratch, { force: true, recursive: true });
}, CLEANUP_TIMEOUT_MS);

describe.skipIf(skipReason !== undefined)(
	'absolute db against live engines',
	() => {
		test.each(CASES.map((engine) => [engine.name, engine] as const))(
			'%s: backup → restore into a fresh database → compare, upsert, truncate, seed',
			async (_, engine) => {
				const dbs = await engine.up();
				await engine.driver.run(dbs.src, engine.ddl);
				await engine.driver.run(dbs.dst, engine.ddl);
				await engine.driver.run(dbs.src, engine.inserts);
				const outDir = join(scratch, engine.name);

				await runDb(['backup', '--url', dbs.src, '--out', outDir]);
				const backup = readBackup(outDir);
				if (engine.name === 'postgres')
					expect(Object.keys(backup)).toEqual(['at', 'tables', 'v']);
				else expect(typeof backup.engine).toBe('string');
				expect(backup.tables.authors).toHaveLength(2);

				await runDb([
					'restore',
					join(outDir, 'latest.json'),
					'--url',
					dbs.dst,
					'-y'
				]);
				expect(await snapshot(engine, dbs.dst)).toEqual(
					await snapshot(engine, dbs.src)
				);
				// The backup reader is lossless too (e.g. MySQL datetime(6),
				// SQL Server datetime2(7)): a backup of the restored target
				// carries exactly the values of the source backup.
				const targetDir = join(scratch, `${engine.name}-target`);
				await runDb(['backup', '--url', dbs.dst, '--out', targetDir]);
				expect(readBackup(targetDir).tables).toEqual(backup.tables);

				// Upsert by primary key: a changed source row overwrites the
				// target without --truncate.
				await engine.driver.run(dbs.src, [engine.update]);
				await runDb(['backup', '--url', dbs.src, '--out', outDir]);
				await runDb([
					'restore',
					join(outDir, 'latest.json'),
					'--url',
					dbs.dst,
					'-y'
				]);
				const keyed = (rows: Awaited<ReturnType<typeof snapshot>>) =>
					rows.filter(([table]) => table !== 'logs');
				expect(keyed(await snapshot(engine, dbs.dst))).toEqual(
					keyed(await snapshot(engine, dbs.src))
				);

				// --truncate empties the target first, so even the keyless table
				// matches exactly.
				await runDb([
					'restore',
					join(outDir, 'latest.json'),
					'--url',
					dbs.dst,
					'--truncate',
					'-y'
				]);
				expect(await snapshot(engine, dbs.dst)).toEqual(
					await snapshot(engine, dbs.src)
				);

				// Explicit ids were restored; the next generated id must not collide.
				await engine.driver.run(dbs.dst, [engine.freshInsert]);

				await runDb(['seed', SEED_FIXTURE, '--url', dbs.dst]);
				const seeded = await engine.driver.rows(
					dbs.dst,
					`select msg from logs where msg = 'seeded'`
				);
				expect(seeded).toHaveLength(1);
			},
			ENGINE_TIMEOUT_MS
		);
	}
);
