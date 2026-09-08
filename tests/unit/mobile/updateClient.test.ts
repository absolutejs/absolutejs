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

	test('resumes a persistent partial file with a verified HTTP range', async () => {
		let partial = bytes.slice(0, 3);
		let written: Uint8Array | undefined;
		const progress: number[] = [];
		const client = createAbsoluteMobileUpdateClient({
			config: {
				appId: manifest.appId,
				channel: manifest.channel,
				currentReleaseId: 'embedded',
				installationId: '11111111-1111-4111-8111-111111111111',
				manifestUrl: 'https://updates.example.com/update.json',
				runtimeFingerprint: manifest.runtimeFingerprint
			},
			fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
				if (String(input).endsWith('update.json'))
					return Response.json(manifest);
				const headers = new Headers(init?.headers);
				expect(headers.get('range')).toBe('bytes=3-');
				expect(headers.get('if-range')).toBe(`"${'a'.repeat(64)}"`);

				return new Response(bytes.slice(3), {
					headers: { 'content-range': 'bytes 3-6/7' },
					status: 206
				});
			}) as typeof fetch,
			store: {
				abort: async () => {},
				activate: async () => {},
				appendPartial: async (_file, chunk, offset) => {
					expect(offset).toBe(partial.byteLength);
					const next = new Uint8Array(offset + chunk.byteLength);
					next.set(partial);
					next.set(chunk, offset);
					partial = next;
				},
				begin: async () => {},
				commit: async () => {},
				readPartial: async () => partial,
				suspend: async () => {},
				write: async (_file, contents) => void (written = contents)
			},
			verifier: {
				digest: async (contents) =>
					new TextDecoder().decode(contents) === 'updated'
						? 'a'.repeat(64)
						: 'd'.repeat(64),
				verify: async () => true
			},
			onProgress: ({ downloadedBytes }) =>
				void progress.push(downloadedBytes)
		});

		expect(await client.download()).toMatchObject({
			kind: 'downloaded',
			transfer: {
				avoidedBytes: 3,
				downloadedBytes: 4,
				downloadedFiles: 1,
				resumedBytes: 3,
				resumedFiles: 1
			}
		});
		expect(written).toEqual(bytes);
		expect(progress.at(-1)).toBe(4);
	});

	test('restarts a partial file when the server returns a full response', async () => {
		let partial = bytes.slice(0, 3);
		const offsets: number[] = [];
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
				abort: async () => {},
				activate: async () => {},
				appendPartial: async (_file, chunk, offset) => {
					offsets.push(offset);
					const next = new Uint8Array(offset + chunk.byteLength);
					next.set(partial.slice(0, offset));
					next.set(chunk, offset);
					partial = next;
				},
				begin: async () => {},
				commit: async () => {},
				readPartial: async () => partial,
				suspend: async () => {},
				write: async () => {}
			},
			verifier: {
				digest: async () => 'a'.repeat(64),
				verify: async () => true
			}
		});

		expect(await client.download()).toMatchObject({
			kind: 'downloaded',
			transfer: {
				downloadedBytes: 7,
				resumedBytes: 0,
				resumedFiles: 0
			}
		});
		expect(partial).toEqual(bytes);
		expect(offsets[0]).toBe(0);
	});

	test('verifies and reuses a completed file from persistent staging', async () => {
		let assetRequested = false;
		const client = createAbsoluteMobileUpdateClient({
			config: {
				appId: manifest.appId,
				channel: manifest.channel,
				currentReleaseId: 'embedded',
				installationId: '11111111-1111-4111-8111-111111111111',
				manifestUrl: 'https://updates.example.com/update.json',
				runtimeFingerprint: manifest.runtimeFingerprint
			},
			fetch: (async (input: RequestInfo | URL) => {
				if (!String(input).endsWith('update.json'))
					assetRequested = true;

				return Response.json(manifest);
			}) as typeof fetch,
			store: {
				abort: async () => {},
				activate: async () => {},
				begin: async () => {},
				commit: async () => {},
				readStaged: async () => bytes,
				write: async () => {}
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
				resumedBytes: 7,
				resumedFiles: 1
			}
		});
		expect(assetRequested).toBe(false);
	});

	test('keeps streamed checkpoints after interruption and resumes next attempt', async () => {
		let partial = new Uint8Array();
		let assetAttempt = 0;
		let suspended = 0;
		const client = createAbsoluteMobileUpdateClient({
			config: {
				appId: manifest.appId,
				channel: manifest.channel,
				currentReleaseId: 'embedded',
				installationId: '11111111-1111-4111-8111-111111111111',
				manifestUrl: 'https://updates.example.com/update.json',
				runtimeFingerprint: manifest.runtimeFingerprint
			},
			fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
				if (String(input).endsWith('update.json'))
					return Response.json(manifest);
				assetAttempt += 1;
				if (assetAttempt === 1) {
					let delivered = false;

					return new Response(
						new ReadableStream({
							pull(controller) {
								if (!delivered) {
									delivered = true;
									controller.enqueue(bytes.slice(0, 3));

									return;
								}
								controller.error(new Error('connection lost'));
							}
						})
					);
				}
				expect(new Headers(init?.headers).get('range')).toBe(
					'bytes=3-'
				);

				return new Response(bytes.slice(3), {
					headers: { 'content-range': 'bytes 3-6/7' },
					status: 206
				});
			}) as typeof fetch,
			store: {
				abort: async () => {},
				activate: async () => {},
				appendPartial: async (_file, chunk, offset) => {
					const next = new Uint8Array(offset + chunk.byteLength);
					next.set(partial.slice(0, offset));
					next.set(chunk, offset);
					partial = next;
				},
				begin: async () => {},
				commit: async () => {},
				readPartial: async () => partial,
				suspend: async () => void (suspended += 1),
				write: async () => {}
			},
			verifier: {
				digest: async () => 'a'.repeat(64),
				verify: async () => true
			}
		});

		await expect(client.download()).rejects.toThrow('connection lost');
		expect(partial).toEqual(bytes.slice(0, 3));
		expect(suspended).toBe(1);
		expect(await client.download()).toMatchObject({
			kind: 'downloaded',
			transfer: { downloadedBytes: 4, resumedBytes: 3 }
		});
	});

	test('bounds parallel asset downloads', async () => {
		const [sourceFile] = manifest.files;
		if (!sourceFile) throw new Error('Fixture file is missing');
		const many: AbsoluteMobileUpdateManifest = {
			...manifest,
			files: Array.from({ length: 5 }, (_, index) => ({
				...sourceFile,
				path: `asset-${index}.js`
			}))
		};
		let active = 0;
		let maximum = 0;
		const client = createAbsoluteMobileUpdateClient({
			concurrency: 2,
			config: {
				appId: manifest.appId,
				channel: manifest.channel,
				currentReleaseId: 'embedded',
				installationId: '11111111-1111-4111-8111-111111111111',
				manifestUrl: 'https://updates.example.com/update.json',
				runtimeFingerprint: manifest.runtimeFingerprint
			},
			fetch: (async (input: RequestInfo | URL) => {
				if (String(input).endsWith('update.json'))
					return Response.json(many);
				active += 1;
				maximum = Math.max(maximum, active);
				await new Promise((resolve) => setTimeout(resolve, 5));
				active -= 1;

				return new Response(bytes);
			}) as typeof fetch,
			store: {
				abort: async () => {},
				activate: async () => {},
				begin: async () => {},
				commit: async () => {},
				write: async () => {}
			},
			verifier: {
				digest: async () => 'a'.repeat(64),
				verify: async () => true
			}
		});

		expect(await client.download()).toMatchObject({
			kind: 'downloaded',
			transfer: { completedFiles: 5, downloadedFiles: 5 }
		});
		expect(maximum).toBe(2);
	});

	test('carries the server capability into sanitized health reports', async () => {
		const reports: { body: unknown; headers: Headers; url: string }[] = [];
		const client = createAbsoluteMobileUpdateClient({
			config: {
				appId: manifest.appId,
				channel: manifest.channel,
				currentReleaseId: 'embedded',
				installationId: '11111111-1111-4111-8111-111111111111',
				manifestUrl: 'https://updates.example.com/update.json',
				runtimeFingerprint: manifest.runtimeFingerprint
			},
			fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = String(input);
				if (url.endsWith('/health')) {
					reports.push({
						body: JSON.parse(String(init?.body)),
						headers: new Headers(init?.headers),
						url
					});

					return Response.json({ paused: false }, { status: 202 });
				}
				if (url.endsWith('update.json'))
					return Response.json(manifest, {
						headers: {
							'x-absolute-mobile-health-token':
								'signed-capability'
						}
					});

				return new Response(bytes);
			}) as typeof fetch,
			store: {
				abort: async () => {},
				activate: async () => {},
				begin: async () => {},
				commit: async () => {},
				write: async () => {}
			},
			verifier: {
				digest: async () => 'a'.repeat(64),
				verify: async () => true
			}
		});
		const result = await client.download();
		expect(result).toMatchObject({
			healthToken: 'signed-capability',
			kind: 'downloaded'
		});
		if (result.kind !== 'downloaded' || !result.healthToken)
			throw new Error('Health capability is missing');
		await client.report({
			healthToken: result.healthToken,
			kind: 'downloaded',
			releaseId: result.manifest.releaseId,
			transfer: result.transfer
		});
		expect(reports).toHaveLength(1);
		expect(reports[0]?.url).toBe('https://updates.example.com/health');
		expect(reports[0]?.headers.get('x-absolute-mobile-health-token')).toBe(
			'signed-capability'
		);
		expect(reports[0]?.body).toMatchObject({
			kind: 'downloaded',
			releaseId: manifest.releaseId,
			transfer: { downloadedBytes: 7 }
		});
	});

	test('reports transfer failure without replacing the update error', async () => {
		const reported: unknown[] = [];
		const client = createAbsoluteMobileUpdateClient({
			config: {
				appId: manifest.appId,
				channel: manifest.channel,
				currentReleaseId: 'embedded',
				installationId: '11111111-1111-4111-8111-111111111111',
				manifestUrl: 'https://updates.example.com/update.json',
				runtimeFingerprint: manifest.runtimeFingerprint
			},
			fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = String(input);
				if (url.endsWith('/health')) {
					reported.push(JSON.parse(String(init?.body)));

					return new Response(null, { status: 202 });
				}
				if (url.endsWith('update.json'))
					return Response.json(manifest, {
						headers: {
							'x-absolute-mobile-health-token':
								'signed-capability'
						}
					});

				return new Response(null, { status: 503 });
			}) as typeof fetch,
			store: {
				abort: async () => {},
				activate: async () => {},
				begin: async () => {},
				commit: async () => {},
				write: async () => {}
			},
			verifier: {
				digest: async () => 'a'.repeat(64),
				verify: async () => true
			}
		});

		await expect(client.download()).rejects.toThrow('HTTP 503');
		expect(reported).toEqual([
			{ kind: 'download-failed', releaseId: manifest.releaseId }
		]);
	});
});
