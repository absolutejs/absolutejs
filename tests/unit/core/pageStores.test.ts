import { describe, expect, test } from 'bun:test';
import type {
	RedisPageStoreClient,
	S3PageStoreClient,
	S3PageStoreListing
} from '../../../types/pageStores';
import { redisPageStore, s3PageStore } from '../../../src/core/pageStores';
import { describePageStoreContract } from '../../helpers/pageStoreContract';

/* The S3 and Redis page stores against stand-ins for the two clients.
 * The stand-ins behave as the services do in the ways the stores rely
 * on — results that come a page at a time, a missing object that is an
 * error in S3 and a null in Redis — so what is tested is the store's
 * handling of those, not the service. The same contract is run against
 * the real services where a machine has them
 * (tests/integration/server/page-stores-real.test.ts). */

const LIST_PAGE = 10;

type FakeObject = { body: string; eTag: string };
type FakeState = { down: boolean; writes: number };

const createS3 = () => {
	const objects = new Map<string, FakeObject>();
	const state: FakeState = { down: false, writes: 0 };
	const reachable = () => {
		if (state.down) throw new Error('connect ECONNREFUSED');
	};
	const client: S3PageStoreClient = {
		delete: async (path) => {
			reachable();
			objects.delete(path);
		},
		file: (path) => ({
			text: async () => {
				reachable();
				const found = objects.get(path);
				// S3 answers a missing key with an error, not a value.
				if (!found)
					throw Object.assign(new Error('The key does not exist'), {
						code: 'NoSuchKey'
					});

				return found.body;
			}
		}),
		list: async ({ continuationToken, prefix = '' }) => {
			reachable();
			const keys = [...objects.keys()]
				.filter((key) => key.startsWith(prefix))
				.sort();
			const from = continuationToken ? Number(continuationToken) : 0;
			const page = keys.slice(from, from + LIST_PAGE);
			const more = from + LIST_PAGE < keys.length;
			const listing: S3PageStoreListing = {
				contents: page.map((key) => ({
					eTag: objects.get(key)?.eTag ?? '',
					key
				})),
				isTruncated: more,
				...(more
					? { nextContinuationToken: String(from + LIST_PAGE) }
					: {})
			};

			return listing;
		},
		write: async (path, data) => {
			reachable();
			state.writes += 1;
			objects.set(path, { body: data, eTag: `"etag-${state.writes}"` });
		}
	};

	return { client, objects, state };
};

const escapeRegExp = (text: string) =>
	text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* Redis MATCH as far as these tests need it: `*` is anything, and a
 * backslash makes the next character literal. */
const globToRegExp = (pattern: string) => {
	const parts = pattern.match(/\\.|\*|[^\\*]+/g) ?? [];
	const source = parts
		.map((part) => {
			if (part === '*') return '.*';

			return escapeRegExp(part.startsWith('\\') ? part.slice(1) : part);
		})
		.join('');

	return new RegExp(`^${source}$`);
};

const createRedis = () => {
	const values = new Map<string, string>();
	const commands: string[] = [];
	const client: RedisPageStoreClient = {
		send: async (command, args) => {
			commands.push(command);
			if (command === 'GET') return values.get(args[0] ?? '') ?? null;
			if (command === 'MGET')
				return args.map((key) => values.get(key) ?? null);
			if (command === 'DEL') {
				args.forEach((key) => values.delete(key));

				return args.length;
			}
			if (command === 'MSET') {
				// One command: every pair lands, or none does.
				for (let index = 0; index < args.length; index += 2)
					values.set(args[index] ?? '', args[index + 1] ?? '');

				return 'OK';
			}
			if (command === 'SCAN') {
				const [cursor = '0', , pattern = '*'] = args;
				const matching = [...values.keys()]
					.filter((key) => globToRegExp(pattern).test(key))
					.sort();
				const from = Number(cursor);
				const next = from + LIST_PAGE;

				return [
					next < matching.length ? String(next) : '0',
					matching.slice(from, next)
				];
			}
			throw new Error(`unexpected command ${command}`);
		}
	};

	return { client, commands, values };
};

describePageStoreContract('s3PageStore', (space) =>
	s3PageStore(createS3().client, { prefix: space })
);

describePageStoreContract('redisPageStore', (space) =>
	redisPageStore(createRedis().client, { prefix: space })
);

describe('s3PageStore', () => {
	/* "Not there" is an answer. "Cannot reach the bucket" is not, and
	 * must surface, or an outage would look like every page was gone. */
	test('a missing object is undefined, but an unreachable bucket throws', async () => {
		const fake = createS3();
		const store = s3PageStore(fake.client);

		expect(await store.get('b1/pages/missing.html')).toBeUndefined();
		fake.state.down = true;

		await expect(store.get('b1/pages/missing.html')).rejects.toThrow(
			'ECONNREFUSED'
		);
		await expect(store.list('b1/')).rejects.toThrow('ECONNREFUSED');
	});

	test('keeps everything under its prefix, and hides the prefix from callers', async () => {
		const fake = createS3();
		const store = s3PageStore(fake.client, { prefix: 'site-a/' });

		await store.put('b1/pages/index.html', 'x');

		expect([...fake.objects.keys()]).toEqual([
			'site-a/b1/pages/index.html'
		]);
		expect((await store.list('b1/'))[0]?.key).toBe('b1/pages/index.html');
	});

	test('two stores with different prefixes in one bucket do not see each other', async () => {
		const fake = createS3();
		const one = s3PageStore(fake.client, { prefix: 'site-a/' });
		const other = s3PageStore(fake.client, { prefix: 'site-b/' });

		await one.put('b1/pages/index.html', 'A');

		expect(await other.get('b1/pages/index.html')).toBeUndefined();
		expect(await other.list('')).toEqual([]);
	});

	/* An ETag is not always a hash of the body, so a write does not
	 * claim to know its version. */
	test('does not claim to know the version of what it wrote', async () => {
		const store = s3PageStore(createS3().client);

		expect(await store.put('b1/pages/index.html', 'x')).toBeUndefined();
	});
});

describe('redisPageStore', () => {
	/* If the body and the version were two writes, two machines writing
	 * at once could leave one's body under the other's version, and the
	 * machine whose version it was would never pull the page. */
	test('writes a body and its version with one command', async () => {
		const fake = createRedis();
		const store = redisPageStore(fake.client);

		await store.put('b1/pages/index.html', 'x');

		expect(fake.commands).toEqual(['MSET']);
		expect(fake.values.size).toBe(2);
	});

	test('reports the version of what it wrote, so the writer fetches nothing back', async () => {
		const store = redisPageStore(createRedis().client);

		const first = await store.put('b1/pages/index.html', 'ONE');
		const again = await store.put('b1/pages/index.html', 'ONE');
		const changed = await store.put('b1/pages/index.html', 'TWO');

		expect(typeof first).toBe('string');
		expect(again).toBe(first);
		expect(changed).not.toBe(first);
	});

	test('delete removes the body and the version together', async () => {
		const fake = createRedis();
		const store = redisPageStore(fake.client);
		await store.put('b1/pages/index.html', 'x');

		await store.delete('b1/pages/index.html');

		expect(fake.values.size).toBe(0);
	});

	/* A key is matched as text. A `*` or a `[` in a prefix must not
	 * turn the listing into a wider pattern than was asked for. */
	test('lists by prefix literally, whatever characters the prefix holds', async () => {
		const fake = createRedis();
		const store = redisPageStore(fake.client, { prefix: 'app[1]*:' });
		const other = redisPageStore(fake.client, { prefix: 'app1x:' });
		await store.put('b1/pages/index.html', 'mine');
		await other.put('b1/pages/index.html', 'theirs');

		expect(await store.list('b1/')).toHaveLength(1);
		expect(await store.get('b1/pages/index.html')).toBe('mine');
	});

	/* Deleted between the scan and the read of its version: it is
	 * simply not in the listing. */
	test('leaves out a key that vanished while it was listing', async () => {
		const fake = createRedis();
		const store = redisPageStore(fake.client);
		await store.put('b1/pages/a.html', 'a');
		await store.put('b1/pages/b.html', 'b');
		const { send } = fake.client;
		fake.client.send = async (command, args) => {
			// The version key goes between the scan that found it and
			// the read of its value.
			if (command === 'MGET')
				fake.values.delete(
					args.find((key) => key.endsWith('a.html')) ?? ''
				);

			return send(command, args);
		};

		const listed = await store.list('b1/pages/');

		expect(listed.map((entry) => entry.key)).toEqual(['b1/pages/b.html']);
	});
});
