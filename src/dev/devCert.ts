import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { platform } from 'node:os';
import { join } from 'node:path';

const CERT_DIR = join(process.cwd(), '.absolutejs');
const CERT_PATH = join(CERT_DIR, 'cert.pem');
const KEY_PATH = join(CERT_DIR, 'key.pem');
const CERT_VALIDITY_DAYS = 365;

// Neutral log that doesn't use [hmr] tag
const devLog = (msg: string) =>
	console.log(
		`\x1b[2m${new Date().toLocaleTimeString()}\x1b[0m \x1b[36m[dev]\x1b[0m ${msg}`
	);

const devWarn = (msg: string) =>
	console.log(
		`\x1b[2m${new Date().toLocaleTimeString()}\x1b[0m \x1b[33m[dev]\x1b[0m \x1b[33m${msg}\x1b[0m`
	);

const certFilesExist = () => existsSync(CERT_PATH) && existsSync(KEY_PATH);

const isCertExpired = () => {
	try {
		const certPem = readFileSync(CERT_PATH, 'utf-8');
		const proc = Bun.spawnSync(['openssl', 'x509', '-enddate', '-noout'], {
			stdin: new TextEncoder().encode(certPem)
		});
		const output = new TextDecoder().decode(proc.stdout).trim();
		const dateStr = output.replace('notAfter=', '');
		const expiryDate = new Date(dateStr);

		return expiryDate.getTime() < Date.now();
	} catch {
		return true;
	}
};

export const hasMkcert = () => {
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
	devLog('Generating locally-trusted certificate with mkcert...');
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

	devLog('HTTPS enabled with locally-trusted certificate (mkcert)');
};

const generateSelfSigned = () => {
	devLog('Generating self-signed certificate...');

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

	devLog('HTTPS enabled with self-signed certificate');
	devLog(
		'For a trusted certificate (no browser warning), install mkcert:'
	);
	devLog(
		'  brew install mkcert && mkcert -install  (macOS)'
	);
	devLog(
		'  sudo apt install mkcert && mkcert -install  (Linux)'
	);
	devLog('Then restart the dev server.');
};

export const ensureDevCert = () => {
	mkdirSync(CERT_DIR, { recursive: true });

	if (certFilesExist() && !isCertExpired()) {
		if (hasMkcert()) {
			devLog('HTTPS enabled with locally-trusted certificate (mkcert)');
		} else {
			devLog('HTTPS enabled with self-signed certificate');
		}

		return { cert: CERT_PATH, key: KEY_PATH };
	}

	if (certFilesExist()) {
		devWarn('Dev certificate expired, regenerating...');
	}

	try {
		if (hasMkcert()) {
			generateWithMkcert();
		} else {
			generateSelfSigned();
		}
	} catch (err) {
		devWarn(
			`Failed to generate certificate: ${err instanceof Error ? err.message : err}`
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

const commandExists = (cmd: string) => {
	try {
		const check =
			platform() === 'win32' ? ['where', cmd] : ['command', '-v', cmd];
		const result = Bun.spawnSync(check, {
			stderr: 'pipe',
			stdout: 'pipe'
		});

		return result.exitCode === 0;
	} catch {
		return false;
	}
};

const installMkcert = () => {
	const os = platform();

	if (os === 'darwin') {
		if (commandExists('brew')) {
			devLog('Installing mkcert with Homebrew...');
			const r = Bun.spawnSync(['brew', 'install', 'mkcert'], {
				stderr: 'pipe',
				stdout: 'pipe'
			});
			if (r.exitCode === 0) return true;
		}
		devWarn('Install Homebrew first: https://brew.sh');

		return false;
	}

	if (os === 'linux') {
		if (commandExists('apt-get')) {
			devLog('Installing mkcert with apt...');
			const r = Bun.spawnSync(
				['sudo', 'apt-get', 'install', '-y', 'mkcert'],
				{ stderr: 'pipe', stdout: 'pipe' }
			);
			if (r.exitCode === 0) return true;
		}
		if (commandExists('dnf')) {
			devLog('Installing mkcert with dnf...');
			const r = Bun.spawnSync(
				['sudo', 'dnf', 'install', '-y', 'mkcert'],
				{ stderr: 'pipe', stdout: 'pipe' }
			);
			if (r.exitCode === 0) return true;
		}
		if (commandExists('pacman')) {
			devLog('Installing mkcert with pacman...');
			const r = Bun.spawnSync(
				['sudo', 'pacman', '-S', '--noconfirm', 'mkcert'],
				{ stderr: 'pipe', stdout: 'pipe' }
			);
			if (r.exitCode === 0) return true;
		}

		// Fallback: try go install
		if (commandExists('go')) {
			devLog('Installing mkcert with go install...');
			const r = Bun.spawnSync(
				[
					'go',
					'install',
					'filippo.io/mkcert@latest'
				],
				{ stderr: 'pipe', stdout: 'pipe' }
			);
			if (r.exitCode === 0) return true;
		}

		devWarn('Could not install mkcert automatically.');
		console.log('  See: https://github.com/FiloSottile/mkcert#installation');

		return false;
	}

	if (os === 'win32') {
		if (commandExists('choco')) {
			devLog('Installing mkcert with Chocolatey...');
			const r = Bun.spawnSync(['choco', 'install', '-y', 'mkcert'], {
				stderr: 'pipe',
				stdout: 'pipe'
			});
			if (r.exitCode === 0) return true;
		}
		if (commandExists('winget')) {
			devLog('Installing mkcert with winget...');
			const r = Bun.spawnSync(
				['winget', 'install', '--id', 'FiloSottile.mkcert', '-e'],
				{ stderr: 'pipe', stdout: 'pipe' }
			);
			if (r.exitCode === 0) return true;
		}

		devWarn('Could not install mkcert automatically.');
		console.log('  See: https://github.com/FiloSottile/mkcert#installation');

		return false;
	}

	return false;
};

// CLI command: install mkcert, set up CA, regenerate cert
export const setupMkcert = () => {
	devLog('Setting up mkcert for locally-trusted HTTPS...');

	if (!hasMkcert()) {
		devLog('mkcert not found — installing...');
		if (!installMkcert()) return false;

		// Verify it installed
		if (!hasMkcert()) {
			devWarn(
				'mkcert installed but not found in PATH. Restart your terminal and try again.'
			);

			return false;
		}
	}

	// Install the local CA (adds to system trust store)
	devLog('Installing local certificate authority...');
	const installResult = Bun.spawnSync(['mkcert', '-install'], {
		stderr: 'pipe',
		stdout: 'pipe'
	});

	if (installResult.exitCode !== 0) {
		devWarn(
			'Failed to install CA: ' +
				new TextDecoder().decode(installResult.stderr)
		);

		return false;
	}

	// Remove old cert to force regeneration with mkcert
	rmSync(CERT_PATH, { force: true });
	rmSync(KEY_PATH, { force: true });

	// Generate new trusted cert
	mkdirSync(CERT_DIR, { recursive: true });
	generateWithMkcert();
	console.log('');
	devLog('Done! Restart your dev server — no more browser warnings.');

	return true;
};
