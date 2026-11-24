import { createPrivateKey, X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { TlsConfig } from '../../types/build';

/* TLS for a production server: the certificate and key the app terminates
 * HTTPS with itself, when nothing in front of it does.
 *
 * It used to be development only. `networking()` loaded the dev
 * certificate under `NODE_ENV === 'development'` and nothing else, and
 * HTTP/2 rode on that, so a production server could speak neither —
 * every deployment needed a proxy in front, including the single machine
 * that had no other use for one.
 *
 * Everything here FAILS rather than falls back. A server asked for HTTPS
 * that quietly starts on plain HTTP is the worst outcome available: it
 * looks up, and it is serving in the clear. A missing file, a key that
 * does not belong to the certificate and a wrong passphrase are each
 * said at startup, in words, instead of as a handshake error on the
 * first request.
 *
 * This file imports nothing from the framework, because a compiled
 * binary loads it on its own before the app exists. */

const MILLISECONDS_IN_A_DAY = 86_400_000;
const EXPIRY_WARNING_DAYS = 14;

type Environment = Record<string, string | undefined>;

type LoadTlsOptions = {
	/** What a relative path is resolved from. */
	cwd?: string;
	env?: Environment;
	/** The time expiry is judged against, for tests. */
	now?: number;
};

const settingsFrom = (config: TlsConfig | undefined, env: Environment) => ({
	ca: env.ABSOLUTE_TLS_CA ?? config?.ca,
	cert: env.ABSOLUTE_TLS_CERT ?? config?.cert,
	http2:
		env.ABSOLUTE_TLS_HTTP2 === undefined
			? config?.http2 !== false
			: env.ABSOLUTE_TLS_HTTP2 !== 'false',
	key: env.ABSOLUTE_TLS_KEY ?? config?.key,
	passphrase: env.ABSOLUTE_TLS_PASSPHRASE
});

const readPem = (path: string, what: string, cwd: string) => {
	const absolute = resolve(cwd, path);
	try {
		return readFileSync(absolute, 'utf-8');
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		throw new Error(
			`TLS: cannot read the ${what} at ${absolute} (${reason}). The server did not start, rather than start without HTTPS.`,
			{ cause: error }
		);
	}
};

const parseCertificate = (pem: string, path: string) => {
	try {
		return new X509Certificate(pem);
	} catch (error) {
		throw new Error(
			`TLS: ${path} is not a PEM certificate. It should begin with "-----BEGIN CERTIFICATE-----".`,
			{ cause: error }
		);
	}
};

const parseKey = (pem: string, path: string, passphrase?: string) => {
	try {
		return createPrivateKey({ key: pem, passphrase });
	} catch (error) {
		const hint =
			passphrase === undefined
				? 'If the key is encrypted, set ABSOLUTE_TLS_PASSPHRASE.'
				: 'Check ABSOLUTE_TLS_PASSPHRASE.';
		throw new Error(
			`TLS: ${path} could not be read as a private key. ${hint}`,
			{ cause: error }
		);
	}
};

const expiryWarning = (
	certificate: X509Certificate,
	path: string,
	now: number
) => {
	const expires = new Date(certificate.validTo).getTime();
	const days = Math.floor((expires - now) / MILLISECONDS_IN_A_DAY);
	if (days < 0)
		return `TLS: the certificate at ${path} expired on ${certificate.validTo}. Browsers will refuse it.`;
	if (days <= EXPIRY_WARNING_DAYS)
		return `TLS: the certificate at ${path} expires in ${days} day(s), on ${certificate.validTo}. A renewed certificate is picked up when the server restarts.`;

	return undefined;
};

/** The TLS a production server should listen with, or `null` when none is
 *  configured. Throws when it is configured and cannot be used. */
export const loadProductionTls = (
	config?: TlsConfig,
	{
		cwd = process.cwd(),
		env = process.env,
		now = Date.now()
	}: LoadTlsOptions = {}
) => {
	const settings = settingsFrom(config, env);
	if (settings.cert === undefined && settings.key === undefined) return null;
	if (settings.cert === undefined || settings.key === undefined) {
		const missing = settings.cert === undefined ? 'certificate' : 'key';
		throw new Error(
			`TLS: a ${missing === 'key' ? 'certificate' : 'key'} is configured without a ${missing}. Set both \`tls.cert\` and \`tls.key\` (or ABSOLUTE_TLS_CERT and ABSOLUTE_TLS_KEY).`
		);
	}

	const cert = readPem(settings.cert, 'certificate', cwd);
	const key = readPem(settings.key, 'private key', cwd);
	const certificate = parseCertificate(cert, settings.cert);
	const privateKey = parseKey(key, settings.key, settings.passphrase);
	if (!certificate.checkPrivateKey(privateKey))
		throw new Error(
			`TLS: the key at ${settings.key} does not belong to the certificate at ${settings.cert}. They are from different pairs.`
		);

	return {
		/** Spread into `Bun.serve` / `app.listen`. */
		serve: {
			...(settings.http2 ? { http2: true } : {}),
			tls: {
				cert,
				key,
				...(settings.ca === undefined
					? {}
					: { ca: readPem(settings.ca, 'CA bundle', cwd) }),
				...(settings.passphrase === undefined
					? {}
					: { passphrase: settings.passphrase })
			}
		},
		warning: expiryWarning(certificate, settings.cert, now)
	};
};

/** `prepare()` knows the config and `networking()` reads the environment:
 *  this is what carries one to the other. The environment wins, so a
 *  deployment can point at its own certificate without a rebuild. */
export const publishTlsConfig = (
	config: TlsConfig | undefined,
	env: Environment = process.env
) => {
	if (config === undefined) return;
	env.ABSOLUTE_TLS_CERT ??= config.cert;
	env.ABSOLUTE_TLS_KEY ??= config.key;
	if (config.ca !== undefined) env.ABSOLUTE_TLS_CA ??= config.ca;
	if (config.http2 === false) env.ABSOLUTE_TLS_HTTP2 ??= 'false';
};
