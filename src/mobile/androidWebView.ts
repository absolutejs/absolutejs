import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const CDP_COMMAND_TIMEOUT_MS = 10_000;
const WEBVIEW_ATTACH_TIMEOUT_MS = 30_000;
const WEBVIEW_POLL_MS = 200;

type AndroidCommandResult = {
	exitCode: number;
	stderr: string;
	stdout: string;
};

type AndroidCommandCapture = (command: string[]) => AndroidCommandResult;

type CdpMessage = {
	error?: { code: number; message: string };
	id?: number;
	method?: string;
	params?: unknown;
	result?: unknown;
};

type CdpTarget = {
	description?: string;
	title?: string;
	type?: string;
	url?: string;
	webSocketDebuggerUrl?: string;
};

export type AbsoluteAndroidWebViewDiagnostic = {
	level: 'error' | 'info' | 'warning';
	message: string;
	source: 'console' | 'exception' | 'log';
};

export type AbsoluteAndroidWebViewSession = {
	close: () => Promise<void>;
	diagnostics: readonly AbsoluteAndroidWebViewDiagnostic[];
	evaluate: <T>(expression: string) => Promise<T>;
	hostPort: number;
	navigate: (url: string) => Promise<void>;
	screenshot: (path: string) => Promise<string>;
	serial: string;
	socket: string;
	tap: (x: number, y: number) => Promise<void>;
	target: CdpTarget;
	waitFor: <T>(
		expression: string,
		options?: { timeoutMs?: number }
	) => Promise<T>;
};

export type AttachAbsoluteAndroidWebViewOptions = {
	adb: string;
	appId: string;
	capture?: AndroidCommandCapture;
	fetch?: typeof fetch;
	serial: string;
	timeoutMs?: number;
};

const captureCommand: AndroidCommandCapture = (command) => {
	const result = Bun.spawnSync(command, {
		stderr: 'pipe',
		stdin: 'ignore',
		stdout: 'pipe'
	});

	return {
		exitCode: result.exitCode,
		stderr: result.stderr.toString(),
		stdout: result.stdout.toString()
	};
};

const escapeRegExp = (value: string) =>
	value.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&');

export const parseAndroidWebViewDevtoolsSockets = (
	output: string,
	options: { appId: string; pids: readonly string[] }
) => {
	const sockets = output
		.split(/\r?\n/u)
		.map((line) => /@([^\s]*devtools_remote[^\s]*)$/u.exec(line)?.[1])
		.filter((socket): socket is string => socket !== undefined);
	const appPattern = new RegExp(escapeRegExp(options.appId), 'iu');
	const exactPidSockets = options.pids.flatMap((pid) =>
		sockets.filter(
			(socket) =>
				socket === `webview_devtools_remote_${pid}` ||
				socket.endsWith(`_devtools_remote_${pid}`)
		)
	);
	const appSockets = sockets.filter((socket) => appPattern.test(socket));

	const ownedSockets = [...new Set([...exactPidSockets, ...appSockets])];

	return ownedSockets.length > 0 ? ownedSockets : [...new Set(sockets)];
};

const requireCommand = (result: AndroidCommandResult, description: string) => {
	if (result.exitCode === 0) return result.stdout.trim();
	throw new Error(
		`${description} failed: ${result.stderr.trim() || result.stdout.trim() || `exit ${result.exitCode}`}`
	);
};

const appPids = (
	adb: string,
	serial: string,
	appId: string,
	capture: AndroidCommandCapture
) =>
	requireCommand(
		capture([adb, '-s', serial, 'shell', 'pidof', appId]),
		`Could not find the running Android process ${appId}`
	)
		.split(/\s+/u)
		.filter(Boolean);

const devtoolsSockets = (
	adb: string,
	serial: string,
	appId: string,
	pids: readonly string[],
	capture: AndroidCommandCapture
) => {
	const output = requireCommand(
		capture([adb, '-s', serial, 'shell', 'cat', '/proc/net/unix']),
		'Could not inspect Android WebView debugging sockets'
	);

	return parseAndroidWebViewDevtoolsSockets(output, { appId, pids });
};

const forwardSocket = (
	adb: string,
	serial: string,
	socket: string,
	capture: AndroidCommandCapture
) => {
	const output = requireCommand(
		capture([
			adb,
			'-s',
			serial,
			'forward',
			'tcp:0',
			`localabstract:${socket}`
		]),
		`Could not forward Android WebView socket ${socket}`
	);
	const port = Number(output);
	if (!Number.isInteger(port) || port < 1) {
		throw new Error(
			`ADB returned an invalid WebView debug port: ${output}`
		);
	}

	return port;
};

const removeForward = (
	adb: string,
	serial: string,
	port: number,
	capture: AndroidCommandCapture
) => {
	capture([adb, '-s', serial, 'forward', '--remove', `tcp:${port}`]);
};

const readTargets = async (fetcher: typeof fetch, port: number) => {
	const response = await fetcher(`http://127.0.0.1:${port}/json/list`, {
		signal: AbortSignal.timeout(CDP_COMMAND_TIMEOUT_MS)
	});
	if (!response.ok) {
		throw new Error(
			`Android WebView debugger returned HTTP ${response.status}.`
		);
	}
	const value: unknown = await response.json();
	if (!Array.isArray(value)) return [];

	return value.filter(
		(candidate): candidate is CdpTarget =>
			typeof candidate === 'object' &&
			candidate !== null &&
			typeof Reflect.get(candidate, 'webSocketDebuggerUrl') === 'string'
	);
};

const targetScore = (target: CdpTarget) => {
	if (target.type !== 'page') return 0;
	if (target.url?.startsWith('http')) return 3;
	if (target.url?.startsWith('capacitor')) return 2;

	return 1;
};

const selectTarget = (targets: CdpTarget[]) =>
	[...targets].sort(
		(left, right) => targetScore(right) - targetScore(left)
	)[0];

const errorText = (value: unknown) => {
	if (typeof value === 'string') return value;
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
};

const diagnosticLevel: (
	level: unknown
) => AbsoluteAndroidWebViewDiagnostic['level'] = (level) => {
	if (level === 'error') return 'error';
	if (level === 'warning') return 'warning';

	return 'info';
};

class CdpConnection {
	readonly diagnostics: AbsoluteAndroidWebViewDiagnostic[] = [];
	readonly socket: WebSocket;
	#closed = false;
	#nextId = 1;
	#pending = new Map<
		number,
		{
			reject: (error: Error) => void;
			resolve: (result: unknown) => void;
			timer: ReturnType<typeof setTimeout>;
		}
	>();

	private constructor(socket: WebSocket) {
		this.socket = socket;
		socket.addEventListener('message', (event) => {
			this.onMessage(event.data);
		});
		socket.addEventListener('close', () => {
			this.#closed = true;
			for (const pending of this.#pending.values()) {
				clearTimeout(pending.timer);
				pending.reject(
					new Error('Android WebView debugger disconnected.')
				);
			}
			this.#pending.clear();
		});
	}

	static connect = (url: string, timeoutMs = CDP_COMMAND_TIMEOUT_MS) =>
		new Promise<CdpConnection>((_resolve, reject) => {
			const socket = new WebSocket(url);
			const timer = setTimeout(() => {
				socket.close();
				reject(
					new Error(
						`Timed out connecting to Android WebView debugger after ${timeoutMs}ms.`
					)
				);
			}, timeoutMs);
			socket.addEventListener(
				'open',
				() => {
					clearTimeout(timer);
					_resolve(new CdpConnection(socket));
				},
				{ once: true }
			);
			socket.addEventListener(
				'error',
				() => {
					clearTimeout(timer);
					reject(
						new Error(
							'Could not connect to Android WebView debugger.'
						)
					);
				},
				{ once: true }
			);
		});

	#recordEvent(message: CdpMessage) {
		if (message.method === 'Runtime.exceptionThrown') {
			this.diagnostics.push({
				level: 'error',
				message: errorText(message.params),
				source: 'exception'
			});
		}
		if (message.method === 'Runtime.consoleAPICalled') {
			const type =
				typeof message.params === 'object' && message.params !== null
					? Reflect.get(message.params, 'type')
					: undefined;
			this.diagnostics.push({
				level: type === 'error' ? 'error' : 'info',
				message: errorText(message.params),
				source: 'console'
			});
		}
		if (message.method === 'Log.entryAdded') {
			const entry =
				typeof message.params === 'object' && message.params !== null
					? Reflect.get(message.params, 'entry')
					: undefined;
			const level =
				typeof entry === 'object' && entry !== null
					? Reflect.get(entry, 'level')
					: undefined;
			this.diagnostics.push({
				level: diagnosticLevel(level),
				message: errorText(entry),
				source: 'log'
			});
		}
	}

	private onMessage(raw: unknown) {
		if (typeof raw !== 'string') return;
		let message: CdpMessage;
		try {
			message = JSON.parse(raw);
		} catch {
			return;
		}
		if (typeof message.id !== 'number') {
			this.#recordEvent(message);

			return;
		}
		const pending = this.#pending.get(message.id);
		if (!pending) return;
		this.#pending.delete(message.id);
		clearTimeout(pending.timer);
		if (message.error) {
			pending.reject(
				new Error(
					`CDP command failed (${message.error.code}): ${message.error.message}`
				)
			);

			return;
		}
		pending.resolve(message.result);
	}

	command = (
		method: string,
		params: Record<string, unknown> = {},
		timeoutMs = CDP_COMMAND_TIMEOUT_MS
	) => {
		if (this.#closed) {
			return Promise.reject(
				new Error('Android WebView debugger is closed.')
			);
		}
		const id = this.#nextId++;

		return new Promise<unknown>((_resolve, reject) => {
			const timer = setTimeout(() => {
				this.#pending.delete(id);
				reject(
					new Error(`CDP ${method} timed out after ${timeoutMs}ms.`)
				);
			}, timeoutMs);
			this.#pending.set(id, {
				reject,
				resolve: _resolve,
				timer
			});
			this.socket.send(JSON.stringify({ id, method, params }));
		});
	};

	close = async () => {
		if (this.#closed) return;
		this.#closed = true;
		this.socket.close();
	};
}

const evaluateResult = (result: unknown) => {
	if (typeof result !== 'object' || result === null) {
		throw new Error(
			'Android WebView returned an invalid evaluation result.'
		);
	}
	const exception = Reflect.get(result, 'exceptionDetails');
	if (exception !== undefined) {
		throw new Error(
			`Android WebView evaluation failed: ${errorText(exception)}`
		);
	}
	const remote = Reflect.get(result, 'result');
	if (typeof remote !== 'object' || remote === null) {
		return Reflect.get({}, 'value');
	}

	return Reflect.get(remote, 'value');
};

const connectTarget = async (target: CdpTarget) => {
	if (!target.webSocketDebuggerUrl) {
		throw new Error('Android WebView target has no debugger URL.');
	}
	const connection = await CdpConnection.connect(target.webSocketDebuggerUrl);
	try {
		await Promise.all([
			connection.command('Runtime.enable'),
			connection.command('Page.enable'),
			connection.command('Log.enable')
		]);
	} catch (error) {
		await connection.close();

		throw error;
	}

	return connection;
};

const isTransientEvaluationError = (error: unknown) => {
	const message = error instanceof Error ? error.message : String(error);

	return /execution context|cannot find context|inspected target navigated|context.*destroyed/iu.test(
		message
	);
};

type CreateWaitFor = (
	evaluate: <T>(expression: string) => Promise<T>
) => AbsoluteAndroidWebViewSession['waitFor'];

const createWaitFor: CreateWaitFor =
	(evaluate) =>
	async <T>(expression: string, options: { timeoutMs?: number } = {}) => {
		const timeoutMs = options.timeoutMs ?? CDP_COMMAND_TIMEOUT_MS;
		const deadline = Date.now() + timeoutMs;
		type Poll = () => Promise<T>;
		const poll: Poll = async () => {
			let value: T | undefined;
			try {
				value = await evaluate<T>(expression);
			} catch (error) {
				if (!isTransientEvaluationError(error)) throw error;
			}
			if (value) return value;
			if (Date.now() >= deadline) {
				throw new Error(
					`Timed out waiting for Android WebView condition after ${timeoutMs}ms: ${expression}`
				);
			}
			await Bun.sleep(WEBVIEW_POLL_MS);

			return poll();
		};

		return poll();
	};

const createSession = (
	options: AttachAbsoluteAndroidWebViewOptions,
	capture: AndroidCommandCapture,
	socket: string,
	hostPort: number,
	target: CdpTarget,
	connection: CdpConnection
) => {
	const evaluate: AbsoluteAndroidWebViewSession['evaluate'] = async (
		expression
	) =>
		evaluateResult(
			await connection.command('Runtime.evaluate', {
				awaitPromise: true,
				expression,
				returnByValue: true
			})
		);
	const waitFor = createWaitFor(evaluate);
	let closed = false;

	return {
		diagnostics: connection.diagnostics,
		evaluate,
		hostPort,
		serial: options.serial,
		socket,
		target,
		waitFor,
		close: async () => {
			if (closed) return;
			closed = true;
			await connection.close();
			removeForward(options.adb, options.serial, hostPort, capture);
		},
		navigate: async (url: string) => {
			await connection.command('Page.navigate', { url });
			await waitFor(
				`document.readyState === 'interactive' || document.readyState === 'complete'`,
				{ timeoutMs: CDP_COMMAND_TIMEOUT_MS }
			);
		},
		screenshot: async (path: string) => {
			const result = await connection.command(
				'Page.captureScreenshot',
				{ captureBeyondViewport: true, format: 'png' },
				WEBVIEW_ATTACH_TIMEOUT_MS
			);
			const data =
				typeof result === 'object' && result !== null
					? Reflect.get(result, 'data')
					: undefined;
			if (typeof data !== 'string') {
				throw new Error(
					'Android WebView screenshot returned no image data.'
				);
			}
			const absolutePath = resolve(path);
			await mkdir(dirname(absolutePath), { recursive: true });
			await writeFile(absolutePath, Buffer.from(data, 'base64'));

			return absolutePath;
		},
		tap: async (coordinateX: number, coordinateY: number) => {
			if (
				!Number.isFinite(coordinateX) ||
				!Number.isFinite(coordinateY) ||
				coordinateX < 0 ||
				coordinateY < 0
			) {
				throw new TypeError(
					'Android WebView tap coordinates must be finite non-negative numbers.'
				);
			}
			await connection.command('Input.dispatchTouchEvent', {
				touchPoints: [{ x: coordinateX, y: coordinateY }],
				type: 'touchStart'
			});
			await connection.command('Input.dispatchTouchEvent', {
				touchPoints: [],
				type: 'touchEnd'
			});
		}
	};
};

const failForward = (
	error: unknown,
	options: AttachAbsoluteAndroidWebViewOptions,
	capture: AndroidCommandCapture,
	hostPort: number
) => {
	removeForward(options.adb, options.serial, hostPort, capture);

	throw error;
};

const attachSocket = async (
	options: AttachAbsoluteAndroidWebViewOptions,
	capture: AndroidCommandCapture,
	fetcher: typeof fetch,
	socket: string
) => {
	const hostPort = forwardSocket(
		options.adb,
		options.serial,
		socket,
		capture
	);
	const targets = await readTargets(fetcher, hostPort).catch((error) =>
		failForward(error, options, capture, hostPort)
	);
	const target = selectTarget(targets);
	if (!target) {
		removeForward(options.adb, options.serial, hostPort, capture);

		return undefined;
	}
	const connection = await connectTarget(target).catch((error) =>
		failForward(error, options, capture, hostPort)
	);

	return createSession(
		options,
		capture,
		socket,
		hostPort,
		target,
		connection
	);
};

const attachFirstSocket = (
	options: AttachAbsoluteAndroidWebViewOptions,
	capture: AndroidCommandCapture,
	fetcher: typeof fetch,
	sockets: readonly string[],
	recordError: (error: unknown) => void
) =>
	sockets.reduce<Promise<AbsoluteAndroidWebViewSession | undefined>>(
		async (pending, socket) => {
			const session = await pending;
			if (session) return session;

			return attachSocket(options, capture, fetcher, socket).catch(
				(error: unknown) => {
					recordError(error);

					return undefined;
				}
			);
		},
		Promise.resolve(undefined)
	);

export const attachAbsoluteAndroidWebView = async (
	options: AttachAbsoluteAndroidWebViewOptions
) => {
	const capture = options.capture ?? captureCommand;
	const fetcher = options.fetch ?? fetch;
	const deadline =
		Date.now() + (options.timeoutMs ?? WEBVIEW_ATTACH_TIMEOUT_MS);
	let lastError: unknown;
	type Poll = () => Promise<AbsoluteAndroidWebViewSession>;
	const poll: Poll = async () => {
		if (Date.now() >= deadline) {
			throw new Error(
				`Could not attach to a debuggable WebView for ${options.appId} on ${options.serial}. Ensure the debug app is open and WebView debugging is enabled.${lastError instanceof Error ? ` Last error: ${lastError.message}` : ''}`
			);
		}
		let pids: string[] | undefined;
		try {
			pids = appPids(options.adb, options.serial, options.appId, capture);
		} catch (error) {
			lastError = error;
		}
		if (!pids) {
			await Bun.sleep(WEBVIEW_POLL_MS);

			return poll();
		}
		const sockets = devtoolsSockets(
			options.adb,
			options.serial,
			options.appId,
			pids,
			capture
		);
		const session = await attachFirstSocket(
			options,
			capture,
			fetcher,
			sockets,
			(error) => {
				lastError = error;
			}
		);
		if (session) return session;
		await Bun.sleep(WEBVIEW_POLL_MS);

		return poll();
	};

	return poll();
};
