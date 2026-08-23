/* eslint-disable @typescript-eslint/consistent-type-assertions, absolute/max-depth-extended, no-await-in-loop -- This file is a sequential, validated JSON-lines protocol state machine. */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { MobileConfig } from '../../types/build';
import { normalizeAbsoluteMobileConfig } from './config';
import {
	prepareAbsoluteIosDevProject,
	startAbsoluteIosDevSession,
	type AbsoluteIosCommandOptions,
	type AbsoluteIosDevPhaseTiming,
	type AbsoluteIosDevSession,
	type StartAbsoluteIosDevOptions
} from './iosSimulatorController';
import {
	ABSOLUTE_REMOTE_MAC_EVENT_PREFIX,
	ABSOLUTE_REMOTE_MAC_PROTOCOL_VERSION
} from './remoteMacWire';

type AgentRequest = {
	command: 'close' | 'rebuild' | 'relaunch' | 'screenshot';
	id: string;
	v: 1;
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

const readyShape = (session: AbsoluteIosDevSession) => ({
	nativeCacheHit: session.nativeCacheHit,
	startedSimulator: session.startedSimulator,
	timings: session.timings,
	type: 'ready',
	udid: session.udid
});

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
	const port = parsePort(args);
	const project = await prepareAbsoluteIosDevProject(config, {
		createNativeProject: false,
		projectRoot,
		run
	});
	const sessionOptions: StartAbsoluteIosDevOptions = {
		capture,
		https: args.includes('--https'),
		port,
		project,
		run,
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
	let session = await startAbsoluteIosDevSession(sessionOptions);
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
