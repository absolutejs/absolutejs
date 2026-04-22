import { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';
import type {
	RAGBackendCapabilities,
	RAGLexicalQueryInput,
	RAGQueryInput,
	RAGVectorCountInput,
	RAGVectorDeleteInput,
	RAGSQLiteNativeDiagnostics,
	RAGUpsertInput,
	RAGVectorStore,
	RAGVectorStoreStatus,
	SQLiteVecResolution
} from '../../../../types/ai';
import {
	RAG_NATIVE_QUERY_CANDIDATE_LIMIT,
	RAG_VECTOR_DIMENSIONS_DEFAULT
} from '../../../constants';
import { rankRAGLexicalMatches } from '../lexical';
import { resolveAbsoluteSQLiteVec } from '../resolveAbsoluteSQLiteVec';
import { matchesMetadataFilterRecord } from './filtering';
import {
	planNativeCandidateSearchBackfillK,
	planNativeCandidateSearchK,
	resolveAdaptiveNativeCandidateLimit,
	summarizeSQLiteCandidateCoverage
} from './queryPlanning';
import { createRAGVector, normalizeVector, querySimilarity } from './utils';

const DEFAULT_DIMENSIONS = RAG_VECTOR_DIMENSIONS_DEFAULT;
const DEFAULT_TABLE_NAME = 'rag_chunks';
const DEFAULT_NATIVE_TABLE_SUFFIX = '_vec0';
const DEFAULT_QUERY_MULTIPLIER = 4;
const MAX_QUERY_MULTIPLIER = 16;
const IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

type NativeDistanceMetric = 'cosine' | 'l2';

type NativeRAGMode = 'vec0';

export type NativeSQLiteRAGStoreOptions = {
	mode: NativeRAGMode;
	extensionPath?: string;
	extensionInitSql?: string | string[];
	distanceMetric?: NativeDistanceMetric;
	tableName?: string;
	queryMultiplier?: number;
	requireAvailable?: boolean;
	resolveFromAbsolutePackages?: boolean;
};

export type SQLiteRAGStoreOptions = {
	db?: Database;
	path?: string;
	dimensions?: number;
	mockEmbedding?: (text: string) => Promise<number[]>;
	tableName?: string;
	native?: NativeSQLiteRAGStoreOptions;
};

type InternalChunk = {
	chunkId: string;
	text: string;
	title?: string;
	source?: string;
	metadata?: Record<string, unknown>;
	vector: number[];
};

type ParsedMetadata = {
	[key: string]: unknown;
};

const isParsedMetadata = (value: unknown): value is ParsedMetadata =>
	Boolean(value) && typeof value === 'object';

type StoredRow = {
	chunk_id: string;
	text: string;
	title: string | null;
	source: string | null;
	metadata: string | null;
	embedding: string;
};

type NativeStoredRow = {
	chunk_id: string;
	chunk_text: string;
	title: string | null;
	source: string | null;
	metadata: string | null;
	embedding: string;
	distance: number;
};

type SQLiteFilterBinding = string | number | bigint | boolean | null;

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === 'object';

const isStoredRow = (value: unknown): value is StoredRow =>
	isObjectRecord(value) &&
	typeof value.chunk_id === 'string' &&
	typeof value.text === 'string' &&
	(typeof value.title === 'string' || value.title === null) &&
	(typeof value.source === 'string' || value.source === null) &&
	(typeof value.metadata === 'string' || value.metadata === null) &&
	typeof value.embedding === 'string';

const isNativeStoredRow = (value: unknown): value is NativeStoredRow =>
	isObjectRecord(value) &&
	typeof value.chunk_id === 'string' &&
	typeof value.chunk_text === 'string' &&
	(typeof value.title === 'string' || value.title === null) &&
	(typeof value.source === 'string' || value.source === null) &&
	(typeof value.metadata === 'string' || value.metadata === null) &&
	typeof value.embedding === 'string' &&
	typeof value.distance === 'number';

const toStoredRows = (value: unknown) =>
	Array.isArray(value) ? value.filter((row) => isStoredRow(row)) : [];

const toNativeStoredRows = (value: unknown) =>
	Array.isArray(value) ? value.filter((row) => isNativeStoredRow(row)) : [];

const createSQLiteStatus = (
	dimensions: number,
	nativeDiagnostics: RAGSQLiteNativeDiagnostics | undefined,
	useNative: boolean
): RAGVectorStoreStatus => ({
	backend: 'sqlite',
	dimensions,
	native: nativeDiagnostics,
	vectorMode: useNative ? 'native_vec0' : 'json_fallback'
});

const createSQLiteCapabilities = (
	useNative: boolean
): RAGBackendCapabilities => ({
	backend: 'sqlite' as const,
	nativeVectorSearch: useNative,
	persistence: 'embedded' as const,
	serverSideFiltering: useNative,
	streamingIngestStatus: false
});

const assertSupportedIdentifier = (name: string) => {
	if (!IDENTIFIER_RE.test(name)) {
		throw new Error(
			`Invalid table name "${name}". Only alphanumeric and underscore names are allowed.`
		);
	}
};

const normalizeQueryMultiplier = (value: number | undefined) => {
	if (value === undefined || !Number.isFinite(value)) {
		return DEFAULT_QUERY_MULTIPLIER;
	}

	const minMultiplier = Math.max(1, Math.floor(value));

	return Math.min(minMultiplier, MAX_QUERY_MULTIPLIER);
};

const normalizeMaxBackfills = (value: number | undefined) => {
	if (value === undefined || !Number.isFinite(value)) {
		return undefined;
	}

	return Math.max(0, Math.floor(value));
};

const normalizeMinResults = (value: number | undefined, topK: number) => {
	if (value === undefined || !Number.isFinite(value)) {
		return topK;
	}

	return Math.min(topK, Math.max(1, Math.floor(value)));
};

const resolveFillTarget = (input: {
	topK: number;
	minResults: number;
	fillPolicy?: 'strict_topk' | 'satisfy_min_results';
}) => {
	const fillPolicy = input.fillPolicy ?? 'satisfy_min_results';

	return {
		fillPolicy,
		targetResults:
			fillPolicy === 'strict_topk' ? input.topK : input.minResults
	};
};

const toJSONString = (metadata?: Record<string, unknown>) =>
	metadata === undefined ? null : JSON.stringify(metadata);

const parseMetadata = (value: string | null) => {
	if (value === null) {
		return undefined;
	}

	try {
		const parsed = JSON.parse(value);
		if (isParsedMetadata(parsed)) {
			return parsed;
		}
	} catch {
		// ignore invalid payloads
	}

	return undefined;
};

const parseVector = (value: string) => {
	try {
		const parsed = JSON.parse(value);

		if (Array.isArray(parsed)) {
			return parsed.filter(
				(element): element is number =>
					typeof element === 'number' && Number.isFinite(element)
			);
		}
	} catch {
		// ignore invalid payloads
	}

	return [];
};

const toSQLiteFilterBinding = (
	value: unknown
): SQLiteFilterBinding | undefined =>
	value === null ||
	typeof value === 'string' ||
	typeof value === 'number' ||
	typeof value === 'bigint' ||
	typeof value === 'boolean'
		? value
		: undefined;

const FILTER_PATH_SEGMENT_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

const isObjectFilterRecord = (
	value: unknown
): value is Record<string, unknown> =>
	Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isOperatorFilterRecord = (
	value: unknown
): value is Record<string, unknown> =>
	isObjectFilterRecord(value) &&
	Object.keys(value).some((key) => key.startsWith('$'));

const isNestedFilterArray = (
	value: unknown
): value is Record<string, unknown>[] =>
	Array.isArray(value) && value.every((entry) => isObjectFilterRecord(entry));

const toSQLiteJsonPath = (key: string) => {
	const segments = key.split('.').filter(Boolean);
	if (
		segments.length === 0 ||
		!segments.every((segment) => FILTER_PATH_SEGMENT_RE.test(segment))
	) {
		return null;
	}

	return `$.${segments.join('.')}`;
};

const resolveSQLiteFilterColumn = (
	key: string,
	aliases: {
		chunkId: string;
		metadata: string;
		source: string;
		title: string;
	}
) => {
	if (key === 'chunkId')
		return { actualSql: aliases.chunkId, kind: 'scalar' as const };
	if (key === 'source')
		return { actualSql: aliases.source, kind: 'scalar' as const };
	if (key === 'title')
		return { actualSql: aliases.title, kind: 'scalar' as const };

	const path = toSQLiteJsonPath(key);
	if (!path) {
		return null;
	}

	return {
		actualSql: `json_extract(${aliases.metadata}, ?)`,
		kind: 'metadata' as const,
		path
	};
};

const buildSQLiteScalarClause = (
	actualSql: string,
	expected: unknown,
	params: SQLiteFilterBinding[]
): string | null => {
	if (!isOperatorFilterRecord(expected)) {
		const binding = toSQLiteFilterBinding(expected);
		if (binding === undefined) {
			return null;
		}

		params.push(binding);
		return `${actualSql} = ?`;
	}

	const clauses: string[] = [];
	for (const [operator, value] of Object.entries(expected)) {
		switch (operator) {
			case '$exists':
				clauses.push(
					Boolean(value)
						? `${actualSql} IS NOT NULL`
						: `${actualSql} IS NULL`
				);
				break;
			case '$ne':
				const neBinding = toSQLiteFilterBinding(value);
				if (neBinding === undefined) {
					return null;
				}
				params.push(neBinding);
				clauses.push(`(${actualSql} IS NULL OR ${actualSql} != ?)`);
				break;
			case '$in':
				if (
					!Array.isArray(value) ||
					value.length === 0 ||
					value.some(
						(entry) => toSQLiteFilterBinding(entry) === undefined
					)
				) {
					return null;
				}
				params.push(...value);
				clauses.push(
					`${actualSql} IN (${value.map(() => '?').join(', ')})`
				);
				break;
			case '$gt':
			case '$gte':
			case '$lt':
			case '$lte': {
				if (typeof value !== 'number' || !Number.isFinite(value)) {
					return null;
				}
				params.push(value);
				const comparison =
					operator === '$gt'
						? '>'
						: operator === '$gte'
							? '>='
							: operator === '$lt'
								? '<'
								: '<=';
				clauses.push(`${actualSql} ${comparison} ?`);
				break;
			}
			default:
				return null;
		}
	}

	return clauses.length > 0
		? clauses.map((clause) => `(${clause})`).join(' AND ')
		: null;
};

const buildSQLiteArrayClause = (
	metadataSql: string,
	path: string,
	expected: unknown,
	params: SQLiteFilterBinding[]
): string | null => {
	if (!isOperatorFilterRecord(expected)) {
		return null;
	}

	const arrayTypeClause = `json_type(${metadataSql}, ?) = 'array'`;
	const clauses: string[] = [];
	for (const [operator, value] of Object.entries(expected)) {
		switch (operator) {
			case '$contains':
				const containsBinding = toSQLiteFilterBinding(value);
				if (containsBinding === undefined) {
					return null;
				}
				params.push(path, path, containsBinding);
				clauses.push(
					`(${arrayTypeClause} AND EXISTS (SELECT 1 FROM json_each(json_extract(${metadataSql}, ?)) WHERE json_each.value = ?))`
				);
				break;
			case '$containsAny':
				if (
					!Array.isArray(value) ||
					value.length === 0 ||
					value.some(
						(entry) => toSQLiteFilterBinding(entry) === undefined
					)
				) {
					return null;
				}
				params.push(path, path, ...value);
				clauses.push(
					`(${arrayTypeClause} AND EXISTS (SELECT 1 FROM json_each(json_extract(${metadataSql}, ?)) WHERE json_each.value IN (${value
						.map(() => '?')
						.join(', ')})))`
				);
				break;
			case '$containsAll':
				if (
					!Array.isArray(value) ||
					value.length === 0 ||
					value.some(
						(entry) => toSQLiteFilterBinding(entry) === undefined
					)
				) {
					return null;
				}
				clauses.push(
					...value.map((entry) => {
						params.push(path, path, entry);
						return `(${arrayTypeClause} AND EXISTS (SELECT 1 FROM json_each(json_extract(${metadataSql}, ?)) WHERE json_each.value = ?))`;
					})
				);
				break;
			default:
				return null;
		}
	}

	return clauses.length > 0
		? clauses.map((clause) => `(${clause})`).join(' AND ')
		: null;
};

const buildSQLiteMetadataScalarMatchClause = (
	metadataSql: string,
	actualSql: string,
	path: string,
	expected: unknown,
	params: SQLiteFilterBinding[]
) => {
	const binding = toSQLiteFilterBinding(expected);
	if (binding === undefined) {
		return null;
	}

	params.push(path, binding, path, path, binding);
	return `(${actualSql} = ? OR (json_type(${metadataSql}, ?) = 'array' AND EXISTS (SELECT 1 FROM json_each(json_extract(${metadataSql}, ?)) WHERE json_each.value = ?)))`;
};

const buildSQLiteFilterPlan = (
	filter: Record<string, unknown> | undefined,
	aliases: {
		chunkId: string;
		metadata: string;
		source: string;
		title: string;
	}
): { clause: string; params: SQLiteFilterBinding[] } | null => {
	if (!filter) {
		return { clause: '', params: [] };
	}

	const params: SQLiteFilterBinding[] = [];
	const build = (entry: Record<string, unknown>): string | null => {
		const clauses: string[] = [];

		for (const [key, value] of Object.entries(entry)) {
			if (key === '$and' || key === '$or') {
				if (!isNestedFilterArray(value) || value.length === 0) {
					return null;
				}

				const nested = value.map((item) => build(item));
				if (nested.some((item) => item === null)) {
					return null;
				}

				clauses.push(
					`(${nested
						.filter((item): item is string => Boolean(item))
						.join(key === '$and' ? ' AND ' : ' OR ')})`
				);
				continue;
			}

			if (key === '$not') {
				if (!isObjectFilterRecord(value)) {
					return null;
				}

				const nested = build(value);
				if (!nested) {
					return null;
				}

				clauses.push(`NOT (${nested})`);
				continue;
			}

			const resolved = resolveSQLiteFilterColumn(key, aliases);
			if (!resolved) {
				return null;
			}

			if (resolved.kind === 'metadata') {
				const metadataScalarClause =
					buildSQLiteMetadataScalarMatchClause(
						aliases.metadata,
						resolved.actualSql,
						resolved.path,
						value,
						params
					);
				if (metadataScalarClause) {
					clauses.push(metadataScalarClause);
					continue;
				}

				const arrayClause = buildSQLiteArrayClause(
					aliases.metadata,
					resolved.path,
					value,
					params
				);
				if (arrayClause) {
					clauses.push(arrayClause);
					continue;
				}

				params.push(resolved.path);
			}

			const scalarClause = buildSQLiteScalarClause(
				resolved.actualSql,
				value,
				params
			);
			if (!scalarClause) {
				return null;
			}

			clauses.push(scalarClause);
		}

		return clauses.length > 0
			? clauses.map((clause) => `(${clause})`).join(' AND ')
			: '';
	};

	const clause = build(filter);
	return clause === null ? null : { clause, params };
};

const buildSQLitePushdownFilter = (
	filter: Record<string, unknown> | undefined
): Record<string, unknown> | undefined => {
	if (!filter) {
		return undefined;
	}

	const nextEntries: Array<[string, unknown]> = [];

	for (const [key, value] of Object.entries(filter)) {
		if (key === '$and' || key === '$or') {
			if (!isNestedFilterArray(value)) {
				continue;
			}

			const nested = value
				.map((entry) => buildSQLitePushdownFilter(entry))
				.filter((entry): entry is Record<string, unknown> =>
					Boolean(entry)
				);

			if (nested.length > 0) {
				nextEntries.push([key, nested]);
			}
			continue;
		}

		if (key === '$not') {
			if (!isObjectFilterRecord(value)) {
				continue;
			}

			const nested = buildSQLitePushdownFilter(value);
			if (nested) {
				nextEntries.push([key, nested]);
			}
			continue;
		}

		if (
			Array.isArray(value) ||
			(isOperatorFilterRecord(value) &&
				Object.keys(value).some(
					(operator) =>
						operator === '$contains' ||
						operator === '$containsAny' ||
						operator === '$containsAll'
				))
		) {
			continue;
		}

		nextEntries.push([key, value]);
	}

	return nextEntries.length > 0 ? Object.fromEntries(nextEntries) : undefined;
};

const normalizeDistance = (distance: number, metric: NativeDistanceMetric) => {
	if (!Number.isFinite(distance)) {
		return 0;
	}

	if (metric === 'cosine') {
		return Math.min(1, Math.max(0, 1 - distance));
	}

	// L2 distance: lower is better, map to approximate similarity.
	return Math.max(0, 1 / (1 + Math.abs(distance)));
};

const matchesFilter = (
	record: InternalChunk,
	filter?: Record<string, unknown>
) =>
	matchesMetadataFilterRecord(
		{
			chunkId: record.chunkId,
			metadata: record.metadata,
			source: record.source,
			title: record.title,
			...(record.metadata ?? {})
		},
		filter
	);

const mapFilterToRows = (rows: StoredRow[]) =>
	rows.map((row) => ({
		chunkId: row.chunk_id,
		metadata: parseMetadata(row.metadata),
		source: row.source ?? undefined,
		text: row.text,
		title: row.title ?? undefined,
		vector: parseVector(row.embedding)
	}));

const buildJsonQuerySql = (tableName: string, whereClause?: string) => `
	SELECT chunk_id, text, title, source, metadata, embedding FROM ${tableName}
	${whereClause ? `WHERE ${whereClause}` : ''}
`;

const buildJsonCountSql = (tableName: string, whereClause?: string) => `
	SELECT COUNT(*) AS count FROM ${tableName}
	${whereClause ? `WHERE ${whereClause}` : ''}
`;

const getChunkCountFromSql = (
	db: Database,
	sql: string,
	params: SQLiteFilterBinding[] = []
) => {
	const result = db.prepare(sql).get(...params) as { count?: unknown } | null;
	const count = result?.count;

	return typeof count === 'number' && Number.isFinite(count) ? count : 0;
};

const getPragmaNumericValue = (db: Database, pragma: string) => {
	const row = db.prepare(`PRAGMA ${pragma}`).get() as Record<
		string,
		unknown
	> | null;
	const value = row ? row[Object.keys(row)[0] ?? ''] : undefined;

	return typeof value === 'number' && Number.isFinite(value) ? value : 0;
};

const refreshSQLiteRuntimeDiagnostics = (
	db: Database,
	nativeDiagnostics: RAGSQLiteNativeDiagnostics | undefined,
	diagnosticTableName: string
) => {
	if (!nativeDiagnostics) {
		return;
	}

	try {
		const rowCount = getChunkCountFromSql(
			db,
			buildJsonCountSql(diagnosticTableName)
		);
		const pageCount = getPragmaNumericValue(db, 'page_count');
		const pageSize = getPragmaNumericValue(db, 'page_size');
		const freelistCount = getPragmaNumericValue(db, 'freelist_count');

		nativeDiagnostics.rowCount = rowCount;
		nativeDiagnostics.pageCount = pageCount;
		nativeDiagnostics.freelistCount = freelistCount;
		nativeDiagnostics.databaseBytes =
			pageCount > 0 && pageSize > 0 ? pageCount * pageSize : 0;
		nativeDiagnostics.lastHealthCheckAt = Date.now();
		nativeDiagnostics.lastHealthError = undefined;
	} catch (error) {
		nativeDiagnostics.lastHealthCheckAt = Date.now();
		nativeDiagnostics.lastHealthError = getErrorMessage(error);
	}
};

const buildNativeQuerySql = (tableName: string, whereClause?: string) => `
	SELECT
		chunk_id,
		embedding,
		chunk_text,
		title,
		source,
		metadata,
		distance
	FROM ${tableName}
	WHERE embedding MATCH vec_f32(?)
		AND k = ?
		${whereClause ? `AND (${whereClause})` : ''}
	ORDER BY distance
`;

const getFilteredSQLiteCandidateCount = (
	db: Database,
	tableName: string,
	filterPlan: { clause: string; params: SQLiteFilterBinding[] } | null
) => {
	if (!filterPlan) {
		return undefined;
	}

	const result = db
		.prepare(buildJsonCountSql(tableName, filterPlan.clause))
		.get(...filterPlan.params) as { count?: unknown } | null;
	const count = result?.count;

	return typeof count === 'number' && Number.isFinite(count)
		? count
		: undefined;
};

const createJsonStatements = (db: Database, tableName: string) => {
	const insertSql = `
		INSERT INTO ${tableName} (
			chunk_id,
			text,
			title,
			source,
			metadata,
			embedding
		) VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(chunk_id) DO UPDATE SET
			text = excluded.text,
			title = excluded.title,
			source = excluded.source,
			metadata = excluded.metadata,
			embedding = excluded.embedding
	`;

	const querySql = `
		SELECT chunk_id, text, title, source, metadata, embedding FROM ${tableName}
	`;
	const clearSql = `DELETE FROM ${tableName}`;
	const deleteSql = `DELETE FROM ${tableName} WHERE chunk_id = ?`;

	const init = () =>
		db.exec(`
			CREATE TABLE IF NOT EXISTS ${tableName} (
				chunk_id TEXT PRIMARY KEY,
				text TEXT NOT NULL,
				title TEXT,
				source TEXT,
				metadata TEXT,
				embedding TEXT NOT NULL
			)
		`);

	init();

	return {
		clear: db.prepare(clearSql),
		delete: db.prepare(deleteSql),
		init,
		insert: db.prepare(insertSql),
		query: db.prepare(querySql)
	};
};

const getSQLiteChunkIdsByChunkIds = (
	db: Database,
	tableName: string,
	chunkIds: string[]
) => {
	const uniqueChunkIds = [...new Set(chunkIds)];
	if (uniqueChunkIds.length === 0) {
		return [] as string[];
	}

	const whereClause = uniqueChunkIds.map(() => '?').join(', ');
	const rows = db
		.prepare(
			`SELECT chunk_id FROM ${tableName} WHERE chunk_id IN (${whereClause})`
		)
		.all(...uniqueChunkIds) as Array<{ chunk_id?: string }>;

	return rows
		.map((row) => row.chunk_id)
		.filter((chunkId): chunkId is string => typeof chunkId === 'string');
};

const getSQLiteCandidateChunkIdsByFilter = (
	db: Database,
	tableName: string,
	filter: Record<string, unknown> | undefined,
	jsonStatements: ReturnType<typeof createJsonStatements>
) => {
	if (!filter || Object.keys(filter).length === 0) {
		return [] as string[];
	}

	const pushdownFilter = buildSQLitePushdownFilter(filter);
	const filterPlan = buildSQLiteFilterPlan(pushdownFilter, {
		chunkId: 'chunk_id',
		metadata: 'metadata',
		source: 'source',
		title: 'title'
	});
	const rawRows = toStoredRows(
		filterPlan
			? db
					.prepare(buildJsonQuerySql(tableName, filterPlan.clause))
					.all(...filterPlan.params)
			: jsonStatements.query.all()
	);
	const chunks = mapFilterToRows(rawRows);

	return chunks
		.filter((chunk) => matchesFilter(chunk, filter))
		.map((chunk) => chunk.chunkId);
};

const getSQLiteCandidateChunkIds = (
	db: Database,
	tableName: string,
	jsonStatements: ReturnType<typeof createJsonStatements>,
	input: {
		filter?: Record<string, unknown>;
		chunkIds?: string[];
	}
) => {
	const chunkIdSet = new Set<string>();
	if (input.filter && Object.keys(input.filter).length > 0) {
		for (const chunkId of getSQLiteCandidateChunkIdsByFilter(
			db,
			tableName,
			input.filter,
			jsonStatements
		)) {
			chunkIdSet.add(chunkId);
		}
	}

	if (input.chunkIds && input.chunkIds.length > 0) {
		for (const chunkId of getSQLiteChunkIdsByChunkIds(
			db,
			tableName,
			input.chunkIds
		)) {
			chunkIdSet.add(chunkId);
		}
	}

	return [...chunkIdSet];
};

const toVectorText = (vector: number[]) => JSON.stringify(vector);

const createNativeVec0Table = (
	db: Database,
	tableName: string,
	dimensions: number,
	metric: NativeDistanceMetric
) => {
	const metricSuffix = metric === 'cosine' ? ' distance_metric=cosine' : '';

	db.exec(`
		CREATE VIRTUAL TABLE IF NOT EXISTS ${tableName} USING vec0(
			chunk_id TEXT,
			embedding float[${dimensions}]${metricSuffix},
			+chunk_text TEXT,
			title TEXT,
			source TEXT,
			metadata TEXT
		)
	`);
};

const createNativeVec0Statements = (db: Database, tableName: string) => {
	const upsertSql = `
		INSERT INTO ${tableName} (
			chunk_id,
			embedding,
			chunk_text,
			title,
			source,
			metadata
		) VALUES (?, vec_f32(?), ?, ?, ?, ?)
	`;
	const deleteSql = `DELETE FROM ${tableName} WHERE chunk_id = ?`;
	const querySql = `
		SELECT
			chunk_id,
			embedding,
			chunk_text,
			title,
			source,
			metadata,
			distance
		FROM ${tableName}
		WHERE embedding MATCH vec_f32(?)
			AND k = ?
		ORDER BY distance
	`;

	return {
		clear: db.prepare(`DELETE FROM ${tableName}`),
		delete: db.prepare(deleteSql),
		insert: db.prepare(upsertSql),
		query: db.prepare(querySql)
	};
};

const mapToRows = (
	vector: number[],
	chunks: InternalChunk[],
	filter?: Record<string, unknown>
) =>
	chunks
		.map((chunk) => ({
			chunk,
			score: querySimilarity(vector, normalizeVector(chunk.vector))
		}))
		.filter(({ chunk }) => matchesFilter(chunk, filter))
		.sort((left, right) => right.score - left.score);
const executeNativeInitSql = (db: Database, initSql?: string | string[]) => {
	if (!initSql) {
		return;
	}

	if (typeof initSql === 'string') {
		db.exec(initSql);

		return;
	}

	for (const command of initSql) {
		db.exec(command);
	}
};

const getErrorMessage = (error: unknown) =>
	error instanceof Error ? error.message : String(error);

const resolveConfiguredNativeExtension = (
	nativeConfig: NativeSQLiteRAGStoreOptions | undefined
): SQLiteVecResolution => {
	const platformKey = `${process.platform}-${process.arch}`;

	if (nativeConfig?.extensionPath) {
		return existsSync(nativeConfig.extensionPath)
			? {
					libraryPath: nativeConfig.extensionPath,
					platformKey,
					source: 'explicit',
					status: 'resolved'
				}
			: {
					libraryPath: nativeConfig.extensionPath,
					platformKey,
					reason: `Configured native.extensionPath was not found: ${nativeConfig.extensionPath}`,
					source: 'explicit',
					status: 'binary_missing'
				};
	}

	if (nativeConfig?.resolveFromAbsolutePackages !== false) {
		return resolveAbsolutePackageNativeExtension(platformKey);
	}

	const envResolution = resolveNativeExtensionFromEnv(platformKey);
	if (envResolution) return envResolution;

	return {
		platformKey,
		reason: 'No native sqlite-vec path was configured. AbsoluteJS will still attempt vec0 initialization in case the extension is already registered on the Database connection.',
		source: 'database',
		status: 'not_configured'
	};
};

const describeNativeFallbackReason = (resolution?: SQLiteVecResolution) => {
	if (!resolution) {
		return 'Native sqlite vec0 was not configured.';
	}

	switch (resolution.status) {
		case 'resolved':
			return undefined;
		case 'package_not_installed':
			return `Install ${resolution.packageName ?? '@absolutejs/absolute-rag-sqlite'} for ${resolution.platformKey}, or provide native.extensionPath.`;
		case 'binary_missing':
			return (
				resolution.reason ?? 'Resolved sqlite-vec binary was missing.'
			);
		case 'unsupported_platform':
			return (
				resolution.reason ??
				'This platform is not yet supported by AbsoluteJS sqlite-vec packages.'
			);
		case 'not_configured':
			return (
				resolution.reason ?? 'No sqlite-vec binary path was configured.'
			);
		case 'package_invalid':
			return (
				resolution.reason ??
				'The sqlite-vec package manifest was invalid.'
			);
		default:
			return 'Native sqlite vec0 could not be initialized.';
	}
};

const resolveNativeExtensionFromEnv = (platformKey: string) => {
	const envPath = process.env.SQLITE_VEC_EXTENSION_PATH;
	if (!envPath) {
		return null;
	}

	if (existsSync(envPath)) {
		return {
			libraryPath: envPath,
			platformKey,
			source: 'env' as const,
			status: 'resolved' as const
		};
	}

	return {
		libraryPath: envPath,
		platformKey,
		reason: `SQLITE_VEC_EXTENSION_PATH was set but not found: ${envPath}`,
		source: 'env' as const,
		status: 'binary_missing' as const
	};
};

const shouldResolveNativeFromEnv = (resolution: SQLiteVecResolution) =>
	resolution.status === 'binary_missing' ||
	resolution.status === 'package_not_installed' ||
	resolution.status === 'unsupported_platform';

const resolveAbsolutePackageNativeExtension: (
	platformKey: string
) => SQLiteVecResolution = (platformKey) => {
	const packageResolution = resolveAbsoluteSQLiteVec();
	if (!shouldResolveNativeFromEnv(packageResolution)) {
		return packageResolution;
	}

	const envResolution = resolveNativeExtensionFromEnv(platformKey);
	if (envResolution) {
		return envResolution;
	}

	return packageResolution;
};

const activateNativeDiagnostics = (
	nativeDiagnostics: RAGSQLiteNativeDiagnostics | undefined
) => {
	if (!nativeDiagnostics) {
		return;
	}

	nativeDiagnostics.available = true;
	nativeDiagnostics.active = true;
	nativeDiagnostics.fallbackReason = undefined;

	if (
		nativeDiagnostics.resolution &&
		nativeDiagnostics.resolution.status === 'resolved'
	) {
		return;
	}

	nativeDiagnostics.resolution = {
		platformKey: `${process.platform}-${process.arch}`,
		reason: 'sqlite-vec was already available on the Database connection or loaded by native.extensionInitSql.',
		source: 'database',
		status: 'resolved'
	};
};

const loadNativeExtension = (
	db: Database,
	nativeResolution: SQLiteVecResolution | undefined
) => {
	if (nativeResolution?.status !== 'resolved') {
		return;
	}

	if (!nativeResolution.libraryPath) {
		return;
	}

	db.loadExtension(nativeResolution.libraryPath);
};

const markNativeLoadFailure = (
	nativeDiagnostics: RAGSQLiteNativeDiagnostics | undefined,
	error: unknown,
	nativeResolution: SQLiteVecResolution | undefined
) => {
	if (!nativeDiagnostics) {
		return;
	}

	nativeDiagnostics.available = false;
	nativeDiagnostics.active = false;
	nativeDiagnostics.lastLoadError = getErrorMessage(error);
	nativeDiagnostics.fallbackReason =
		describeNativeFallbackReason(nativeResolution) ??
		nativeDiagnostics.lastLoadError;
};

const markNativeQueryFailure = (
	nativeDiagnostics: RAGSQLiteNativeDiagnostics | undefined,
	error: unknown
) => {
	if (!nativeDiagnostics) {
		return;
	}

	nativeDiagnostics.lastQueryError = getErrorMessage(error);
	nativeDiagnostics.active = false;
	nativeDiagnostics.fallbackReason = nativeDiagnostics.lastQueryError;
};

const countFilterClauses = (filter?: Record<string, unknown>): number => {
	if (!filter) {
		return 0;
	}

	let count = 0;
	for (const [key, value] of Object.entries(filter)) {
		if (key === '$and' || key === '$or') {
			if (isNestedFilterArray(value)) {
				count += value.reduce(
					(total, entry) => total + countFilterClauses(entry),
					0
				);
			}
			continue;
		}

		if (key === '$not') {
			if (isObjectFilterRecord(value)) {
				count += countFilterClauses(value);
			}
			continue;
		}

		count += 1;
	}

	return count;
};

const resolveSQLitePushdownMode = (input: {
	filter?: Record<string, unknown>;
	pushdownFilter?: Record<string, unknown>;
}): {
	jsRemainderClauseCount: number;
	jsRemainderRatio?: number;
	pushdownClauseCount: number;
	pushdownCoverageRatio?: number;
	pushdownMode: 'none' | 'partial' | 'full';
	totalFilterClauseCount: number;
} => {
	const totalFilterClauseCount = countFilterClauses(input.filter);
	const pushdownClauseCount = countFilterClauses(input.pushdownFilter);
	const jsRemainderClauseCount = Math.max(
		0,
		totalFilterClauseCount - pushdownClauseCount
	);

	const pushdownMode =
		pushdownClauseCount === 0
			? 'none'
			: pushdownClauseCount >= totalFilterClauseCount
				? 'full'
				: 'partial';

	return {
		jsRemainderClauseCount,
		jsRemainderRatio:
			totalFilterClauseCount > 0
				? jsRemainderClauseCount / totalFilterClauseCount
				: undefined,
		pushdownClauseCount,
		pushdownCoverageRatio:
			totalFilterClauseCount > 0
				? pushdownClauseCount / totalFilterClauseCount
				: undefined,
		pushdownMode,
		totalFilterClauseCount
	};
};

const updateSQLiteLastQueryPlan = (input: {
	nativeDiagnostics: RAGSQLiteNativeDiagnostics | undefined;
	queryMode: 'json_fallback' | 'native_vec0';
	filter?: Record<string, unknown>;
	pushdownFilter?: Record<string, unknown>;
	topK: number;
	plannerProfileUsed?: 'latency' | 'balanced' | 'recall';
	queryMultiplierUsed?: number;
	candidateLimitUsed?: number;
	maxBackfillsUsed?: number;
	minResultsUsed?: number;
	fillPolicyUsed?: 'strict_topk' | 'satisfy_min_results';
	filteredCandidateCount?: number;
	initialSearchK?: number;
	finalSearchK?: number;
	backfillCount?: number;
	backfillLimitReached?: boolean;
	minResultsSatisfied?: boolean;
	returnedCount?: number;
	underfilledTopK?: boolean;
	candidateBudgetExhausted?: boolean;
}) => {
	if (!input.nativeDiagnostics) {
		return;
	}

	const pushdown = resolveSQLitePushdownMode({
		filter: input.filter,
		pushdownFilter: input.pushdownFilter
	});

	input.nativeDiagnostics.lastQueryPlan = {
		backfillCount: input.backfillCount,
		candidateBudgetExhausted: input.candidateBudgetExhausted,
		candidateCoverage: summarizeSQLiteCandidateCoverage({
			filteredCandidateCount: input.filteredCandidateCount,
			returnedCount: input.returnedCount,
			topK: input.topK
		}),
		filteredCandidateCount: input.filteredCandidateCount,
		finalSearchK: input.finalSearchK,
		initialSearchK: input.initialSearchK,
		searchExpansionRatio:
			typeof input.initialSearchK === 'number' &&
			typeof input.finalSearchK === 'number' &&
			input.initialSearchK > 0
				? input.finalSearchK / input.initialSearchK
				: undefined,
		jsRemainderClauseCount: pushdown.jsRemainderClauseCount,
		plannerProfileUsed: input.plannerProfileUsed,
		candidateLimitUsed: input.candidateLimitUsed,
		maxBackfillsUsed: input.maxBackfillsUsed,
		minResultsUsed: input.minResultsUsed,
		fillPolicyUsed: input.fillPolicyUsed,
		queryMultiplierUsed: input.queryMultiplierUsed,
		jsRemainderRatio: pushdown.jsRemainderRatio,
		pushdownApplied: pushdown.pushdownClauseCount > 0,
		pushdownClauseCount: pushdown.pushdownClauseCount,
		pushdownCoverageRatio: pushdown.pushdownCoverageRatio,
		pushdownMode: pushdown.pushdownMode,
		queryMode: input.queryMode,
		candidateYieldRatio:
			typeof input.returnedCount === 'number' &&
			typeof input.finalSearchK === 'number' &&
			input.finalSearchK > 0
				? input.returnedCount / input.finalSearchK
				: undefined,
		returnedCount: input.returnedCount,
		backfillLimitReached: input.backfillLimitReached,
		minResultsSatisfied: input.minResultsSatisfied,
		topKFillRatio:
			typeof input.returnedCount === 'number' && input.topK > 0
				? input.returnedCount / input.topK
				: undefined,
		totalFilterClauseCount: pushdown.totalFilterClauseCount,
		underfilledTopK: input.underfilledTopK
	};
};

const markNativeUpsertFailure = (
	nativeDiagnostics: RAGSQLiteNativeDiagnostics | undefined,
	error: unknown
) => {
	if (!nativeDiagnostics) {
		return;
	}

	nativeDiagnostics.lastUpsertError = getErrorMessage(error);
	nativeDiagnostics.active = false;
	nativeDiagnostics.fallbackReason = nativeDiagnostics.lastUpsertError;
};

const analyzeSQLiteBackend = (input: {
	db: Database;
	nativeDiagnostics: RAGSQLiteNativeDiagnostics | undefined;
	tableName: string;
	diagnosticTableName: string;
}) => {
	try {
		input.db.exec('PRAGMA optimize');
		input.db.exec(`ANALYZE ${input.tableName}`);
		input.nativeDiagnostics &&
			(input.nativeDiagnostics.lastAnalyzeAt = Date.now());
		if (input.nativeDiagnostics) {
			input.nativeDiagnostics.lastAnalyzeError = undefined;
		}
		refreshSQLiteRuntimeDiagnostics(
			input.db,
			input.nativeDiagnostics,
			input.diagnosticTableName
		);
	} catch (error) {
		if (input.nativeDiagnostics) {
			input.nativeDiagnostics.lastAnalyzeAt = Date.now();
			input.nativeDiagnostics.lastAnalyzeError = getErrorMessage(error);
		}
		throw error;
	}
};

const initializeNativeBackend = (input: {
	db: Database;
	dimensions: number;
	nativeConfig: NativeSQLiteRAGStoreOptions;
	nativeDiagnostics: RAGSQLiteNativeDiagnostics | undefined;
	nativeDistanceMetric: NativeDistanceMetric;
	nativeResolution: SQLiteVecResolution | undefined;
	nativeTableName: string;
}) => {
	const {
		db,
		dimensions,
		nativeConfig,
		nativeDiagnostics,
		nativeDistanceMetric,
		nativeResolution,
		nativeTableName
	} = input;

	loadNativeExtension(db, nativeResolution);
	executeNativeInitSql(db, nativeConfig.extensionInitSql);
	createNativeVec0Table(
		db,
		nativeTableName,
		dimensions,
		nativeDistanceMetric
	);

	const nativeStatements = createNativeVec0Statements(db, nativeTableName);
	activateNativeDiagnostics(nativeDiagnostics);

	return nativeStatements;
};

const createNativeInitializationError = (
	error: unknown,
	nativeTableName: string
) =>
	new Error(
		`Failed to initialize sqlite vec0 backend for table "${nativeTableName}". ` +
			`Install @absolutejs/absolute-rag-sqlite for your platform, set native.extensionPath, or pre-register the sqlite-vec extension in the Database connection. ` +
			`Details: ${getErrorMessage(error)}`
	);

const initializeNativeBackendSafely = (input: {
	db: Database;
	dimensions: number;
	nativeConfig: NativeSQLiteRAGStoreOptions;
	nativeDiagnostics: RAGSQLiteNativeDiagnostics | undefined;
	nativeDistanceMetric: NativeDistanceMetric;
	nativeResolution: SQLiteVecResolution | undefined;
	nativeTableName: string;
}) => {
	const {
		nativeConfig,
		nativeDiagnostics,
		nativeResolution,
		nativeTableName
	} = input;

	try {
		return initializeNativeBackend(input);
	} catch (error) {
		markNativeLoadFailure(nativeDiagnostics, error, nativeResolution);
		if (nativeConfig.requireAvailable) {
			throw createNativeInitializationError(error, nativeTableName);
		}

		return undefined;
	}
};

const fallbackToJsonUpsert = (
	chunks: InternalChunk[],
	jsonStatements: ReturnType<typeof createJsonStatements>
) => {
	for (const chunk of chunks) {
		jsonStatements.insert.run(
			chunk.chunkId,
			chunk.text,
			chunk.title ?? null,
			chunk.source ?? null,
			toJSONString(chunk.metadata),
			toVectorText(chunk.vector)
		);
	}
};

const upsertNativeChunks = (
	chunks: InternalChunk[],
	nativeStatements: ReturnType<typeof createNativeVec0Statements> | undefined
) => {
	if (!nativeStatements) {
		throw new Error('Native vector statements unavailable');
	}

	for (const chunk of chunks) {
		nativeStatements.delete.run(chunk.chunkId);
		nativeStatements.insert.run(
			chunk.chunkId,
			toVectorText(chunk.vector),
			chunk.text,
			chunk.title ?? null,
			chunk.source ?? null,
			toJSONString(chunk.metadata)
		);
	}
};

export const createSQLiteRAGStore = (
	options: SQLiteRAGStoreOptions = {}
): RAGVectorStore => {
	const dimensions = options.dimensions ?? DEFAULT_DIMENSIONS;
	const tableName = options.tableName ?? DEFAULT_TABLE_NAME;
	assertSupportedIdentifier(tableName);
	const nativeConfig = options.native;
	const nativeTableName =
		nativeConfig?.tableName ?? `${tableName}${DEFAULT_NATIVE_TABLE_SUFFIX}`;

	if (nativeConfig?.mode === 'vec0' && nativeConfig.tableName) {
		assertSupportedIdentifier(nativeConfig.tableName);
	}

	if (!Number.isInteger(dimensions) || dimensions <= 0) {
		throw new Error(
			`Invalid dimension "${dimensions}". dimensions must be a positive integer.`
		);
	}

	const db = options.db ?? new Database(options.path ?? ':memory:');
	const nativeDistanceMetric: NativeDistanceMetric =
		nativeConfig?.distanceMetric === 'l2' ? 'l2' : 'cosine';
	const nativeQueryMultiplier = normalizeQueryMultiplier(
		nativeConfig?.queryMultiplier
	);
	const nativeResolution =
		nativeConfig?.mode === 'vec0'
			? resolveConfiguredNativeExtension(nativeConfig)
			: undefined;
	const nativeDiagnostics: RAGSQLiteNativeDiagnostics | undefined =
		nativeConfig?.mode === 'vec0'
			? {
					active: false,
					available: false,
					distanceMetric: nativeDistanceMetric,
					fallbackReason:
						describeNativeFallbackReason(nativeResolution),
					mode: nativeConfig.mode,
					requested: true,
					resolution: nativeResolution,
					tableName: nativeTableName
				}
			: undefined;

	const jsonStatements = createJsonStatements(db, tableName);
	jsonStatements.init();

	let useNative = false;
	let nativeStatements:
		| ReturnType<typeof createNativeVec0Statements>
		| undefined;
	if (nativeConfig?.mode === 'vec0') {
		nativeStatements = initializeNativeBackendSafely({
			db,
			dimensions,
			nativeConfig,
			nativeDiagnostics,
			nativeDistanceMetric,
			nativeResolution,
			nativeTableName
		});
		useNative = nativeStatements !== undefined;
	}
	refreshSQLiteRuntimeDiagnostics(
		db,
		nativeDiagnostics,
		useNative ? nativeTableName : tableName
	);

	const embed = async (input: {
		text: string;
		model?: string;
		signal?: AbortSignal;
	}) => {
		void input.model;
		if (input.signal?.aborted) {
			throw new DOMException('Aborted', 'AbortError');
		}

		if (options.mockEmbedding) {
			return options.mockEmbedding(input.text).then(normalizeVector);
		}

		return normalizeVector([...createRAGVector(input.text, dimensions)]);
	};

	const queryFallback = async (input: RAGQueryInput) => {
		const queryVector = normalizeVector(input.queryVector);
		const pushdownFilter = buildSQLitePushdownFilter(input.filter);
		const filterPlan = buildSQLiteFilterPlan(pushdownFilter, {
			chunkId: 'chunk_id',
			metadata: 'metadata',
			source: 'source',
			title: 'title'
		});
		const rawRows = toStoredRows(
			filterPlan
				? db
						.prepare(
							buildJsonQuerySql(tableName, filterPlan.clause)
						)
						.all(...filterPlan.params)
				: jsonStatements.query.all()
		);
		const chunks = mapFilterToRows(rawRows);
		const filtered = mapToRows(queryVector, chunks, input.filter);
		const limited = filtered.slice(0, input.topK);
		updateSQLiteLastQueryPlan({
			backfillCount: 0,
			candidateBudgetExhausted: false,
			filter: input.filter,
			filteredCandidateCount: rawRows.length,
			finalSearchK: rawRows.length,
			initialSearchK: rawRows.length,
			nativeDiagnostics,
			pushdownFilter,
			plannerProfileUsed: input.plannerProfile,
			queryMultiplierUsed: input.queryMultiplier,
			queryMode: 'json_fallback',
			returnedCount: limited.length,
			topK: input.topK,
			underfilledTopK: limited.length < input.topK
		});

		return limited.map(({ chunk, score }) => ({
			chunkId: chunk.chunkId,
			chunkText: chunk.text,
			embedding: chunk.vector,
			metadata: chunk.metadata,
			score,
			source: chunk.source,
			title: chunk.title
		}));
	};

	const queryNative = async (input: RAGQueryInput) => {
		if (!nativeStatements) {
			throw new Error('Native vector backend is not available');
		}

		const queryMultiplier = normalizeQueryMultiplier(
			input.queryMultiplier ?? nativeConfig?.queryMultiplier
		);
		const maxBackfills = normalizeMaxBackfills(input.maxBackfills);
		const minResults = normalizeMinResults(input.minResults, input.topK);
		const fillTarget = resolveFillTarget({
			fillPolicy: input.fillPolicy,
			minResults,
			topK: input.topK
		});
		const queryVector = normalizeVector(input.queryVector);
		const queryVectorText = toVectorText(queryVector);
		const pushdownFilter = buildSQLitePushdownFilter(input.filter);
		const filterPlan = buildSQLiteFilterPlan(pushdownFilter, {
			chunkId: 'chunk_id',
			metadata: 'metadata',
			source: 'source',
			title: 'title'
		});
		const filteredCandidateCount = getFilteredSQLiteCandidateCount(
			db,
			tableName,
			filterPlan
		);
		const candidateLimit = resolveAdaptiveNativeCandidateLimit({
			defaultCandidateLimit: RAG_NATIVE_QUERY_CANDIDATE_LIMIT,
			explicitCandidateLimit: input.candidateLimit,
			filteredCandidateCount,
			plannerProfile: input.plannerProfile,
			queryMultiplier,
			topK: input.topK
		});
		const searchK = planNativeCandidateSearchK({
			candidateLimit,
			filteredCandidateCount,
			queryMultiplier,
			topK: input.topK
		});

		if (searchK === 0) {
			return [];
		}

		const runNativeQuery = (candidateK: number) =>
			toNativeStoredRows(
				filterPlan
					? db
							.prepare(
								buildNativeQuerySql(
									nativeTableName,
									filterPlan.clause
								)
							)
							.all(
								queryVectorText,
								candidateK,
								...filterPlan.params
							)
					: nativeStatements.query.all(queryVectorText, candidateK)
			);

		let currentSearchK = searchK;
		let backfillCount = 0;
		let candidateBudgetExhausted = false;
		let backfillLimitReached = false;
		let mapped = [] as Array<{
			chunkId: string;
			chunkText: string;
			embedding: number[];
			metadata?: Record<string, unknown>;
			score: number;
			source?: string;
			title?: string;
		}>;

		for (;;) {
			const rawRows = runNativeQuery(currentSearchK);
			mapped = rawRows
				.map((row) => {
					const chunk: InternalChunk = {
						chunkId: row.chunk_id,
						metadata: parseMetadata(row.metadata),
						source: row.source ?? undefined,
						text: row.chunk_text,
						title: row.title ?? undefined,
						vector: parseVector(row.embedding)
					};

					return {
						chunk,
						score: normalizeDistance(
							row.distance,
							nativeDistanceMetric
						)
					};
				})
				.filter(({ chunk }) => matchesFilter(chunk, input.filter))
				.map((entry) => ({
					chunkId: entry.chunk.chunkId,
					chunkText: entry.chunk.text,
					embedding: entry.chunk.vector,
					metadata: entry.chunk.metadata,
					score: entry.score,
					source: entry.chunk.source,
					title: entry.chunk.title
				}))
				.sort((left, right) => right.score - left.score);

			if (mapped.length >= fillTarget.targetResults) {
				break;
			}

			const nextSearchK = planNativeCandidateSearchBackfillK({
				backfillCount,
				candidateLimit,
				currentSearchK,
				filteredCandidateCount,
				maxBackfills
			});

			if (nextSearchK <= currentSearchK) {
				backfillLimitReached =
					typeof maxBackfills === 'number' &&
					backfillCount >= maxBackfills &&
					mapped.length < fillTarget.targetResults;
				candidateBudgetExhausted =
					mapped.length < fillTarget.targetResults;
				break;
			}

			currentSearchK = nextSearchK;
			backfillCount += 1;
		}

		updateSQLiteLastQueryPlan({
			backfillCount,
			backfillLimitReached,
			candidateBudgetExhausted,
			filter: input.filter,
			filteredCandidateCount,
			finalSearchK: currentSearchK,
			initialSearchK: searchK,
			nativeDiagnostics,
			pushdownFilter,
			plannerProfileUsed: input.plannerProfile,
			candidateLimitUsed: candidateLimit,
			maxBackfillsUsed: maxBackfills,
			minResultsUsed: minResults,
			fillPolicyUsed: fillTarget.fillPolicy,
			queryMultiplierUsed: queryMultiplier,
			queryMode: 'native_vec0',
			returnedCount: Math.min(mapped.length, input.topK),
			minResultsSatisfied: mapped.length >= minResults,
			topK: input.topK,
			underfilledTopK: mapped.length < input.topK
		});

		return mapped.slice(0, input.topK);
	};

	const query = async (input: RAGQueryInput) => {
		if (!useNative) {
			return queryFallback(input);
		}

		try {
			return await queryNative(input);
		} catch (error) {
			markNativeQueryFailure(nativeDiagnostics, error);
			if (nativeConfig?.requireAvailable) {
				throw new Error(
					`Native vector query failed for table "${nativeTableName}". ${getErrorMessage(error)}`,
					{ cause: error }
				);
			}

			return queryFallback(input);
		}
	};

	const queryLexical = async (input: RAGLexicalQueryInput) => {
		const pushdownFilter = buildSQLitePushdownFilter(input.filter);
		const filterPlan = buildSQLiteFilterPlan(pushdownFilter, {
			chunkId: 'chunk_id',
			metadata: 'metadata',
			source: 'source',
			title: 'title'
		});
		const rawRows = toStoredRows(
			filterPlan
				? db
						.prepare(
							buildJsonQuerySql(tableName, filterPlan.clause)
						)
						.all(...filterPlan.params)
				: jsonStatements.query.all()
		);
		const chunks = mapFilterToRows(rawRows).filter((chunk) =>
			matchesFilter(chunk, input.filter)
		);
		const ranked = rankRAGLexicalMatches(input.query, chunks);

		return ranked.slice(0, input.topK).map(({ result, score }) => ({
			chunkId: result.chunkId,
			chunkText: result.text,
			metadata: result.metadata,
			score,
			source: result.source,
			title: result.title
		}));
	};

	const upsert = async (input: RAGUpsertInput) => {
		const chunks =
			input.chunks.length > 0
				? await Promise.all(
						input.chunks.map(async (chunk) => ({
							chunkId: chunk.chunkId,
							metadata: chunk.metadata,
							source: chunk.source,
							text: chunk.text,
							title: chunk.title,
							vector: chunk.embedding
								? normalizeVector(chunk.embedding)
								: normalizeVector(
										await embed({ text: chunk.text })
									)
						}))
					)
				: [];

		if (!useNative) {
			fallbackToJsonUpsert(chunks, jsonStatements);
			refreshSQLiteRuntimeDiagnostics(db, nativeDiagnostics, tableName);

			return;
		}

		try {
			upsertNativeChunks(chunks, nativeStatements);
		} catch (error) {
			markNativeUpsertFailure(nativeDiagnostics, error);
			if (nativeConfig?.requireAvailable) {
				throw new Error(
					`Native vector upsert failed for table "${nativeTableName}". ${getErrorMessage(error)}`,
					{ cause: error }
				);
			}

			useNative = false;
			fallbackToJsonUpsert(chunks, jsonStatements);
		}
		refreshSQLiteRuntimeDiagnostics(
			db,
			nativeDiagnostics,
			useNative ? nativeTableName : tableName
		);
	};

	const count = async (input: RAGVectorCountInput = {}) => {
		const filter = input.filter;
		const chunkIds = input.chunkIds;
		const hasFilter = Boolean(filter && Object.keys(filter).length > 0);
		const hasChunkIds = Boolean(chunkIds && chunkIds.length > 0);

		if (!hasFilter && !hasChunkIds) {
			return getChunkCountFromSql(db, buildJsonCountSql(tableName), []);
		}

		if (hasFilter && !hasChunkIds) {
			return getSQLiteCandidateChunkIdsByFilter(
				db,
				tableName,
				filter,
				jsonStatements
			).length;
		}

		return getSQLiteCandidateChunkIds(db, tableName, jsonStatements, {
			chunkIds,
			filter
		}).length;
	};

	const remove = async (input: RAGVectorDeleteInput = {}) => {
		const filter = input.filter;
		const chunkIds = input.chunkIds;
		const hasFilter = Boolean(filter && Object.keys(filter).length > 0);
		const hasChunkIds = Boolean(chunkIds && chunkIds.length > 0);

		if (!hasFilter && !hasChunkIds) {
			return 0;
		}

		const toDelete = getSQLiteCandidateChunkIds(
			db,
			tableName,
			jsonStatements,
			{
				chunkIds,
				filter
			}
		);
		if (toDelete.length === 0) {
			return 0;
		}

		for (const chunkId of toDelete) {
			jsonStatements.delete.run(chunkId);
		}

		if (!useNative || !nativeStatements) {
			refreshSQLiteRuntimeDiagnostics(db, nativeDiagnostics, tableName);
			return toDelete.length;
		}

		for (const chunkId of toDelete) {
			nativeStatements.delete.run(chunkId);
		}

		refreshSQLiteRuntimeDiagnostics(
			db,
			nativeDiagnostics,
			useNative ? nativeTableName : tableName
		);

		return toDelete.length;
	};

	const clear = () => {
		jsonStatements.clear.run();
		if (!useNative || !nativeStatements) {
			refreshSQLiteRuntimeDiagnostics(db, nativeDiagnostics, tableName);
			return;
		}

		try {
			nativeStatements.clear.run();
		} catch {
			jsonStatements.clear.run();
		}
		refreshSQLiteRuntimeDiagnostics(
			db,
			nativeDiagnostics,
			useNative ? nativeTableName : tableName
		);
	};

	const analyze = () => {
		analyzeSQLiteBackend({
			db,
			diagnosticTableName: useNative ? nativeTableName : tableName,
			nativeDiagnostics,
			tableName
		});
	};

	return {
		analyze,
		clear,
		embed,
		query,
		queryLexical,
		count,
		delete: remove,
		upsert,
		getCapabilities: () => createSQLiteCapabilities(useNative),
		getStatus: () =>
			createSQLiteStatus(dimensions, nativeDiagnostics, useNative)
	};
};
