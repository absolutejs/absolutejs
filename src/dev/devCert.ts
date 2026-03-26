import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { logInfo, logWarn } from '../utils/logger';

const CERT_DIR = join(process.cwd(), '.absolutejs');
const CERT_PATH = join(CERT_DIR, 'cert.pem');
const KEY_PATH = join(CERT_DIR, 'key.pem');
const CERT_VALIDITY_DAYS = 365;

const certFilesExist = () =>
	existsSync(CERT_PATH) && existsSync(KEY_PATH);

const isCertExpired = () => {
	try {
		const certPem = readFileSync(CERT_PATH, 'utf-8');
		// Parse the not-after date from the PEM certificate
		// X.509 certs have "Not After" in the text representation
		const proc = Bun.spawnSync(['openssl', 'x509', '-enddate', '-noout'], {
			stdin: new TextEncoder().encode(certPem)
		});
		const output = new TextDecoder().decode(proc.stdout).trim();
		// output: notAfter=Mar 25 12:00:00 2026 GMT
		const dateStr = output.replace('notAfter=', '');
		const expiryDate = new Date(dateStr);

		return expiryDate.getTime() < Date.now();
	} catch {
		// If we can't check, assume expired and regenerate
		return true;
	}
};

const hasMkcert = () => {
	try {
		const result = Bun.spawnSync(['mkcert', '-version'], {
			stderr: 'pipe',
			stdout: 'pipe'
		});

		return result.exitCode === 0;
	} catch {
		return false;
	}
};

const generateWithMkcert = () => {
	logInfo('Generating locally-trusted certificate with mkcert...');
	const result = Bun.spawnSync(
		[
			'mkcert',
			'-cert-file',
			CERT_PATH,
			'-key-file',
			KEY_PATH,
			'localhost',
			'127.0.0.1',
			'::1'
		],
		{ stderr: 'pipe', stdout: 'pipe' }
	);

	if (result.exitCode !== 0) {
		const err = new TextDecoder().decode(result.stderr);
		throw new Error(`mkcert failed: ${err}`);
	}

	logInfo('Certificate generated with mkcert (locally trusted, no browser warning)');
};

const generateSelfSigned = () => {
	logInfo('Generating self-signed certificate for HTTPS dev server...');

	// Use Bun's native crypto to generate a self-signed cert
	// This avoids requiring openssl on the user's machine
	const proc = Bun.spawnSync(
		[
			'openssl',
			'req',
			'-x509',
			'-newkey',
			'ec',
			'-pkeyopt',
			'ec_paramgen_curve:prime256v1',
			'-days',
			String(CERT_VALIDITY_DAYS),
			'-nodes',
			'-keyout',
			KEY_PATH,
			'-out',
			CERT_PATH,
			'-subj',
			'/CN=localhost',
			'-addext',
			'subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1'
		],
		{ stderr: 'pipe', stdout: 'pipe' }
	);

	if (proc.exitCode !== 0) {
		const err = new TextDecoder().decode(proc.stderr);
		throw new Error(`openssl failed: ${err}`);
	}

	logInfo(
		'Self-signed certificate generated (one-time browser warning on first visit)'
	);
};

export const ensureDevCert = () => {
	mkdirSync(CERT_DIR, { recursive: true });

	if (certFilesExist() && !isCertExpired()) {
		return { cert: CERT_PATH, key: KEY_PATH };
	}

	if (certFilesExist()) {
		logWarn('Dev certificate expired, regenerating...');
	}

	try {
		if (hasMkcert()) {
			generateWithMkcert();
		} else {
			generateSelfSigned();
		}
	} catch (err) {
		logWarn(
			`Failed to generate HTTPS certificate: ${err instanceof Error ? err.message : err}`
		);

		return null;
	}

	return { cert: CERT_PATH, key: KEY_PATH };
};

export const loadDevCert = () => {
	const paths = ensureDevCert();
	if (!paths) return null;

	try {
		return {
			cert: readFileSync(paths.cert, 'utf-8'),
			key: readFileSync(paths.key, 'utf-8')
		};
	} catch {
		return null;
	}
};
