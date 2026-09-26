import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'bun:test';
import type { DbColumnMeta, DbTableMeta } from '../../../types/db';
import {
	detectTarget,
	readOrmDialect,
	sqlitePath
} from '../../../src/cli/scripts/dbEngines/detect';
import {
	mssqlColumnType,
	parseMssqlUrl
} from '../../../src/cli/scripts/dbEngines/mssql';
import {
	mssqlUpsert,
	mysqlInsert,
	postgresInsert,
	quoteMssqlIdent,
	quoteMysqlIdent,
	rowsPerChunk,
	sqliteInsert
} from '../../../src/cli/scripts/dbEngines/sqlText';
import {
	decodeBinary,
	encodeMssqlValue,
	encodeMysqlValue,
	encodeSqliteValue,
	encodeValue,
	normalizeRow,
	parseJsonText,
	pgArrayLiteral
} from '../../../src/cli/scripts/dbEngines/values';

const scratch = mkdtempSync(join(tmpdir(), 'absolute-db-unit-'));
afterAll(() => rmSync(scratch, { force: true, recursive: true }));

const players: DbTableMeta = {
	columns: [
		{ identity: true, isJson: false, name: 'id' },
		{ isJson: false, name: 'handle' },
		{ generated: true, isJson: false, name: 'handle_len' }
	],
	name: 'players',
	primaryKey: ['id']
};
const joinTable: DbTableMeta = {
	columns: [
		{ isJson: false, name: 'a' },
		{ isJson: false, name: 'b' }
	],
	name: 'pairs',
	primaryKey: ['a', 'b']
};

describe('db engine detection', () => {
	test('maps URL schemes to engine families', () => {
		const family = (url: string) => detectTarget(url, undefined).family;
		expect(family('postgres://u@h/db')).toBe('postgres');
		expect(family('postgresql://u@h/db')).toBe('postgres');
		expect(family('cockroachdb://root@h:26257/db')).toBe('postgres');
		expect(family('mysql://u@h/db')).toBe('mysql');
		expect(family('mariadb://u@h/db')).toBe('mysql');
		expect(family('singlestore://u@h/db')).toBe('mysql');
		expect(family('file:./dev.db')).toBe('sqlite');
		expect(family('sqlite:app.sqlite')).toBe('sqlite');
		expect(family('./data/app.db')).toBe('sqlite');
		expect(family('libsql://x.turso.io')).toBe('libsql');
		expect(family('https://x.turso.io')).toBe('libsql');
		expect(family('ws://127.0.0.1:8080')).toBe('libsql');
		expect(family('sqlserver://h:1433;database=d')).toBe('mssql');
		expect(family('mssql://sa:pw@h/d')).toBe('mssql');
	});

	test('a schemeless URL is SQLite when the ORM config says so', () => {
		expect(
			detectTarget('data/app', {
				dialect: 'turso',
				source: 'drizzle.config.ts'
			}).family
		).toBe('sqlite');
	});

	test('refuses MongoDB and Gel with a clear message', () => {
		expect(() => detectTarget('mongodb+srv://c/x', undefined)).toThrow(
			/does not support MongoDB/
		);
		expect(() => detectTarget('gel://h/db', undefined)).toThrow(
			/does not support Gel/
		);
		expect(() =>
			detectTarget('data/app', {
				dialect: 'mongodb',
				source: 'prisma/schema.prisma'
			})
		).toThrow(/prisma\/schema.prisma declares "mongodb"/);
	});

	test('refuses an unknown scheme listing the supported ones', () => {
		expect(() => detectTarget('redis://h', undefined)).toThrow(
			/Unrecognised database URL scheme "redis:"/
		);
	});

	test('an explicit SQL URL wins over a MongoDB ORM config', () => {
		expect(
			detectTarget('postgres://h/db', {
				dialect: 'mongodb',
				source: 'prisma/schema.prisma'
			}).family
		).toBe('postgres');
	});

	test('reads the drizzle dialect and the prisma provider', () => {
		const drizzleDir = join(scratch, 'drizzle');
		const prismaDir = join(scratch, 'prisma-app');
		Bun.spawnSync(['mkdir', '-p', drizzleDir, join(prismaDir, 'prisma')]);
		writeFileSync(
			join(drizzleDir, 'drizzle.config.ts'),
			`export default defineConfig({ dialect: 'singlestore', schema: './s.ts' });`
		);
		writeFileSync(
			join(prismaDir, 'prisma', 'schema.prisma'),
			'generator client {\n  provider = "prisma-client-js"\n}\ndatasource db {\n  provider = "sqlserver"\n  url = env("DATABASE_URL")\n}\n'
		);
		expect(readOrmDialect(drizzleDir)).toEqual({
			dialect: 'singlestore',
			source: 'drizzle.config.ts'
		});
		expect(readOrmDialect(prismaDir)).toEqual({
			dialect: 'sqlserver',
			source: 'prisma/schema.prisma'
		});
	});

	test('resolves SQLite paths and never invents a missing file', () => {
		const file = join(scratch, 'app.db');
		writeFileSync(file, '');
		expect(sqlitePath(`file:${file}`, '/')).toBe(file);
		expect(sqlitePath(`sqlite://${file}`, '/')).toBe(file);
		expect(sqlitePath('file:app.db', scratch)).toBe(file);
		expect(() => sqlitePath('file:missing.db', scratch)).toThrow(
			/SQLite database file not found/
		);
		expect(() => sqlitePath(':memory:', scratch)).toThrow(/in-memory/);
	});
});

describe('db statement shapes', () => {
	test('identifier quoting per dialect', () => {
		expect(quoteMysqlIdent('we`ird')).toBe('`we``ird`');
		expect(quoteMssqlIdent('we]ird')).toBe('[we]]ird]');
	});

	test('chunk size respects the bind-parameter limit', () => {
		expect(rowsPerChunk(4, 65_535)).toBe(500);
		expect(rowsPerChunk(300, 65_535)).toBe(218);
		expect(rowsPerChunk(50, 2000)).toBe(40);
		expect(rowsPerChunk(5000, 2000)).toBe(1);
	});

	test('postgres skips generated columns and overrides identity', () => {
		expect(postgresInsert(players, 2, true)).toBe(
			'insert into "players" ("id", "handle") overriding system value values ($1, $2), ($3, $4) on conflict ("id") do update set "handle" = excluded."handle"'
		);
	});

	test('sqlite uses positional parameters with the same upsert', () => {
		expect(sqliteInsert(joinTable, 1)).toBe(
			'insert into "pairs" ("a", "b") values (?, ?) on conflict ("a", "b") do nothing'
		);
	});

	test('mysql upserts with the row alias or VALUES()', () => {
		expect(mysqlInsert(players, 1, true)).toBe(
			'insert into `players` (`id`, `handle`) values (?, ?) as new_row on duplicate key update `handle` = new_row.`handle`'
		);
		expect(mysqlInsert(players, 1, false)).toBe(
			'insert into `players` (`id`, `handle`) values (?, ?) on duplicate key update `handle` = values(`handle`)'
		);
	});

	test('mysql key-only tables skip duplicates without insert ignore', () => {
		expect(mysqlInsert(joinTable, 1, true)).toBe(
			'insert into `pairs` (`a`, `b`) values (?, ?) on duplicate key update `a` = `a`'
		);
	});

	test('sql server merges on the key with typed casts and identity insert', () => {
		const typed: DbTableMeta = {
			...players,
			columns: [
				{ identity: true, isJson: false, name: 'id', sqlType: 'int' },
				{ isJson: false, name: 'handle', sqlType: 'nvarchar(50)' }
			]
		};
		expect(mssqlUpsert(typed, 1, '[dbo].[players]')).toBe(
			'set identity_insert [dbo].[players] on; merge into [dbo].[players] with (holdlock) as tgt using (values (cast(@p0 as int), cast(@p1 as nvarchar(50)))) as src ([id], [handle]) on tgt.[id] = src.[id] when matched then update set tgt.[handle] = src.[handle] when not matched then insert ([id], [handle]) values (src.[id], src.[handle]); set identity_insert [dbo].[players] off;'
		);
	});

	test('sql server keyless tables insert plainly', () => {
		const keyless: DbTableMeta = {
			columns: [{ isJson: false, name: 'msg', sqlType: 'nvarchar(max)' }],
			name: 'logs',
			primaryKey: []
		};
		expect(mssqlUpsert(keyless, 2, '[dbo].[logs]')).toBe(
			'insert into [dbo].[logs] ([msg]) values (cast(@p0 as nvarchar(max))), (cast(@p1 as nvarchar(max)));'
		);
	});

	test('sql server column types keep length, precision and scale', () => {
		const col = (
			type: string,
			max_length: number,
			precision = 0,
			scale = 0
		) =>
			mssqlColumnType({
				is_computed: false,
				is_identity: false,
				max_length,
				name: 'c',
				precision,
				scale,
				type
			});
		expect(col('nvarchar', 100)).toBe('nvarchar(50)');
		expect(col('nvarchar', -1)).toBe('nvarchar(max)');
		expect(col('varbinary', -1)).toBe('varbinary(max)');
		expect(col('decimal', 9, 12, 2)).toBe('decimal(12, 2)');
		expect(col('datetime2', 8, 27, 7)).toBe('datetime2(7)');
		expect(col('int', 4)).toBe('int');
	});

	test('parses both SQL Server URL forms', () => {
		expect(
			parseMssqlUrl(
				'sqlserver://db.local\\SQLEXPRESS:1434;database=app;user=sa;password=p;w=d;encrypt=false;trustServerCertificate=true'
			)
		).toEqual({
			database: 'app',
			encrypt: false,
			instanceName: 'SQLEXPRESS',
			password: 'p',
			port: 1434,
			server: 'db.local',
			trustServerCertificate: true,
			user: 'sa'
		});
		expect(
			parseMssqlUrl(
				'mssql://sa:p%40ss@db.local:1433/app?trustServerCertificate=true'
			)
		).toEqual({
			database: 'app',
			encrypt: true,
			instanceName: undefined,
			password: 'p@ss',
			port: 1433,
			server: 'db.local',
			trustServerCertificate: true,
			user: 'sa'
		});
	});
});

describe('db value encoding', () => {
	const bytes = JSON.parse(JSON.stringify(Buffer.from([0, 1, 255])));

	test('binary round-trips through the Buffer JSON shape', () => {
		expect(decodeBinary(bytes)).toEqual(Buffer.from([0, 1, 255]));
		expect(decodeBinary({ data: ['x'], type: 'Buffer' })).toBeUndefined();
		expect(encodeValue({ isJson: false, name: 'b' }, bytes)).toEqual(
			Buffer.from([0, 1, 255])
		);
	});

	test('postgres arrays become array literals', () => {
		expect(pgArrayLiteral([1, 2])).toBe('{"1","2"}');
		expect(pgArrayLiteral(['a', 'b "q"', null, ['n']])).toBe(
			'{"a","b \\"q\\"",NULL,{"n"}}'
		);
		expect(encodeValue({ isJson: false, name: 'tags' }, ['x'])).toBe(
			'{"x"}'
		);
	});

	test('mysql stringifies JSON and rewrites ISO datetimes', () => {
		const json: DbColumnMeta = { isJson: true, name: 'meta' };
		expect(encodeMysqlValue(json, { a: 1 })).toBe('{"a":1}');
		expect(encodeMysqlValue(json, 'scalar')).toBe('"scalar"');
		expect(
			encodeMysqlValue(
				{ isJson: false, kind: 'temporal', name: 'at' },
				'2024-01-02T03:04:05.678Z'
			)
		).toBe('2024-01-02 03:04:05.678');
		expect(
			encodeMysqlValue(
				{ isJson: false, kind: 'temporal', name: 'at' },
				'2024-01-02 03:04:05.123456'
			)
		).toBe('2024-01-02 03:04:05.123456');
	});

	test('sqlite binds booleans as integers and bytes as Uint8Array', () => {
		const col: DbColumnMeta = { isJson: false, name: 'x' };
		expect(encodeSqliteValue(col, true)).toBe(1);
		expect(encodeSqliteValue(col, { a: 1 })).toBe('{"a":1}');
		expect(encodeSqliteValue(col, bytes)).toBeInstanceOf(Uint8Array);
	});

	test('sql server keeps wide integers exact and drops the UTC suffix', () => {
		const col: DbColumnMeta = { isJson: false, name: 'x' };
		expect(encodeMssqlValue(col, 2 ** 40)).toBe(String(2 ** 40));
		expect(encodeMssqlValue(col, 7)).toBe(7);
		expect(
			encodeMssqlValue(
				{ isJson: false, kind: 'temporal', name: 'x' },
				'2024-01-02T03:04:05.678Z'
			)
		).toBe('2024-01-02T03:04:05.678');
	});

	test('driver rows normalize big integers and byte containers', () => {
		expect(
			normalizeRow({
				big: 9007199254740993n,
				blob: new Uint8Array([1]),
				buf: new Uint8Array([2]).buffer,
				small: 5n
			})
		).toEqual({
			big: '9007199254740993',
			blob: Buffer.from([1]),
			buf: Buffer.from([2]),
			small: 5
		});
	});

	test('JSON text from text-JSON engines is parsed for JSON columns', () => {
		expect(parseJsonText('{"a":1}')).toEqual({ a: 1 });
		expect(parseJsonText('not json')).toBe('not json');
		expect(parseJsonText(3)).toBe(3);
	});
});
