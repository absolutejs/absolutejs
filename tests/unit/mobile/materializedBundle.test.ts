import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import type { AbsoluteMobileStoredCompatibilityRelease } from '../../../src/mobile/artifactStore';
import {
	loadAbsoluteMobileMaterializedBundle,
	materializeAbsoluteMobileCompatibilityBundle
} from '../../../src/mobile/materializedBundle';
import { createAbsoluteMobileCompatibilityArtifact } from '../../../src/mobile/releaseArtifact';

const roots: string[] = [];

const temporaryRoot = async () => {
	const root = await mkdtemp(join(tmpdir(), 'absolute-mobile-bundle-'));
	roots.push(root);

	return root;
};

const releaseFor = (
	generation: number
): AbsoluteMobileStoredCompatibilityRelease => {
	const source = `export const mobileProducer={handle:()=>new Response("producer-${generation}")};`;
	const producer = new Blob([source]);
	const artifact = createAbsoluteMobileCompatibilityArtifact({
		appBuild: `build-${generation}`,
		appId: 'com.example.absolute',
		generation,
		pages: [
			{
				bundleHash: `page-${generation}`,
				bundlePath: `/pages/account-${generation}.js`,
				contract: `account@${generation}`,
				framework: 'react',
				pageId: 'Account',
				propsSchemaHash: `schema-${generation}`
			}
		],
		producer: {
			bundleHash: createHash('sha256').update(source).digest('hex'),
			bytes: producer.size,
			exportName: 'mobileProducer',
			module: 'producer.js'
		},
		routes: [{ method: 'GET', pageId: 'Account', pattern: '/account' }],
		runtime: `runtime-${generation}`
	});

	return { artifact, producer };
};

afterEach(async () => {
	await Promise.all(
		roots
			.splice(0)
			.map((root) => rm(root, { force: true, recursive: true }))
	);
});

describe('materialized mobile compatibility bundle', () => {
	test('writes an atomic pointer to immutable retained producers', async () => {
		const root = await temporaryRoot();
		const releases = [3, 2, 1].map(releaseFor);
		const index = await materializeAbsoluteMobileCompatibilityBundle({
			currentReleaseId: releases[0]?.artifact.releaseId ?? '',
			releases,
			root
		});
		const loaded = await loadAbsoluteMobileMaterializedBundle(root);

		expect(loaded.currentReleaseId).toBe(index.currentReleaseId);
		expect(loaded.artifacts.map(({ generation }) => generation)).toEqual([
			3, 2, 1
		]);
		const previous = releases.find(
			({ artifact }) => artifact.generation === 2
		);
		if (!previous) throw new Error('Previous test release is missing.');
		const producer = await loaded.loadProducer(previous.artifact);
		expect(
			await (
				await producer.handle(
					new Request('https://example.test/account')
				)
			).text()
		).toBe('producer-2');
	});

	test('rejects inputs that have not already been reduced to retention', async () => {
		const root = await temporaryRoot();
		const releases = [4, 3, 2, 1].map(releaseFor);

		await expect(
			materializeAbsoluteMobileCompatibilityBundle({
				currentReleaseId: releases[0]?.artifact.releaseId ?? '',
				releases,
				root
			})
		).rejects.toThrow('only retained releases');
	});
});
