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
	engine: 'capacitor' | 'expo';
	entry: string;
	expoNativeRoutes: Record<string, string>;
	expoSdkVersion?: 57;
	iosVersion?: string;
	nativeProjectDirectory: string;
	platforms: MobilePlatform[];
	productionOrigin: string;
	pushAndroidGoogleServicesFile: string;
};

const APP_ID_PATTERN = /^[A-Za-z][\w]*(?:\.[A-Za-z][\w]*)+$/;
const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*$/;
const APPLE_APP_ID_PREFIX_PATTERN = /^[A-Z0-9]{10}$/;
const CERTIFICATE_FINGERPRINT_PATTERN = /^[0-9A-F]{64}$/;
const HOSTNAME_PATTERN =
	/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/;
const EXPO_RESERVED_ROUTE_PREFIXES = new Set([
	'_expo',
	'_flight',
	'_sitemap',
	'assets',
	'expo-dev-plugins',
	'inspector',
	'manifest',
	'public'
]);

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

const validateExpoNativeRouteSegment = (
	path: string,
	segment: string,
	index: number,
	count: number,
	parameters: Set<string>
) => {
	if (segment === '*' && (index !== count - 1 || count === 1)) {
		throw new TypeError(
			`mobile.routes.native route ${path} must use * once, as the final segment after a static or parameterized prefix.`
		);
	}
	if (segment === '*') return;
	if (
		!segment.startsWith(':') &&
		(segment.includes('*') || segment.includes(':'))
	) {
		throw new TypeError(
			`mobile.routes.native route ${path} contains invalid segment ${segment}.`
		);
	}
	if (!segment.startsWith(':')) return;
	const name = segment.slice(1);
	if (!/^[A-Za-z][A-Za-z0-9_]*$/u.test(name)) {
		throw new TypeError(
			`mobile.routes.native route ${path} has invalid parameter ${segment}.`
		);
	}
	if (parameters.has(name)) {
		throw new TypeError(
			`mobile.routes.native route ${path} repeats parameter ${segment}.`
		);
	}
	parameters.add(name);
};

const normalizeExpoNativeRoutes = (
	config: MobileConfig,
	projectRoot: string
) => {
	if (config.engine !== 'expo') return {};
	const routes = config.routes?.native ?? {};
	const normalized: Record<string, string> = {};
	const ownership = new Map<string, string>();
	for (const [route, module] of Object.entries(routes)) {
		const path = normalizeEntry(route);
		if (
			path.includes('?') ||
			path.includes('#') ||
			(path !== '/' && path.endsWith('/'))
		) {
			throw new TypeError(
				`mobile.routes.native route ${path} must be a canonical path without a query, fragment, or trailing slash.`
			);
		}
		if (path === '/__absolute/native') {
			throw new TypeError(
				'mobile.routes.native reserves /__absolute/native for the Expo diagnostic screen.'
			);
		}
		const segments = path.split('/').filter(Boolean);
		if (segments[0] && EXPO_RESERVED_ROUTE_PREFIXES.has(segments[0])) {
			throw new TypeError(
				`mobile.routes.native route ${path} conflicts with an Expo Router or Metro reserved path.`
			);
		}
		const parameters = new Set<string>();
		segments.forEach((segment, index) =>
			validateExpoNativeRouteSegment(
				path,
				segment,
				index,
				segments.length,
				parameters
			)
		);
		const signature = segments
			.map((segment) => (segment.startsWith(':') ? ':' : segment))
			.join('/');
		const existing = ownership.get(signature);
		if (existing) {
			throw new TypeError(
				`mobile.routes.native routes ${existing} and ${path} claim the same Expo route pattern.`
			);
		}
		ownership.set(signature, path);
		normalized[path] = resolveProjectPath(
			projectRoot,
			requireText(module, `mobile.routes.native[${path}]`),
			`mobile.routes.native[${path}]`
		);
	}

	return Object.fromEntries(
		Object.entries(normalized).sort(([left], [right]) =>
			left.localeCompare(right)
		)
	);
};

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
		engine: config.engine ?? 'capacitor',
		entry: normalizeEntry(config.entry),
		expoNativeRoutes: normalizeExpoNativeRoutes(config, projectRoot),
		...(config.engine === 'expo'
			? { expoSdkVersion: config.expo?.sdkVersion ?? 57 }
			: {}),
		iosVersion: normalizeIosVersion(config.ios?.version),
		nativeProjectDirectory: resolveProjectPath(
			projectRoot,
			config.nativeProject?.directory ??
				(config.engine === 'expo'
					? '.absolutejs/mobile/expo'
					: 'mobile'),
			'mobile.nativeProject.directory'
		),
		platforms: normalizePlatforms(config.platforms),
		productionOrigin,
		pushAndroidGoogleServicesFile: resolveProjectPath(
			projectRoot,
			config.pushNotifications?.android?.googleServicesFile ??
				'google-services.json',
			'mobile.pushNotifications.android.googleServicesFile'
		)
	};
};
