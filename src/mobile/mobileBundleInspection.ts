import { createHash } from 'node:crypto';
import { access, readFile, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import type { NormalizedAbsoluteMobileConfig } from './config';
import { ABSOLUTE_MOBILE_PAGE_PROTOCOL_VERSION } from './pageProtocol';
import type { AbsoluteMobileCompatibilityRoute } from './releaseArtifact';
import { resolveAbsoluteMobileRoute } from './routeMatcher';
import { ABSOLUTE_MOBILE_CLIENT_MANIFEST_FORMAT } from './transport';

type JsonObject = Record<string, unknown>;

export type MobileBundleInspection = {
	appBuild?: string;
	auth?: boolean;
	capabilities?: string[];
	entryResolved?: boolean;
	frameworks?: string[];
	issue?: string;
	manifest: string;
	pageCount?: number;
	routeCount?: number;
	runtime?: string;
	status: 'invalid' | 'missing' | 'valid';
	sync?: boolean;
};

const MOBILE_FRAMEWORKS = new Set([
	'angular',
	'ember',
	'html',
	'htmx',
	'react',
	'svelte',
	'vue'
]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

const isObject = (value: unknown): value is JsonObject =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const portablePath = (projectRoot: string, path: string) => {
	const value = relative(resolve(projectRoot), resolve(path)).replaceAll(
		'\\',
		'/'
	);

	return value || '.';
};

const pathExists = async (path: string) => {
	try {
		await access(path);

		return true;
	} catch {
		return false;
	}
};

const readObject = async (path: string) => {
	const value: unknown = JSON.parse(await readFile(path, 'utf8'));
	if (!isObject(value)) throw new TypeError('JSON root must be an object.');

	return value;
};

const requireString = (value: unknown, field: string) => {
	if (typeof value !== 'string' || value.length === 0)
		throw new TypeError(`${field} must be a non-empty string.`);

	return value;
};

const requireStringArray = (value: unknown, field: string) => {
	if (
		!Array.isArray(value) ||
		!value.every((item): item is string => typeof item === 'string')
	)
		throw new TypeError(`${field} must be a string array.`);

	return value;
};

const requireBundleFile = async (
	root: string,
	value: unknown,
	field: string,
	expectedHash?: string
) => {
	const portable = requireString(value, field);
	const path = resolve(root, portable);
	const normalizedRoot = resolve(root);
	if (path === normalizedRoot || !path.startsWith(`${normalizedRoot}/`))
		throw new TypeError(`${field} must remain inside the mobile bundle.`);
	if (!(await stat(path).catch(() => undefined))?.isFile())
		throw new TypeError(`${field} does not exist in the mobile bundle.`);
	if (expectedHash !== undefined) {
		if (!SHA256_PATTERN.test(expectedHash))
			throw new TypeError(`${field} has an invalid SHA-256 digest.`);
		const actual = createHash('sha256')
			.update(await readFile(path))
			.digest('hex');
		if (actual !== expectedHash)
			throw new TypeError(`${field} failed its SHA-256 integrity check.`);
	}

	return portable;
};

export const inspectAbsoluteMobileBundle = async (
	config: NormalizedAbsoluteMobileConfig,
	projectRoot: string
) => {
	const manifestPath = join(
		config.bundleDirectory,
		'absolute-mobile-manifest.json'
	);
	const manifest = portablePath(projectRoot, manifestPath);
	if (!(await pathExists(manifestPath)))
		return { manifest, status: 'missing' } satisfies MobileBundleInspection;

	try {
		const value = await readObject(manifestPath);
		if (value.format !== ABSOLUTE_MOBILE_CLIENT_MANIFEST_FORMAT)
			throw new TypeError('format is not supported by this runtime.');
		if (requireString(value.appId, 'appId') !== config.appId)
			throw new TypeError(
				'appId does not match the effective mobile config.'
			);
		if (
			requireString(value.productionOrigin, 'productionOrigin') !==
			config.productionOrigin
		)
			throw new TypeError(
				'productionOrigin does not match the effective mobile config.'
			);
		const appBuild = requireString(value.appBuild, 'appBuild');
		const runtime = requireString(value.runtime, 'runtime');
		if (runtime !== String(ABSOLUTE_MOBILE_PAGE_PROTOCOL_VERSION))
			throw new TypeError(
				'runtime is not supported by this AbsoluteJS build.'
			);
		const capabilities = requireStringArray(
			value.deviceCapabilities,
			'deviceCapabilities'
		).sort();
		if (!Array.isArray(value.pages) || !Array.isArray(value.routes))
			throw new TypeError('pages and routes must be arrays.');
		const pageIds = new Set<string>();
		const frameworks = new Set<string>();
		await Promise.all(
			value.pages.map(async (candidate) => {
				if (!isObject(candidate))
					throw new TypeError('pages contains an invalid entry.');
				const pageId = requireString(candidate.pageId, 'page.pageId');
				if (pageIds.has(pageId))
					throw new TypeError('page.pageId values must be unique.');
				pageIds.add(pageId);
				const framework = requireString(
					candidate.framework,
					'page.framework'
				);
				if (!MOBILE_FRAMEWORKS.has(framework))
					throw new TypeError('page.framework is unsupported.');
				frameworks.add(framework);
				const bundleHash = requireString(
					candidate.bundleHash,
					'page.bundleHash'
				);
				requireString(candidate.contract, 'page.contract');
				requireString(
					candidate.propsSchemaHash,
					'page.propsSchemaHash'
				);
				await requireBundleFile(
					config.bundleDirectory,
					candidate.localBundlePath,
					'page.localBundlePath',
					bundleHash
				);
				if (candidate.localStylePath !== undefined) {
					const styleHash = requireString(
						candidate.styleBundleHash,
						'page.styleBundleHash'
					);
					await requireBundleFile(
						config.bundleDirectory,
						candidate.localStylePath,
						'page.localStylePath',
						styleHash
					);
				} else if (candidate.styleBundleHash !== undefined)
					throw new TypeError(
						'page.styleBundleHash requires page.localStylePath.'
					);
			})
		);
		const routes = value.routes.map<AbsoluteMobileCompatibilityRoute>(
			(candidate) => {
				if (!isObject(candidate))
					throw new TypeError('routes contains an invalid entry.');
				const { method } = candidate;
				if (method !== 'GET' && method !== 'HEAD')
					throw new TypeError('route.method must be GET or HEAD.');
				const pageId = requireString(candidate.pageId, 'route.pageId');
				if (!pageIds.has(pageId))
					throw new TypeError(
						'route.pageId references a missing page.'
					);

				return {
					method,
					pageId,
					pattern: requireString(candidate.pattern, 'route.pattern')
				};
			}
		);
		await Promise.all(
			['index.html', 'absolute-mobile-bootstrap.js'].map((file) =>
				requireBundleFile(config.bundleDirectory, file, file)
			)
		);
		const entryPath = new URL(config.entry, 'https://absolute.invalid')
			.pathname;
		const entryResolved =
			resolveAbsoluteMobileRoute(routes, entryPath) !== undefined;
		if (!entryResolved)
			throw new TypeError('entry is not owned by an embedded route.');

		return {
			appBuild,
			auth: isObject(value.auth),
			capabilities,
			entryResolved,
			frameworks: [...frameworks].sort(),
			manifest,
			pageCount: value.pages.length,
			routeCount: value.routes.length,
			runtime,
			status: 'valid',
			sync: isObject(value.sync)
		} satisfies MobileBundleInspection;
	} catch (error) {
		return {
			issue:
				error instanceof Error
					? error.message
					: 'The embedded mobile manifest is invalid.',
			manifest,
			status: 'invalid'
		} satisfies MobileBundleInspection;
	}
};
