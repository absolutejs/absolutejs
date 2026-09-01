/* eslint-disable @typescript-eslint/consistent-type-assertions, absolute/max-depth-extended, no-await-in-loop -- This file is a sequential, validated JSON-lines protocol state machine. */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { MobileConfig } from '../../types/build';
import { normalizeAbsoluteMobileConfig } from './config';
import {
	absoluteExpoExecutable,
	startAbsoluteExpoDevSession,
	type AbsoluteExpoDevPhaseTiming,
	type AbsoluteExpoDevSession
} from './expoDevController';
import {
	syncAbsoluteExpoWebAssets,
	writeAbsoluteExpoProject
} from './expoProject';
import { writeAbsoluteCapacitorConfig } from './capacitorProject';
import { applyAbsoluteNativeBackgroundSync } from './nativeBackgroundSync';
import { applyAbsoluteNativeDeepLinks } from './nativeDeepLinks';
import { applyAbsoluteNativeDeviceCapabilities } from './nativeDeviceCapabilities';
import { inspectAbsoluteMobileRelease } from './releaseDoctor';
import { buildAbsoluteIosRelease } from './iosRelease';
import {
	prepareAbsoluteIosDevProject,
	startAbsoluteIosDevSession,
	type AbsoluteIosCommandOptions,
	type AbsoluteIosDevPhaseTiming,
	type AbsoluteIosDevSession,
	type StartAbsoluteIosDevOptions
} from './iosSimulatorController';
import { startAbsoluteIosTcpRelay } from './iosPhysicalDeviceTransport';
import {
	ABSOLUTE_REMOTE_MAC_EVENT_PREFIX,
	ABSOLUTE_REMOTE_MAC_PROTOCOL_VERSION
} from './remoteMacWire';

type AgentRequest = {
	buildNumber?: number;
	command: 'build-number' | 'close' | 'rebuild' | 'relaunch' | 'screenshot';
	id: string;
	v: number;
};

const productionEnvironment = () => {
	const env: Record<string, string | undefined> = { ...process.env };
	delete env.ABSOLUTE_EXPO_DEVELOPMENT;
	delete env.ABSOLUTE_EXPO_DEVELOPMENT_CA_PATH;
	delete env.EXPO_PUBLIC_ABSOLUTE_DEV_ANDROID_ORIGIN;
	delete env.EXPO_PUBLIC_ABSOLUTE_DEV_IOS_ORIGIN;
	env.BABEL_ENV = 'production';
	env.NODE_ENV = 'production';

	return env;
};

const capacitorExecutable = async () => {
	const executable = join(process.cwd(), 'node_modules', '.bin', 'cap');
	if (!(await Bun.file(executable).exists()))
		throw new Error(
			"Remote iOS release requires the application's pinned Capacitor CLI dependency."
		);

	return executable;
};

const emit = (event: Record<string, unknown>) =>
	process.stdout.write(
		`${ABSOLUTE_REMOTE_MAC_EVENT_PREFIX}${JSON.stringify({
			...event,
			v: ABSOLUTE_REMOTE_MAC_PROTOCOL_VERSION
		})}\n`
	);

const errorMessage = (error: unknown) =>
	error instanceof Error ? error.message : String(error);

const valueAfter = (args: string[], flag: string) => {
	const index = args.indexOf(flag);

	return index < 0 ? undefined : args[index + 1];
};

const parsePort = (args: string[]) => {
	const port = Number(valueAfter(args, '--port'));
	if (!Number.isInteger(port) || port < 1 || port > 65_535)
		throw new TypeError('Remote iOS agent requires a valid --port.');

	return port;
};

const parseOptionalPort = (args: string[], flag: string) => {
	const value = valueAfter(args, flag);
	if (value === undefined) return undefined;
	const port = Number(value);
	if (!Number.isInteger(port) || port < 1 || port > 65_535)
		throw new TypeError(`Remote iOS agent requires a valid ${flag}.`);

	return port;
};

const parseMobileConfig = (args: string[]) => {
	const encoded = valueAfter(args, '--mobile-config');
	if (!encoded)
		throw new TypeError('Remote iOS agent requires --mobile-config.');
	const parsed = JSON.parse(
		Buffer.from(encoded, 'base64url').toString('utf8')
	);
	if (typeof parsed !== 'object' || parsed === null)
		throw new TypeError(
			'Remote iOS agent received an invalid mobile config.'
		);

	return parsed as MobileConfig;
};

const consumeLines = async (
	stream: ReadableStream<Uint8Array>,
	onLine: (line: string) => void
) => {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let buffered = '';
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			buffered += decoder.decode(value, { stream: true });
			const lines = buffered.split(/\r?\n/u);
			buffered = lines.pop() ?? '';
			lines.forEach(onLine);
		}
	} finally {
		reader.releaseLock();
	}
};

const run = async (
	command: string[],
	options: AbsoluteIosCommandOptions = {}
) => {
	const child = Bun.spawn(command, {
		cwd: options.cwd,
		env: options.env,
		signal: options.signal,
		stderr: 'pipe',
		stdin: 'ignore',
		stdout: 'pipe'
	});
	void consumeLines(child.stdout, (message) =>
		emit({ message, type: 'log' })
	);
	void consumeLines(child.stderr, (message) =>
		emit({ message, type: 'log' })
	);

	return child.exited;
};

const capture = (
	command: string[],
	options: AbsoluteIosCommandOptions = {}
) => {
	try {
		const result = Bun.spawnSync(command, {
			cwd: options.cwd,
			env: options.env,
			stderr: 'pipe',
			stdin: 'ignore',
			stdout: 'pipe'
		});

		return {
			exitCode: result.exitCode,
			stderr: result.stderr.toString(),
			stdout: result.stdout.toString()
		};
	} catch (error) {
		return { exitCode: 1, stderr: errorMessage(error), stdout: '' };
	}
};

const requestBuildNumber = async (buildIdentity: string) => {
	const id = crypto.randomUUID();
	emit({ buildIdentity, id, type: 'build-number-request' });
	const input = createInterface({ input: process.stdin, terminal: false });
	try {
		for await (const line of input) {
			const request = JSON.parse(line) as AgentRequest;
			if (
				request.v !== ABSOLUTE_REMOTE_MAC_PROTOCOL_VERSION ||
				request.id !== id ||
				request.command !== 'build-number' ||
				!Number.isSafeInteger(request.buildNumber) ||
				(request.buildNumber ?? 0) < 1
			)
				throw new TypeError(
					'Remote iOS agent received an invalid build number response.'
				);

			return request.buildNumber as number;
		}
	} finally {
		input.close();
	}
	throw new Error('Remote iOS build-number channel closed unexpectedly.');
};

const prepareAbsoluteRemoteIosRelease = async (
	config: ReturnType<typeof normalizeAbsoluteMobileConfig>
) => {
	if (config.engine === 'expo') {
		const generated = await writeAbsoluteExpoProject(config, {
			projectRoot: process.cwd()
		});
		await syncAbsoluteExpoWebAssets(config);
		const installExit = await run([process.execPath, 'install'], {
			cwd: generated.path
		});
		if (installExit !== 0)
			throw new Error(
				`Remote Expo dependency installation exited with status ${installExit}.`
			);
		const prebuildExit = await run(
			[
				await absoluteExpoExecutable(generated.path),
				'prebuild',
				'--clean',
				'--platform',
				'ios'
			],
			{ cwd: generated.path, env: productionEnvironment() }
		);
		if (prebuildExit !== 0)
			throw new Error(
				`Remote Expo prebuild exited with status ${prebuildExit}.`
			);
	} else {
		await writeAbsoluteCapacitorConfig(config, {
			projectRoot: process.cwd()
		});
		const syncExit = await run(
			[await capacitorExecutable(), 'sync', 'ios'],
			{ cwd: process.cwd() }
		);
		if (syncExit !== 0)
			throw new Error(
				`Remote Capacitor synchronization exited with status ${syncExit}.`
			);
		await applyAbsoluteNativeDeepLinks(config, ['ios']);
		await applyAbsoluteNativeDeviceCapabilities(process.cwd(), config, [
			'ios'
		]);
		await applyAbsoluteNativeBackgroundSync(process.cwd(), config, ['ios']);
	}
	const inspection = await inspectAbsoluteMobileRelease(
		{ ...config, platforms: ['ios'] },
		process.cwd()
	);
	if (!inspection.ready)
		throw new TypeError(
			'Remote iOS release validation failed before Xcode signing.'
		);
};

const runAbsoluteRemoteIosReleaseAgent = async (options: {
	args: string[];
	config: ReturnType<typeof normalizeAbsoluteMobileConfig>;
}) => {
	const prepareStarted = performance.now();
	await prepareAbsoluteRemoteIosRelease(options.config);
	emit({
		durationMs: performance.now() - prepareStarted,
		phase: 'remote-release-prepare',
		type: 'timing'
	});
	const buildStarted = performance.now();
	const release = await buildAbsoluteIosRelease({
		allowUnsigned: options.args.includes('--unsigned'),
		config: options.config,
		developmentTeam: valueAfter(options.args, '--development-team'),
		...(options.config.engine === 'expo'
			? { env: productionEnvironment() }
			: {}),
		...(options.args.includes('--request-build-number')
			? { prepareBuildNumber: requestBuildNumber }
			: {}),
		projectRoot: process.cwd(),
		run
	});
	emit({
		durationMs: performance.now() - buildStarted,
		phase: 'remote-release-xcode',
		type: 'timing'
	});
	emit({ metadata: release.metadata, type: 'release' });
};

const readyShape = (session: AbsoluteIosDevSession) => ({
	engine: 'capacitor',
	nativeCacheHit: session.nativeCacheHit,
	startedSimulator: session.startedSimulator,
	targetKind: session.targetKind,
	timings: session.timings,
	type: 'ready',
	udid: session.udid
});

const runAbsoluteRemoteExpoAgent = async (options: {
	args: string[];
	certificateAuthorityPath?: string;
	config: ReturnType<typeof normalizeAbsoluteMobileConfig>;
	deviceIdentifier?: string;
	port: number;
	relayPort?: number;
	serverHost?: string;
}) => {
	if (options.config.engine !== 'expo')
		throw new TypeError(
			'The remote Expo executor requires Expo configuration.'
		);
	const metroPort = parseOptionalPort(options.args, '--metro-port');
	if (metroPort === undefined)
		throw new TypeError('Remote Expo execution requires --metro-port.');
	const metroRelayPort = parseOptionalPort(
		options.args,
		'--metro-relay-port'
	);
	if (options.deviceIdentifier && metroRelayPort === undefined)
		throw new TypeError(
			'Remote physical Expo execution requires --metro-relay-port.'
		);
	const generated = await writeAbsoluteExpoProject(options.config, {
		projectRoot: process.cwd()
	});
	const dependencyCacheHit = await Bun.file(
		join(generated.path, 'node_modules', 'expo', 'package.json')
	).exists();
	if (!dependencyCacheHit) {
		emit({ state: 'preparing-native', type: 'state' });
		const installStarted = performance.now();
		const installExit = await run([process.execPath, 'install'], {
			cwd: generated.path
		});
		if (installExit !== 0)
			throw new Error(
				`Remote Expo dependency installation exited with status ${installExit}.`
			);
		emit({
			durationMs: performance.now() - installStarted,
			phase: 'preparing-native',
			type: 'timing'
		});
	}
	let serverRelay:
		| Awaited<ReturnType<typeof startAbsoluteIosTcpRelay>>
		| undefined;
	let metroRelay:
		| Awaited<ReturnType<typeof startAbsoluteIosTcpRelay>>
		| undefined;
	let session: AbsoluteExpoDevSession | undefined;
	try {
		serverRelay = options.deviceIdentifier
			? await startAbsoluteIosTcpRelay({
					listenPort: options.port,
					targetPort: options.relayPort ?? 0
				})
			: undefined;
		metroRelay = options.deviceIdentifier
			? await startAbsoluteIosTcpRelay({
					listenPort: metroPort,
					targetPort: metroRelayPort ?? 0
				})
			: undefined;
		session = await startAbsoluteExpoDevSession({
			certificateAuthorityPath: options.certificateAuthorityPath,
			config: options.config,
			executable: await absoluteExpoExecutable(generated.path),
			iosDevice: options.deviceIdentifier,
			iosOrigin: `${options.args.includes('--https') ? 'https' : 'http'}://${options.serverHost ?? 'localhost'}:${options.port}`,
			metro: 'external',
			metroHost: options.serverHost ?? 'localhost',
			metroPort,
			platforms: ['ios'],
			log: (message) => emit({ message, type: 'log' }),
			onPhaseTiming: (timing: AbsoluteExpoDevPhaseTiming) =>
				emit({ ...timing, type: 'timing' }),
			onStateChange: (state) => emit({ state, type: 'state' })
		});
		emit({
			engine: 'expo',
			nativeCacheHit: dependencyCacheHit,
			startedSimulator: false,
			targetKind: options.deviceIdentifier ? 'device' : 'simulator',
			timings: session.timings,
			type: 'ready',
			udid: options.deviceIdentifier ?? 'booted'
		});
		const input = createInterface({
			input: process.stdin,
			terminal: false
		});
		try {
			for await (const line of input) {
				let request: AgentRequest | undefined;
				try {
					request = JSON.parse(line) as AgentRequest;
					if (
						request.v !== ABSOLUTE_REMOTE_MAC_PROTOCOL_VERSION ||
						typeof request.id !== 'string' ||
						request.command !== 'close'
					)
						throw new Error('Invalid remote Expo request.');
					await session.close();
					emit({ id: request.id, ok: true, type: 'response' });

					return;
				} catch (error) {
					emit({
						error: errorMessage(error),
						id: request?.id ?? '',
						ok: false,
						type: 'response'
					});
				}
			}
		} finally {
			input.close();
		}
	} finally {
		await session?.close().catch(() => undefined);
		await Promise.all([
			serverRelay?.close().catch(() => undefined),
			metroRelay?.close().catch(() => undefined)
		]);
	}
};

export const runAbsoluteRemoteMacAgent = async (args: string[]) => {
	if (process.platform !== 'darwin')
		throw new Error(
			'The AbsoluteJS remote iOS agent can run only on macOS.'
		);
	const projectRoot = process.cwd();
	const config = normalizeAbsoluteMobileConfig(
		parseMobileConfig(args),
		projectRoot
	);
	if (args.includes('--release-ios')) {
		await runAbsoluteRemoteIosReleaseAgent({ args, config });

		return;
	}
	const port = parsePort(args);
	const deviceIdentifier = valueAfter(args, '--ios-device');
	const serverHost = valueAfter(args, '--server-host');
	const relayPort = parseOptionalPort(args, '--relay-port');
	if (deviceIdentifier && (!serverHost || relayPort === undefined))
		throw new TypeError(
			'Remote physical iOS development requires --server-host and --relay-port.'
		);
	const encodedCertificateAuthority = valueAfter(
		args,
		'--certificate-authority'
	);
	const certificateAuthorityPath = encodedCertificateAuthority
		? join(
				projectRoot,
				'.absolutejs',
				'mobile',
				`remote-dev-ca-${process.pid}.pem`
			)
		: undefined;
	if (certificateAuthorityPath && encodedCertificateAuthority) {
		await mkdir(join(projectRoot, '.absolutejs', 'mobile'), {
			recursive: true
		});
		await writeFile(
			certificateAuthorityPath,
			Buffer.from(encodedCertificateAuthority, 'base64url')
		);
	}
	if (config.engine === 'expo') {
		try {
			await runAbsoluteRemoteExpoAgent({
				args,
				certificateAuthorityPath,
				config,
				deviceIdentifier,
				port,
				relayPort,
				serverHost
			});
		} finally {
			if (certificateAuthorityPath)
				await rm(certificateAuthorityPath, { force: true });
		}

		return;
	}
	const project = await prepareAbsoluteIosDevProject(config, {
		createNativeProject: false,
		projectRoot,
		run,
		target: deviceIdentifier ? 'device' : 'simulator'
	});
	const relay = deviceIdentifier
		? await startAbsoluteIosTcpRelay({
				listenPort: port,
				targetPort: relayPort ?? 0
			})
		: undefined;
	const sessionOptions: StartAbsoluteIosDevOptions = {
		capture,
		certificateAuthorityPath,
		deviceIdentifier,
		https: args.includes('--https'),
		port,
		project,
		run,
		serverHost,
		log: (message: string) => emit({ message, type: 'log' }),
		nativeLog: (entry: unknown) => emit({ entry, type: 'native-log' }),
		onPhaseTiming: (timing: AbsoluteIosDevPhaseTiming) =>
			emit({ ...timing, type: 'timing' }),
		onStateChange: (state: unknown) => emit({ state, type: 'state' }),
		spawn: (command: string[], options: AbsoluteIosCommandOptions = {}) => {
			Bun.spawn(command, {
				cwd: options.cwd,
				env: options.env,
				signal: options.signal,
				stderr: 'ignore',
				stdin: 'ignore',
				stdout: 'ignore'
			});
		}
	};
	let session: AbsoluteIosDevSession;
	try {
		session = await startAbsoluteIosDevSession(sessionOptions);
	} catch (error) {
		await relay?.close().catch(() => undefined);
		if (certificateAuthorityPath)
			await rm(certificateAuthorityPath, { force: true });

		throw error;
	}
	emit(readyShape(session));
	const input = createInterface({ input: process.stdin, terminal: false });
	try {
		for await (const line of input) {
			let request: AgentRequest | undefined;
			try {
				request = JSON.parse(line) as AgentRequest;
				if (
					request.v !== ABSOLUTE_REMOTE_MAC_PROTOCOL_VERSION ||
					typeof request.id !== 'string'
				)
					throw new Error('Invalid remote Mac request.');
				let result: unknown;
				if (request.command === 'close') await session.close();
				else if (request.command === 'relaunch')
					await session.relaunch();
				else if (request.command === 'rebuild') {
					session = await session.rebuild();
					result = readyShape(session);
				} else if (request.command === 'screenshot') {
					const destination = join(
						'.absolutejs',
						'mobile',
						'remote-screenshot.png'
					);
					const path = await session.screenshot(destination);
					result = {
						data: (await readFile(path)).toString('base64')
					};
				} else throw new Error('Unknown remote Mac request.');
				emit({ id: request.id, ok: true, result, type: 'response' });
				if (request.command === 'close') return;
			} catch (error) {
				emit({
					error: errorMessage(error),
					id: request?.id ?? '',
					ok: false,
					type: 'response'
				});
			}
		}
	} finally {
		input.close();
		await session.close().catch(() => undefined);
		await relay?.close().catch(() => undefined);
		if (certificateAuthorityPath)
			await rm(certificateAuthorityPath, { force: true });
	}
};

export const runAbsoluteRemoteMacAgentSafely = async (args: string[]) => {
	try {
		await runAbsoluteRemoteMacAgent(args);
	} catch (error) {
		emit({ error: errorMessage(error), type: 'fatal' });
		process.exitCode = 1;
	}
};
