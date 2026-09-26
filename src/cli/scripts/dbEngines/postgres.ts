/* PostgreSQL and CockroachDB (PostgreSQL wire) over Bun SQL. The catalog
   queries and statement shapes for PostgreSQL are the ones `absolute db`
   has always used; CockroachDB differs only where it must (hidden `rowid`
   columns, no `truncate … restart identity`). */
import { SQL } from 'bun';
import type {
	DbColumnKind,
	DbConnection,
	DbRow,
	DbTableMeta,
	LinkRow,
	PgColumnRow
} from '../../../../types/db';
import {
	chunkRows,
	insertableColumns,
	postgresInsert,
	quoteIdent,
	rowsPerChunk
} from './sqlText';
import { encodeValue } from './values';

const PG_PARAM_LIMIT = 65_535;
const SCHEMA = 'public';
const JSON_DATA_TYPES = ['json', 'jsonb'];

type NameRow = { table_name: string };
type KeyRow = { col: string };
type VersionRow = { v: string };

const KINDS: Record<string, DbColumnKind> = {
	ARRAY: 'array',
	bytea: 'binary',
	json: 'json',
	jsonb: 'json'
};
const kindOf = (dataType: string) => KINDS[dataType] ?? 'other';

const toColumn = (row: PgColumnRow) => ({
	generated: row.is_generated === 'ALWAYS',
	identity: row.identity_generation === 'ALWAYS',
	isJson: JSON_DATA_TYPES.includes(row.data_type),
	kind: kindOf(row.data_type),
	name: row.column_name,
	sequenced:
		row.is_identity === 'YES' ||
		(row.column_default ?? '').startsWith('nextval(')
});

const connectionUrl = (url: string) =>
	url.replace(/^cockroachdb:/i, 'postgresql:');

export const openPostgres = async (url: string) => {
	const sql = new SQL(connectionUrl(url));
	const [version]: VersionRow[] = await sql.unsafe('select version() as v');
	const cockroach = /cockroachdb/i.test(version?.v ?? '');
	const sequencedByTable = new Map<string, string[]>();

	const listTables = async () => {
		const rows: NameRow[] =
			await sql`select table_name from information_schema.tables where table_schema = ${SCHEMA} and table_type = ${'BASE TABLE'} order by table_name`;

		return rows.map((row) => row.table_name);
	};

	const columnsFor = async (name: string) => {
		const hidden = cockroach ? ` and is_hidden = 'NO'` : '';
		const rows: PgColumnRow[] = await sql.unsafe(
			`select column_name, data_type, column_default, is_generated, is_identity, identity_generation from information_schema.columns where table_schema = $1 and table_name = $2${hidden} order by ordinal_position`,
			[SCHEMA, name]
		);

		return rows.map(toColumn);
	};

	const primaryKeyFor = async (name: string) => {
		const rows: KeyRow[] = await sql.unsafe(
			`select a.attname as col from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey) where i.indrelid = $1::regclass and i.indisprimary order by a.attnum`,
			[`${SCHEMA}.${quoteIdent(name)}`]
		);

		return rows.map((row) => row.col);
	};

	const tableMeta = async (name: string) => {
		const [columns, primaryKey] = await Promise.all([
			columnsFor(name),
			primaryKeyFor(name)
		]);
		sequencedByTable.set(
			name,
			columns.filter((col) => col.sequenced).map((col) => col.name)
		);

		return {
			columns: columns.map(
				({ generated, identity, isJson, kind, name: colName }) => ({
					generated,
					identity,
					isJson,
					kind,
					name: colName
				})
			),
			name,
			primaryKey
		};
	};

	const foreignLinks = async () => {
		const rows: LinkRow[] = await sql.unsafe(
			`select tc.table_name as child, ccu.table_name as parent from information_schema.table_constraints tc join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = $1`,
			[SCHEMA]
		);

		return rows.map((row) => ({ from: row.child, to: row.parent }));
	};

	const readRows = async (meta: DbTableMeta) => {
		const rows: DbRow[] = await sql.unsafe(
			`select * from ${quoteIdent(meta.name)}`
		);

		return rows;
	};

	const insertChunk = async (meta: DbTableMeta, rows: DbRow[]) => {
		const cols = insertableColumns(meta);
		const overriding = cols.some((col) => col.identity === true);
		const params = rows.flatMap((row) =>
			cols.map((col) => encodeValue(col, row[col.name]))
		);
		await sql.unsafe(postgresInsert(meta, rows.length, overriding), params);
	};

	const insertRows = async (meta: DbTableMeta, rows: DbRow[]) => {
		const size = rowsPerChunk(
			insertableColumns(meta).length,
			PG_PARAM_LIMIT
		);
		await chunkRows(rows, size).reduce(async (prev, part) => {
			await prev;

			return insertChunk(meta, part);
		}, Promise.resolve());
	};

	const truncate = async (names: string[]) => {
		if (names.length === 0) return;
		const list = names.map(quoteIdent).join(', ');
		// CockroachDB has no `restart identity`; its SERIAL is unique_rowid().
		const restart = cockroach ? '' : ' restart identity';
		await sql.unsafe(`truncate ${list}${restart} cascade`);
	};

	/* Explicit ids were inserted, so move each serial/identity sequence past
	   the highest restored value or the next app insert collides. */
	const resyncSequences = async (meta: DbTableMeta) => {
		const sequenced = sequencedByTable.get(meta.name) ?? [];
		await Promise.all(
			sequenced.map((col) =>
				sql.unsafe(
					`select setval(pg_get_serial_sequence($1, $2), coalesce((select max(${quoteIdent(col)}) from ${quoteIdent(meta.name)}), 0) + 1, false)`,
					[`${SCHEMA}.${quoteIdent(meta.name)}`, col]
				)
			)
		);
	};

	const afterRestore = async (restored: DbTableMeta[]) => {
		await Promise.all(restored.map(resyncSequences));
	};

	const connection: DbConnection = {
		afterRestore,
		engine: cockroach ? 'cockroach' : 'postgres',
		foreignLinks,
		insertRows,
		listTables,
		readRows,
		tableMeta,
		truncate,
		close: () => sql.end()
	};

	return connection;
};
