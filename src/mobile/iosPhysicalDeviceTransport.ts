import { randomUUID, X509Certificate } from 'node:crypto';
import { createServer, type Server as HttpServer } from 'node:http';
import {
	connect as connectTcp,
	createServer as createTcpServer,
	isIP,
	type Server as TcpServer
} from 'node:net';
import { readFile } from 'node:fs/promises';

export type AbsoluteIosCloseableServer = {
	close: () => Promise<void>;
};

export type AbsoluteIosCaEnrollmentServer = AbsoluteIosCloseableServer & {
	url: string;
};

const closeServer = (server: HttpServer | TcpServer) =>
	new Promise<void>((resolve, reject) => {
		server.close((error) => {
			if (error) reject(error);
			else resolve();
		});
	});

const listen = (server: HttpServer | TcpServer, port: number) =>
	new Promise<number>((resolve, reject) => {
		server.once('error', reject);
		server.listen(port, '0.0.0.0', () => {
			server.off('error', reject);
			const address = server.address();
			if (!address || typeof address === 'string') {
				reject(
					new Error('Could not determine the iOS device helper port.')
				);

				return;
			}
			resolve(address.port);
		});
	});

const findEphemeralPort = async () => {
	const probe = createTcpServer();
	const port = await new Promise<number>((resolve, reject) => {
		probe.once('error', reject);
		probe.listen(0, '127.0.0.1', () => {
			const address = probe.address();
			if (!address || typeof address === 'string') {
				reject(
					new Error('Could not allocate the iOS CA enrollment port.')
				);

				return;
			}
			resolve(address.port);
		});
	});
	await closeServer(probe);

	return port;
};

export const normalizeAbsoluteIosDeviceHost = (value: string) => {
	const normalized = value.trim();
	if (!normalized || normalized.length > 253 || /[\0\s/?#]/u.test(normalized))
		throw new TypeError(
			'Physical iOS development requires a valid LAN host.'
		);

	return normalized;
};
export const normalizeAbsoluteIosDeviceIdentifier = (value: string) => {
	const normalized = value.trim();
	if (!normalized || normalized.length > 256 || /[\0\r\n]/u.test(normalized))
		throw new TypeError(
			'--ios-device requires a valid Xcode device identifier or name.'
		);

	return normalized;
};

const urlForHost = (protocol: 'http' | 'https', host: string, port: number) => {
	const url = new URL(`${protocol}://localhost:${port}`);
	const normalizedHost = normalizeAbsoluteIosDeviceHost(host);
	url.hostname =
		isIP(normalizedHost) === 6 ? `[${normalizedHost}]` : normalizedHost;

	return url;
};

export const startAbsoluteIosCaEnrollmentServer = async (options: {
	certificateAuthorityPath: string;
	displayHost: string;
}): Promise<AbsoluteIosCaEnrollmentServer> => {
	const certificate = new X509Certificate(
		await readFile(options.certificateAuthorityPath)
	);
	const certificateBytes = certificate.raw;
	const token = randomUUID().replaceAll('-', '');
	const certificatePath = `/${token}/absolutejs-development-ca.cer`;
	const server = createServer((request, response) => {
		if (request.method !== 'GET' || request.url !== certificatePath) {
			response.writeHead(404, {
				'Cache-Control': 'no-store',
				'Content-Type': 'text/plain; charset=utf-8'
			});
			response.end('Not found.');

			return;
		}
		response.writeHead(200, {
			'Cache-Control': 'no-store',
			'Content-Disposition':
				'attachment; filename="absolutejs-development-ca.cer"',
			'Content-Length': String(certificateBytes.byteLength),
			'Content-Type': 'application/x-x509-ca-cert',
			'X-Content-Type-Options': 'nosniff'
		});
		response.end(certificateBytes);
	});
	const port = await findEphemeralPort();
	await listen(server, port);
	const url = urlForHost('http', options.displayHost, port);
	url.pathname = certificatePath;

	return {
		url: url.href,
		close: () => closeServer(server)
	};
};

export const startAbsoluteIosTcpRelay = async (options: {
	listenPort: number;
	targetPort: number;
}): Promise<AbsoluteIosCloseableServer> => {
	const server = createTcpServer((downstream) => {
		const upstream = connectTcp({
			host: '127.0.0.1',
			port: options.targetPort
		});
		downstream.pipe(upstream);
		upstream.pipe(downstream);
		const closePeer = () => {
			downstream.destroy();
			upstream.destroy();
		};
		downstream.once('error', closePeer);
		upstream.once('error', closePeer);
	});
	await listen(server, options.listenPort);

	return { close: () => closeServer(server) };
};
