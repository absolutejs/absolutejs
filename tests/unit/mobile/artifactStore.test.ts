import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import {
	carryForwardAbsoluteMobileCompatibilityReleases,
	createAbsoluteMobileBlobArtifactStore,
	createAbsoluteMobileFileArtifactStore,
	type AbsoluteMobileBlobStore,
	type AbsoluteMobileStoredCompatibilityRelease
} from '../../../src/mobile/artifactStore';
import { createAbsoluteMobileCompatibilityArtifact } from '../../../src/mobile/releaseArtifact';

const roots: string[] = [];

const temporaryRoot = async () => {
	const root = await mkdtemp(join(tmpdir(), 'absolute-mobile-artifacts-'));
	roots.push(root);

	return root;
};

const releaseFor = (
	generation: number
): AbsoluteMobileStoredCompatibilityRelease => {
	const producer = new Blob([
		`export const mobileProducer = { generation: ${generation} };`
	]);
	const bundleHash = createHash('sha256')
		.update(`export const mobileProducer = { generation: ${generation} };`)
		.digest('hex');
	const artifact = createAbsoluteMobileCompatibilityArtifact({
		appBuild: `build-${generation}`,
		appId: 'com.example.absolute',
		generation,
		pages: [
			{
				bundleHash: `page-${generation}`,
				contract: `account@${generation}`,
				framework: 'react',
				pageId: 'Account',
				propsSchemaHash: `schema-${generation}`
			}
		],
		producer: {
			bundleHash,
			bytes: producer.size,
			exportName: 'mobileProducer',
			module: 'producer.js'
		},
		routes: [{ method: 'GET', pageId: 'Account', pattern: '/account' }],
		runtime: `runtime-${generation}`
	});

	return { artifact, producer };
};

const collectBlobBody = async (
	body: ReadableStream<Uint8Array> | Uint8Array | string
) => {
	if (typeof body === 'string') return new TextEncoder().encode(body);
	if (body instanceof Uint8Array) return body;

	return new Uint8Array(await new Response(body).arrayBuffer());
};

const createMemoryBlobStore = (): AbsoluteMobileBlobStore => {
	const objects = new Map<string, Uint8Array>();

	return {
		delete: async (key) => {
			objects.delete(key);
		},
		get: async (key) => objects.get(key) ?? null,
		list: async ({ prefix }) => ({
			objects: [...objects.keys()]
				.filter((key) => key.startsWith(prefix))
				.map((key) => ({ key })),
			truncated: false
		}),
		put: async (key, body) => {
			const bytes = await collectBlobBody(body);
			objects.set(key, bytes);
		}
	};
};

afterEach(async () => {
	await Promise.all(
		roots
			.splice(0)
			.map((root) => rm(root, { force: true, recursive: true }))
	);
});

describe('mobile compatibility artifact store', () => {
	test('uses the @absolutejs/blob-compatible shape for remote history', async () => {
		const store = createAbsoluteMobileBlobArtifactStore({
			store: createMemoryBlobStore()
		});
		const release = releaseFor(1);
		await store.write(release);

		expect(await store.list(release.artifact.appId)).toEqual([
			release.artifact
		]);
		const loaded = await store.read(
			release.artifact.appId,
			release.artifact.releaseId
		);
		expect(await loaded?.producer.text()).toBe(
			await release.producer.text()
		);
	});

	test('atomically writes, lists, reads, and deletes a release', async () => {
		const store = createAbsoluteMobileFileArtifactStore({
			root: await temporaryRoot()
		});
		const release = releaseFor(1);
		await store.write(release);
		await store.write(release);

		expect(await store.list(release.artifact.appId)).toEqual([
			release.artifact
		]);
		const loaded = await store.read(
			release.artifact.appId,
			release.artifact.releaseId
		);
		expect(await loaded?.producer.text()).toBe(
			await release.producer.text()
		);

		await store.delete(release.artifact.appId, release.artifact.releaseId);
		expect(
			await store.read(release.artifact.appId, release.artifact.releaseId)
		).toBeNull();
	});

	test('carries the current release and two prior producers forward', async () => {
		const store = createAbsoluteMobileFileArtifactStore({
			root: await temporaryRoot()
		});
		await Promise.all(
			[1, 2, 3].map((generation) => store.write(releaseFor(generation)))
		);

		const retained = await carryForwardAbsoluteMobileCompatibilityReleases({
			current: releaseFor(4),
			store
		});

		expect(retained.map(({ artifact }) => artifact.generation)).toEqual([
			4, 3, 2
		]);
	});

	test('rejects producer bytes that do not match release metadata', async () => {
		const store = createAbsoluteMobileFileArtifactStore({
			root: await temporaryRoot()
		});
		const release = releaseFor(1);

		await expect(
			store.write({ ...release, producer: new Blob(['tampered']) })
		).rejects.toThrow('does not match');
	});

	test('rejects unsafe release identifiers before resolving a path', async () => {
		const store = createAbsoluteMobileFileArtifactStore({
			root: await temporaryRoot()
		});

		await expect(
			store.read('com.example.absolute', '../escape')
		).rejects.toThrow('Invalid mobile compatibility release id');
	});
});
