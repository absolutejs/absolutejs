/* Pure, dialect-specific SQL text builders for `absolute db`. Nothing here
   touches a connection, so every statement shape is unit-testable. */
import type {
	DbColumnMeta,
	DbForeignLink,
	DbTableMeta
} from '../../../../types/db';

const MAX_CHUNK_ROWS = 500;

export const chunkRows = <Item>(items: Item[], size: number) =>
	Array.from({ length: Math.ceil(items.length / size) }, (_, idx) =>
		items.slice(idx * size, idx * size + size)
	);
export const insertableColumns = (meta: DbTableMeta) =>
	meta.columns.filter((col) => col.generated !== true);
export const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;
export const quoteMssqlIdent = (name: string) =>
	`[${name.replace(/]/g, ']]')}]`;
export const quoteMysqlIdent = (name: string) =>
	`\`${name.replace(/`/g, '``')}\``;
export const rowsPerChunk = (columnCount: number, paramLimit: number) =>
	Math.max(
		1,
		Math.min(
			MAX_CHUNK_ROWS,
			Math.floor(paramLimit / Math.max(1, columnCount))
		)
	);

const updatableColumns = (meta: DbTableMeta) =>
	insertableColumns(meta)
		.map((col) => col.name)
		.filter((name) => !meta.primaryKey.includes(name));

/* `insert … on conflict` tail shared by PostgreSQL, CockroachDB and SQLite. */
export const conflictClause = (meta: DbTableMeta) => {
	if (meta.primaryKey.length === 0) return 'on conflict do nothing';
	const target = meta.primaryKey.map(quoteIdent).join(', ');
	const updatable = updatableColumns(meta);
	if (updatable.length === 0) return `on conflict (${target}) do nothing`;
	const sets = updatable
		.map((name) => `${quoteIdent(name)} = excluded.${quoteIdent(name)}`)
		.join(', ');

	return `on conflict (${target}) do update set ${sets}`;
};

const valueGroups = (
	rowCount: number,
	columnCount: number,
	slot: (index: number) => string
) =>
	Array.from({ length: rowCount }, (_, rowIdx) => {
		const slots = Array.from({ length: columnCount }, (_cell, colIdx) =>
			slot(rowIdx * columnCount + colIdx)
		);

		return `(${slots.join(', ')})`;
	}).join(', ');

export const mysqlInsert = (
	meta: DbTableMeta,
	rowCount: number,
	rowAlias: boolean
) => {
	const cols = insertableColumns(meta);
	const columnList = cols.map((col) => quoteMysqlIdent(col.name)).join(', ');
	const groups = valueGroups(rowCount, cols.length, () => '?');
	const updatable = updatableColumns(meta);
	const table = quoteMysqlIdent(meta.name);
	// `insert ignore` would also downgrade bad values to warnings, so a
	// key-only or keyless table gets a no-op assignment instead: duplicates
	// are skipped and every other error still raises.
	const [first] = cols;
	if (
		(meta.primaryKey.length === 0 || updatable.length === 0) &&
		first !== undefined
	)
		return `insert into ${table} (${columnList}) values ${groups} on duplicate key update ${quoteMysqlIdent(first.name)} = ${quoteMysqlIdent(first.name)}`;
	const incoming = (name: string) =>
		rowAlias
			? `new_row.${quoteMysqlIdent(name)}`
			: `values(${quoteMysqlIdent(name)})`;
	const sets = updatable
		.map((name) => `${quoteMysqlIdent(name)} = ${incoming(name)}`)
		.join(', ');
	const alias = rowAlias ? ' as new_row' : '';

	return `insert into ${table} (${columnList}) values ${groups}${alias} on duplicate key update ${sets}`;
};
export const postgresInsert = (
	meta: DbTableMeta,
	rowCount: number,
	overridingSystemValue: boolean
) => {
	const cols = insertableColumns(meta);
	const columnList = cols.map((col) => quoteIdent(col.name)).join(', ');
	const overriding = overridingSystemValue ? ' overriding system value' : '';
	const groups = valueGroups(
		rowCount,
		cols.length,
		(index) => `$${index + 1}`
	);

	return `insert into ${quoteIdent(meta.name)} (${columnList})${overriding} values ${groups} ${conflictClause(meta)}`;
};
export const sqliteInsert = (meta: DbTableMeta, rowCount: number) => {
	const cols = insertableColumns(meta);
	const columnList = cols.map((col) => quoteIdent(col.name)).join(', ');
	const groups = valueGroups(rowCount, cols.length, () => '?');

	return `insert into ${quoteIdent(meta.name)} (${columnList}) values ${groups} ${conflictClause(meta)}`;
};

const mssqlCast = (col: DbColumnMeta, index: number) =>
	`cast(@p${index} as ${col.sqlType ?? 'nvarchar(max)'})`;

/* SQL Server has no upsert statement: MERGE a VALUES source on the primary
   key. Parameters are cast to each column's declared type in the source so
   inference never widens or truncates. */
export const dependencyOrder = (names: string[], links: DbForeignLink[]) => {
	const present = new Set(names);
	const edges = links.filter(
		(link) =>
			present.has(link.from) &&
			present.has(link.to) &&
			link.from !== link.to
	);
	const indegree = new Map(names.map((name) => [name, 0]));
	edges.forEach((link) =>
		indegree.set(link.from, (indegree.get(link.from) ?? 0) + 1)
	);
	const ready = names.filter((name) => (indegree.get(name) ?? 0) === 0);
	const ordered: string[] = [];
	const release = (parent: string) =>
		edges
			.filter((link) => link.to === parent)
			.forEach((link) => {
				const next = (indegree.get(link.from) ?? 0) - 1;
				indegree.set(link.from, next);
				if (next === 0) ready.push(link.from);
			});
	const drain = () => {
		const head = ready.shift();
		if (head === undefined) return;
		ordered.push(head);
		release(head);
		drain();
	};
	drain();
	names.forEach((name) => {
		if (!ordered.includes(name)) ordered.push(name);
	});

	return ordered;
};
export const mssqlUpsert = (
	meta: DbTableMeta,
	rowCount: number,
	qualifiedTable: string
) => {
	const cols = insertableColumns(meta);
	const names = cols.map((col) => quoteMssqlIdent(col.name));
	const rows = Array.from({ length: rowCount }, (_, rowIdx) => {
		const slots = cols.map((col, colIdx) =>
			mssqlCast(col, rowIdx * cols.length + colIdx)
		);

		return `(${slots.join(', ')})`;
	}).join(', ');
	const identity = cols.some((col) => col.identity === true);
	const identityOn = identity
		? `set identity_insert ${qualifiedTable} on; `
		: '';
	const identityOff = identity
		? ` set identity_insert ${qualifiedTable} off;`
		: '';
	if (meta.primaryKey.length === 0)
		return `${identityOn}insert into ${qualifiedTable} (${names.join(', ')}) values ${rows};${identityOff}`;
	const match = meta.primaryKey
		.map(
			(name) =>
				`tgt.${quoteMssqlIdent(name)} = src.${quoteMssqlIdent(name)}`
		)
		.join(' and ');
	const updatable = updatableColumns(meta);
	const whenMatched =
		updatable.length === 0
			? ''
			: ` when matched then update set ${updatable
					.map(
						(name) =>
							`tgt.${quoteMssqlIdent(name)} = src.${quoteMssqlIdent(name)}`
					)
					.join(', ')}`;
	const sourceCols = names.map((name) => `src.${name}`).join(', ');

	return `${identityOn}merge into ${qualifiedTable} with (holdlock) as tgt using (values ${rows}) as src (${names.join(', ')}) on ${match}${whenMatched} when not matched then insert (${names.join(', ')}) values (${sourceCols});${identityOff}`;
};
