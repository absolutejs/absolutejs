import { resolve } from 'node:path';
import { getAvailablePort } from './ports';
import { waitForServer } from './http';

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..');

export type DevServer = {
	port: number;
	baseUrl: string;
	proc: ReturnType<typeof Bun.spawn>;
	kill: () => Promise<void>;
	/** Resolves when a line matching `pattern` is observed on the
	 *  dev server's stdout/stderr. Useful for asserting on the
	 *  `[abs:restart] <path>` stdout marker that the framework
	 *  emits when it falls back to a parent-CLI-driven restart. */
	waitForOutput: (
		pattern: RegExp,
		options?: { timeoutMs?: number }
	) => Promise<string>;
	/** Snapshot of every stdout/stderr line emitted so far. Useful
	 *  for asserting *absence* of a pattern (where `waitForOutput`
	 *  is the wrong tool — it'd just time out). Consumers should
	 *  copy the array if they need a stable reference. */
	readonly outputLines: readonly string[];
};

type DevServerOptions = {
	port?: number;
	serverEntry?: string;
	configPath?: string;
	env?: Record<string, string>;
	/** Override the boot-readiness `waitForServer` retry count.
	 *  Default is the helper's own (120 × 500ms = 60s). Useful for
	 *  tests that EXPECT boot to fail and don't want to eat the full
	 *  timeout. */
	bootMaxRetries?: number;
	/** Run the dev server with TLS enabled (sets `ABSOLUTE_HTTPS=true`
	 *  for the bun child; baseUrl becomes `https://localhost:<port>`).
	 *  The dev runtime auto-generates a self-signed cert via openssl
	 *  if mkcert isn't installed; this helper otherwise needs no
	 *  extra plumbing. Cert validation is bypassed in the readiness
	 *  probe so the self-signed boot still satisfies `waitForServer`. */
	https?: boolean;
};

const DEFAULT_OUTPUT_TIMEOUT_MS = 10_000;

const drainStream = (
	stream: ReadableStream<Uint8Array> | null,
	onLine: (line: string) => void
) => {
	if (!stream) return;
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	const pump = async () => {
		while (true) {
			const { done, value } = await reader.read();
			if (done) return;
			buffer += decoder.decode(value, { stream: true });
			let idx;
			while ((idx = buffer.indexOf('\n')) !== -1) {
				onLine(buffer.slice(0, idx));
				buffer = buffer.slice(idx + 1);
			}
		}
	};
	void pump().catch(() => {
		/* stream closed */
	});
};

export const startDevServer = async (options?: DevServerOptions | number) => {
	// Backwards compat: accept bare port number
	const opts =
		typeof options === 'number' ? { port: options } : (options ?? {});
	const resolvedPort = opts.port ?? (await getAvailablePort());
	const serverEntry =
		opts.serverEntry ?? resolve(PROJECT_ROOT, 'example/server.ts');
	const configPath =
		opts.configPath ?? resolve(PROJECT_ROOT, 'example/absolute.config.ts');

	const httpsEnabled = opts.https === true;
	const proc = Bun.spawn(['bun', '--hot', '--no-clear-screen', serverEntry], {
		cwd: PROJECT_ROOT,
		env: {
			...process.env,
			ABSOLUTE_CONFIG: configPath,
			FORCE_COLOR: '0',
			NODE_ENV: 'development',
			PORT: String(resolvedPort),
			TELEMETRY_OFF: '1',
			...(httpsEnabled ? { ABSOLUTE_HTTPS: 'true' } : {}),
			...opts.env
		},
		stderr: 'pipe',
		stdout: 'pipe'
	});

	const outputLines: string[] = [];
	const lineWaiters: Array<{
		pattern: RegExp;
		resolve: (line: string) => void;
	}> = [];
	const recordLine = (line: string) => {
		outputLines.push(line);
		for (let i = lineWaiters.length - 1; i >= 0; i--) {
			const entry = lineWaiters[i];
			if (entry && entry.pattern.test(line)) {
				lineWaiters.splice(i, 1);
				entry.resolve(line);
			}
		}
	};
	drainStream(proc.stdout as ReadableStream<Uint8Array> | null, recordLine);
	drainStream(proc.stderr as ReadableStream<Uint8Array> | null, recordLine);

	const baseUrl = `${httpsEnabled ? 'https' : 'http'}://localhost:${resolvedPort}`;

	try {
		await waitForServer(`${baseUrl}/hmr-status`, opts.bootMaxRetries, {
			rejectUnauthorized: !httpsEnabled
		});
	} catch (err) {
		proc.kill();
		throw new Error(
			`Dev server failed to start on port ${resolvedPort}: ${err}${
				outputLines.length
					? `\n\nlast output:\n${outputLines.slice(-20).join('\n')}`
					: ''
			}`,
			{ cause: err }
		);
	}

	const kill = async () => {
		try {
			proc.kill();
		} catch {
			// already exited
		}
		await proc.exited;
	};

	const waitForOutput = (
		pattern: RegExp,
		{ timeoutMs = DEFAULT_OUTPUT_TIMEOUT_MS } = {}
	) => {
		const existing = outputLines.find((line) => pattern.test(line));
		if (existing) return Promise.resolve(existing);
		return new Promise<string>((res, rej) => {
			const timer = setTimeout(() => {
				const idx = lineWaiters.findIndex((w) => w.resolve === res);
				if (idx !== -1) lineWaiters.splice(idx, 1);
				rej(
					new Error(
						`Timed out waiting for stdout/stderr line matching ${pattern} after ${timeoutMs}ms. Last 20 lines:\n${outputLines.slice(-20).join('\n')}`
					)
				);
			}, timeoutMs);
			lineWaiters.push({
				pattern,
				resolve: (line) => {
					clearTimeout(timer);
					res(line);
				}
			});
		});
	};

	return {
		baseUrl,
		kill,
		get outputLines() {
			return outputLines;
		},
		port: resolvedPort,
		proc,
		waitForOutput
	} satisfies DevServer;
};
