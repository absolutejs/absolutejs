/* Start a project's own AbsoluteJS server from a test, and stop it.
 *
 * This repository has had a harness for this since early on, but it is
 * wired to this repository: the project root is derived from the helper's
 * own location, the entry and config default to `example/`, and the child
 * runs `src/cli/index.ts` and `src/dev/serverBootstrap.ts` from source.
 * None of that exists in a project that installs the package, so there
 * was no supported way to boot an app in a test — every project wrote the
 * spawn, the readiness probe and the teardown again, and the teardown is
 * the part people get wrong.
 *
 * This runs the CLI the project has installed, from the project's own
 * directory, which is what the project's own `absolute dev` would do. */

import { existsSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { getAvailablePort } from './ports';
import { waitForServer } from './http';

const CLI_RELATIVE_PATH = join(
	'node_modules',
	'@absolutejs',
	'absolute',
	'dist',
	'cli',
	'index.js'
);

const DEFAULT_READY_ATTEMPTS = 120;
const DEFAULT_OUTPUT_TIMEOUT_MS = 10_000;
const EXIT_TIMEOUT_MS = 5_000;
const PORT_RELEASE_GRACE_MS = 250;
const NOT_FOUND = -1;

/* Walked upward rather than resolved once, so a workspace whose packages
 * are hoisted to the repository root works without configuration. */
const findInstalledCli = (projectRoot: string) => {
	let directory = resolvePath(projectRoot);
	let previous = '';
	while (directory !== previous) {
		const candidate = join(directory, CLI_RELATIVE_PATH);
		if (existsSync(candidate)) return candidate;
		previous = directory;
		directory = dirname(directory);
	}

	return null;
};

export type StartProjectOptions = {
	/** Path to the CLI to run. Only needed when the package is not
	 *  installed where it can be found — a monorepo running against a
	 *  build, for instance. */
	cliPath?: string;
	/** `--config`. Defaults to whatever the CLI finds in `projectRoot`. */
	configPath?: string;
	/** Added to the child's environment. */
	env?: Record<string, string>;
	/** `development` runs `absolute dev` (hot reload); `production` runs
	 *  `absolute start`, which builds first. Default `development`. */
	mode?: 'development' | 'production';
	/** Port to serve on. Default: one the OS says is free. */
	port?: number;
	/** The project to start. Default `process.cwd()`. */
	projectRoot?: string;
	/** Readiness attempts at 500ms each. Default 120, so 60s — a
	 *  production start builds first, so it needs the headroom. Lower it
	 *  in a test that expects boot to fail. */
	readyAttempts?: number;
	/** Server entry to run. Defaults to the CLI's own resolution. */
	serverEntry?: string;
	/** Serve over HTTPS with a generated certificate. The readiness probe
	 *  then accepts a self-signed one. */
	https?: boolean;
};

export type RunningProject = {
	/** `http://localhost:<port>`, or `https://` when `https` was set. */
	baseUrl: string;
	/** Stop the server and everything it started. Throws if a child
	 *  survived, rather than leaking a process that holds the port. */
	kill: () => Promise<void>;
	/** Every stdout and stderr line seen so far. Copy it if you need a
	 *  stable snapshot — asserting a line is ABSENT wants this, where
	 *  `waitForOutput` would only time out. */
	readonly outputLines: readonly string[];
	port: number;
	process: ReturnType<typeof Bun.spawn>;
	/** Resolve when a line matching `pattern` appears, including lines
	 *  already seen. */
	waitForOutput: (
		pattern: RegExp,
		options?: { timeoutMs?: number }
	) => Promise<string>;
};

type Waiter = {
	pattern: RegExp;
	settle: (line: string) => void;
};

/* Emits every complete line in `buffer` and returns what is left over —
 * a chunk boundary lands mid-line far more often than not. */
const drainLines = (buffer: string, onLine: (line: string) => void) => {
	let rest = buffer;
	let newline = rest.indexOf('\n');
	while (newline !== NOT_FOUND) {
		onLine(rest.slice(0, newline));
		rest = rest.slice(newline + 1);
		newline = rest.indexOf('\n');
	}

	return rest;
};

const pumpLines = (
	stream: ReadableStream<Uint8Array> | undefined,
	onLine: (line: string) => void
) => {
	if (!stream) return;
	const decoder = new TextDecoder();
	let buffer = '';
	const run = async () => {
		for await (const chunk of stream) {
			buffer += decoder.decode(chunk, { stream: true });
			buffer = drainLines(buffer, onLine);
		}
		if (buffer.length > 0) onLine(buffer);
	};
	void run().catch(() => {
		/* The stream closed with the process. */
	});
};

/* `absolute start` runs the built server as its own child, so killing the
 * CLI does not always take the server with it — and a survivor keeps the
 * port, which is what makes the NEXT test fail instead of this one.
 *
 * Checked by probing the port rather than by hunting processes: it is the
 * property that actually matters, it is the same on every platform, and
 * it cannot be fooled by a command line that does not mention the port
 * (`pgrep -f PORT=3000` never matches, because the port is in the child's
 * environment, not its argv). */
const stillListening = async (port: number) => {
	try {
		const probe = await Bun.connect({
			hostname: '127.0.0.1',
			port,
			socket: { data: () => undefined }
		});
		probe.end();

		return true;
	} catch {
		return false;
	}
};

/** Boot a project's server and wait until it answers.
 *
 *     const app = await startProject({ projectRoot: fixture });
 *     const { html } = await fetchPage(`${app.baseUrl}/`);
 *     await app.kill();
 */
export const startProject = async (options: StartProjectOptions = {}) => {
	const {
		cliPath,
		configPath,
		env,
		https = false,
		mode = 'development',
		port,
		projectRoot = process.cwd(),
		readyAttempts = DEFAULT_READY_ATTEMPTS,
		serverEntry
	} = options;

	const root = resolvePath(projectRoot);
	const cli = cliPath ?? findInstalledCli(root);
	if (cli === null)
		throw new Error(
			`Could not find @absolutejs/absolute installed from ${root}. Install it, or pass \`cliPath\` pointing at its dist/cli/index.js.`
		);

	const resolvedPort = port ?? (await getAvailablePort());
	const command = mode === 'production' ? 'start' : 'dev';
	const args = [
		process.execPath,
		cli,
		command,
		...(serverEntry === undefined ? [] : [serverEntry]),
		...(configPath === undefined ? [] : ['--config', configPath])
	];

	const outputLines: string[] = [];
	const waiters: Waiter[] = [];
	const observe = (line: string) => {
		outputLines.push(line);
		for (const waiter of waiters.filter((item) => item.pattern.test(line)))
			waiter.settle(line);
	};

	const child = Bun.spawn(args, {
		cwd: root,
		env: {
			...process.env,
			FORCE_COLOR: '0',
			NODE_ENV: mode,
			PORT: String(resolvedPort),
			/* A test run is not usage. */
			TELEMETRY_OFF: '1',
			...(https ? { ABSOLUTE_HTTPS: 'true' } : {}),
			...env
		},
		stderr: 'pipe',
		stdout: 'pipe'
	});

	pumpLines(child.stdout, observe);
	pumpLines(child.stderr, observe);

	const baseUrl = `${https ? 'https' : 'http'}://localhost:${resolvedPort}`;

	const kill = async () => {
		try {
			child.kill();
		} catch {
			/* Already exited. */
		}
		await Promise.race([child.exited, Bun.sleep(EXIT_TIMEOUT_MS)]);
		/* A moment for the socket to be released before concluding that
		 * something is still holding it. */
		await Bun.sleep(PORT_RELEASE_GRACE_MS);
		if (await stillListening(resolvedPort))
			throw new Error(
				`Stopping the server left something listening on port ${resolvedPort}. A child outlived \`absolute ${command}\`; it will hold the port for the rest of this run.`
			);
	};

	const waitForOutput = (
		pattern: RegExp,
		waitOptions?: { timeoutMs?: number }
	) => {
		const seen = outputLines.find((line) => pattern.test(line));
		if (seen !== undefined) return Promise.resolve(seen);

		const timeoutMs = waitOptions?.timeoutMs ?? DEFAULT_OUTPUT_TIMEOUT_MS;

		return new Promise<string>((resolve, reject) => {
			const forget = () => {
				const index = waiters.findIndex(
					(item) => item.settle === resolveOnce
				);
				if (index !== NOT_FOUND) waiters.splice(index, 1);
			};
			const timer = setTimeout(() => {
				forget();
				reject(
					new Error(
						`No output matched ${pattern} within ${timeoutMs}ms. Saw:\n${outputLines.join('\n')}`
					)
				);
			}, timeoutMs);
			const resolveOnce = (line: string) => {
				clearTimeout(timer);
				forget();
				resolve(line);
			};
			waiters.push({ pattern, settle: resolveOnce });
		});
	};

	try {
		await waitForServer(baseUrl, {
			maxRetries: readyAttempts,
			...(https ? { rejectUnauthorized: false } : {})
		});
	} catch (error) {
		await kill().catch(() => undefined);
		throw new Error(
			`\`absolute ${command}\` did not come up on ${baseUrl}. Output:\n${outputLines.join('\n')}`,
			{ cause: error }
		);
	}

	return {
		baseUrl,
		kill,
		outputLines,
		port: resolvedPort,
		process: child,
		waitForOutput
	} satisfies RunningProject;
};
