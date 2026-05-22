import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hasMkcert } from '../../dev/devCert';

const CERT_DIR = resolve(process.cwd(), '.absolutejs');

export type ConfigCert = {
	cert: string;
	key: string;
};

const certPathsFor = (host: string) => {
	const safe = host.replace(/[^a-zA-Z0-9.-]/g, '_');

	return {
		cert: resolve(CERT_DIR, `config-${safe}.cert.pem`),
		key: resolve(CERT_DIR, `config-${safe}.key.pem`)
	};
};

const readPem = (certPath: string, keyPath: string) => {
	try {
		const cert: ConfigCert = {
			cert: readFileSync(certPath, 'utf-8'),
			key: readFileSync(keyPath, 'utf-8')
		};

		return cert;
	} catch {
		return null;
	}
};

/**
 * Produce a TLS cert/key covering `host` (a `*.localhost` subdomain that
 * browsers resolve to loopback) plus localhost + loopback IPs, reusing the
 * mkcert toolchain AbsoluteJS already relies on for dev HTTPS. Certs are
 * cached per host under `.absolutejs/`. Returns `null` when mkcert isn't
 * available so the caller can fall back to plain HTTP.
 */
export const ensureConfigCert = (host: string) => {
	mkdirSync(CERT_DIR, { recursive: true });
	const paths = certPathsFor(host);

	if (existsSync(paths.cert) && existsSync(paths.key)) {
		return readPem(paths.cert, paths.key);
	}

	if (!hasMkcert()) return null;

	const result = Bun.spawnSync(
		[
			'mkcert',
			'-cert-file',
			paths.cert,
			'-key-file',
			paths.key,
			host,
			'localhost',
			'127.0.0.1',
			'::1'
		],
		{ stderr: 'pipe', stdout: 'pipe' }
	);
	if (result.exitCode !== 0) return null;

	return readPem(paths.cert, paths.key);
};
