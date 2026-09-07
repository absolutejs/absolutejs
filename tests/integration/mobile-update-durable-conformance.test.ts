import {
	CreateBucketCommand,
	ListObjectsV2Command,
	PutObjectCommand,
	S3Client
} from '@aws-sdk/client-s3';
import {
	convertCertificateToCertificatePEM,
	convertKeyPairToPEM,
	generateKeyPair,
	generateSelfSignedCodeSigningCertificate
} from '@expo/code-signing-certificates';
import {
	createHash,
	generateKeyPairSync,
	randomUUID,
	verify,
	X509Certificate
} from 'node:crypto';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'bun:test';
import { normalizeAbsoluteMobileConfig } from '../../src/mobile/config';
import { createAbsoluteMobileUpdateClient } from '../../src/mobile/updateClient';
import {
	createAbsoluteMobileUpdateServerPlugin,
	loadAbsoluteMobileUpdateServerModule,
	writeAbsoluteMobileUpdateRegistry
} from '../../src/mobile/updateServer';
import {
	buildAbsoluteMobileUpdate,
	verifyAbsoluteMobileUpdateSignature
} from '../../src/mobile/updateSigning';

const enabled = process.env.ABSOLUTE_TEST_MOBILE_UPDATE_DURABLE === '1';
const durableTest = enabled ? test : test.skip;
const MINIO_IMAGE = 'minio/minio:RELEASE.2025-04-22T22-12-26Z' as const;
const ACCESS_KEY = 'absolute-update-test';
const SECRET_KEY = 'absolute-update-test-secret';

const command = async (
	args: string[],
	options: { allowFailure?: boolean } = {}
) => {
	const process = Bun.spawn(args, {
		stderr: 'pipe',
		stdout: 'pipe'
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		process.exited,
		new Response(process.stdout).text(),
		new Response(process.stderr).text()
	]);
	if (exitCode !== 0 && !options.allowFailure)
		throw new Error(
			`${args.join(' ')} failed (${exitCode}): ${stderr || stdout}`
		);

	return { exitCode, stderr, stdout };
};

const waitForMinio = async (endpoint: string) => {
	const deadline = Date.now() + 60_000;
	let lastError: unknown;
	while (Date.now() < deadline) {
		try {
			const response = await fetch(`${endpoint}/minio/health/ready`);
			if (response.ok) return;
		} catch (error) {
			lastError = error;
		}
		await Bun.sleep(250);
	}
	throw new Error('MinIO did not become ready.', { cause: lastError });
};

const availablePort = async () =>
	new Promise<number>((resolve, reject) => {
		const server = createServer();
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			if (!address || typeof address === 'string') {
				server.close();
				reject(new Error('Could not reserve a MinIO loopback port.'));

				return;
			}
			server.close((error) => {
				if (error) reject(error);
				else resolve(address.port);
			});
		});
	});

const withEnvironment = <T>(
	values: Record<string, string>,
	operation: () => T
) => {
	const previous = Object.fromEntries(
		Object.keys(values).map((name) => [name, process.env[name]])
	);
	Object.assign(process.env, values);

	return Promise.resolve(operation()).finally(() => {
		for (const [name, value] of Object.entries(previous)) {
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}
	});
};

durableTest(
	'generated S3 update storage is durable, multi-instance safe, and fails closed',
	async () => {
		const projectRoot = await mkdtemp(
			join(tmpdir(), 'absolute-update-minio-')
		);
		const container = `absolute-update-${randomUUID()}`;
		let client: S3Client | undefined;
		try {
			const port = await availablePort();
			await command([
				'docker',
				'run',
				'--detach',
				'--name',
				container,
				'--publish',
				`127.0.0.1:${port}:9000`,
				'--env',
				`MINIO_ROOT_USER=${ACCESS_KEY}`,
				'--env',
				`MINIO_ROOT_PASSWORD=${SECRET_KEY}`,
				MINIO_IMAGE,
				'server',
				'/data',
				'--address',
				':9000'
			]);
			const endpoint = `http://127.0.0.1:${port}`;
			await waitForMinio(endpoint);

			const s3Client = new S3Client({
				credentials: {
					accessKeyId: ACCESS_KEY,
					secretAccessKey: SECRET_KEY
				},
				endpoint,
				forcePathStyle: true,
				region: 'us-east-1'
			});
			client = s3Client;
			const bucket = `absolute-update-${randomUUID()}`;
			await s3Client.send(new CreateBucketCommand({ Bucket: bucket }));
			await symlink(
				join(process.cwd(), 'node_modules'),
				join(projectRoot, 'node_modules')
			);

			const { privateKey, publicKey } = generateKeyPairSync('ec', {
				namedCurve: 'prime256v1'
			});
			const encodedPublicKey = publicKey
				.export({ format: 'der', type: 'spki' })
				.toString('base64');
			for (const modulePath of [
				'mobile-a.update.ts',
				'mobile-b.update.ts',
				'mobile-restarted.update.ts',
				'mobile-invalid.update.ts',
				'mobile-missing-bucket.update.ts'
			])
				await writeAbsoluteMobileUpdateRegistry({
					modulePath,
					projectRoot,
					publicKeys: { main: encodedPublicKey },
					storage: 's3'
				});

			const buildRelease = async (label: string) => {
				const bundleDirectory = join(projectRoot, `bundle-${label}`);
				await mkdir(bundleDirectory);
				await Promise.all([
					writeFile(
						join(bundleDirectory, 'index.html'),
						`<main>${label}</main>`
					),
					writeFile(
						join(bundleDirectory, 'app.js'),
						`globalThis.release = ${JSON.stringify(label)};`
					)
				]);

				return buildAbsoluteMobileUpdate({
					appId: 'com.example.durable',
					bundleDirectory,
					channel: 'production',
					classification: 'bug-fix',
					createdAt: new Date(
						label === 'one'
							? '2026-09-07T12:00:00.000Z'
							: '2026-09-07T13:00:00.000Z'
					),
					keyId: 'main',
					outputDirectory: join(projectRoot, `update-${label}`),
					privateKey: privateKey.export({
						format: 'pem',
						type: 'pkcs8'
					}),
					runtimeFingerprint: 'a'.repeat(64)
				});
			};
			const [first, second] = await Promise.all([
				buildRelease('one'),
				buildRelease('two')
			]);
			const expoBundle = join(projectRoot, 'bundle-expo');
			await Promise.all([
				mkdir(join(expoBundle, '_absolute'), { recursive: true }),
				mkdir(join(expoBundle, '_expo/static/js/android'), {
					recursive: true
				}),
				mkdir(join(expoBundle, 'assets'), { recursive: true })
			]);
			await Promise.all([
				writeFile(
					join(expoBundle, '_expo/static/js/android/entry.hbc'),
					'expo-entry'
				),
				writeFile(join(expoBundle, 'assets/icon.png'), 'expo-icon'),
				writeFile(
					join(expoBundle, '_absolute/expo-update.json'),
					JSON.stringify({
						engine: 'expo',
						expoConfig: { name: 'Durable', slug: 'durable' },
						format: 1,
						platforms: {
							android: {
								assets: [
									{
										extension: 'png',
										path: 'assets/icon.png'
									}
								],
								launchAsset: {
									extension: 'hbc',
									path: '_expo/static/js/android/entry.hbc'
								}
							}
						},
						runtimeVersion: 'a'.repeat(64)
					})
				)
			]);
			const expoRelease = await buildAbsoluteMobileUpdate({
				appId: 'com.example.durable',
				bundleDirectory: expoBundle,
				channel: 'expo',
				classification: 'bug-fix',
				createdAt: new Date('2026-09-07T14:00:00.000Z'),
				keyId: 'main',
				outputDirectory: join(projectRoot, 'update-expo'),
				privateKey: privateKey.export({
					format: 'pem',
					type: 'pkcs8'
				}),
				runtimeFingerprint: 'a'.repeat(64)
			});
			const expoSigningKeyPair = generateKeyPair();
			const expoCertificate = convertCertificateToCertificatePEM(
				generateSelfSignedCodeSigningCertificate({
					commonName: 'AbsoluteJS Durable Test',
					keyPair: expoSigningKeyPair,
					validityNotAfter: new Date('2036-01-01T00:00:00.000Z'),
					validityNotBefore: new Date('2026-01-01T00:00:00.000Z')
				})
			);
			const expoPrivateKey =
				convertKeyPairToPEM(expoSigningKeyPair).privateKeyPEM;
			await mkdir(join(projectRoot, 'certs'));
			await writeFile(
				join(projectRoot, 'certs/expo-update.pem'),
				expoCertificate
			);
			const environment: Record<string, string> = {
				ABSOLUTE_EXPO_UPDATE_PRIVATE_KEY: expoPrivateKey,
				ABSOLUTE_MOBILE_UPDATE_S3_BUCKET: bucket,
				ABSOLUTE_MOBILE_UPDATE_S3_ENDPOINT: endpoint,
				ABSOLUTE_MOBILE_UPDATE_S3_FORCE_PATH_STYLE: '1',
				ABSOLUTE_MOBILE_UPDATE_S3_REGION: 'us-east-1',
				AWS_ACCESS_KEY_ID: ACCESS_KEY,
				AWS_SECRET_ACCESS_KEY: SECRET_KEY
			};

			await withEnvironment(environment, async () => {
				const configFor = (registry: string) =>
					normalizeAbsoluteMobileConfig(
						{
							appId: first.manifest.appId,
							appName: 'Durable',
							platforms: ['android'],
							server: {
								productionOrigin: 'https://api.example.com'
							},
							updates: {
								publicKeys: { main: encodedPublicKey },
								server: { registry }
							}
						},
						projectRoot
					);
				const firstModule = await loadAbsoluteMobileUpdateServerModule(
					projectRoot,
					'mobile-a.update.ts'
				);
				const secondModule = await loadAbsoluteMobileUpdateServerModule(
					projectRoot,
					'mobile-b.update.ts'
				);
				const secondServer =
					await createAbsoluteMobileUpdateServerPlugin(
						configFor('mobile-b.update.ts'),
						projectRoot,
						{ production: true }
					);

				await firstModule.registry.publishUpdate({
					manifest: first.manifest,
					releaseDirectory: first.outputDirectory,
					rollout: 1
				});
				const crossInstanceFile =
					await secondModule.registry.readUpdateFile({
						appId: first.manifest.appId,
						path: 'app.js',
						releaseId: first.manifest.releaseId
					});
				expect(crossInstanceFile?.file.sha256).toBe(
					first.manifest.files.find(({ path }) => path === 'app.js')
						?.sha256
				);
				const downloadedFiles: string[] = [];
				const mobileClient = createAbsoluteMobileUpdateClient({
					config: {
						appId: first.manifest.appId,
						channel: first.manifest.channel,
						currentReleaseId: 'embedded',
						installationId: '11111111-1111-4111-8111-111111111111',
						manifestUrl:
							'https://api.example.com/__absolute/mobile/updates/production/update.json',
						runtimeFingerprint: first.manifest.runtimeFingerprint
					},
					fetch: ((input: RequestInfo | URL, init?: RequestInit) =>
						secondServer.handle(
							new Request(input, init)
						)) as typeof fetch,
					store: {
						abort: async () => {},
						activate: async () => {},
						begin: async () => {},
						commit: async () => {},
						write: async ({ path }) =>
							void downloadedFiles.push(path)
					},
					verifier: {
						digest: async (bytes) =>
							createHash('sha256').update(bytes).digest('hex'),
						verify: async (manifest) => {
							verifyAbsoluteMobileUpdateSignature(
								manifest,
								publicKey.export({
									format: 'pem',
									type: 'spki'
								})
							);

							return true;
						}
					}
				});
				expect((await mobileClient.download()).kind).toBe('downloaded');
				expect(downloadedFiles.sort()).toEqual([
					'app.js',
					'index.html'
				]);

				await command(['docker', 'restart', container]);
				await waitForMinio(endpoint);
				const restartedServer =
					await createAbsoluteMobileUpdateServerPlugin(
						configFor('mobile-restarted.update.ts'),
						projectRoot,
						{ production: true }
					);
				const afterRestart = await restartedServer.handle(
					new Request(
						'https://api.example.com/__absolute/mobile/updates/production/update.json',
						{
							headers: {
								'x-absolute-mobile-app': first.manifest.appId,
								'x-absolute-mobile-channel':
									first.manifest.channel,
								'x-absolute-mobile-installation':
									'11111111-1111-4111-8111-111111111111',
								'x-absolute-mobile-release': 'embedded',
								'x-absolute-mobile-runtime':
									first.manifest.runtimeFingerprint
							}
						}
					)
				);
				expect(afterRestart.status).toBe(200);
				expect((await afterRestart.json()).releaseId).toBe(
					first.manifest.releaseId
				);

				const partialReleaseId = `amu_${'f'.repeat(64)}`;
				const appHash = createHash('sha256')
					.update(first.manifest.appId)
					.digest('hex');
				await s3Client.send(
					new PutObjectCommand({
						Body: 'incomplete',
						Bucket: bucket,
						Key: `absolutejs/mobile-updates/${appHash}/releases/${partialReleaseId}/files/index.html`
					})
				);
				const stillCurrent = await secondModule.registry.resolveUpdate({
					appId: first.manifest.appId,
					channel: first.manifest.channel,
					installationId: '11111111-1111-4111-8111-111111111111',
					runtimeFingerprint: first.manifest.runtimeFingerprint
				});
				expect(stillCurrent?.manifest.releaseId).toBe(
					first.manifest.releaseId
				);

				await secondModule.registry.publishUpdate({
					manifest: second.manifest,
					releaseDirectory: second.outputDirectory,
					rollout: 0.25
				});
				const mutations = await Promise.allSettled([
					firstModule.registry.promoteUpdate({
						appId: first.manifest.appId,
						channel: first.manifest.channel,
						releaseId: first.manifest.releaseId,
						rollout: 0.5
					}),
					secondModule.registry.promoteUpdate({
						appId: second.manifest.appId,
						channel: second.manifest.channel,
						releaseId: second.manifest.releaseId,
						rollout: 1
					})
				]);
				expect(
					mutations.every(({ status }) => status === 'fulfilled')
				).toBe(true);
				const resolutions = await Promise.all(
					[firstModule.registry, secondModule.registry].map(
						(registry) =>
							registry.resolveUpdate({
								appId: first.manifest.appId,
								channel: first.manifest.channel,
								installationId:
									'11111111-1111-4111-8111-111111111111',
								runtimeFingerprint:
									first.manifest.runtimeFingerprint
							})
					)
				);
				expect(resolutions[0]?.manifest.releaseId).toBe(
					resolutions[1]?.manifest.releaseId
				);
				const resolvedReleaseId = resolutions[0]?.manifest.releaseId;
				if (!resolvedReleaseId)
					throw new Error(
						'Concurrent update resolution returned no release.'
					);
				expect([
					first.manifest.releaseId,
					second.manifest.releaseId
				]).toContain(resolvedReleaseId);

				await secondModule.registry.rollbackUpdate({
					appId: first.manifest.appId,
					channel: first.manifest.channel,
					releaseId: first.manifest.releaseId
				});
				expect(
					(
						await firstModule.registry.resolveUpdate({
							appId: first.manifest.appId,
							channel: first.manifest.channel,
							installationId:
								'11111111-1111-4111-8111-111111111111',
							runtimeFingerprint:
								first.manifest.runtimeFingerprint
						})
					)?.manifest.releaseId
				).toBe(first.manifest.releaseId);
				await firstModule.registry.rollbackUpdate({
					appId: first.manifest.appId,
					channel: first.manifest.channel
				});
				const embeddedRollback = await restartedServer.handle(
					new Request(
						'https://api.example.com/__absolute/mobile/updates/production/update.json',
						{
							headers: {
								'x-absolute-mobile-app': first.manifest.appId,
								'x-absolute-mobile-channel':
									first.manifest.channel,
								'x-absolute-mobile-installation':
									'11111111-1111-4111-8111-111111111111',
								'x-absolute-mobile-release':
									first.manifest.releaseId,
								'x-absolute-mobile-runtime':
									first.manifest.runtimeFingerprint
							}
						}
					)
				);
				expect(embeddedRollback.status).toBe(204);

				await secondModule.registry.publishUpdate({
					manifest: expoRelease.manifest,
					releaseDirectory: expoRelease.outputDirectory,
					rollout: 1
				});
				const expoConfig = normalizeAbsoluteMobileConfig(
					{
						appId: expoRelease.manifest.appId,
						appName: 'Durable',
						engine: 'expo',
						server: {
							productionOrigin: 'https://api.example.com'
						},
						updates: {
							channel: 'expo',
							expoCodeSigning: {
								certificatePath: 'certs/expo-update.pem',
								keyId: 'main'
							},
							publicKeys: { main: encodedPublicKey },
							server: { registry: 'mobile-b.update.ts' }
						}
					},
					projectRoot
				);
				const expoServer = await createAbsoluteMobileUpdateServerPlugin(
					expoConfig,
					projectRoot,
					{ production: true }
				);
				const expoResponse = await expoServer.handle(
					new Request(
						'https://api.example.com/__absolute/mobile/updates/expo/update.json',
						{
							headers: {
								'expo-expect-signature':
									'sig, keyid="main", alg="rsa-v1_5-sha256"',
								'expo-extra-params':
									'absolute-installation="11111111-1111-4111-8111-111111111111"',
								'expo-platform': 'android',
								'expo-protocol-version': '1',
								'expo-runtime-version':
									expoRelease.manifest.runtimeFingerprint,
								'x-absolute-mobile-app':
									expoRelease.manifest.appId,
								'x-absolute-mobile-channel': 'expo'
							}
						}
					)
				);
				expect(expoResponse.status).toBe(200);
				const expoResponseBody = await expoResponse.text();
				const expoSignature = /sig="([A-Za-z0-9+/]+={0,2})"/u.exec(
					expoResponse.headers.get('expo-signature') ?? ''
				)?.[1];
				if (!expoSignature)
					throw new Error(
						'Expo response did not contain an RSA signature.'
					);
				expect(
					verify(
						'RSA-SHA256',
						Buffer.from(expoResponseBody),
						new X509Certificate(expoCertificate).publicKey,
						Buffer.from(expoSignature, 'base64')
					)
				).toBe(true);
				expect(
					JSON.parse(expoResponseBody).extra.absolutejs.releaseId
				).toBe(expoRelease.manifest.releaseId);

				const healthObjects = await s3Client.send(
					new ListObjectsV2Command({
						Bucket: bucket,
						Prefix: 'absolutejs/mobile-updates/_health/'
					})
				);
				expect(healthObjects.KeyCount ?? 0).toBe(0);

				process.env.AWS_SECRET_ACCESS_KEY = 'incorrect-secret';
				await expect(
					createAbsoluteMobileUpdateServerPlugin(
						configFor('mobile-invalid.update.ts'),
						projectRoot,
						{ production: true }
					)
				).rejects.toThrow('storage verification failed');
				process.env.AWS_SECRET_ACCESS_KEY = SECRET_KEY;
				process.env.ABSOLUTE_MOBILE_UPDATE_S3_BUCKET = `${bucket}-missing`;
				await expect(
					createAbsoluteMobileUpdateServerPlugin(
						configFor('mobile-missing-bucket.update.ts'),
						projectRoot,
						{ production: true }
					)
				).rejects.toThrow('storage verification failed');
				process.env.ABSOLUTE_MOBILE_UPDATE_S3_BUCKET = bucket;
			});
		} catch (error) {
			const logs = await command(['docker', 'logs', container], {
				allowFailure: true
			});
			if (logs.stdout || logs.stderr)
				console.error(
					'MinIO conformance logs:',
					logs.stdout,
					logs.stderr
				);
			throw error;
		} finally {
			client?.destroy();
			await command(['docker', 'rm', '--force', container], {
				allowFailure: true
			});
			await rm(projectRoot, { force: true, recursive: true });
		}
	},
	180_000
);
