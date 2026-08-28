import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync
} from 'node:fs';
import { X509Certificate } from 'node:crypto';
import { isIP } from 'node:net';
import { platform } from 'node:os';
import { join } from 'node:path';

const CERT_DIR = join(process.cwd(), '.absolutejs');
const CERT_PATH = join(CERT_DIR, 'cert.pem');
const KEY_PATH = join(CERT_DIR, 'key.pem');
const CERT_VALIDITY_DAYS = 365;
const DEFAULT_CERTIFICATE_HOSTS = ['localhost', '127.0.0.1', '::1'];
const CERTIFICATE_HOSTNAME_PATTERN =
	/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/u;

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

export const normalizeDevCertificateHosts = (hosts: readonly string[] = []) => {
	const normalized = new Set(DEFAULT_CERTIFICATE_HOSTS);
	for (const host of hosts) {
		const value = host.trim().toLowerCase();
		if (!value || value === '0.0.0.0' || value === '::') continue;
		if (isIP(value) === 0 && !CERTIFICATE_HOSTNAME_PATTERN.test(value)) {
			throw new TypeError(
				`Invalid development certificate host: ${host}`
			);
		}
		normalized.add(value);
	}

	return [...normalized];
};

const certificateIsUsable = (hosts: readonly string[]) => {
	try {
		const certPem = readFileSync(CERT_PATH, 'utf-8');
		const certificate = new X509Certificate(certPem);
		if (new Date(certificate.validTo).getTime() <= Date.now()) return false;

		return normalizeDevCertificateHosts(hosts).every((host) =>
			isIP(host)
				? certificate.checkIP(host) !== undefined
				: certificate.checkHost(host) !== undefined
		);
	} catch {
		return false;
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

const generateWithMkcert = (hosts: readonly string[] = []) => {
	const result = Bun.spawnSync(
		[
			'mkcert',
			'-cert-file',
			CERT_PATH,
			'-key-file',
			KEY_PATH,
			...normalizeDevCertificateHosts(hosts)
		],
		{ stderr: 'pipe', stdout: 'pipe' }
	);

	if (result.exitCode !== 0) {
		const err = new TextDecoder().decode(result.stderr);
		throw new Error(`mkcert failed: ${err}`);
	}
};

const generateSelfSigned = (hosts: readonly string[] = []) => {
	const subjectAlternativeNames = normalizeDevCertificateHosts(hosts)
		.map((host) => `${isIP(host) ? 'IP' : 'DNS'}:${host}`)
		.join(',');
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
			`subjectAltName=${subjectAlternativeNames}`
		],
		{ stderr: 'pipe', stdout: 'pipe' }
	);

	if (proc.exitCode !== 0) {
		const err = new TextDecoder().decode(proc.stderr);
		throw new Error(`openssl failed: ${err}`);
	}

	devLog(
		'Using self-signed certificate — browser will show a one-time warning'
	);
};

const generateCert = (hosts: readonly string[] = []) => {
	if (hasMkcert()) {
		generateWithMkcert(hosts);
	} else {
		generateSelfSigned(hosts);
	}
};

export const ensureDevCert = (hosts: readonly string[] = []) => {
	mkdirSync(CERT_DIR, { recursive: true });

	// Cert exists and valid — reuse silently
	if (hasCert(hosts)) {
		return { cert: CERT_PATH, key: KEY_PATH };
	}

	// Expired — regenerate silently
	if (certFilesExist()) {
		devLog(
			'Certificate is expired or missing a required host, regenerating...'
		);
	}

	try {
		generateCert(hosts);
	} catch (err) {
		devWarn(
			`Failed to generate certificate: ${err instanceof Error ? err.message : err}`
		);

		return null;
	}

	return { cert: CERT_PATH, key: KEY_PATH };
};
export const hasCert = (hosts: readonly string[] = []) =>
	certFilesExist() && certificateIsUsable(hosts);
export const loadDevCert = (hosts: readonly string[] = []) => {
	const paths = ensureDevCert(hosts);
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
		const check = platform() === 'win32' ? ['where', cmd] : ['which', cmd];
		const result = Bun.spawnSync(check, {
			stderr: 'pipe',
			stdout: 'pipe'
		});

		return result.exitCode === 0;
	} catch {
		return false;
	}
};

const installMkcertDarwin = () => {
	if (!commandExists('brew')) {
		devWarn('Install Homebrew first: https://brew.sh');

		return false;
	}

	devLog('Installing mkcert with Homebrew...');
	const result = Bun.spawnSync(['brew', 'install', 'mkcert'], {
		stderr: 'pipe',
		stdout: 'pipe'
	});

	return result.exitCode === 0;
};

const installMkcertLinux = () => {
	// stdin + stderr inherit for password prompt, stdout piped to hide package logs
	const sudoOpts: { stderr: 'inherit'; stdin: 'inherit'; stdout: 'pipe' } = {
		stderr: 'inherit',
		stdin: 'inherit',
		stdout: 'pipe'
	};

	if (commandExists('apt-get')) {
		devLog('Installing mkcert (may prompt for password)...');
		// Install mkcert + libnss3-tools (certutil) together
		// so mkcert -install can add the CA to browser trust stores
		const result = Bun.spawnSync(
			['sudo', 'apt-get', 'install', '-y', 'mkcert', 'libnss3-tools'],
			sudoOpts
		);
		if (result.exitCode === 0) return true;
	}

	if (commandExists('dnf')) {
		devLog('Installing mkcert (may prompt for password)...');
		const result = Bun.spawnSync(
			['sudo', 'dnf', 'install', '-y', 'mkcert'],
			sudoOpts
		);
		if (result.exitCode === 0) return true;
	}

	if (commandExists('pacman')) {
		devLog('Installing mkcert (may prompt for password)...');
		const result = Bun.spawnSync(
			['sudo', 'pacman', '-S', '--noconfirm', 'mkcert'],
			sudoOpts
		);
		if (result.exitCode === 0) return true;
	}

	devWarn('Could not install mkcert automatically.');
	console.log('  See: https://github.com/FiloSottile/mkcert#installation');

	return false;
};

const installMkcertWin32 = () => {
	if (commandExists('choco')) {
		devLog('Installing mkcert with Chocolatey...');
		const result = Bun.spawnSync(['choco', 'install', '-y', 'mkcert'], {
			stderr: 'pipe',
			stdout: 'pipe'
		});
		if (result.exitCode === 0) return true;
	}

	if (commandExists('winget')) {
		devLog('Installing mkcert with winget...');
		const result = Bun.spawnSync(
			['winget', 'install', '--id', 'FiloSottile.mkcert', '-e'],
			{ stderr: 'pipe', stdout: 'pipe' }
		);
		if (result.exitCode === 0) return true;
	}

	devWarn('Could not install mkcert automatically.');
	console.log('  See: https://github.com/FiloSottile/mkcert#installation');

	return false;
};

const installMkcert = () => {
	const osPlatform = platform();

	if (osPlatform === 'darwin') return installMkcertDarwin();
	if (osPlatform === 'linux') return installMkcertLinux();
	if (osPlatform === 'win32') return installMkcertWin32();

	return false;
};

const ensureMkcert = () => {
	if (hasMkcert()) return true;
	if (!installMkcert()) return false;

	// Verify it installed
	if (!hasMkcert()) {
		devWarn(
			'mkcert installed but not found in PATH. Restart your terminal and try again.'
		);

		return false;
	}

	return true;
};

const isWSL = () => {
	if (platform() !== 'linux') return false;
	try {
		return /microsoft|wsl/i.test(readFileSync('/proc/version', 'utf-8'));
	} catch {
		return false;
	}
};

const runCapture = (cmd: string[]) => {
	try {
		const result = Bun.spawnSync(cmd, { stderr: 'pipe', stdout: 'pipe' });
		if (result.exitCode !== 0) return null;
		const out = new TextDecoder().decode(result.stdout).trim();

		return out || null;
	} catch {
		return null;
	}
};

const mkcertCaRoot = () => runCapture(['mkcert', '-CAROOT']);
export const getDevCertificateAuthorityPath = () => {
	const caRoot = hasMkcert() ? mkcertCaRoot() : null;
	const rootCertificate = caRoot ? join(caRoot, 'rootCA.pem') : null;
	if (rootCertificate && existsSync(rootCertificate)) return rootCertificate;
	if (certFilesExist()) return CERT_PATH;

	return null;
};
const toWindowsPath = (linuxPath: string) =>
	runCapture(['wslpath', '-w', linuxPath]);
const windowsTempDir = () => {
	const winTemp = runCapture(['cmd.exe', '/c', 'echo %TEMP%']);
	if (!winTemp) return null;

	return runCapture(['wslpath', '-u', winTemp]);
};

/**
 * Under WSL the browser runs on Windows, whose trust store never receives the
 * CA that `mkcert -install` added on the Linux side — so dev HTTPS shows as
 * untrusted there. Stage mkcert's rootCA in a Windows-visible temp dir and
 * import it into the current user's Root store via PowerShell (no admin, no GUI
 * prompt, idempotent). Returns true when the CA is trusted on Windows.
 */
const trustCaOnWindows = () => {
	const caRoot = mkcertCaRoot();
	if (!caRoot) return false;
	const rootCa = join(caRoot, 'rootCA.pem');
	if (!existsSync(rootCa)) return false;

	const winTemp = windowsTempDir();
	if (!winTemp) return false;

	const staged = join(winTemp, 'absolutejs-mkcert-rootCA.crt');
	try {
		copyFileSync(rootCa, staged);
	} catch {
		return false;
	}

	const stagedWin = toWindowsPath(staged);
	if (!stagedWin) {
		rmSync(staged, { force: true });

		return false;
	}

	const result = Bun.spawnSync(
		[
			'powershell.exe',
			'-NoProfile',
			'-Command',
			`Import-Certificate -FilePath '${stagedWin}' -CertStoreLocation Cert:\\CurrentUser\\Root`
		],
		{ stderr: 'pipe', stdout: 'pipe' }
	);
	rmSync(staged, { force: true });

	return result.exitCode === 0;
};

// CLI command: install mkcert, set up CA, regenerate cert
export const setupMkcert = (hosts: readonly string[] = []) => {
	if (!ensureMkcert()) return false;

	// Install the local CA (adds to system trust store)
	const installResult = Bun.spawnSync(['mkcert', '-install'], {
		stderr: 'pipe',
		stdin: 'inherit',
		stdout: 'pipe'
	});

	if (installResult.exitCode !== 0) {
		devWarn('Failed to install local CA');

		return false;
	}

	// On WSL the Linux trust store the step above wrote to is invisible to the
	// Windows browser; mirror the CA into the Windows store so HTTPS is trusted.
	if (isWSL()) {
		if (trustCaOnWindows()) {
			devLog(
				'Trusted the local CA in the Windows store — Chrome/Edge on Windows now accept dev HTTPS'
			);
		} else {
			const caRoot = mkcertCaRoot();
			const hint = caRoot
				? toWindowsPath(join(caRoot, 'rootCA.pem'))
				: null;
			devWarn(
				'Could not auto-trust the local CA on Windows; Windows browsers may warn.'
			);
			if (hint) {
				console.log(
					`  Run in PowerShell: Import-Certificate -FilePath "${hint}" -CertStoreLocation Cert:\\CurrentUser\\Root`
				);
			}
		}
	}

	// Remove old cert to force regeneration with mkcert
	rmSync(CERT_PATH, { force: true });
	rmSync(KEY_PATH, { force: true });

	// Generate new trusted cert
	mkdirSync(CERT_DIR, { recursive: true });
	generateWithMkcert(hosts);
	console.log('');
	devLog('mkcert installed — HTTPS certificates are now locally trusted');

	return true;
};
