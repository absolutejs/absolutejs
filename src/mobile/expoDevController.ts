import { spawn, type ChildProcess } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import type { NormalizedAbsoluteMobileConfig } from './config';
import {
	startAbsoluteIosCaEnrollmentServer,
	type AbsoluteIosCaEnrollmentServer
} from './iosPhysicalDeviceTransport';

export type AbsoluteExpoDevPlatform = 'android' | 'ios';
export type AbsoluteExpoDevState =
	| 'building-android'
	| 'building-ios'
	| 'closed'
	| 'enrolling-trust'
	| 'failed'
	| 'preparing-native'
	| 'ready'
	| 'starting-metro';

export type AbsoluteExpoDevCommand = {
	args: string[];
	env: Record<string, string>;
	platform?: AbsoluteExpoDevPlatform;
	role: 'metro' | 'native-build' | 'native-prepare';
};

export type AbsoluteExpoDevPlan = {
	commands: AbsoluteExpoDevCommand[];
	metroPort: number;
	project: string;
};

export type PlanAbsoluteExpoDevOptions = {
	androidDevice?: string;
	androidOrigin?: string;
	certificateAuthorityPath?: string;
	iosDevice?: string;
	iosOrigin?: string;
	metroPort: number;
	platforms: AbsoluteExpoDevPlatform[];
};

export type StartAbsoluteExpoDevOptions = PlanAbsoluteExpoDevOptions & {
	config: NormalizedAbsoluteMobileConfig;
	executable?: string;
	log?: (message: string) => void;
	onPhaseTiming?: (timing: {
		durationMs: number;
		phase: AbsoluteExpoDevState;
	}) => void;
	onStateChange?: (state: AbsoluteExpoDevState) => void;
	signal?: AbortSignal;
	spawnProcess?: typeof spawn;
	startCaEnrollmentServer?: typeof startAbsoluteIosCaEnrollmentServer;
};

export type AbsoluteExpoDevSession = {
	close: () => Promise<void>;
	metroPort: number;
	platforms: AbsoluteExpoDevPlatform[];
	timings: Partial<Record<AbsoluteExpoDevState, number>>;
};

const METRO_READY_TIMEOUT_MS = 60_000;
const PROCESS_CLOSE_TIMEOUT_MS = 2_000;

const commandEnvironment = (options: PlanAbsoluteExpoDevOptions) => ({
	ABSOLUTE_EXPO_DEVELOPMENT: '1',
	...(options.certificateAuthorityPath
		? {
				ABSOLUTE_EXPO_DEVELOPMENT_CA_PATH:
					options.certificateAuthorityPath
			}
		: {}),
	...(options.androidOrigin
		? { EXPO_PUBLIC_ABSOLUTE_DEV_ANDROID_ORIGIN: options.androidOrigin }
		: {}),
	...(options.iosOrigin
		? { EXPO_PUBLIC_ABSOLUTE_DEV_IOS_ORIGIN: options.iosOrigin }
		: {})
});

export const absoluteExpoExecutable = async (project: string) => {
	const executable = join(project, 'node_modules', '.bin', 'expo');
	try {
		await access(executable);

		return executable;
	} catch {
		throw new TypeError(
			'Expo dependencies are not installed in the generated shell. Run `absolute mobile init --yes`.'
		);
	}
};

export const planAbsoluteExpoDevSession = (
	config: NormalizedAbsoluteMobileConfig,
	options: PlanAbsoluteExpoDevOptions
): AbsoluteExpoDevPlan => {
	if (config.engine !== 'expo')
		throw new TypeError('The Expo development controller requires Expo.');
	if (options.platforms.length === 0)
		throw new TypeError(
			'Expo development requires a local target platform.'
		);
	const secureOrigin = [options.androidOrigin, options.iosOrigin].some(
		(origin) => origin && new URL(origin).protocol === 'https:'
	);
	if (secureOrigin && !options.certificateAuthorityPath)
		throw new TypeError(
			'Expo HTTPS development requires the AbsoluteJS development CA certificate.'
		);
	const env = commandEnvironment(options);
	const metro: AbsoluteExpoDevCommand = {
		args: [
			'start',
			'--dev-client',
			'--host',
			'localhost',
			'--port',
			String(options.metroPort)
		],
		env,
		role: 'metro'
	};
	const prepare: AbsoluteExpoDevCommand = {
		args: [
			'prebuild',
			'--clean',
			'--no-install',
			'--platform',
			options.platforms.length === 2
				? 'all'
				: (options.platforms[0] ?? 'all')
		],
		env,
		role: 'native-prepare'
	};
	const native = options.platforms.map((platform) => {
		const device =
			platform === 'android' ? options.androidDevice : options.iosDevice;
		const command: AbsoluteExpoDevCommand = {
			args: [
				`run:${platform}`,
				'--no-bundler',
				'--port',
				String(options.metroPort),
				...(device ? ['--device', device] : [])
			],
			env,
			platform,
			role: 'native-build'
		};

		return command;
	});

	return {
		commands: [prepare, metro, ...native],
		metroPort: options.metroPort,
		project: config.nativeProjectDirectory
	};
};

const abortError = () =>
	new DOMException('Expo development aborted.', 'AbortError');

const forwardLines = (
	process: ChildProcess,
	onLine: (line: string) => void
) => {
	const attach = (stream: NodeJS.ReadableStream | null) => {
		if (!stream) return;
		let buffered = '';
		stream.on('data', (chunk: Buffer) => {
			buffered += chunk.toString('utf8');
			let newline = buffered.indexOf('\n');
			while (newline >= 0) {
				onLine(buffered.slice(0, newline).replace(/\r$/u, ''));
				buffered = buffered.slice(newline + 1);
				newline = buffered.indexOf('\n');
			}
		});
		stream.on('end', () => {
			if (buffered) onLine(buffered);
		});
	};
	attach(process.stdout);
	attach(process.stderr);
};

const stopProcess = async (process: ChildProcess) => {
	if (process.exitCode !== null || process.killed) return;
	process.kill('SIGTERM');
	await Promise.race([
		new Promise<void>((resolve) => process.once('exit', () => resolve())),
		new Promise<void>((resolve) =>
			setTimeout(resolve, PROCESS_CLOSE_TIMEOUT_MS)
		)
	]);
	if (process.exitCode === null) process.kill('SIGKILL');
};

const waitForExit = (process: ChildProcess) =>
	new Promise<number>((resolve) => {
		if (process.exitCode !== null) {
			resolve(process.exitCode);

			return;
		}
		process.once('exit', (code) => resolve(code ?? 1));
	});

type ExpoUtilityCommandOptions = {
	cwd: string;
	signal?: AbortSignal;
	log: (message: string) => void;
};

const runUtilityCommand = async (
	run: typeof spawn,
	command: string,
	args: string[],
	options: ExpoUtilityCommandOptions
) => {
	const child = run(command, args, {
		cwd: options.cwd,
		env: process.env,
		stdio: ['ignore', 'pipe', 'pipe']
	});
	forwardLines(child, options.log);
	const abort = () => void stopProcess(child);
	options.signal?.addEventListener('abort', abort, { once: true });
	const exitCode = await waitForExit(child);
	options.signal?.removeEventListener('abort', abort);
	if (options.signal?.aborted) throw abortError();

	return exitCode;
};

export const startAbsoluteExpoDevSession = async (
	options: StartAbsoluteExpoDevOptions
) => {
	const plan = planAbsoluteExpoDevSession(options.config, options);
	const executable =
		options.executable ?? (await absoluteExpoExecutable(plan.project));
	const run = options.spawnProcess ?? spawn;
	const log = options.log ?? (() => undefined);
	const timings: Partial<Record<AbsoluteExpoDevState, number>> = {};
	let caEnrollmentServer: AbsoluteIosCaEnrollmentServer | null = null;
	const closeEnrollmentServer = async () => {
		const server = caEnrollmentServer;
		caEnrollmentServer = null;
		await server?.close();
	};
	const publishTiming = (phase: AbsoluteExpoDevState, durationMs: number) => {
		timings[phase] = (timings[phase] ?? 0) + durationMs;
		options.onPhaseTiming?.({ durationMs, phase });
	};
	const setState = (state: AbsoluteExpoDevState) => {
		options.onStateChange?.(state);
	};
	if (options.signal?.aborted) throw abortError();
	const prepareCommand = plan.commands.find(
		(command) => command.role === 'native-prepare'
	);
	const metroCommand = plan.commands.find(
		(command) => command.role === 'metro'
	);
	const nativeCommands = plan.commands.filter(
		(command) => command.role === 'native-build'
	);
	if (!prepareCommand)
		throw new TypeError('Expo native preparation command is missing.');
	if (!metroCommand) throw new TypeError('Expo Metro command is missing.');
	setState('preparing-native');
	const prepareStarted = performance.now();
	const prepareProcess = run(executable, prepareCommand.args, {
		cwd: plan.project,
		env: { ...process.env, ...prepareCommand.env },
		stdio: ['ignore', 'pipe', 'pipe']
	});
	forwardLines(prepareProcess, (line) => {
		if (line) log(`[prebuild] ${line}`);
	});
	const abortPrepare = () => void stopProcess(prepareProcess);
	options.signal?.addEventListener('abort', abortPrepare, { once: true });
	const prepareExit = await waitForExit(prepareProcess);
	options.signal?.removeEventListener('abort', abortPrepare);
	if (options.signal?.aborted) throw abortError();
	if (prepareExit !== 0) {
		setState('failed');
		throw new Error(
			`Expo native preparation exited with status ${prepareExit}.`
		);
	}
	const prepareMs = performance.now() - prepareStarted;
	timings['preparing-native'] = prepareMs;
	options.onPhaseTiming?.({
		durationMs: prepareMs,
		phase: 'preparing-native'
	});
	setState('starting-metro');
	const metroStarted = performance.now();
	const metro = run(executable, metroCommand.args, {
		cwd: plan.project,
		env: { ...process.env, ...metroCommand.env },
		stdio: ['ignore', 'pipe', 'pipe']
	});
	let metroReady = false;
	let resolveMetro: (() => void) | undefined;
	const metroPromise = new Promise<void>((resolve, reject) => {
		const timeout = setTimeout(() => {
			reject(
				new Error('Expo Metro did not become ready within 60 seconds.')
			);
		}, METRO_READY_TIMEOUT_MS);
		resolveMetro = () => {
			clearTimeout(timeout);
			resolve();
		};
		metro.once('exit', (code) => {
			if (!metroReady) {
				clearTimeout(timeout);
				reject(
					new Error(`Expo Metro exited with status ${code ?? 1}.`)
				);
			}
		});
	});
	forwardLines(metro, (line) => {
		if (line) log(`[metro] ${line}`);
		if (
			!metroReady &&
			/(?:Waiting on|Metro waiting on|Dev server ready)/iu.test(line)
		) {
			metroReady = true;
			resolveMetro?.();
		}
	});
	const abort = () => void stopProcess(metro);
	options.signal?.addEventListener('abort', abort, { once: true });
	const runNativeCommand = async (command: AbsoluteExpoDevCommand) => {
		if (options.signal?.aborted) throw abortError();
		const { platform } = command;
		if (!platform)
			throw new TypeError(
				'Expo native build command is missing a platform.'
			);
		const state: AbsoluteExpoDevState =
			platform === 'android' ? 'building-android' : 'building-ios';
		setState(state);
		const started = performance.now();
		const child = run(executable, command.args, {
			cwd: plan.project,
			env: { ...process.env, ...command.env },
			stdio: ['ignore', 'pipe', 'pipe']
		});
		forwardLines(child, (line) => {
			if (line) log(`[${platform}] ${line}`);
		});
		const abortChild = () => void stopProcess(child);
		options.signal?.addEventListener('abort', abortChild, { once: true });
		const exitCode = await waitForExit(child);
		options.signal?.removeEventListener('abort', abortChild);
		if (options.signal?.aborted) throw abortError();
		if (exitCode !== 0) {
			throw new Error(
				`Expo ${platform} development build exited with status ${exitCode}.`
			);
		}
		if (
			platform === 'ios' &&
			options.certificateAuthorityPath &&
			options.iosOrigin &&
			new URL(options.iosOrigin).protocol === 'https:' &&
			!options.iosDevice
		) {
			setState('enrolling-trust');
			const trustStarted = performance.now();
			const utilityOptions: ExpoUtilityCommandOptions = {
				cwd: plan.project,
				signal: options.signal,
				log: (line: string) => line && log(`[ios-trust] ${line}`)
			};
			const trustExit = await runUtilityCommand(
				run,
				'xcrun',
				[
					'simctl',
					'keychain',
					'booted',
					'add-root-cert',
					options.certificateAuthorityPath
				],
				utilityOptions
			);
			if (trustExit !== 0)
				throw new Error(
					`Expo iOS Simulator development CA trust exited with status ${trustExit}.`
				);
			await runUtilityCommand(
				run,
				'xcrun',
				['simctl', 'terminate', 'booted', options.config.appId],
				utilityOptions
			);
			const launchExit = await runUtilityCommand(
				run,
				'xcrun',
				['simctl', 'launch', 'booted', options.config.appId],
				utilityOptions
			);
			if (launchExit !== 0)
				throw new Error(
					`Expo iOS Simulator relaunch exited with status ${launchExit}.`
				);
			log(
				'Installed the AbsoluteJS development CA into the Expo iOS Simulator and relaunched the app.'
			);
			publishTiming('enrolling-trust', performance.now() - trustStarted);
		}
		const durationMs = performance.now() - started;
		timings[state] = durationMs;
		options.onPhaseTiming?.({ durationMs, phase: state });
	};
	const runNativeCommands = async (
		commands: AbsoluteExpoDevCommand[]
	): Promise<void> => {
		const [command, ...remaining] = commands;
		if (!command) return;
		await runNativeCommand(command);
		await runNativeCommands(remaining);
	};
	const startPhysicalIosEnrollment = async () => {
		if (
			!options.iosDevice ||
			!options.certificateAuthorityPath ||
			!options.iosOrigin ||
			new URL(options.iosOrigin).protocol !== 'https:'
		) {
			return;
		}
		setState('enrolling-trust');
		const trustStarted = performance.now();
		const startEnrollment =
			options.startCaEnrollmentServer ??
			startAbsoluteIosCaEnrollmentServer;
		caEnrollmentServer = await startEnrollment({
			certificateAuthorityPath: options.certificateAuthorityPath,
			displayHost: new URL(options.iosOrigin).hostname
		});
		log(
			`On the iOS device, open ${caEnrollmentServer.url}, install the AbsoluteJS development CA profile, then enable it under Settings > General > About > Certificate Trust Settings. This public CA endpoint exists only for this dev session.`
		);
		publishTiming('enrolling-trust', performance.now() - trustStarted);
	};
	try {
		await startPhysicalIosEnrollment();
		await metroPromise;
		const metroMs = performance.now() - metroStarted;
		timings['starting-metro'] = metroMs;
		options.onPhaseTiming?.({
			durationMs: metroMs,
			phase: 'starting-metro'
		});
		await runNativeCommands(nativeCommands);
		setState('ready');

		return {
			metroPort: plan.metroPort,
			platforms: options.platforms,
			timings,
			close: async () => {
				options.signal?.removeEventListener('abort', abort);
				await stopProcess(metro);
				await closeEnrollmentServer();
				setState('closed');
			}
		};
	} catch (error) {
		options.signal?.removeEventListener('abort', abort);
		await stopProcess(metro);
		await closeEnrollmentServer();
		setState('failed');
		throw error;
	}
};
