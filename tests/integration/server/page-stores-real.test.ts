import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { redisPageStore, s3PageStore } from '../../../src/core/pageStores';
import { describePageStoreContract } from '../../helpers/pageStoreContract';

/* The page stores against the real services, through Bun's own clients.
 *
 * The unit tests run the same contract against stand-ins, which proves
 * the stores handle what the services do — as far as the stand-ins are
 * right about what that is. This proves it against the services
 * themselves: what S3 actually throws for a missing key, how a Redis
 * SCAN actually pages.
 *
 * It needs a Redis and an S3-compatible service, so it runs only where
 * the environment names them, and is skipped everywhere else:
 *
 *   PAGE_STORE_TEST_REDIS_URL=redis://localhost:6379
 *   PAGE_STORE_TEST_S3_ENDPOINT=http://localhost:9000
 *   PAGE_STORE_TEST_S3_BUCKET=pages
 *   PAGE_STORE_TEST_S3_ACCESS_KEY_ID=…
 *   PAGE_STORE_TEST_S3_SECRET_ACCESS_KEY=…
 */

const redisUrl = process.env.PAGE_STORE_TEST_REDIS_URL;
const s3: Record<string, string | undefined> = {
	accessKeyId: process.env.PAGE_STORE_TEST_S3_ACCESS_KEY_ID,
	bucket: process.env.PAGE_STORE_TEST_S3_BUCKET,
	endpoint: process.env.PAGE_STORE_TEST_S3_ENDPOINT,
	secretAccessKey: process.env.PAGE_STORE_TEST_S3_SECRET_ACCESS_KEY
};
const hasS3 = Object.values(s3).every((value) => Boolean(value));

if (redisUrl) {
	const client = new Bun.RedisClient(redisUrl);

	describePageStoreContract('redisPageStore on a real Redis', (space) =>
		redisPageStore(client, { prefix: space })
	);
}

if (hasS3) {
	const client = new Bun.S3Client({
		accessKeyId: s3.accessKeyId ?? '',
		bucket: s3.bucket ?? '',
		endpoint: s3.endpoint ?? '',
		secretAccessKey: s3.secretAccessKey ?? ''
	});

	describePageStoreContract('s3PageStore on a real S3 service', (space) =>
		s3PageStore(client, { prefix: space })
	);

	describe('s3PageStore on a real S3 service', () => {
		/* The one thing the stand-in could only assume: what the service
		 * says for a key that is not there. */
		test('a missing object is undefined, not an error', async () => {
			const store = s3PageStore(client, {
				prefix: `missing-${crypto.randomUUID()}/`
			});

			expect(
				await store.get('b1/pages/never-written.html')
			).toBeUndefined();
		});

		test('an unreachable service is an error, not a missing object', async () => {
			const unreachable = s3PageStore(
				new Bun.S3Client({
					accessKeyId: s3.accessKeyId ?? '',
					bucket: s3.bucket ?? '',
					endpoint: 'http://127.0.0.1:1',
					secretAccessKey: s3.secretAccessKey ?? ''
				})
			);

			await expect(
				unreachable.get('b1/pages/index.html')
			).rejects.toThrow();
		});
	});
}

/* `static.store` in the config: the same stores, built on Bun's clients
 * with credentials taken from the environment — which is what lets the
 * config hold nothing secret.
 *
 * In a process of its own, because Bun's clients read their credentials
 * from the environment the process STARTED with: setting
 * `process.env.REDIS_URL` here, after the fact, changes nothing, which
 * is also what a deployment should expect. */
const STORES_MODULE = resolve(
	import.meta.dir,
	'../../../src/core/pageStores.ts'
).replace(/\\/g, '/');

const fromConfigIn = async (
	type: 'redis' | 's3',
	environment: Record<string, string>
) => {
	const prefix = `config-${crypto.randomUUID()}${type === 'redis' ? ':' : '/'}`;
	const script = `
		import { pageStoreFromConfig } from '${STORES_MODULE}';
		const store = pageStoreFromConfig({ prefix: '${prefix}', type: '${type}' });
		await store.put('b1/pages/index.html', 'FROM CONFIG');
		console.log(JSON.stringify({
			body: await store.get('b1/pages/index.html'),
			listed: (await store.list('b1/')).length
		}));
		process.exit(0);
	`;
	const child = Bun.spawn(['bun', '-e', script], {
		env: { ...process.env, ...environment },
		stderr: 'pipe',
		stdout: 'pipe'
	});
	const [stdout, stderr] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited
	]);
	const lastLine = stdout.trim().split('\n').pop() ?? '';

	return lastLine.startsWith('{') ? JSON.parse(lastLine) : { stderr };
};

if (redisUrl)
	describe('static.store: { type: "redis" }', () => {
		test('reaches the Redis that REDIS_URL names', async () => {
			expect(
				await fromConfigIn('redis', { REDIS_URL: redisUrl })
			).toEqual({ body: 'FROM CONFIG', listed: 1 });
		});
	});

if (hasS3)
	describe('static.store: { type: "s3" }', () => {
		test.each(['S3', 'AWS'])(
			'takes its bucket and credentials from the %s_ variables',
			async (family) => {
				expect(
					await fromConfigIn('s3', {
						[`${family}_ACCESS_KEY_ID`]: s3.accessKeyId ?? '',
						[`${family}_BUCKET`]: s3.bucket ?? '',
						[`${family}_ENDPOINT`]: s3.endpoint ?? '',
						[`${family}_SECRET_ACCESS_KEY`]:
							s3.secretAccessKey ?? ''
					})
				).toEqual({ body: 'FROM CONFIG', listed: 1 });
			}
		);
	});

describe('the real page store services', () => {
	test.skipIf(Boolean(redisUrl) && hasS3)(
		'are not all configured here, so some of this file did not run',
		() => {
			expect(Boolean(redisUrl) && hasS3).toBe(false);
		}
	);
});
