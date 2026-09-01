import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	absoluteRemoteMacSshBase,
	ABSOLUTE_REMOTE_MAC_EVENT_PREFIX,
	absoluteRemoteProjectSyncCommands,
	absoluteRemoteReleaseInputSyncCommands,
	buildAbsoluteRemoteIosRelease,
	captureAbsoluteRemoteMacCommand,
	createAbsoluteRemoteIosDevProject,
	inspectAbsoluteRemoteMacLanHost,
	listAbsoluteRemoteMacProfiles,
	materializeAbsoluteRemoteMacAgent,
	pairAbsoluteRemoteMac,
	removeAbsoluteRemoteMacProfile,
	startAbsoluteRemoteIosDevSession,
	startAbsoluteRemoteExpoIosDevSession,
	createAbsoluteRemoteExpoIosDevProject,
	ABSOLUTE_REMOTE_MAC_PROTOCOL_VERSION,
	validateAbsoluteSshDestination,
	type AbsoluteRemoteMacTransport
} from '../../../src/mobile/remoteMacProtocol';
import { normalizeAbsoluteMobileConfig } from '../../../src/mobile/config';
import type { AbsoluteIosReleaseMetadata } from '../../../src/mobile/iosRelease';

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { force: true, recursive: true }))
	);
});

const temporaryRoot = async () => {
	const root = await mkdtemp(join(tmpdir(), 'absolute-remote-mac-'));
	temporaryDirectories.push(root);

	return root;
};

type FakeProtocolRequest = {
	buildNumber?: number;
	command: string;
	id: string;
	v: number;
};

type FakeReadyEvent = {
	engine: 'capacitor' | 'expo';
	nativeCacheHit: boolean;
	startedSimulator: boolean;
	targetKind: 'simulator';
	timings: Record<string, number>;
	type: 'ready';
	udid: string;
};

type FakeProtocolProcessOptions = {
	initial: Record<string, unknown>[];
	onRequest: (
		request: FakeProtocolRequest,
		controls: {
			emit: (event: Record<string, unknown>) => void;
			exit: (code?: number) => void;
		}
	) => void;
};

const fakeProtocolProcess = (options: FakeProtocolProcessOptions) => {
	let stdoutController!: ReadableStreamDefaultController<Uint8Array>;
	let stderrController!: ReadableStreamDefaultController<Uint8Array>;
	let resolveExit!: (code: number) => void;
	let exited = false;
	let buffered = '';
	const encoder = new TextEncoder();
	const stdout = new ReadableStream<Uint8Array>({
		start: (controller) => {
			stdoutController = controller;
		}
	});
	const stderr = new ReadableStream<Uint8Array>({
		start: (controller) => {
			stderrController = controller;
		}
	});
	const exitedPromise = new Promise<number>((resolve) => {
		resolveExit = resolve;
	});
	const emit = (event: Record<string, unknown>) =>
		stdoutController.enqueue(
			encoder.encode(
				`${ABSOLUTE_REMOTE_MAC_EVENT_PREFIX}${JSON.stringify({ ...event, v: ABSOLUTE_REMOTE_MAC_PROTOCOL_VERSION })}\n`
			)
		);
	const exit = (code = 0) => {
		if (exited) return;
		exited = true;
		stdoutController.close();
		stderrController.close();
		resolveExit(code);
	};
	options.initial.forEach(emit);
	const stdin = {
		end: () => 0,
		flush: () => 0,
		ref: () => undefined,
		start: () => undefined,
		unref: () => undefined,
		write: (chunk: string | ArrayBufferView | ArrayBuffer) => {
			buffered +=
				typeof chunk === 'string'
					? chunk
					: new TextDecoder().decode(chunk as BufferSource);
			const lines = buffered.split(/\r?\n/u);
			buffered = lines.pop() ?? '';
			lines.filter(Boolean).forEach((line) =>
				options.onRequest(JSON.parse(line) as FakeProtocolRequest, {
					emit,
					exit
				})
			);

			return typeof chunk === 'string'
				? Buffer.byteLength(chunk)
				: chunk.byteLength;
		}
	} as ReturnType<AbsoluteRemoteMacTransport['spawn']>['stdin'];

	return {
		exited: exitedPromise,
		stderr,
		stdin,
		stdout,
		kill: () => exit(143)
	} satisfies ReturnType<AbsoluteRemoteMacTransport['spawn']>;
};

describe('remote Mac protocol', () => {
	test('quotes every one-shot remote command argument', async () => {
		let captured: string[] = [];
		await captureAbsoluteRemoteMacCommand(
			{
				bunPath: '/Users/builder/.bun/bin/bun',
				createdAt: '2026-08-28T00:00:00.000Z',
				destination: 'builder@mac',
				name: 'mac',
				workspaceRoot: '/Users/builder/.absolutejs/remote-ios',
				xcodeVersion: 'Xcode 26.4'
			},
			['/usr/bin/xcrun', 'devicectl', 'name with spaces; touch /tmp/no'],
			{
				capture: async (command) => {
					captured = command;

					return { exitCode: 0, stderr: '', stdout: '' };
				}
			}
		);
		expect(captured.at(-2)).toBe('/bin/sh -lc');
		expect(captured.at(-1)).toContain("'name with spaces; touch /tmp/no'");
	});

	test('discovers the Remote Mac LAN address without persisting it', async () => {
		const commands: string[][] = [];
		const host = await inspectAbsoluteRemoteMacLanHost(
			{
				bunPath: '/Users/builder/.bun/bin/bun',
				createdAt: '2026-08-28T00:00:00.000Z',
				destination: 'builder@mac',
				name: 'mac',
				workspaceRoot: '/Users/builder/.absolutejs/remote-ios',
				xcodeVersion: 'Xcode 26.4'
			},
			{
				capture: async (command) => {
					commands.push(command);

					return {
						exitCode: 0,
						stderr: '',
						stdout: '192.168.50.8\n'
					};
				}
			}
		);
		expect(host).toBe('192.168.50.8');
		expect(commands[0]?.join(' ')).toContain('ipconfig getifaddr');
	});

	test('pairs a verified Mac without storing credentials', async () => {
		const root = await temporaryRoot();
		const profilePath = join(root, 'profiles.json');
		const commands: string[][] = [];
		const profile = await pairAbsoluteRemoteMac({
			destination: 'builder@mac.example',
			name: 'Team-Mac',
			port: 2222,
			profilePath,
			transport: {
				capture: async (command) => {
					commands.push(command);

					return {
						exitCode: 0,
						stderr: '',
						stdout: 'Darwin\n/Users/builder\n/Users/builder/.bun/bin/bun\nXcode 26.4 Build version 17F1\n'
					};
				}
			}
		});
		expect(profile).toMatchObject({
			destination: 'builder@mac.example',
			name: 'team-mac',
			port: 2222,
			workspaceRoot: '/Users/builder/.absolutejs/remote-ios'
		});
		expect(commands[0]).toContain('StrictHostKeyChecking=accept-new');
		const source = await readFile(profilePath, 'utf8');
		expect(source).not.toContain('password');
		expect((await stat(profilePath)).mode & 0o777).toBe(0o600);
		expect(await listAbsoluteRemoteMacProfiles(profilePath)).toMatchObject({
			defaultProfile: 'team-mac',
			profiles: [{ name: 'team-mac' }]
		});
		expect(
			await removeAbsoluteRemoteMacProfile('team-mac', profilePath)
		).toBe(true);
		expect(
			(await listAbsoluteRemoteMacProfiles(profilePath)).profiles
		).toEqual([]);
	});

	test('rejects SSH option and shell injection', () => {
		expect(() =>
			validateAbsoluteSshDestination('-oProxyCommand=bad')
		).toThrow();
		expect(() =>
			validateAbsoluteSshDestination('mac; touch /tmp/bad')
		).toThrow();
		expect(
			absoluteRemoteMacSshBase({
				destination: 'work-mac',
				port: 2200
			})
		).toEqual([
			'ssh',
			'-o',
			'BatchMode=yes',
			'-o',
			'ConnectTimeout=10',
			'-o',
			'ServerAliveInterval=15',
			'-o',
			'ServerAliveCountMax=3',
			'-o',
			'StrictHostKeyChecking=yes',
			'-p',
			'2200',
			'work-mac'
		]);
	});

	test('rejects unsafe manually edited profiles and a root workspace', async () => {
		const root = await temporaryRoot();
		const profilePath = join(root, 'profiles.json');
		await writeFile(
			profilePath,
			JSON.stringify({
				defaultProfile: 'mac',
				format: 1,
				profiles: {
					mac: {
						bunPath: '/Users/builder/.bun/bin/bun',
						createdAt: '2026-08-23T00:00:00.000Z',
						destination: '-oProxyCommand=bad',
						name: 'mac',
						workspaceRoot: '/Users/builder/.absolutejs',
						xcodeVersion: 'Xcode 26.4'
					}
				}
			})
		);
		await expect(
			listAbsoluteRemoteMacProfiles(profilePath)
		).rejects.toThrow();
		await expect(
			pairAbsoluteRemoteMac({
				destination: 'builder@mac.example',
				name: 'mac',
				profilePath,
				transport: {
					capture: async () => ({
						exitCode: 0,
						stderr: '',
						stdout: 'Darwin\n/Users/builder\n/Users/builder/.bun/bin/bun\nXcode 26.4\n'
					})
				},
				workspaceRoot: '/'
			})
		).rejects.toThrow('absolute macOS path');
	});

	test('uses an isolated project identity and an atomic cache-preserving sync', async () => {
		const root = await temporaryRoot();
		const config = normalizeAbsoluteMobileConfig(
			{
				appId: 'com.example.remote',
				appName: 'Remote',
				platforms: ['ios'],
				server: { productionOrigin: 'https://example.com' }
			},
			root
		);
		const project = createAbsoluteRemoteIosDevProject(config, root, {
			bunPath: '/Users/builder/.bun/bin/bun',
			createdAt: '2026-08-23T00:00:00.000Z',
			destination: 'builder@mac',
			name: 'mac',
			workspaceRoot: '/Users/builder/.absolutejs/remote-ios',
			xcodeVersion: 'Xcode 26.4'
		});
		expect(project.remoteProjectRoot).toMatch(
			/^\/Users\/builder\/\.absolutejs\/remote-ios\/projects\/[a-f0-9]{20}\/current$/u
		);
		expect(project.remoteProjectRoot).not.toContain('\\');
		const commands = absoluteRemoteProjectSyncCommands(project);
		expect(commands.tar).toContain('--exclude=node_modules');
		expect(commands.tar).toContain('--exclude=.absolutejs');
		expect(commands.tar).toContain('--exclude=.env');
		expect(commands.tar).toContain('--exclude=*.p8');
		expect(commands.tar).toContain('--exclude=*.mobileprovision');
		expect(commands.remote.join(' ')).toContain('node_modules');
		expect(commands.remote.join(' ')).toContain('.absolutejs');
		expect(commands.remote.join(' ')).not.toContain(root);
		const releaseCommands = absoluteRemoteReleaseInputSyncCommands(project);
		expect(releaseCommands.tar).toContain(config.bundleDirectory);
		expect(releaseCommands.remote.join(' ')).toContain(
			'.absolutejs/mobile/web'
		);
		expect(releaseCommands.remote.join(' ')).not.toContain(root);
	});

	test('builds a self-contained content-addressable agent artifact', async () => {
		const root = await temporaryRoot();
		const artifact = await materializeAbsoluteRemoteMacAgent(root);
		const source = await readFile(artifact.path, 'utf8');
		expect(artifact.sha256).toMatch(/^[a-f0-9]{64}$/u);
		expect(artifact.bytes).toBeGreaterThan(10_000);
		expect(source).not.toContain('./node_modules/.bin/absolute');
		expect(source).not.toContain('pairAbsoluteRemoteMac');
	});

	test('allocates build numbers locally and retrieves remote releases through the agent protocol', async () => {
		const root = await temporaryRoot();
		const config = normalizeAbsoluteMobileConfig(
			{
				appId: 'com.example.remote.release',
				appName: 'Remote Release',
				ios: { version: '2.1.0' },
				platforms: ['ios'],
				server: { productionOrigin: 'https://example.com' }
			},
			root
		);
		const project = createAbsoluteRemoteIosDevProject(config, root, {
			bunPath: '/Users/builder/.bun/bin/bun',
			createdAt: '2026-09-01T00:00:00.000Z',
			destination: 'builder@mac',
			name: 'mac',
			workspaceRoot: '/Users/builder/.absolutejs/remote-ios',
			xcodeVersion: 'Xcode 26.4'
		});
		const sha256 = 'a'.repeat(64);
		const buildIdentity = 'b'.repeat(64);
		const metadata: AbsoluteIosReleaseMetadata = {
			appBuild: 'ambuild_remote',
			appId: config.appId,
			artifact: 'App.ipa' as const,
			buildNumber: 23,
			bytes: 123,
			engine: 'capacitor' as const,
			format: 1 as const,
			marketingVersion: '2.1.0',
			platform: 'ios' as const,
			releaseId: `amobile_ios_${sha256}`,
			runtime: '1',
			sha256,
			signed: true,
			type: 'ipa' as const
		};
		const identities: string[] = [];
		const phases: string[] = [];
		const release = await buildAbsoluteRemoteIosRelease({
			project,
			transport: {
				spawn: () =>
					fakeProtocolProcess({
						initial: [
							{
								buildIdentity,
								id: 'build-number',
								type: 'build-number-request'
							}
						],
						onRequest: (request, { emit, exit }) => {
							if (
								request.command !== 'build-number' ||
								request.id !== 'build-number' ||
								request.buildNumber !== 23
							) {
								exit(2);

								return;
							}
							emit({ metadata, type: 'release' });
							exit();
						}
					})
			},
			installAgent: async () => ({ remotePath: '/remote/agent.js' }),
			onPhaseTiming: ({ phase }) => phases.push(phase),
			prepareBuildNumber: async (identity) => {
				identities.push(identity);

				return 23;
			},
			retrieveRelease: async (_project, received) => ({
				artifactPath: join(root, 'App.ipa'),
				metadata: received,
				releaseRoot: join(root, received.releaseId)
			}),
			syncProject: async () => undefined,
			syncReleaseInputs: async () => undefined
		});
		expect(identities).toEqual([buildIdentity]);
		expect(release.metadata).toEqual(metadata);
		expect(phases).toContain('remote-release-sync');
		expect(phases).toContain('remote-release-download');
	});

	test('drives a remote session over the versioned event stream and reverse tunnel', async () => {
		const root = await temporaryRoot();
		const config = normalizeAbsoluteMobileConfig(
			{
				appId: 'com.example.protocol',
				appName: 'Protocol',
				platforms: ['ios'],
				server: { productionOrigin: 'https://example.com' }
			},
			root
		);
		const project = createAbsoluteRemoteIosDevProject(config, root, {
			bunPath: '/Users/builder/.bun/bin/bun',
			createdAt: '2026-08-23T00:00:00.000Z',
			destination: 'builder@mac',
			name: 'mac',
			workspaceRoot: '/Users/builder/.absolutejs/remote-ios',
			xcodeVersion: 'Xcode 26.4'
		});
		const certificateAuthorityPath = join(root, 'dev-ca.pem');
		await writeFile(certificateAuthorityPath, 'PUBLIC DEVELOPMENT CA');
		const spawned: string[][] = [];
		let syncs = 0;
		const ready: FakeReadyEvent = {
			engine: 'capacitor',
			nativeCacheHit: true,
			startedSimulator: false,
			targetKind: 'simulator',
			timings: { total: 12 },
			type: 'ready',
			udid: 'REMOTE-UDID'
		};
		const spawnAgent = (command: string[]) => {
			spawned.push(command);

			return fakeProtocolProcess({
				initial: [ready],
				onRequest: (request, { emit, exit }) => {
					emit({
						id: request.id,
						ok: true,
						...(request.command === 'rebuild'
							? { result: ready }
							: {}),
						type: 'response'
					});
					if (request.command === 'close') exit();
				}
			});
		};
		const session = await startAbsoluteRemoteIosDevSession({
			certificateAuthorityPath,
			https: true,
			port: 43123,
			project,
			transport: {
				spawn: spawnAgent,
				capture: async () => ({ exitCode: 0, stderr: '', stdout: '' })
			},
			installAgent: async () => ({ remotePath: '/remote/agent.js' }),
			syncProject: async () => {
				syncs++;
			}
		});
		expect(session.udid).toBe('REMOTE-UDID');
		expect(session.nativeCacheHit).toBe(true);
		expect(session.timings['remote-agent']).toBeNumber();
		expect(session.timings['remote-connect']).toBeNumber();
		expect(session.timings['remote-sync']).toBeNumber();
		expect(syncs).toBe(1);
		expect(spawned[0]).toContain('43123:127.0.0.1:43123');
		expect(spawned[0]?.join(' ')).toContain('/remote/agent.js');
		expect(spawned[0]?.join(' ')).toContain('--certificate-authority');
		expect(spawned[0]?.join(' ')).toContain('--https');
		expect(spawned[0]?.join(' ')).not.toContain('PUBLIC DEVELOPMENT CA');
		expect(spawned[0]?.join(' ')).not.toContain(
			'node_modules/.bin/absolute'
		);
		await session.relaunch();
		const rebuilt = await session.rebuild();
		expect(syncs).toBe(2);
		expect(rebuilt.udid).toBe('REMOTE-UDID');
		await rebuilt.close();

		const physical = await startAbsoluteRemoteIosDevSession({
			certificateAuthorityPath,
			deviceIdentifier: 'PHONE-UDID',
			https: true,
			port: 43124,
			project,
			serverHost: '192.168.50.8',
			transport: {
				spawn: spawnAgent,
				capture: async () => ({ exitCode: 0, stderr: '', stdout: '' })
			},
			installAgent: async () => ({ remotePath: '/remote/agent.js' }),
			syncProject: async () => undefined
		});
		const physicalCommand = spawned.at(-1) ?? [];
		expect(physicalCommand).toContain('127.0.0.1:59508:127.0.0.1:43124');
		expect(physicalCommand.join(' ')).toContain('--ios-device');
		expect(physicalCommand.join(' ')).toContain('PHONE-UDID');
		expect(physicalCommand.join(' ')).toContain('--server-host');
		expect(physicalCommand.join(' ')).toContain('192.168.50.8');
		expect(physicalCommand.join(' ')).toContain('--relay-port');
		await physical.close();
	}, 15_000);

	test('drives Expo iOS through the shared agent with Bun and Metro tunnels', async () => {
		const root = await temporaryRoot();
		const config = normalizeAbsoluteMobileConfig(
			{
				appId: 'com.example.expo.remote',
				appName: 'Remote Expo',
				engine: 'expo',
				platforms: ['ios'],
				server: { productionOrigin: 'https://example.com' }
			},
			root
		);
		const project = createAbsoluteRemoteExpoIosDevProject(config, root, {
			bunPath: '/Users/builder/.bun/bin/bun',
			createdAt: '2026-08-30T00:00:00.000Z',
			destination: 'builder@mac',
			name: 'mac',
			workspaceRoot: '/Users/builder/.absolutejs/remote-ios',
			xcodeVersion: 'Xcode 26.4'
		});
		const spawned: string[][] = [];
		const ready: FakeReadyEvent = {
			engine: 'expo',
			nativeCacheHit: true,
			startedSimulator: false,
			targetKind: 'simulator',
			timings: { 'building-ios': 15 },
			type: 'ready',
			udid: 'booted'
		};
		const spawnAgent = (command: string[]) => {
			spawned.push(command);

			return fakeProtocolProcess({
				initial: [ready],
				onRequest: (request, { emit, exit }) => {
					emit({ id: request.id, ok: true, type: 'response' });
					if (request.command === 'close') exit();
				}
			});
		};
		const session = await startAbsoluteRemoteExpoIosDevSession({
			metroPort: 48123,
			port: 43123,
			project,
			transport: {
				spawn: spawnAgent,
				capture: async () => ({ exitCode: 0, stderr: '', stdout: '' })
			},
			installAgent: async () => ({ remotePath: '/remote/agent.js' }),
			syncProject: async () => undefined
		});
		expect(session.platforms).toEqual(['ios']);
		expect(session.metroPort).toBe(48123);
		expect(spawned[0]).toContain('43123:127.0.0.1:43123');
		expect(spawned[0]).toContain('48123:127.0.0.1:48123');
		expect(spawned[0]?.join(' ')).toContain('--metro-port');
		await session.close();

		const physical = await startAbsoluteRemoteExpoIosDevSession({
			deviceIdentifier: 'PHONE-UDID',
			metroPort: 48124,
			port: 43124,
			project,
			serverHost: '192.168.50.8',
			transport: {
				spawn: spawnAgent,
				capture: async () => ({ exitCode: 0, stderr: '', stdout: '' })
			},
			installAgent: async () => ({ remotePath: '/remote/agent.js' }),
			syncProject: async () => undefined
		});
		const physicalCommand = spawned.at(-1) ?? [];
		expect(physicalCommand).toContain('127.0.0.1:59508:127.0.0.1:43124');
		expect(physicalCommand).toContain('127.0.0.1:64508:127.0.0.1:48124');
		expect(physicalCommand.join(' ')).toContain('--metro-relay-port');
		await physical.close();
	}, 15_000);
});
