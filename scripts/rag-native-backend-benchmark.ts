import { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
	buildRAGRetrievalComparisonDecisionSummary,
	buildRAGRetrievalReleaseVerdict,
	compareRAGRetrievalStrategies,
	createHeuristicRAGQueryTransform,
	createHeuristicRAGReranker,
	createRAGCollection,
	createRAGFileEvaluationSuiteSnapshotHistoryStore,
	createRAGFileRetrievalComparisonHistoryStore,
	createRAGNativeBackendBenchmarkCorpus,
	createRAGNativeBackendBenchmarkMockEmbedding,
	createRAGNativeBackendComparisonBenchmarkSnapshot,
	createRAGNativeBackendComparisonBenchmarkSuite,
	loadRAGEvaluationSuiteSnapshotHistory,
	loadRAGRetrievalComparisonHistory,
	persistRAGRetrievalComparisonRun
} from '../src/ai';
import { createPostgresRAGStore } from '../src/ai/rag/adapters/postgres';
import { createSQLiteRAGStore } from '../src/ai/rag/adapters/sqlite';
import type { RAGVectorStore } from '../types/ai';

const DEFAULT_POSTGRES_URL =
	process.env.RAG_POSTGRES_TEST_URL ??
	process.env.RAG_POSTGRES_URL ??
	process.env.DATABASE_URL ??
	'postgres://postgres:postgres@localhost:55433/absolute_rag_demo';
const DEFAULT_ARTIFACT_DIR =
	process.env.RAG_BENCH_ARTIFACT_DIR ?? '/tmp/absolutejs-rag-benchmarks';
const GROUP_KEY = 'runtime-native-backend-parity';
const CORPUS_GROUP_KEY = 'release-benchmark';

const args = process.argv.slice(2);
const hasFlag = (flag: string) => args.includes(flag);
const getNamedArg = (flag: string) => {
	const index = args.indexOf(flag);
	return index >= 0 ? args[index + 1] : undefined;
};

const requirePostgres = hasFlag('--require-postgres');
const requireSQLiteNative = hasFlag('--require-sqlite-native');
const requestedBackend = getNamedArg('--backend') ?? 'all';
const artifactDir = resolve(
	getNamedArg('--artifact-dir') ?? DEFAULT_ARTIFACT_DIR
);
const HISTORY_PATH = resolve(
	artifactDir,
	'native-backend-comparison-history.json'
);
const SNAPSHOT_PATH = resolve(
	artifactDir,
	'native-backend-comparison-snapshots.json'
);
const REPORT_PATH = resolve(
	artifactDir,
	'native-backend-comparison-report.json'
);

const createBenchmarkCollection = (store: RAGVectorStore) =>
	createRAGCollection({
		queryTransform: async (input) => ({
			query: input.query,
			variants: ['launch checklist exact wording']
		}),
		rerank: createHeuristicRAGReranker(),
		store
	});

const createBackendTags = (
	backend: string,
	vectorMode: string,
	fixtureVariant: string
) => [
	'runtime',
	'backend',
	'native',
	'workflow:release-proof',
	`fixture:${fixtureVariant}`,
	`backend:${backend}`,
	`vector-mode:${vectorMode}`
];

const ensureDir = (path: string) => {
	mkdirSync(dirname(path), { recursive: true });
};

const canUseSQLiteNative = () => {
	const db = new Database(':memory:');
	try {
		createSQLiteRAGStore({
			db,
			dimensions: 2,
			native: { mode: 'vec0', requireAvailable: true }
		});
		return true;
	} catch {
		return false;
	} finally {
		db.close();
	}
};

const canUsePostgres = async () => {
	try {
		const sql = new Bun.SQL(DEFAULT_POSTGRES_URL);
		await sql`select 1 as ok`;
		await sql.close?.();
		return true;
	} catch {
		return false;
	}
};

const suite = createRAGNativeBackendComparisonBenchmarkSuite();
const retrievals = [
	{
		id: 'native-latency',
		label: 'Native latency',
		retrieval: {
			mode: 'vector' as const,
			nativeQueryProfile: 'latency' as const
		}
	},
	{
		id: 'native-adaptive',
		label: 'Adaptive native planner',
		retrieval: {
			mode: 'vector' as const
		}
	},
	{
		id: 'hybrid-adaptive',
		label: 'Hybrid adaptive',
		retrieval: {
			mode: 'hybrid' as const
		}
	},
	{
		id: 'hybrid-transform',
		label: 'Hybrid transform',
		queryTransform: createHeuristicRAGQueryTransform(),
		retrieval: {
			mode: 'hybrid' as const
		}
	}
];

const comparisonHistoryStore =
	createRAGFileRetrievalComparisonHistoryStore(HISTORY_PATH);
const snapshotHistoryStore =
	createRAGFileEvaluationSuiteSnapshotHistoryStore(SNAPSHOT_PATH);

const persistSuiteSnapshot = async () => {
	const history = await loadRAGEvaluationSuiteSnapshotHistory({
		store: snapshotHistoryStore,
		suite
	});
	const version = (history.snapshots[0]?.version ?? 0) + 1;
	const snapshot = createRAGNativeBackendComparisonBenchmarkSnapshot({
		metadata: {
			persistedBy: 'scripts/rag-native-backend-benchmark.ts'
		},
		suite,
		version
	});
	await snapshotHistoryStore.saveSnapshot(snapshot);
	return snapshot;
};

const persistComparisonRun = async (input: {
	backendLabel: string;
	comparison: Awaited<ReturnType<typeof compareRAGRetrievalStrategies>>;
	startedAt: number;
	tags: string[];
}) => {
	const finishedAt = Date.now();
	const decisionSummary = buildRAGRetrievalComparisonDecisionSummary({
		baselineRetrievalId: 'native-latency',
		candidateRetrievalId: 'native-adaptive',
		comparison: input.comparison,
		policy: {
			maxRuntimeCandidateBudgetExhaustedCasesDelta: 0,
			maxRuntimeUnderfilledTopKCasesDelta: 0,
			minAverageF1Delta: 0,
			minPassingRateDelta: 0,
			severity: 'fail'
		}
	});
	await persistRAGRetrievalComparisonRun({
		run: {
			comparison: input.comparison,
			corpusGroupKey: CORPUS_GROUP_KEY,
			corpusKeys: input.comparison.corpusKeys,
			decisionSummary,
			elapsedMs: finishedAt - input.startedAt,
			finishedAt,
			groupKey: GROUP_KEY,
			id: randomUUID(),
			label: `${suite.label} (${input.backendLabel})`,
			releaseVerdict: buildRAGRetrievalReleaseVerdict({
				decisionSummary,
				groupKey: GROUP_KEY
			}),
			startedAt: input.startedAt,
			suiteId: suite.id,
			suiteLabel: suite.label ?? suite.id,
			tags: input.tags
		},
		store: comparisonHistoryStore
	});
};

const runSQLiteNativeBenchmark = async () => {
	const db = new Database(':memory:');
	const store = createSQLiteRAGStore({
		db,
		dimensions: 2,
		mockEmbedding: createRAGNativeBackendBenchmarkMockEmbedding,
		native: { mode: 'vec0', requireAvailable: true }
	});
	try {
		const collection = createBenchmarkCollection(store);
		await collection.ingest({
			chunks: createRAGNativeBackendBenchmarkCorpus({
				backend: 'sqlite-native'
			})
		});
		await store.analyze?.();
		const startedAt = Date.now();
		const comparison = await compareRAGRetrievalStrategies({
			collection,
			retrievals,
			suite
		});
		const status = collection.getStatus?.();
		await persistComparisonRun({
			backendLabel: 'sqlite-native',
			comparison,
			startedAt,
			tags: createBackendTags(
				status?.backend ?? 'sqlite',
				status?.vectorMode ?? 'native_vec0',
				'sqlite-native'
			)
		});
		return {
			backend: 'sqlite-native',
			comparison,
			status
		};
	} finally {
		db.close();
		await store.close?.();
	}
};

const runPostgresBenchmark = async () => {
	const store = createPostgresRAGStore({
		connectionString: DEFAULT_POSTGRES_URL,
		dimensions: 2,
		mockEmbedding: createRAGNativeBackendBenchmarkMockEmbedding,
		tableName: `rag_release_bench_${randomUUID().replaceAll('-', '_')}`
	});
	try {
		const collection = createBenchmarkCollection(store);
		await collection.ingest({
			chunks: createRAGNativeBackendBenchmarkCorpus({
				backend: 'postgres'
			})
		});
		await store.analyze?.();
		const startedAt = Date.now();
		const comparison = await compareRAGRetrievalStrategies({
			collection,
			retrievals,
			suite
		});
		const status = collection.getStatus?.();
		await persistComparisonRun({
			backendLabel: 'postgres',
			comparison,
			startedAt,
			tags: createBackendTags(
				status?.backend ?? 'postgres',
				status?.vectorMode ?? 'native_pgvector',
				'postgres'
			)
		});
		return {
			backend: 'postgres',
			comparison,
			status
		};
	} finally {
		await store.close?.();
	}
};

const shouldRunBackend = (backend: 'sqlite-native' | 'postgres') =>
	requestedBackend === 'all' || requestedBackend === backend;

const main = async () => {
	ensureDir(HISTORY_PATH);
	ensureDir(SNAPSHOT_PATH);
	ensureDir(REPORT_PATH);

	const availability = {
		postgres: shouldRunBackend('postgres') ? await canUsePostgres() : false,
		sqliteNative: shouldRunBackend('sqlite-native')
			? canUseSQLiteNative()
			: false
	};
	const missingRequired =
		(requirePostgres && !availability.postgres) ||
		(requireSQLiteNative && !availability.sqliteNative);
	if (missingRequired) {
		console.error(
			JSON.stringify(
				{
					ok: false,
					error: 'Required native benchmark backend is unavailable',
					availability
				},
				null,
				2
			)
		);
		process.exit(1);
	}

	const snapshot = await persistSuiteSnapshot();
	const results = [] as Array<{
		backend: string;
		leaderboard?: string[];
		status?: unknown;
		skipped?: boolean;
		reason?: string;
	}>;

	if (shouldRunBackend('sqlite-native')) {
		if (!availability.sqliteNative) {
			results.push({
				backend: 'sqlite-native',
				reason: 'sqlite vec0 backend unavailable',
				skipped: true
			});
		} else {
			const result = await runSQLiteNativeBenchmark();
			results.push({
				backend: result.backend,
				leaderboard: result.comparison.leaderboard.map(
					(entry) => entry.runId
				),
				status: result.status
			});
		}
	}

	if (shouldRunBackend('postgres')) {
		if (!availability.postgres) {
			results.push({
				backend: 'postgres',
				reason: 'postgres backend unavailable',
				skipped: true
			});
		} else {
			const result = await runPostgresBenchmark();
			results.push({
				backend: result.backend,
				leaderboard: result.comparison.leaderboard.map(
					(entry) => entry.runId
				),
				status: result.status
			});
		}
	}

	const history = await loadRAGRetrievalComparisonHistory({
		groupKey: GROUP_KEY,
		limit: 10,
		store: comparisonHistoryStore,
		suiteId: suite.id
	});
	const report = {
		availability,
		groupKey: GROUP_KEY,
		ok: true,
		recentRunCount: history.length,
		reportPath: REPORT_PATH,
		results,
		snapshot: {
			id: snapshot.id,
			version: snapshot.version
		},
		suite: {
			caseCount: suite.input.cases.length,
			id: suite.id,
			label: suite.label
		}
	};
	await Bun.write(REPORT_PATH, JSON.stringify(report, null, 2));
	console.log(JSON.stringify(report, null, 2));
};

await main();
