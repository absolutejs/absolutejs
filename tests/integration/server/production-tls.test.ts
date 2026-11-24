import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import { connect as connectHttp2 } from 'node:http2';
import { join, resolve } from 'node:path';
import { connect as connectTls } from 'node:tls';
import { getAvailablePort } from '../../helpers/ports';
import { createTlsFixture } from '../../helpers/tlsFixture';

/* A production server terminating HTTPS itself, through the same
 * `networking()` every app calls.
 *
 * TLS and HTTP/2 were both tied to `NODE_ENV === 'development'`: a
 * production server could not do either, whatever it was given. What is
 * checked here is what a deployment depends on — a browser gets HTTP/2,
 * an older client still gets HTTP/1.1 on the same port, and a
 * certificate that cannot be used stops the server instead of leaving it
 * up on plain HTTP. */

const NETWORKING = resolve(
	import.meta.dir,
	'../../../src/plugins/networking.ts'
);
/* By path: the entry is written outside the repository, where a bare
 * 'elysia' would resolve to whatever Bun auto-installs, not the version
 * the plugin was written for. */
const ELYSIA = Bun.fileURLToPath(import.meta.resolve('elysia'));
const STARTUP_TIMEOUT_MS = 15_000;
const POLL_INTERVAL_MS = 50;

let fixture: Awaited<ReturnType<typeof createTlsFixture>>;
let site: { cert: string; key: string };
let other: { cert: string; key: string };
let entry = '';

beforeAll(async () => {
	fixture = await createTlsFixture();
	site = fixture.pair('site');
	other = fixture.pair('other');
	entry = join(fixture.directory, 'server.ts');
	await writeFile(
		entry,
		`import { Elysia } from ${JSON.stringify(ELYSIA)};
import { networking } from ${JSON.stringify(NETWORKING)};

new Elysia().get('/', () => 'served').use(networking);
`
	);
});

afterAll(() => fixture.remove());

const start = (port: number, env: Record<string, string>) =>
	Bun.spawn([process.execPath, entry], {
		cwd: resolve(import.meta.dir, '../../..'),
		env: {
			...process.env,
			ABSOLUTE_HOST: 'localhost',
			ABSOLUTE_INSTANCE_MANAGED: '1',
			ABSOLUTE_PORT: String(port),
			NODE_ENV: 'production',
			TELEMETRY_OFF: '1',
			...env
		},
		stderr: 'pipe',
		stdout: 'pipe'
	});

const tlsEnv = (pair: { cert: string; key: string }) => ({
	ABSOLUTE_TLS_CERT: pair.cert,
	ABSOLUTE_TLS_KEY: pair.key
});

/* The certificate is self-signed, so it is its own authority: trusting
 * exactly it is stricter than turning verification off. */
const overTls = async (port: number, ca: string) =>
	fetch(`https://localhost:${port}/`, { tls: { ca } });

const waitUntilServing = async (port: number, ca: string) => {
	const deadline = Date.now() + STARTUP_TIMEOUT_MS;
	const attempt = async (): Promise<void> => {
		const response = await overTls(port, ca).catch(() => null);
		if (response?.ok) return;
		if (Date.now() > deadline)
			throw new Error(`No HTTPS server on port ${port}.`);
		await Bun.sleep(POLL_INTERVAL_MS);
		await attempt();
	};
	await attempt();
};

type Http2Answer = { alpn: string | undefined; body: string; status: number };

const overHttp2 = (port: number, ca: string) =>
	new Promise<Http2Answer>((_resolve, reject) => {
		const session = connectHttp2(`https://localhost:${port}`, { ca });
		session.on('error', reject);
		const request = session.request({ ':path': '/' });
		let body = '';
		let status = 0;
		request.on('response', (headers) => {
			status = Number(headers[':status']);
		});
		request.setEncoding('utf8');
		request.on('data', (chunk: string) => {
			body += chunk;
		});
		request.on('end', () => {
			const alpn = session.alpnProtocol;
			session.close();
			_resolve({ alpn, body, status });
		});
		request.end();
	});

/* What the server picks when a client offers both, as a browser does. */
const negotiatedProtocol = (port: number, ca: string) =>
	new Promise<string | false | null>((_resolve, reject) => {
		const socket = connectTls(
			{
				ALPNProtocols: ['h2', 'http/1.1'],
				ca,
				host: 'localhost',
				port,
				servername: 'localhost'
			},
			() => {
				const { alpnProtocol } = socket;
				socket.end();
				_resolve(alpnProtocol);
			}
		);
		socket.on('error', reject);
	});

describe('a production server with a certificate', () => {
	test('serves HTTP/2 to a client that asks, and HTTP/1.1 to one that does not', async () => {
		const port = await getAvailablePort();
		const ca = await readFile(site.cert, 'utf8');
		const server = start(port, tlsEnv(site));
		try {
			await waitUntilServing(port, ca);

			expect(await negotiatedProtocol(port, ca)).toBe('h2');
			const modern = await overHttp2(port, ca);
			expect(modern).toEqual({ alpn: 'h2', body: 'served', status: 200 });

			const legacy = await overTls(port, ca);
			expect(await legacy.text()).toBe('served');
		} finally {
			server.kill();
			await server.exited;
		}
	}, 30_000);

	test('does not also answer plain HTTP on that port', async () => {
		const port = await getAvailablePort();
		const ca = await readFile(site.cert, 'utf8');
		const server = start(port, tlsEnv(site));
		try {
			await waitUntilServing(port, ca);
			const plain = await fetch(`http://localhost:${port}/`)
				.then((response) => response.text())
				.catch(() => null);

			expect(plain).not.toBe('served');
		} finally {
			server.kill();
			await server.exited;
		}
	}, 30_000);

	test('ABSOLUTE_TLS_HTTP2=false keeps HTTPS and drops HTTP/2', async () => {
		const port = await getAvailablePort();
		const ca = await readFile(site.cert, 'utf8');
		const server = start(port, {
			...tlsEnv(site),
			ABSOLUTE_TLS_HTTP2: 'false'
		});
		try {
			await waitUntilServing(port, ca);

			/* With HTTP/2 off Bun offers no protocol at all, which a
			 * client reads as HTTP/1.1. */
			expect(await negotiatedProtocol(port, ca)).not.toBe('h2');
			expect(await (await overTls(port, ca)).text()).toBe('served');
		} finally {
			server.kill();
			await server.exited;
		}
	}, 30_000);
});

describe('a production server with a certificate it cannot use', () => {
	/* The failure that matters: asked for HTTPS, unable to do it, and up
	 * anyway on plain HTTP. */
	test('exits saying why, and never listens', async () => {
		const port = await getAvailablePort();
		const server = start(port, {
			ABSOLUTE_TLS_CERT: site.cert,
			ABSOLUTE_TLS_KEY: other.key
		});
		const [exitCode, stderr, stdout] = await Promise.all([
			server.exited,
			new Response(server.stderr).text(),
			new Response(server.stdout).text()
		]);

		expect(exitCode).not.toBe(0);
		expect(`${stdout}\n${stderr}`).toContain(
			'does not belong to the certificate'
		);
		expect(await fetch(`http://localhost:${port}/`).catch(() => null)).toBe(
			null
		);
	}, 30_000);
});

describe('the cases that must not change', () => {
	test('with no certificate, production is plain HTTP as before', async () => {
		const port = await getAvailablePort();
		const server = start(port, {});
		try {
			const deadline = Date.now() + STARTUP_TIMEOUT_MS;
			const attempt = async (): Promise<string> => {
				const response = await fetch(`http://localhost:${port}/`).catch(
					() => null
				);
				if (response?.ok) return response.text();
				if (Date.now() > deadline) throw new Error('No HTTP server.');
				await Bun.sleep(POLL_INTERVAL_MS);

				return attempt();
			};

			expect(await attempt()).toBe('served');
		} finally {
			server.kill();
			await server.exited;
		}
	}, 30_000);

	/* The build runs the server for a moment to render static pages and
	 * fetches them over plain HTTP. A project with `tls` configured must
	 * still be able to build. */
	test('the build-time prerender server stays on plain HTTP', async () => {
		const port = await getAvailablePort();
		const server = start(port, {
			...tlsEnv(site),
			ABSOLUTE_PRERENDER: '1'
		});
		try {
			const deadline = Date.now() + STARTUP_TIMEOUT_MS;
			const attempt = async (): Promise<string> => {
				const response = await fetch(`http://localhost:${port}/`).catch(
					() => null
				);
				if (response?.ok) return response.text();
				if (Date.now() > deadline) throw new Error('No HTTP server.');
				await Bun.sleep(POLL_INTERVAL_MS);

				return attempt();
			};

			expect(await attempt()).toBe('served');
		} finally {
			server.kill();
			await server.exited;
		}
	}, 30_000);
});
