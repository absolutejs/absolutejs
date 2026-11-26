import { createHash } from 'node:crypto';
import type { PageStore, PageStoreEntry } from '../../types/pageStore';
import type {
	PageStoreConfig,
	PageStorePrefixOptions,
	RedisPageStoreClient,
	S3PageStoreClient
} from '../../types/pageStores';

/* Page stores for the two things most deployments already have: an
 * object store and a Redis.
 *
 * Both are written against the small part of a client they use, so they
 * work with Bun's own `S3Client` and `RedisClient` — no dependency is
 * added for either — and with anything else shaped the same. */

const DEFAULT_S3_PREFIX = 'absolutejs-pages/';
const DEFAULT_REDIS_PREFIX = 'absolutejs:pages:';
const VERSION_LENGTH = 16;

/* ------------------------------------------------------------------ */
/* S3                                                                   */
/* ------------------------------------------------------------------ */

const NOT_FOUND_NAMES = new Set(['NoSuchKey', 'NotFound']);
const HTTP_NOT_FOUND = 404;

/* An object that is not there, as opposed to a store that cannot be
 * reached. The two must not be confused: the first is an answer, the
 * second has to surface so the outage is reported. */
const isMissingObject = (error: unknown) => {
	if (typeof error !== 'object' || error === null) return false;
	const code: unknown = Reflect.get(error, 'code');
	const name: unknown = Reflect.get(error, 'name');
	const status: unknown =
		Reflect.get(error, 'status') ?? Reflect.get(error, 'statusCode');

	return (
		(typeof code === 'string' && NOT_FOUND_NAMES.has(code)) ||
		(typeof name === 'string' && NOT_FOUND_NAMES.has(name)) ||
		status === HTTP_NOT_FOUND
	);
};

const listAllObjects = async (
	client: S3PageStoreClient,
	prefix: string,
	continuationToken?: string
): Promise<PageStoreEntry[]> => {
	const page = await client.list({
		prefix,
		...(continuationToken === undefined ? {} : { continuationToken })
	});
	const entries = (page.contents ?? []).map((object) => ({
		key: object.key,
		// An ETag changes with the content; where a service gives
		// none, the modification time does.
		version: object.eTag ?? object.lastModified ?? ''
	}));
	if (!page.isTruncated || page.nextContinuationToken === undefined)
		return entries;

	return [
		...entries,
		...(await listAllObjects(client, prefix, page.nextContinuationToken))
	];
};

/** A page store in an S3 bucket, or anything that speaks S3.
 *
 *      registerPageStore(s3PageStore(new Bun.S3Client({ bucket: 'pages' })));
 *
 *  One object per page. A write does not say what version it produced —
 *  an ETag is not always a hash of the body — so the machine that wrote
 *  a page fetches it back once on its next check. */
export const s3PageStore = (
	client: S3PageStoreClient,
	{ prefix = DEFAULT_S3_PREFIX }: PageStorePrefixOptions = {}
) => {
	const store: PageStore = {
		delete: async (key) => {
			await client.delete(`${prefix}${key}`);
		},
		get: async (key) => {
			try {
				return await client.file(`${prefix}${key}`).text();
			} catch (error) {
				if (isMissingObject(error)) return undefined;
				throw error;
			}
		},
		list: async (keyPrefix) =>
			(await listAllObjects(client, `${prefix}${keyPrefix}`)).map(
				(entry) => ({
					key: entry.key.slice(prefix.length),
					version: entry.version
				})
			),
		put: async (key, body) => {
			await client.write(`${prefix}${key}`, body, {
				type: 'application/json'
			});
		}
	};

	return store;
};

/* ------------------------------------------------------------------ */
/* Redis                                                                */
/* ------------------------------------------------------------------ */

const BODY_SPACE = 'body:';
const VERSION_SPACE = 'version:';
const SCAN_COUNT = '500';
const GLOB_SPECIAL = /[*?[\]\\]/g;

const versionOfBody = (body: string) =>
	createHash('sha256').update(body).digest('hex').slice(0, VERSION_LENGTH);

const stringsOf = (value: unknown) =>
	Array.isArray(value)
		? value.filter((item): item is string => typeof item === 'string')
		: [];

/* One step of a SCAN: the next cursor and the keys it found. */
const readScan = (reply: unknown) => {
	if (!Array.isArray(reply)) return { cursor: '0', keys: [] };
	const [cursor, keys]: unknown[] = reply;

	return { cursor: String(cursor ?? '0'), keys: stringsOf(keys) };
};

const scanAll = async (
	client: RedisPageStoreClient,
	pattern: string,
	cursor = '0'
): Promise<string[]> => {
	const step = readScan(
		await client.send('SCAN', [
			cursor,
			'MATCH',
			pattern,
			'COUNT',
			SCAN_COUNT
		])
	);
	if (step.cursor === '0') return step.keys;

	return [...step.keys, ...(await scanAll(client, pattern, step.cursor))];
};

/** A page store in Redis, or anything that speaks its protocol.
 *
 *      registerPageStore(redisPageStore(new Bun.RedisClient()));
 *
 *  A page's body and its version are two keys written by ONE command, so
 *  they can never disagree — which is what would happen if two machines
 *  wrote a page at the same moment and one's body landed with the
 *  other's version. The version is a hash of the body, so a write can
 *  say what it produced and the writer never fetches its own page back.
 *
 *  For a single Redis or a primary with replicas. A Redis Cluster
 *  spreads keys over nodes, and neither the listing nor the two-key
 *  write here is cluster-aware. */
export const redisPageStore = (
	client: RedisPageStoreClient,
	{ prefix = DEFAULT_REDIS_PREFIX }: PageStorePrefixOptions = {}
) => {
	const bodyKey = (key: string) => `${prefix}${BODY_SPACE}${key}`;
	const versionKey = (key: string) => `${prefix}${VERSION_SPACE}${key}`;
	const versionSpace = `${prefix}${VERSION_SPACE}`;
	const store: PageStore = {
		delete: async (key) => {
			await client.send('DEL', [bodyKey(key), versionKey(key)]);
		},
		get: async (key) => {
			const body = await client.send('GET', [bodyKey(key)]);

			return typeof body === 'string' ? body : undefined;
		},
		list: async (keyPrefix) => {
			const found = await scanAll(
				client,
				`${`${versionSpace}${keyPrefix}`.replace(GLOB_SPECIAL, '\\$&')}*`
			);
			if (found.length === 0) return [];
			const versions = stringsOrNull(await client.send('MGET', found));

			return found
				.map((key, index) => ({
					key: key.slice(versionSpace.length),
					version: versions[index]
				}))
				.filter(
					(entry): entry is PageStoreEntry =>
						typeof entry.version === 'string'
				);
		},
		put: async (key, body) => {
			const version = versionOfBody(body);
			await client.send('MSET', [
				bodyKey(key),
				body,
				versionKey(key),
				version
			]);

			return version;
		}
	};

	return store;
};

/* An MGET reply keeps its positions: a key deleted since the scan is a
 * null in its place, not a shorter list. */
const stringsOrNull = (value: unknown) =>
	Array.isArray(value)
		? value.map((item) => (typeof item === 'string' ? item : undefined))
		: [];

/* ------------------------------------------------------------------ */
/* From config                                                          */
/* ------------------------------------------------------------------ */

/** The store a `static.store` entry in the config names, built on Bun's
 *  own clients. Credentials are not in the config: `Bun.S3Client` reads
 *  `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (or the `AWS_` names) and
 *  `Bun.RedisClient` reads `REDIS_URL`, from the server's environment. */
export const pageStoreFromConfig = (config: PageStoreConfig) => {
	const prefixOptions: PageStorePrefixOptions =
		config.prefix === undefined ? {} : { prefix: config.prefix };
	if (config.type === 'redis')
		return redisPageStore(new Bun.RedisClient(), prefixOptions);

	return s3PageStore(
		new Bun.S3Client({
			...(config.bucket === undefined ? {} : { bucket: config.bucket }),
			...(config.endpoint === undefined
				? {}
				: { endpoint: config.endpoint }),
			...(config.region === undefined ? {} : { region: config.region })
		}),
		prefixOptions
	);
};
