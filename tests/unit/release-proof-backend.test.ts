import { expect, test } from 'bun:test';
import { createSyncClient } from '@absolutejs/sync/client';
import { createReleaseProofBackend } from '../helpers/releaseProofBackend';
import { pollNative } from '../helpers/androidLocalHttps';
import type { ReleaseProofRow } from '../helpers/ReleaseDataProof';

test('release proof uses the real Sync engine and counts actual writes without deduplicating evidence', async () => {
	const app = createReleaseProofBackend({
		challenge: 'fresh-proof',
		origin: 'https://localhost'
	}).listen({ hostname: '127.0.0.1', port: 0 });
	if (!app.server) throw new Error('Sync fixture did not start');
	const client = createSyncClient({
		url: `ws://127.0.0.1:${app.server.port}/sync/ws`
	});
	const collection = client.collection<ReleaseProofRow>({
		collection: 'proof'
	});
	const facts = async () =>
		(await (
			await app.handle(new Request('http://localhost/__proof'))
		).json()) as { writes: number };
	try {
		await pollNative(
			async () => client.status().connection === 'online',
			'test Sync connection',
			5000
		);
		expect((await facts()).writes).toBe(0);
		await expect(
			collection.mutate({
				args: { challenge: 'wrong' },
				name: 'recordProof'
			})
		).rejects.toThrow();
		expect((await facts()).writes).toBe(0);
		await collection.mutate({
			args: { challenge: 'fresh-proof' },
			name: 'recordProof'
		});
		await pollNative(
			async () => collection.get().data.length === 1,
			'receipt delivery',
			5000
		);
		expect(collection.get().data[0]?.value).toBe('fresh-proof');
		expect((await facts()).writes).toBe(1);
		await collection.mutate({
			args: { challenge: 'fresh-proof' },
			name: 'recordProof'
		});
		expect((await facts()).writes).toBe(2);
	} finally {
		client.close();
		await app.stop();
	}
}, 15_000);
