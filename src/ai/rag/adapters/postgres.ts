import type { RAGQueryInput, RAGUpsertInput } from '../types';
import type {
	RAGBackendCapabilities,
	RAGLexicalQueryInput,
	RAGPostgresNativeDiagnostics,
	RAGVectorCountInput,
	RAGVectorDeleteInput,
	RAGVectorStore,
	RAGVectorStoreStatus
} from '../../../../types/ai';
import {
	RAG_NATIVE_QUERY_CANDIDATE_LIMIT,
	RAG_VECTOR_DIMENSIONS_DEFAULT
} from '../../../constants';
import { rankRAGLexicalMatches } from '../lexical';
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
const DEFAULT_SCHEMA_NAME = 'public';
const DEFAULT_QUERY_MULTIPLIER = 4;
const MAX_QUERY_MULTIPLIER = 16;
const DEFAULT_POSTGRES_INDEX_TYPE = 'hnsw';
const DEFAULT_POSTGRES_IVFFLAT_LISTS = 100;
const DEFAULT_POSTGRES_HNSW_M = 16;
const DEFAULT_POSTGRES_HNSW_EF_CONSTRUCTION = 64;
const IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const FILTER_PATH_SEGMENT_RE = /^[a-zA-Z0-9_]+$/;

type BunSQLClient = InstanceType<typeof Bun.SQL>;
type PostgresDistanceMetric = 'cosine' | 'l2' | 'inner_product';
type PostgresIndexType = 'none' | 'hnsw' | 'ivfflat';

export type PostgresRAGStoreOptions = {
	connectionString?: string;
	sql?: BunSQLClient;
	dimensions?: number;
	mockEmbedding?: (text: string) => Promise<number[]>;
	tableName?: string;
	schemaName?: string;
	distanceMetric?: PostgresDistanceMetric;
	queryMultiplier?: number;
	indexType?: PostgresIndexType;
	indexLists?: number;
	hnswM?: number;
	hnswEfConstruction?: number;
};

type InternalChunk = {
	chunkId: string;
	text: string;
	title?: string;
	source?: string;
	metadata?: Record<string, unknown>;
	vector: number[];
};

type PostgresStoredRow = {
	chunk_id: string;
	text: string;
	title: string | null;
	source: string | null;
	metadata: unknown;
	embedding?: string | null;
	distance?: number | null;
};

type PostgresHealthRow = {
	estimated_row_count?: unknown;
	table_bytes?: unknown;
	index_bytes?: unknown;
	total_bytes?: unknown;
	index_present?: unknown;
};

const isObjectFilterRecord = (
	value: unknown
): value is Record<string, unknown> =>
	Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isNestedFilterArray = (
	value: unknown
): value is Record<string, unknown>[] =>
	Array.isArray(value) && value.every((entry) => isObjectFilterRecord(entry));

const isOperatorFilterRecord = (
	value: unknown
): value is Record<string, unknown> =>
	isObjectFilterRecord(value) &&
	Object.keys(value).some((key) => key.startsWith('$'));

const countFilterClauses = (filter?: Record<string, unknown>) => {
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

const toPostgresJsonPath = (key: string) => {
	const segments = key.split('.').filter(Boolean);
	if (
		segments.length === 0 ||
		!segments.every((segment) => FILTER_PATH_SEGMENT_RE.test(segment))
	) {
		return null;
	}

	return segments;
};

const toPostgresFilterBinding = (value: unknown) => {
	if (
		typeof value === 'string' ||
		typeof value === 'number' ||
		typeof value === 'boolean' ||
		value === null
	) {
		return value;
	}

	return undefined;
};

const buildPostgresJsonbScalarEquality = (input: {
	comparison?: '=' | '<>';
	valueSql: string;
}) => {
	const comparison = input.comparison ?? '=';
	return comparison === '='
		? `jsonb_typeof(${input.valueSql}) = 'null'`
		: `coalesce(jsonb_typeof(${input.valueSql}), 'missing') <> 'null'`;
};

const buildPostgresMetadataScalarEquality = (input: {
	actualSql: string;
	bind: (value: unknown) => string;
	comparison?: '=' | '<>';
	value: string | number | boolean | null;
	valueSql: string;
}) =>
	input.value === null
		? buildPostgresJsonbScalarEquality({
				comparison: input.comparison,
				valueSql: input.valueSql
			})
		: `${input.actualSql} ${input.comparison ?? '='} ${input.bind(String(input.value))}`;

const buildPostgresFilterPlan = (
	filter: Record<string, unknown> | undefined,
	startIndex = 0
): { clause: string; params: unknown[] } | null => {
	if (!filter) {
		return { clause: '', params: [] };
	}

	const params: unknown[] = [];
	const bind = (value: unknown) => {
		params.push(value);
		return `$${params.length + startIndex}`;
	};
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

			const isScalarField =
				key === 'chunkId' || key === 'source' || key === 'title';
			const jsonPath = isScalarField ? null : toPostgresJsonPath(key);
			if (!isScalarField && !jsonPath) {
				return null;
			}
			let actualSql: string;
			let metadataPathSegments: string[] = [];
			let metadataValueSql: string | undefined;
			if (isScalarField) {
				actualSql = key === 'chunkId' ? 'chunk_id' : key;
			} else {
				metadataPathSegments = jsonPath ?? [];
				actualSql = `jsonb_extract_path_text(metadata, ${metadataPathSegments
					.map((segment) => `'${segment}'`)
					.join(', ')})`;
				metadataValueSql = `metadata #> '{${metadataPathSegments.join(',')}}'`;
			}

			if (!isOperatorFilterRecord(value)) {
				const binding = toPostgresFilterBinding(value);
				if (binding === undefined) {
					return null;
				}

				clauses.push(
					isScalarField
						? `${actualSql} = ${bind(String(binding))}`
						: buildPostgresMetadataScalarEquality({
								actualSql,
								bind,
								value: binding,
								valueSql: metadataValueSql!
							})
				);
				continue;
			}

			const operatorClauses = Object.entries(value).map(
				([operator, expected]) => {
					switch (operator) {
						case '$exists':
							return isScalarField
								? expected
									? `${actualSql} IS NOT NULL`
									: `${actualSql} IS NULL`
								: expected
									? `${metadataValueSql} IS NOT NULL`
									: `${metadataValueSql} IS NULL`;
						case '$in': {
							if (
								!Array.isArray(expected) ||
								expected.length === 0
							) {
								return null;
							}

							const bindings = expected
								.map((entry) => toPostgresFilterBinding(entry))
								.filter(
									(
										entry
									): entry is string | number | boolean =>
										entry !== undefined
								);
							if (bindings.length !== expected.length) {
								return null;
							}

							return isScalarField
								? `${actualSql} IN (${bindings
										.map((entry) => bind(String(entry)))
										.join(', ')})`
								: `(${bindings
										.map((entry) =>
											buildPostgresMetadataScalarEquality(
												{
													actualSql,
													bind,
													value: entry,
													valueSql: metadataValueSql!
												}
											)
										)
										.join(' OR ')})`;
						}
						case '$ne': {
							const binding = toPostgresFilterBinding(expected);
							return binding === undefined
								? null
								: isScalarField
									? `${actualSql} <> ${bind(String(binding))}`
									: buildPostgresMetadataScalarEquality({
											actualSql,
											bind,
											comparison: '<>',
											value: binding,
											valueSql: metadataValueSql!
										});
						}
						case '$gt':
						case '$gte':
						case '$lt':
						case '$lte': {
							if (
								typeof expected !== 'number' ||
								!Number.isFinite(expected)
							) {
								return null;
							}
							const comparison =
								operator === '$gt'
									? '>'
									: operator === '$gte'
										? '>='
										: operator === '$lt'
											? '<'
											: '<=';
							return `((${actualSql}) ~ '^-?[0-9]+(\\.[0-9]+)?$' AND (${actualSql})::double precision ${comparison} ${bind(expected)})`;
						}
						case '$contains':
							if (isScalarField) {
								return null;
							}
							if (
								toPostgresFilterBinding(expected) === undefined
							) {
								return null;
							}
							return `(${metadataValueSql} IS NOT NULL AND ${metadataValueSql} ? ${bind(String(expected))})`;
						case '$containsAny':
						case '$containsAll': {
							if (isScalarField || !Array.isArray(expected)) {
								return null;
							}
							const values = expected
								.map((entry) => toPostgresFilterBinding(entry))
								.filter(
									(
										entry
									): entry is string | number | boolean =>
										entry !== undefined
								);
							if (
								values.length === 0 ||
								values.length !== expected.length
							) {
								return null;
							}
							const sqlArray = `ARRAY[${values.map((value) => bind(String(value))).join(', ')}]::text[]`;
							return `(${metadataValueSql} IS NOT NULL AND ${metadataValueSql} ${operator === '$containsAny' ? '?|' : '?&'} ${sqlArray})`;
						}
						default:
							return null;
					}
				}
			);

			if (operatorClauses.some((clause) => clause === null)) {
				return null;
			}

			clauses.push(
				operatorClauses
					.filter((clause): clause is string => Boolean(clause))
					.map((clause) => `(${clause})`)
					.join(' AND ')
			);
		}

		return clauses.length > 0
			? clauses.map((clause) => `(${clause})`).join(' AND ')
			: '';
	};

	const clause = build(filter);
	return clause === null || clause.trim().length === 0
		? null
		: { clause, params };
};

const buildPostgresPushdownFilter = (
	filter: Record<string, unknown> | undefined
): Record<string, unknown> | undefined => {
	if (!filter) {
		return undefined;
	}

	const hasPushdownFilterPlan = (entry: Record<string, unknown>) => {
		const plan = buildPostgresFilterPlan(entry);
		return (
			plan !== null &&
			Boolean(plan.clause) &&
			plan.clause.trim().length > 0
		);
	};
	const hasPushdownFilterPlanEntry = (entry: unknown) => {
		if (!isObjectFilterRecord(entry)) {
			return false;
		}

		return hasPushdownFilterPlan(entry);
	};

	const nextEntries: Array<[string, unknown]> = [];

	for (const [key, value] of Object.entries(filter)) {
		if (key === '$and' || key === '$or') {
			if (!isNestedFilterArray(value)) {
				continue;
			}

			const nested = value
				.map((entry) => buildPostgresPushdownFilter(entry))
				.filter((entry): entry is Record<string, unknown> =>
					hasPushdownFilterPlanEntry(entry)
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

			const nested = buildPostgresPushdownFilter(value);
			if (hasPushdownFilterPlanEntry(nested)) {
				nextEntries.push([key, nested]);
			}
			continue;
		}

		if (
			Array.isArray(value) ||
			(isOperatorFilterRecord(value) &&
				Object.keys(value).some(
					(operator) =>
						!(
							operator === '$exists' ||
							operator === '$in' ||
							operator === '$contains' ||
							operator === '$containsAny' ||
							operator === '$containsAll' ||
							operator === '$ne' ||
							operator === '$gt' ||
							operator === '$gte' ||
							operator === '$lt' ||
							operator === '$lte'
						)
				))
		) {
			continue;
		}

		const isScalarColumnKey = ['chunkId', 'source', 'title'].includes(key);
		const jsonPath = isScalarColumnKey ? null : toPostgresJsonPath(key);
		if (!isScalarColumnKey && !jsonPath) {
			continue;
		}

		if (!hasPushdownFilterPlan({ [key]: value })) {
			continue;
		}

		nextEntries.push([key, value]);
	}

	return nextEntries.length > 0 ? Object.fromEntries(nextEntries) : undefined;
};

const resolvePostgresPushdownMode = (input: {
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

const assertSupportedIdentifier = (name: string) => {
	if (!IDENTIFIER_RE.test(name)) {
		throw new Error(
			`Invalid identifier "${name}". Only alphanumeric and underscore names are allowed.`
		);
	}
};

const normalizePostgresIndexType = (
	value: PostgresIndexType | undefined
): PostgresIndexType => {
	if (value === undefined) {
		return DEFAULT_POSTGRES_INDEX_TYPE;
	}

	if (value === 'none' || value === 'hnsw' || value === 'ivfflat') {
		return value;
	}

	throw new Error(
		`Invalid postgres index type "${String(value)}". Expected "none", "hnsw", or "ivfflat".`
	);
};

const normalizePositiveInteger = (
	value: number | undefined,
	fallback: number
) => {
	if (value === undefined || !Number.isFinite(value)) {
		return fallback;
	}

	return Math.max(1, Math.floor(value));
};

const getPostgresIndexOperatorClass = (metric: PostgresDistanceMetric) =>
	metric === 'cosine'
		? 'vector_cosine_ops'
		: metric === 'inner_product'
			? 'vector_ip_ops'
			: 'vector_l2_ops';

const getPostgresIndexName = (
	qualifiedTableName: string,
	indexType: PostgresIndexType
) =>
	indexType === 'none'
		? undefined
		: `${qualifiedTableName.replace('.', '_')}_embedding_${indexType}_idx`;

const buildPostgresIndexSql = (input: {
	distanceMetric: PostgresDistanceMetric;
	hnswEfConstruction: number;
	hnswM: number;
	ifNotExists?: boolean;
	indexLists: number;
	indexType: PostgresIndexType;
	qualifiedTableName: string;
}) => {
	if (input.indexType === 'none') {
		return undefined;
	}

	const opclass = getPostgresIndexOperatorClass(input.distanceMetric);
	const indexName = getPostgresIndexName(
		input.qualifiedTableName,
		input.indexType
	);
	const optionsSql =
		input.indexType === 'hnsw'
			? ` with (m = ${input.hnswM}, ef_construction = ${input.hnswEfConstruction})`
			: ` with (lists = ${input.indexLists})`;
	const createPrefix =
		input.ifNotExists === false
			? 'create index'
			: 'create index if not exists';

	return `${createPrefix} ${indexName} on ${input.qualifiedTableName} using ${input.indexType} (embedding ${opclass})${optionsSql}`;
};

const normalizeQueryMultiplier = (value: number | undefined) => {
	if (value === undefined || !Number.isFinite(value)) {
		return DEFAULT_QUERY_MULTIPLIER;
	}

	return Math.min(MAX_QUERY_MULTIPLIER, Math.max(1, Math.floor(value)));
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

const toQualifiedTableName = (schemaName: string, tableName: string) =>
	`${schemaName}.${tableName}`;

const toVectorLiteral = (vector: number[]) => `[${vector.join(',')}]`;

const parseMetadata = (value: unknown) => {
	if (typeof value === 'string') {
		try {
			const parsed = JSON.parse(value);
			if (
				parsed &&
				typeof parsed === 'object' &&
				!Array.isArray(parsed)
			) {
				return parsed as Record<string, unknown>;
			}
		} catch {
			return undefined;
		}
	}

	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}

	return value as Record<string, unknown>;
};

const parseVectorText = (value?: string | null) => {
	if (!value) {
		return [];
	}

	const normalized = value.trim();
	const wrapped = normalized.startsWith('[')
		? normalized
		: `[${normalized.replace(/[()]/g, '')}]`;

	try {
		const parsed = JSON.parse(wrapped);
		return Array.isArray(parsed)
			? parsed.filter(
					(entry): entry is number =>
						typeof entry === 'number' && Number.isFinite(entry)
				)
			: [];
	} catch {
		return [];
	}
};

const parseCountValue = (value: unknown) => {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value;
	}

	if (typeof value === 'bigint') {
		return Number(value);
	}

	if (typeof value === 'string') {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : 0;
	}

	return 0;
};

const parseBooleanValue = (value: unknown) => {
	if (typeof value === 'boolean') {
		return value;
	}

	if (typeof value === 'number') {
		return value !== 0;
	}

	if (typeof value === 'bigint') {
		return value !== 0n;
	}

	if (typeof value === 'string') {
		const normalized = value.trim().toLowerCase();
		return (
			normalized === 'true' || normalized === 't' || normalized === '1'
		);
	}

	return false;
};

const refreshPostgresRuntimeDiagnostics = async (
	db: BunSQLClient,
	nativeDiagnostics: RAGPostgresNativeDiagnostics,
	input: {
		indexName?: string;
		qualifiedTableName: string;
		schemaName: string;
		tableName: string;
	}
) => {
	try {
		const rows = (await db.unsafe(
			`select
				c.reltuples::bigint as estimated_row_count,
				pg_relation_size($1::regclass) as table_bytes,
				pg_indexes_size($1::regclass) as index_bytes,
				pg_total_relation_size($1::regclass) as total_bytes,
				exists(
					select 1
					from pg_indexes
					where schemaname = $2
					  and tablename = $3
					  and indexname = $4
				) as index_present
			from pg_class c
			join pg_namespace n on n.oid = c.relnamespace
			where n.nspname = $2
			  and c.relname = $3
			limit 1`,
			[
				input.qualifiedTableName,
				input.schemaName,
				input.tableName,
				input.indexName ?? ''
			]
		)) as PostgresHealthRow[];
		const row = rows[0];
		nativeDiagnostics.indexName = input.indexName;
		nativeDiagnostics.indexPresent = input.indexName
			? parseBooleanValue(row?.index_present)
			: undefined;
		nativeDiagnostics.estimatedRowCount = parseCountValue(
			row?.estimated_row_count
		);
		nativeDiagnostics.tableBytes = parseCountValue(row?.table_bytes);
		nativeDiagnostics.indexBytes = parseCountValue(row?.index_bytes);
		nativeDiagnostics.totalBytes = parseCountValue(row?.total_bytes);
		nativeDiagnostics.lastHealthCheckAt = Date.now();
		nativeDiagnostics.lastHealthError = undefined;
	} catch (error) {
		nativeDiagnostics.lastHealthCheckAt = Date.now();
		nativeDiagnostics.lastHealthError =
			error instanceof Error ? error.message : String(error);
	}
};

const analyzePostgresTable = async (
	db: BunSQLClient,
	nativeDiagnostics: RAGPostgresNativeDiagnostics,
	input: {
		indexName?: string;
		qualifiedTableName: string;
		schemaName: string;
		tableName: string;
	}
) => {
	try {
		await db.unsafe(`analyze ${input.qualifiedTableName}`);
		nativeDiagnostics.lastAnalyzeAt = Date.now();
		nativeDiagnostics.lastAnalyzeError = undefined;
		await refreshPostgresRuntimeDiagnostics(db, nativeDiagnostics, input);
	} catch (error) {
		nativeDiagnostics.lastAnalyzeAt = Date.now();
		nativeDiagnostics.lastAnalyzeError =
			error instanceof Error ? error.message : String(error);
		throw error;
	}
};

const rebuildPostgresNativeIndex = async (
	db: BunSQLClient,
	nativeDiagnostics: RAGPostgresNativeDiagnostics,
	input: {
		distanceMetric: PostgresDistanceMetric;
		hnswEfConstruction: number;
		hnswM: number;
		indexLists: number;
		indexName?: string;
		indexType: PostgresIndexType;
		qualifiedTableName: string;
		schemaName: string;
		tableName: string;
	}
) => {
	if (!input.indexName || input.indexType === 'none') {
		throw new Error('Postgres native index rebuild is not configured');
	}

	try {
		await db.unsafe(`drop index if exists ${input.indexName}`);
		await db.unsafe(
			buildPostgresIndexSql({
				distanceMetric: input.distanceMetric,
				hnswEfConstruction: input.hnswEfConstruction,
				hnswM: input.hnswM,
				ifNotExists: false,
				indexLists: input.indexLists,
				indexType: input.indexType,
				qualifiedTableName: input.qualifiedTableName
			})!
		);
		nativeDiagnostics.lastReindexAt = Date.now();
		nativeDiagnostics.lastReindexError = undefined;
		await analyzePostgresTable(db, nativeDiagnostics, input);
	} catch (error) {
		nativeDiagnostics.lastReindexAt = Date.now();
		nativeDiagnostics.lastReindexError =
			error instanceof Error ? error.message : String(error);
		throw error;
	}
};

const getPostgresChunkIdsByChunkIds = async (
	db: BunSQLClient,
	qualifiedTableName: string,
	chunkIds: string[]
) => {
	const normalized = [...new Set(chunkIds)].filter(
		(chunkId): chunkId is string => chunkId.length > 0
	);
	if (normalized.length === 0) {
		return [] as string[];
	}

	const placeholders = normalized
		.map((_, index) => `$${index + 1}`)
		.join(', ');
	const rows = (await db.unsafe(
		`select chunk_id from ${qualifiedTableName} where chunk_id in (${placeholders})`,
		normalized
	)) as Array<{ chunk_id?: string }>;

	return rows
		.map((row) => row.chunk_id)
		.filter((chunkId): chunkId is string => typeof chunkId === 'string');
};

const getPostgresCandidateChunkIdsByFilter = async (
	db: BunSQLClient,
	qualifiedTableName: string,
	filter?: Record<string, unknown>
) => {
	if (!filter || Object.keys(filter).length === 0) {
		return [] as string[];
	}

	const pushdownFilter = buildPostgresPushdownFilter(filter);
	const filterPlan = buildPostgresFilterPlan(pushdownFilter);
	const rowsSql = filterPlan?.clause
		? `select chunk_id, text, title, source, metadata from ${qualifiedTableName} where ${filterPlan.clause}`
		: `select chunk_id, text, title, source, metadata from ${qualifiedTableName}`;
	const rows = (await db.unsafe(
		rowsSql,
		filterPlan?.clause ? (filterPlan.params ?? []) : []
	)) as PostgresStoredRow[];

	const chunks = rows
		.map((row) => mapRowToChunk(row))
		.filter((chunk) => matchesFilter(chunk, filter));

	return chunks.map((chunk) => chunk.chunkId);
};

const getPostgresCandidateChunkIds = async (
	db: BunSQLClient,
	qualifiedTableName: string,
	input: {
		filter?: Record<string, unknown>;
		chunkIds?: string[];
	}
) => {
	const chunkIdSet = new Set<string>();
	if (input.filter && Object.keys(input.filter).length > 0) {
		for (const chunkId of await getPostgresCandidateChunkIdsByFilter(
			db,
			qualifiedTableName,
			input.filter
		)) {
			chunkIdSet.add(chunkId);
		}
	}

	if (input.chunkIds && input.chunkIds.length > 0) {
		for (const chunkId of await getPostgresChunkIdsByChunkIds(
			db,
			qualifiedTableName,
			input.chunkIds
		)) {
			chunkIdSet.add(chunkId);
		}
	}

	return [...chunkIdSet];
};

const normalizeDistance = (
	distance: number,
	metric: PostgresDistanceMetric
) => {
	if (!Number.isFinite(distance)) {
		return 0;
	}

	if (metric === 'cosine') {
		return Math.min(1, Math.max(0, 1 - distance));
	}

	if (metric === 'inner_product') {
		return Math.max(0, -distance);
	}

	return Math.max(0, 1 / (1 + Math.abs(distance)));
};

const getDistanceOperator = (metric: PostgresDistanceMetric) =>
	metric === 'cosine' ? '<=>' : metric === 'inner_product' ? '<#>' : '<->';

const createPostgresStatus = (
	dimensions: number,
	nativeDiagnostics: RAGPostgresNativeDiagnostics
): RAGVectorStoreStatus => ({
	backend: 'postgres',
	dimensions,
	native: nativeDiagnostics,
	vectorMode: 'native_pgvector'
});

const createPostgresCapabilities = (): RAGBackendCapabilities => ({
	backend: 'postgres',
	nativeVectorSearch: true,
	persistence: 'external',
	serverSideFiltering: true,
	streamingIngestStatus: false
});

const updatePostgresLastQueryPlan = (input: {
	nativeDiagnostics: RAGPostgresNativeDiagnostics;
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
	const pushdown = resolvePostgresPushdownMode({
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
		candidateLimitUsed: input.candidateLimitUsed,
		maxBackfillsUsed: input.maxBackfillsUsed,
		minResultsUsed: input.minResultsUsed,
		fillPolicyUsed: input.fillPolicyUsed,
		plannerProfileUsed: input.plannerProfileUsed,
		jsRemainderClauseCount: pushdown.jsRemainderClauseCount,
		queryMultiplierUsed: input.queryMultiplierUsed,
		jsRemainderRatio: pushdown.jsRemainderRatio,
		pushdownApplied: pushdown.pushdownClauseCount > 0,
		pushdownClauseCount: pushdown.pushdownClauseCount,
		pushdownCoverageRatio: pushdown.pushdownCoverageRatio,
		pushdownMode: pushdown.pushdownMode,
		queryMode: 'native_pgvector',
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

const mapRowToChunk = (row: PostgresStoredRow): InternalChunk => ({
	chunkId: row.chunk_id,
	metadata: parseMetadata(row.metadata),
	source: row.source ?? undefined,
	text: row.text,
	title: row.title ?? undefined,
	vector: parseVectorText(row.embedding)
});

const ensurePostgresSchema = async (
	db: BunSQLClient,
	input: {
		dimensions: number;
		distanceMetric: PostgresDistanceMetric;
		hnswEfConstruction: number;
		hnswM: number;
		indexLists: number;
		indexType: PostgresIndexType;
		qualifiedTableName: string;
	}
) => {
	await db.unsafe('create extension if not exists vector');
	const [schemaName] = input.qualifiedTableName.split('.');
	if (schemaName) {
		await db.unsafe(`create schema if not exists ${schemaName}`);
	}
	await db.unsafe(`
		create table if not exists ${input.qualifiedTableName} (
			chunk_id text primary key,
			text text not null,
			title text,
			source text,
			metadata jsonb,
			embedding vector(${input.dimensions}) not null
		)
	`);
	const indexSql = buildPostgresIndexSql(input);
	if (indexSql) {
		await db.unsafe(indexSql);
	}
};

export const createPostgresRAGStore = (
	options: PostgresRAGStoreOptions = {}
): RAGVectorStore => {
	const dimensions = options.dimensions ?? DEFAULT_DIMENSIONS;
	const distanceMetric = options.distanceMetric ?? 'cosine';
	const queryMultiplier = normalizeQueryMultiplier(options.queryMultiplier);
	const indexType = normalizePostgresIndexType(options.indexType);
	const indexLists = normalizePositiveInteger(
		options.indexLists,
		DEFAULT_POSTGRES_IVFFLAT_LISTS
	);
	const hnswM = normalizePositiveInteger(
		options.hnswM,
		DEFAULT_POSTGRES_HNSW_M
	);
	const hnswEfConstruction = normalizePositiveInteger(
		options.hnswEfConstruction,
		DEFAULT_POSTGRES_HNSW_EF_CONSTRUCTION
	);
	const tableName = options.tableName ?? DEFAULT_TABLE_NAME;
	const schemaName = options.schemaName ?? DEFAULT_SCHEMA_NAME;
	assertSupportedIdentifier(tableName);
	assertSupportedIdentifier(schemaName);
	const qualifiedTableName = toQualifiedTableName(schemaName, tableName);
	const indexName = getPostgresIndexName(qualifiedTableName, indexType);
	const db =
		options.sql ??
		new Bun.SQL(
			options.connectionString ??
				process.env.RAG_POSTGRES_URL ??
				process.env.DATABASE_URL ??
				'postgres://postgres:postgres@localhost:55433/absolute_rag_demo'
		);

	const nativeDiagnostics: RAGPostgresNativeDiagnostics = {
		active: true,
		available: true,
		distanceMetric,
		extensionName: 'vector',
		indexName,
		indexType,
		mode: 'pgvector',
		requested: true,
		schemaName,
		tableName
	};
	const capabilities = createPostgresCapabilities();
	const distanceOperator = getDistanceOperator(distanceMetric);
	let initialized: Promise<void> | undefined;

	const init = () => {
		initialized ??= ensurePostgresSchema(db, {
			dimensions,
			distanceMetric,
			hnswEfConstruction,
			hnswM,
			indexLists,
			indexType,
			qualifiedTableName
		})
			.then(() =>
				refreshPostgresRuntimeDiagnostics(db, nativeDiagnostics, {
					indexName,
					qualifiedTableName,
					schemaName,
					tableName
				})
			)
			.catch((error) => {
				nativeDiagnostics.active = false;
				nativeDiagnostics.available = false;
				nativeDiagnostics.lastInitError =
					error instanceof Error ? error.message : String(error);
				nativeDiagnostics.lastMigrationError =
					error instanceof Error ? error.message : String(error);
				nativeDiagnostics.fallbackReason =
					nativeDiagnostics.lastInitError;
				throw error;
			});
		return initialized;
	};

	const embed = async (input: {
		text: string;
		model?: string;
		signal?: AbortSignal;
	}) => {
		void input.model;
		void input.signal;

		if (options.mockEmbedding) {
			return options.mockEmbedding(input.text);
		}

		return normalizeVector(createRAGVector(input.text, dimensions));
	};

	const query = async (input: RAGQueryInput) => {
		await init();
		const queryVector = normalizeVector(input.queryVector);
		const queryMultiplier = normalizeQueryMultiplier(
			input.queryMultiplier ?? options.queryMultiplier
		);
		const maxBackfills = normalizeMaxBackfills(input.maxBackfills);
		const minResults = normalizeMinResults(input.minResults, input.topK);
		const fillTarget = resolveFillTarget({
			fillPolicy: input.fillPolicy,
			minResults,
			topK: input.topK
		});
		const queryVectorLiteral = toVectorLiteral(queryVector);
		const pushdownFilter = buildPostgresPushdownFilter(input.filter);
		const queryFilterPlan = buildPostgresFilterPlan(pushdownFilter);
		const effectivePushdownFilter = queryFilterPlan
			? pushdownFilter
			: undefined;
		const countFilterPlan = queryFilterPlan;
		const countSql = countFilterPlan?.clause
			? `select count(*)::int as count from ${qualifiedTableName} where ${countFilterPlan.clause}`
			: `select count(*)::int as count from ${qualifiedTableName}`;
		const totalRowsResult = await db.unsafe(
			countSql,
			countFilterPlan?.params ?? []
		);
		nativeDiagnostics.lastFilterDebug = {
			countParams: countFilterPlan?.params ?? [],
			countResultRaw: totalRowsResult?.[0],
			countSql,
			filter: input.filter,
			pushdownFilter: effectivePushdownFilter
		};
		const totalRows = parseCountValue(totalRowsResult?.[0]?.count);
		const candidateLimit = resolveAdaptiveNativeCandidateLimit({
			defaultCandidateLimit: RAG_NATIVE_QUERY_CANDIDATE_LIMIT,
			explicitCandidateLimit: input.candidateLimit,
			filteredCandidateCount: totalRows,
			plannerProfile: input.plannerProfile,
			queryMultiplier,
			topK: input.topK
		});
		const hasPushdownFilter = Boolean(effectivePushdownFilter);
		const plannedFilteredCandidateCount =
			hasPushdownFilter && totalRows === 0 ? undefined : totalRows;
		const initialSearchK = planNativeCandidateSearchK({
			candidateLimit,
			filteredCandidateCount: plannedFilteredCandidateCount,
			queryMultiplier,
			topK: input.topK
		});

		if (initialSearchK === 0) {
			return [];
		}

		let currentSearchK = initialSearchK;
		let backfillCount = 0;
		let candidateBudgetExhausted = false;
		let backfillLimitReached = false;
		let effectiveFilteredCandidateCount = plannedFilteredCandidateCount;
		let mapped: Array<{
			chunkId: string;
			chunkText: string;
			embedding: number[];
			metadata?: Record<string, unknown>;
			score: number;
			source?: string;
			title?: string;
		}> = [];

		for (;;) {
			const rowsSql = queryFilterPlan?.clause
				? `select chunk_id, text, title, source, metadata, embedding::text as embedding, embedding ${distanceOperator} '${queryVectorLiteral}'::vector as distance from ${qualifiedTableName} where ${queryFilterPlan.clause} order by embedding ${distanceOperator} '${queryVectorLiteral}'::vector limit $${
						queryFilterPlan.params.length + 1
					}`
				: `select chunk_id, text, title, source, metadata, embedding::text as embedding, embedding ${distanceOperator} '${queryVectorLiteral}'::vector as distance from ${qualifiedTableName} order by embedding ${distanceOperator} '${queryVectorLiteral}'::vector limit $1`;
			const rows = (await db.unsafe(
				rowsSql,
				queryFilterPlan?.clause
					? [...(queryFilterPlan.params ?? []), currentSearchK]
					: [currentSearchK]
			)) as PostgresStoredRow[];
			nativeDiagnostics.lastFilterDebug = {
				...nativeDiagnostics.lastFilterDebug,
				queryParams: queryFilterPlan?.clause
					? [...(queryFilterPlan.params ?? []), currentSearchK]
					: [currentSearchK],
				queryRowCount: rows.length,
				querySql: rowsSql
			};
			if (
				hasPushdownFilter &&
				effectiveFilteredCandidateCount === undefined &&
				rows.length <= currentSearchK
			) {
				effectiveFilteredCandidateCount = rows.length;
			}

			mapped = rows
				.map((row) => {
					const chunk = mapRowToChunk(row);
					return {
						chunk,
						score: normalizeDistance(
							Number(row.distance ?? 0),
							distanceMetric
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
				filteredCandidateCount: effectiveFilteredCandidateCount,
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

		nativeDiagnostics.lastQueryError = undefined;
		const returned = mapped.slice(0, input.topK);
		updatePostgresLastQueryPlan({
			backfillCount,
			backfillLimitReached,
			candidateBudgetExhausted,
			candidateLimitUsed: candidateLimit,
			maxBackfillsUsed: maxBackfills,
			minResultsUsed: minResults,
			fillPolicyUsed: fillTarget.fillPolicy,
			plannerProfileUsed: input.plannerProfile,
			filter: input.filter,
			pushdownFilter: effectivePushdownFilter,
			queryMultiplierUsed: queryMultiplier,
			filteredCandidateCount: effectiveFilteredCandidateCount,
			finalSearchK: currentSearchK,
			initialSearchK,
			nativeDiagnostics,
			minResultsSatisfied: returned.length >= minResults,
			returnedCount: returned.length,
			topK: input.topK,
			underfilledTopK: returned.length < input.topK
		});

		return returned;
	};

	const queryLexical = async (input: RAGLexicalQueryInput) => {
		await init();
		const pushdownFilter = buildPostgresPushdownFilter(input.filter);
		const lexicalFilterPlan = buildPostgresFilterPlan(pushdownFilter);
		const rowsSql = lexicalFilterPlan?.clause
			? `select chunk_id, text, title, source, metadata from ${qualifiedTableName} where ${lexicalFilterPlan.clause}`
			: `select chunk_id, text, title, source, metadata from ${qualifiedTableName}`;
		const rows = (await db.unsafe(
			rowsSql,
			lexicalFilterPlan?.params ?? []
		)) as PostgresStoredRow[];
		const chunks = rows
			.map((row) => mapRowToChunk(row))
			.filter((chunk) => matchesFilter(chunk, input.filter));
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
		await init();
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

		for (const chunk of chunks) {
			await db.unsafe(
				`insert into ${qualifiedTableName} (chunk_id, text, title, source, metadata, embedding)
				 values ($1, $2, $3, $4, $5::jsonb, $6::vector)
				 on conflict (chunk_id) do update set
				   text = excluded.text,
				   title = excluded.title,
				   source = excluded.source,
				   metadata = excluded.metadata,
				   embedding = excluded.embedding`,
				[
					chunk.chunkId,
					chunk.text,
					chunk.title ?? null,
					chunk.source ?? null,
					chunk.metadata ?? null,
					toVectorLiteral(chunk.vector)
				]
			);
		}
		await refreshPostgresRuntimeDiagnostics(db, nativeDiagnostics, {
			indexName,
			qualifiedTableName,
			schemaName,
			tableName
		});
	};

	const count = async (input: RAGVectorCountInput = {}) => {
		await init();
		const filter = input.filter;
		const chunkIds = input.chunkIds;
		const hasFilter = Boolean(filter && Object.keys(filter).length > 0);
		const hasChunkIds = Boolean(chunkIds && chunkIds.length > 0);

		if (!hasFilter && !hasChunkIds) {
			const countResult = (await db.unsafe(
				`select count(*)::int as count from ${qualifiedTableName}`
			)) as Array<{ count?: unknown }>;
			return parseCountValue(countResult[0]?.count);
		}

		return (
			await getPostgresCandidateChunkIds(db, qualifiedTableName, {
				filter,
				chunkIds
			})
		).length;
	};

	const remove = async (input: RAGVectorDeleteInput = {}) => {
		await init();
		const filter = input.filter;
		const chunkIds = input.chunkIds;
		const hasFilter = Boolean(filter && Object.keys(filter).length > 0);
		const hasChunkIds = Boolean(chunkIds && chunkIds.length > 0);

		if (!hasFilter && !hasChunkIds) {
			return 0;
		}

		const ids = await getPostgresCandidateChunkIds(db, qualifiedTableName, {
			filter,
			chunkIds
		});
		if (ids.length === 0) {
			return 0;
		}

		const placeholders = ids.map((_, index) => `$${index + 1}`).join(', ');
		await db.unsafe(
			`delete from ${qualifiedTableName} where chunk_id in (${placeholders})`,
			ids
		);
		await refreshPostgresRuntimeDiagnostics(db, nativeDiagnostics, {
			indexName,
			qualifiedTableName,
			schemaName,
			tableName
		});

		return ids.length;
	};

	const clear = async () => {
		await init();
		await db.unsafe(`truncate table ${qualifiedTableName}`);
		await refreshPostgresRuntimeDiagnostics(db, nativeDiagnostics, {
			indexName,
			qualifiedTableName,
			schemaName,
			tableName
		});
	};

	const analyze = async () => {
		await init();
		await analyzePostgresTable(db, nativeDiagnostics, {
			indexName,
			qualifiedTableName,
			schemaName,
			tableName
		});
	};

	const rebuildNativeIndex = async () => {
		await init();
		await rebuildPostgresNativeIndex(db, nativeDiagnostics, {
			distanceMetric,
			hnswEfConstruction,
			hnswM,
			indexLists,
			indexName,
			indexType,
			qualifiedTableName,
			schemaName,
			tableName
		});
	};

	const close = async () => {
		await db.close?.();
	};

	return {
		analyze,
		clear,
		close,
		embed,
		getCapabilities: () => capabilities,
		getStatus: () => createPostgresStatus(dimensions, nativeDiagnostics),
		query,
		queryLexical,
		rebuildNativeIndex: indexName ? rebuildNativeIndex : undefined,
		count,
		delete: remove,
		upsert
	};
};
