import { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';
import type {
	RAGBackendCapabilities,
	RAGLexicalQueryInput,
	RAGQueryInput,
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
	distance: number;
};

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

const valuesMatch = (expected: unknown, actual: unknown) => {
	if (actual === expected) {
		return true;
	}

	if (
		typeof actual === 'object' &&
		actual !== null &&
		typeof expected === 'object' &&
		expected !== null
	) {
		return JSON.stringify(actual) === JSON.stringify(expected);
	}

	return false;
};

const matchesFilter = (
	record: InternalChunk,
	filter?: Record<string, unknown>
) => {
	if (!filter) {
		return true;
	}

	return Object.entries(filter).every(([key, value]) => {
		if (key === 'chunkId') {
			return valuesMatch(value, record.chunkId);
		}

		if (key === 'source') {
			return valuesMatch(value, record.source);
		}

		if (key === 'title') {
			return valuesMatch(value, record.title);
		}

		if (!record.metadata) {
			return false;
		}

		return valuesMatch(value, record.metadata[key]);
	});
};

const mapFilterToRows = (rows: StoredRow[]) =>
	rows.map((row) => ({
		chunkId: row.chunk_id,
		metadata: parseMetadata(row.metadata),
		source: row.source ?? undefined,
		text: row.text,
		title: row.title ?? undefined,
		vector: parseVector(row.embedding)
	}));

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
		init,
		insert: db.prepare(insertSql),
		query: db.prepare(querySql)
	};
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
		const rawRows = toStoredRows(jsonStatements.query.all());
		const chunks = mapFilterToRows(rawRows);
		const filtered = mapToRows(queryVector, chunks, input.filter);

		return filtered.slice(0, input.topK).map(({ chunk, score }) => ({
			chunkId: chunk.chunkId,
			chunkText: chunk.text,
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

		const queryVector = normalizeVector(input.queryVector);
		const searchK = Math.min(
			Math.max(input.topK * nativeQueryMultiplier, input.topK),
			RAG_NATIVE_QUERY_CANDIDATE_LIMIT
		);
		const queryVectorText = toVectorText(queryVector);

		const rawRows = toNativeStoredRows(
			nativeStatements.query.all(queryVectorText, searchK)
		);
		const mapped = rawRows
			.map((row) => {
				const chunk: InternalChunk = {
					chunkId: row.chunk_id,
					metadata: parseMetadata(row.metadata),
					source: row.source ?? undefined,
					text: row.chunk_text,
					title: row.title ?? undefined,
					vector: []
				};

				return {
					chunk,
					score: normalizeDistance(row.distance, nativeDistanceMetric)
				};
			})
			.filter(({ chunk }) => matchesFilter(chunk, input.filter))
			.map((entry) => ({
				chunkId: entry.chunk.chunkId,
				chunkText: entry.chunk.text,
				metadata: entry.chunk.metadata,
				score: entry.score,
				source: entry.chunk.source,
				title: entry.chunk.title
			}));

		return mapped
			.sort((left, right) => right.score - left.score)
			.slice(0, input.topK);
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
		const rawRows = toStoredRows(jsonStatements.query.all());
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
	};

	const clear = () => {
		jsonStatements.clear.run();
		if (!useNative || !nativeStatements) {
			return;
		}

		try {
			nativeStatements.clear.run();
		} catch {
			jsonStatements.clear.run();
		}
	};

	return {
		clear,
		embed,
		query,
		queryLexical,
		upsert,
		getCapabilities: () => createSQLiteCapabilities(useNative),
		getStatus: () =>
			createSQLiteStatus(dimensions, nativeDiagnostics, useNative)
	};
};
