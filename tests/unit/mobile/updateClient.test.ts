import { describe, expect, test } from 'bun:test';
import { createAbsoluteMobileUpdateClient } from '../../../src/mobile/updateClient';
import type { AbsoluteMobileUpdateManifest } from '../../../src/mobile/updateProtocol';

const bytes = new TextEncoder().encode('updated');
const manifest: AbsoluteMobileUpdateManifest = {
	appId: 'com.example.absolute',
	channel: 'production',
	classification: 'bug-fix',
	createdAt: '2026-09-01T12:00:00.000Z',
	files: [
		{ bytes: bytes.byteLength, path: 'index.html', sha256: 'a'.repeat(64) }
	],
	format: 1,
	releaseId: `amu_${'b'.repeat(64)}`,
	runtimeFingerprint: 'c'.repeat(64),
	signature: {
		algorithm: 'ecdsa-p256-sha256',
		keyId: 'key-1',
		value: btoa(String.fromCharCode(...new Uint8Array(64)))
	},
	withinSubmittedPurpose: true
};

describe('mobile update client', () => {
	test('downloads verified assets into an atomic staging transaction', async () => {
		const calls: string[] = [];
		const client = createAbsoluteMobileUpdateClient({
			config: {
				appId: manifest.appId,
				channel: manifest.channel,
				currentReleaseId: 'embedded',
				installationId: '11111111-1111-4111-8111-111111111111',
				manifestUrl:
					'https://updates.example.com/releases/current/update.json',
				runtimeFingerprint: manifest.runtimeFingerprint
			},
			fetch: (async (input: RequestInfo | URL) => {
				const url = String(input);
				calls.push(url);

				return url.endsWith('update.json')
					? Response.json(manifest)
					: new Response(bytes);
			}) as typeof fetch,
			store: {
				abort: async (id) => void calls.push(`abort:${id}`),
				activate: async (id) => void calls.push(`activate:${id}`),
				begin: async ({ releaseId }) =>
					void calls.push(`begin:${releaseId}`),
				commit: async ({ releaseId }) =>
					void calls.push(`commit:${releaseId}`),
				write: async ({ path }, value) =>
					void calls.push(`write:${path}:${value.byteLength}`)
			},
			verifier: {
				digest: async () => 'a'.repeat(64),
				verify: async () => true
			}
		});

		const result = await client.download();
		expect(result.kind).toBe('downloaded');
		expect(result).toMatchObject({
			transfer: {
				downloadedBytes: 7,
				downloadedFiles: 1,
				reusedBytes: 0,
				reusedFiles: 0,
				totalBytes: 7,
				totalFiles: 1
			}
		});
		expect(calls).toEqual([
			'https://updates.example.com/releases/current/update.json',
			`begin:${manifest.releaseId}`,
			`https://updates.example.com/releases/current/${manifest.releaseId}/files/index.html`,
			'write:index.html:7',
			`commit:${manifest.releaseId}`
		]);
	});

	test('reuses only locally cached files that match the signed target digest', async () => {
		const calls: string[] = [];
		const client = createAbsoluteMobileUpdateClient({
			config: {
				appId: manifest.appId,
				channel: manifest.channel,
				currentReleaseId: 'previous',
				installationId: '11111111-1111-4111-8111-111111111111',
				manifestUrl: 'https://updates.example.com/update.json',
				runtimeFingerprint: manifest.runtimeFingerprint
			},
			fetch: (async (input: RequestInfo | URL) => {
				calls.push(String(input));

				return Response.json(manifest);
			}) as typeof fetch,
			store: {
				abort: async () => {},
				activate: async () => {},
				begin: async () => {},
				commit: async () => {},
				readReusable: async () => bytes,
				write: async ({ path }, value) =>
					void calls.push(`write:${path}:${value.byteLength}`)
			},
			verifier: {
				digest: async () => 'a'.repeat(64),
				verify: async () => true
			}
		});

		expect(await client.download()).toMatchObject({
			kind: 'downloaded',
			transfer: {
				downloadedBytes: 0,
				downloadedFiles: 0,
				reusedBytes: 7,
				reusedFiles: 1
			}
		});
		expect(calls).toEqual([
			'https://updates.example.com/update.json',
			'write:index.html:7'
		]);
	});

	test('downloads a signed file when the local reuse candidate is corrupt', async () => {
		const calls: string[] = [];
		const client = createAbsoluteMobileUpdateClient({
			config: {
				appId: manifest.appId,
				channel: manifest.channel,
				currentReleaseId: 'previous',
				installationId: '11111111-1111-4111-8111-111111111111',
				manifestUrl: 'https://updates.example.com/update.json',
				runtimeFingerprint: manifest.runtimeFingerprint
			},
			fetch: (async (input: RequestInfo | URL) => {
				const url = String(input);
				calls.push(url);

				return url.endsWith('update.json')
					? Response.json(manifest)
					: new Response(bytes);
			}) as typeof fetch,
			store: {
				abort: async () => {},
				activate: async () => {},
				begin: async () => {},
				commit: async () => {},
				readReusable: async () => new TextEncoder().encode('corrupt'),
				write: async () => {}
			},
			verifier: {
				digest: async (contents) =>
					new TextDecoder().decode(contents) === 'updated'
						? 'a'.repeat(64)
						: 'd'.repeat(64),
				verify: async () => true
			}
		});

		expect(await client.download()).toMatchObject({
			kind: 'downloaded',
			transfer: { downloadedFiles: 1, reusedFiles: 0 }
		});
		expect(calls).toContain(
			`https://updates.example.com/${manifest.releaseId}/files/index.html`
		);
	});

	test('fails closed and aborts staging on incompatible or corrupt updates', async () => {
		const aborted: string[] = [];
		const client = createAbsoluteMobileUpdateClient({
			config: {
				appId: manifest.appId,
				channel: manifest.channel,
				currentReleaseId: 'embedded',
				installationId: '11111111-1111-4111-8111-111111111111',
				manifestUrl: 'https://updates.example.com/update.json',
				runtimeFingerprint: manifest.runtimeFingerprint
			},
			fetch: (async (input: RequestInfo | URL) =>
				String(input).endsWith('update.json')
					? Response.json(manifest)
					: new Response(bytes)) as typeof fetch,
			store: {
				abort: async (id) => void aborted.push(id),
				activate: async () => {},
				begin: async () => {},
				commit: async () => {},
				write: async () => {}
			},
			verifier: {
				digest: async () => 'd'.repeat(64),
				verify: async () => true
			}
		});

		await expect(client.download()).rejects.toThrow(
			'integrity verification'
		);
		expect(aborted).toEqual([manifest.releaseId]);
	});

	test('does not redownload a release quarantined by the native watchdog', async () => {
		const calls: string[] = [];
		const client = createAbsoluteMobileUpdateClient({
			config: {
				appId: manifest.appId,
				blockedReleaseIds: [manifest.releaseId],
				channel: manifest.channel,
				currentReleaseId: 'embedded',
				installationId: '11111111-1111-4111-8111-111111111111',
				manifestUrl: 'https://updates.example.com/update.json',
				runtimeFingerprint: manifest.runtimeFingerprint
			},
			fetch: (async (input: RequestInfo | URL) => {
				calls.push(String(input));

				return Response.json(manifest);
			}) as typeof fetch,
			store: {
				abort: async () => void calls.push('abort'),
				activate: async () => {},
				begin: async () => void calls.push('begin'),
				commit: async () => {},
				write: async () => {}
			},
			verifier: {
				digest: async () => 'a'.repeat(64),
				verify: async () => true
			}
		});

		expect(await client.download()).toEqual({
			kind: 'quarantined',
			releaseId: manifest.releaseId
		});
		expect(calls).toEqual(['https://updates.example.com/update.json']);
	});
});
