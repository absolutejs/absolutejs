import { resolve } from 'node:path';
import type { MobileConfig, MobilePlatform } from '../../types/build';

export type NormalizedAbsoluteMobileConfig = {
	appId: string;
	appName: string;
	bundleDirectory: string;
	deepLinkHosts: string[];
	deepLinkScheme?: string;
	engine: 'capacitor';
	entry: string;
	nativeProjectDirectory: string;
	platforms: MobilePlatform[];
	productionOrigin: string;
};

const APP_ID_PATTERN = /^[A-Za-z][\w]*(?:\.[A-Za-z][\w]*)+$/;
const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*$/;

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
	if (parsed.protocol !== 'https:') {
		throw new TypeError(
			'mobile.server.productionOrigin must use HTTPS in production.'
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
	const normalized = new Set<string>([new URL(productionOrigin).hostname]);
	for (const host of hosts ?? []) {
		const value = requireText(host, 'mobile.deepLinks.hosts');
		if (value.includes('/') || value.includes(':')) {
			throw new TypeError(
				'mobile.deepLinks.hosts entries must be hostnames without ports or paths.'
			);
		}
		normalized.add(value.toLowerCase());
	}

	return [...normalized].sort();
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
	const deepLinkScheme = config.deepLinks?.scheme?.trim().toLowerCase();
	if (deepLinkScheme && !SCHEME_PATTERN.test(deepLinkScheme)) {
		throw new TypeError(
			'mobile.deepLinks.scheme is not a valid URL scheme.'
		);
	}

	return {
		appId,
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
		nativeProjectDirectory: resolveProjectPath(
			projectRoot,
			config.nativeProject?.directory ?? 'mobile',
			'mobile.nativeProject.directory'
		),
		platforms: normalizePlatforms(config.platforms),
		productionOrigin
	};
};
