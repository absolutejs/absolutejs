import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	absoluteRemoteMacSshBase,
	ABSOLUTE_REMOTE_MAC_EVENT_PREFIX,
	absoluteRemoteProjectSyncCommands,
	createAbsoluteRemoteIosDevProject,
	inspectAbsoluteRemoteMacLanHost,
	listAbsoluteRemoteMacProfiles,
	materializeAbsoluteRemoteMacAgent,
	pairAbsoluteRemoteMac,
	removeAbsoluteRemoteMacProfile,
	startAbsoluteRemoteIosDevSession,
	validateAbsoluteSshDestination,
	type AbsoluteRemoteMacTransport
} from '../../../src/mobile/remoteMacProtocol';
import { normalizeAbsoluteMobileConfig } from '../../../src/mobile/config';

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

describe('remote Mac protocol', () => {
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
		expect(commands.remote.join(' ')).toContain('node_modules');
		expect(commands.remote.join(' ')).toContain('.absolutejs');
		expect(commands.remote.join(' ')).not.toContain(root);
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
		const prefix = JSON.stringify(ABSOLUTE_REMOTE_MAC_EVENT_PREFIX);
		const fakeAgent = `
const prefix = ${prefix};
const ready = { nativeCacheHit: true, startedSimulator: false, targetKind: "simulator", timings: { total: 12 }, type: "ready", udid: "REMOTE-UDID", v: 1 };
console.log(prefix + JSON.stringify(ready));
let buffered = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffered += chunk;
  const lines = buffered.split(/\\r?\\n/);
  buffered = lines.pop() || "";
  for (const line of lines) {
    const request = JSON.parse(line);
    const result = request.command === "rebuild" ? ready : undefined;
    console.log(prefix + JSON.stringify({ id: request.id, ok: true, result, type: "response", v: 1 }));
    if (request.command === "close") process.exit(0);
  }
});
setInterval(() => {}, 1000);`;
		const session = await startAbsoluteRemoteIosDevSession({
			certificateAuthorityPath,
			https: true,
			port: 43123,
			project,
			transport: {
				capture: async () => ({ exitCode: 0, stderr: '', stdout: '' }),
				spawn: (command, options) => {
					spawned.push(command);

					return Bun.spawn([process.execPath, '-e', fakeAgent], {
						signal: options.signal,
						stderr: 'pipe',
						stdin: 'pipe',
						stdout: 'pipe'
					}) as ReturnType<AbsoluteRemoteMacTransport['spawn']>;
				}
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
				capture: async () => ({ exitCode: 0, stderr: '', stdout: '' }),
				spawn: (command, options) => {
					spawned.push(command);

					return Bun.spawn([process.execPath, '-e', fakeAgent], {
						signal: options.signal,
						stderr: 'pipe',
						stdin: 'pipe',
						stdout: 'pipe'
					}) as ReturnType<AbsoluteRemoteMacTransport['spawn']>;
				}
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
	});
});
