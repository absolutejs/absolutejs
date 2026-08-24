import { resolve } from 'node:path';
import type { MobileConfig, MobilePlatform } from '../../types/build';

export type NormalizedAbsoluteMobileConfig = {
	appId: string;
	appName: string;
	androidCertificateFingerprints: string[];
	appleAppIdPrefix?: string;
	bundleDirectory: string;
	deepLinkHosts: string[];
	deepLinkScheme?: string;
	engine: 'capacitor';
	entry: string;
	iosVersion?: string;
	nativeProjectDirectory: string;
	platforms: MobilePlatform[];
	productionOrigin: string;
};

const APP_ID_PATTERN = /^[A-Za-z][\w]*(?:\.[A-Za-z][\w]*)+$/;
const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*$/;
const APPLE_APP_ID_PREFIX_PATTERN = /^[A-Z0-9]{10}$/;
const CERTIFICATE_FINGERPRINT_PATTERN = /^[0-9A-F]{64}$/;
const HOSTNAME_PATTERN =
	/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/;

const resolveProjectPath = (
	projectRoot: string,
	value: string,
	field: string
) => {
	const root = resolve(projectRoot);
	const path = resolve(root, value);
	if (path !== root && !path.startsWith(`${root}/`)) {
		throw new TypeError(`${field} must remain inside the project root.`);
	}

	return path;
};

const requireText = (value: string, field: string) => {
	const normalized = value.trim();
	if (!normalized) throw new TypeError(`${field} must not be empty.`);

	return normalized;
};

const normalizeEntry = (entry: string | undefined) => {
	const normalized = requireText(entry ?? '/', 'mobile.entry');
	if (!normalized.startsWith('/') || normalized.startsWith('//')) {
		throw new TypeError(
			'mobile.entry must be an absolute application path.'
		);
	}

	return normalized;
};

const normalizeProductionOrigin = (value: string) => {
	const parsed = new URL(
		requireText(value, 'mobile.server.productionOrigin')
	);
	const isLoopbackHttp =
		parsed.protocol === 'http:' &&
		(parsed.hostname === 'localhost' ||
			parsed.hostname === '127.0.0.1' ||
			parsed.hostname === '[::1]');
	if (parsed.protocol !== 'https:' && !isLoopbackHttp) {
		throw new TypeError(
			'mobile.server.productionOrigin must use HTTPS, except for a loopback development origin.'
		);
	}
	if (
		parsed.username ||
		parsed.password ||
		parsed.pathname !== '/' ||
		parsed.search ||
		parsed.hash
	) {
		throw new TypeError(
			'mobile.server.productionOrigin must be an origin without credentials, path, query, or hash.'
		);
	}

	return parsed.origin;
};

const normalizePlatforms = (
	platforms: readonly MobilePlatform[] | undefined
) => {
	const normalized: MobilePlatform[] = [
		...new Set<MobilePlatform>(platforms ?? ['ios', 'android'])
	];
	if (normalized.length === 0) {
		throw new TypeError(
			'mobile.platforms must contain at least one platform.'
		);
	}

	return normalized;
};

const normalizeHosts = (
	hosts: readonly string[] | undefined,
	productionOrigin: string
) => {
	const normalizeHostname = (host: string) => {
		const value = requireText(host, 'mobile.deepLinks.hosts').toLowerCase();
		if (!HOSTNAME_PATTERN.test(value)) {
			throw new TypeError(
				'mobile.deepLinks.hosts entries must be valid hostnames without ports, wildcards, or paths.'
			);
		}

		return value;
	};
	const productionHostname = new URL(productionOrigin).hostname;
	// IPv6 loopback is valid for a local backend preview but cannot be an
	// Android App Link or Apple Universal Link hostname.
	const normalized = new Set<string>(
		productionHostname === '[::1]'
			? []
			: [normalizeHostname(productionHostname)]
	);
	for (const host of hosts ?? []) {
		normalized.add(normalizeHostname(host));
	}

	return [...normalized].sort();
};

const normalizeAppleAppIdPrefix = (value: string | undefined) => {
	if (value === undefined) return undefined;
	const normalized = requireText(
		value,
		'mobile.deepLinks.apple.appIdPrefix'
	).toUpperCase();
	if (!APPLE_APP_ID_PREFIX_PATTERN.test(normalized)) {
		throw new TypeError(
			'mobile.deepLinks.apple.appIdPrefix must contain ten letters or digits.'
		);
	}

	return normalized;
};

const normalizeIosVersion = (value: string | undefined) => {
	if (value === undefined) return undefined;
	const normalized = requireText(value, 'mobile.ios.version');
	if (!/^\d+(?:\.\d+){0,2}$/u.test(normalized)) {
		throw new TypeError(
			'mobile.ios.version must contain one to three dot-separated integer components, for example 1.4.0.'
		);
	}

	return normalized;
};

const normalizeCertificateFingerprints = (
	values: readonly string[] | undefined
) =>
	[
		...new Set(
			(values ?? [])
				.map((value) =>
					requireText(
						value,
						'mobile.deepLinks.android.sha256CertificateFingerprints'
					)
						.replaceAll(':', '')
						.toUpperCase()
				)
				.map((value) => {
					if (!CERTIFICATE_FINGERPRINT_PATTERN.test(value)) {
						throw new TypeError(
							'mobile.deepLinks.android.sha256CertificateFingerprints entries must be SHA-256 certificate fingerprints.'
						);
					}

					return value.match(/.{2}/g)?.join(':') ?? value;
				})
		)
	].sort();

export const normalizeAbsoluteMobileConfig = (
	config: MobileConfig,
	projectRoot: string
): NormalizedAbsoluteMobileConfig => {
	const appId = requireText(config.appId, 'mobile.appId');
	if (!APP_ID_PATTERN.test(appId)) {
		throw new TypeError(
			'mobile.appId must use reverse-domain notation, for example com.example.app.'
		);
	}
	const productionOrigin = normalizeProductionOrigin(
		config.server.productionOrigin
	);
	const deepLinkScheme = (config.deepLinks?.scheme ?? appId)
		.trim()
		.toLowerCase();
	if (deepLinkScheme && !SCHEME_PATTERN.test(deepLinkScheme)) {
		throw new TypeError(
			'mobile.deepLinks.scheme is not a valid URL scheme.'
		);
	}

	return {
		androidCertificateFingerprints: normalizeCertificateFingerprints(
			config.deepLinks?.android?.sha256CertificateFingerprints
		),
		appId,
		appleAppIdPrefix: normalizeAppleAppIdPrefix(
			config.deepLinks?.apple?.appIdPrefix
		),
		appName: requireText(config.appName, 'mobile.appName'),
		bundleDirectory: resolveProjectPath(
			projectRoot,
			config.bundleDirectory ?? '.absolutejs/mobile/web',
			'mobile.bundleDirectory'
		),
		deepLinkHosts: normalizeHosts(
			config.deepLinks?.hosts,
			productionOrigin
		),
		deepLinkScheme,
		engine: 'capacitor',
		entry: normalizeEntry(config.entry),
		iosVersion: normalizeIosVersion(config.ios?.version),
		nativeProjectDirectory: resolveProjectPath(
			projectRoot,
			config.nativeProject?.directory ?? 'mobile',
			'mobile.nativeProject.directory'
		),
		platforms: normalizePlatforms(config.platforms),
		productionOrigin
	};
};
