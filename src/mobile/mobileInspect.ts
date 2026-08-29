import { access, readFile, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import type { NormalizedAbsoluteMobileConfig } from './config';
import { resolveAbsoluteDeviceCapabilityPlan } from './deviceCapabilities';
import { inspectAbsoluteMobileRelease } from './releaseDoctor';
import type { AbsoluteMobileCompatibilityRoute } from './releaseArtifact';
import { resolveAbsoluteMobileRoute } from './routeMatcher';

export const ABSOLUTE_MOBILE_INSPECTION_FORMAT = 1 as const;

type JsonObject = Record<string, unknown>;

type MobilePackageInspection = {
	declared: string;
	installed?: string;
	name: string;
};

type MobileBundleInspection = {
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

export type AbsoluteMobileProjectInspection = {
	bundle: MobileBundleInspection;
	capabilities: {
		current: string[];
		embeddedMatchesCurrent?: boolean;
		issue?: string;
		plugins: string[];
	};
	config: {
		appId: string;
		appName: string;
		bundleDirectory: string;
		deepLinkHosts: string[];
		deepLinkScheme?: string;
		engine: 'capacitor';
		entry: string;
		iosVersion?: string;
		nativeProjectDirectory: string;
		platforms: string[];
		productionOrigin: string;
	};
	format: typeof ABSOLUTE_MOBILE_INSPECTION_FORMAT;
	nativeProjects: Array<{
		initialized: boolean;
		path: string;
		platform: string;
	}>;
	packages: MobilePackageInspection[];
	release: {
		checks: Array<{ id: string; status: 'fail' | 'pass' | 'warn' }>;
		ready: boolean;
	};
	runtime: { absolutejs: string };
};

export type InspectAbsoluteMobileProjectOptions = {
	absolutejsVersion?: string;
	inspectRelease?: typeof inspectAbsoluteMobileRelease;
};

type InspectBundle = (
	config: NormalizedAbsoluteMobileConfig,
	projectRoot: string
) => Promise<MobileBundleInspection>;

const MOBILE_PACKAGE_NAMES = new Set([
	'@absolutejs/absolute',
	'@absolutejs/auth',
	'@absolutejs/devices',
	'@absolutejs/devices-capacitor',
	'@absolutejs/http',
	'@absolutejs/pwa',
	'@absolutejs/sync',
	'@absolutejs/sync-capacitor',
	'@capacitor-community/sqlite'
]);
const MOBILE_FRAMEWORKS = new Set([
	'angular',
	'ember',
	'html',
	'htmx',
	'react',
	'svelte',
	'vue'
]);

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
	field: string
) => {
	const portable = requireString(value, field);
	const path = resolve(root, portable);
	const normalizedRoot = resolve(root);
	if (path === normalizedRoot || !path.startsWith(`${normalizedRoot}/`))
		throw new TypeError(`${field} must remain inside the mobile bundle.`);
	if (!(await stat(path).catch(() => undefined))?.isFile())
		throw new TypeError(`${field} does not exist in the mobile bundle.`);

	return portable;
};

const inspectBundle: InspectBundle = async (
	config: NormalizedAbsoluteMobileConfig,
	projectRoot: string
) => {
	const manifestPath = join(
		config.bundleDirectory,
		'absolute-mobile-manifest.json'
	);
	const manifest = portablePath(projectRoot, manifestPath);
	if (!(await pathExists(manifestPath)))
		return { manifest, status: 'missing' };

	try {
		const value = await readObject(manifestPath);
		if (value.format !== 1)
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
				requireString(candidate.bundleHash, 'page.bundleHash');
				requireString(candidate.contract, 'page.contract');
				requireString(
					candidate.propsSchemaHash,
					'page.propsSchemaHash'
				);
				await requireBundleFile(
					config.bundleDirectory,
					candidate.localBundlePath,
					'page.localBundlePath'
				);
				if (candidate.localStylePath !== undefined)
					await requireBundleFile(
						config.bundleDirectory,
						candidate.localStylePath,
						'page.localStylePath'
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
		};
	} catch (error) {
		return {
			issue:
				error instanceof Error
					? error.message
					: 'The embedded mobile manifest is invalid.',
			manifest,
			status: 'invalid'
		};
	}
};

const addPackageDeclarations = (
	declarations: Map<string, string>,
	value: unknown
) => {
	if (!isObject(value)) return;
	for (const [name, declared] of Object.entries(value).filter(
		(entry): entry is [string, string] => typeof entry[1] === 'string'
	))
		declarations.set(name, declared);
};

const packageInspections = async (
	projectRoot: string,
	additionalNames: readonly string[]
) => {
	const project = await readObject(join(projectRoot, 'package.json'));
	const declarations = new Map<string, string>();
	for (const field of ['dependencies', 'devDependencies'])
		addPackageDeclarations(declarations, project[field]);
	const names = [...new Set([...declarations.keys(), ...additionalNames])]
		.filter(
			(name) =>
				MOBILE_PACKAGE_NAMES.has(name) ||
				name.startsWith('@capacitor/') ||
				additionalNames.includes(name)
		)
		.sort();

	return Promise.all(
		names.map(async (name) => {
			const installedManifest = await readObject(
				join(projectRoot, 'node_modules', name, 'package.json')
			).catch(() => undefined);
			const installed = installedManifest?.version;

			return {
				declared: declarations.get(name) ?? 'transitive',
				...(typeof installed === 'string' ? { installed } : {}),
				name
			} satisfies MobilePackageInspection;
		})
	);
};

export const inspectAbsoluteMobileProject = async (
	config: NormalizedAbsoluteMobileConfig,
	projectRoot: string,
	options: InspectAbsoluteMobileProjectOptions = {}
) => {
	const bundle = await inspectBundle(config, projectRoot);
	let currentCapabilities: string[] = [];
	let capabilityIssue: string | undefined;
	let plugins: string[] = [];
	try {
		const plan = resolveAbsoluteDeviceCapabilityPlan(projectRoot);
		currentCapabilities = plan.capabilities;
		plugins = plan.requiredPackages;
	} catch {
		capabilityIssue = 'Native capability metadata could not be resolved.';
	}
	const pluginNames = plugins.map((spec) =>
		spec.slice(0, spec.lastIndexOf('@'))
	);
	const releaseInspection = await (
		options.inspectRelease ?? inspectAbsoluteMobileRelease
	)(config, projectRoot).catch(() => ({ checks: [], ready: false }));

	return {
		bundle,
		capabilities: {
			current: currentCapabilities,
			...(bundle.capabilities
				? {
						embeddedMatchesCurrent:
							JSON.stringify(bundle.capabilities) ===
							JSON.stringify(currentCapabilities)
					}
				: {}),
			...(capabilityIssue ? { issue: capabilityIssue } : {}),
			plugins
		},
		config: {
			appId: config.appId,
			appName: config.appName,
			bundleDirectory: portablePath(projectRoot, config.bundleDirectory),
			deepLinkHosts: config.deepLinkHosts,
			deepLinkScheme: config.deepLinkScheme,
			engine: config.engine,
			entry: config.entry,
			iosVersion: config.iosVersion,
			nativeProjectDirectory: portablePath(
				projectRoot,
				config.nativeProjectDirectory
			),
			platforms: config.platforms,
			productionOrigin: config.productionOrigin
		},
		format: ABSOLUTE_MOBILE_INSPECTION_FORMAT,
		nativeProjects: await Promise.all(
			config.platforms.map(async (platform) => {
				const path = join(config.nativeProjectDirectory, platform);

				return {
					initialized: await pathExists(path),
					path: portablePath(projectRoot, path),
					platform
				};
			})
		),
		packages: await packageInspections(projectRoot, pluginNames),
		release: {
			checks: releaseInspection.checks.map(({ id, status }) => ({
				id,
				status
			})),
			ready: releaseInspection.ready
		},
		runtime: { absolutejs: options.absolutejsVersion ?? 'unknown' }
	} satisfies AbsoluteMobileProjectInspection;
};

const yesNo = (value: boolean) => (value ? 'yes' : 'no');

export const renderAbsoluteMobileProjectInspection = (
	report: AbsoluteMobileProjectInspection
) => {
	const lines = [
		`AbsoluteJS mobile inspection (format ${report.format})`,
		'',
		`App: ${report.config.appName} (${report.config.appId})`,
		`Engine: ${report.config.engine}`,
		`Platforms: ${report.config.platforms.join(', ')}`,
		`Entry: ${report.config.entry}`,
		`Production origin: ${report.config.productionOrigin}`,
		`AbsoluteJS: ${report.runtime.absolutejs}`,
		'',
		`Bundle: ${report.bundle.status} (${report.bundle.manifest})`
	];
	if (report.bundle.status === 'valid') {
		lines.push(
			`  Build/runtime: ${report.bundle.appBuild} / ${report.bundle.runtime}`,
			`  Pages/routes: ${report.bundle.pageCount} / ${report.bundle.routeCount}`,
			`  Frameworks: ${report.bundle.frameworks?.join(', ') || 'none'}`,
			`  Auth/Sync: ${yesNo(report.bundle.auth === true)} / ${yesNo(report.bundle.sync === true)}`
		);
	} else if (report.bundle.issue)
		lines.push(`  Issue: ${report.bundle.issue}`);
	lines.push(
		'',
		`Capabilities: ${report.capabilities.current.join(', ') || 'none'}`,
		`Native plugins: ${report.capabilities.plugins.join(', ') || 'none'}`
	);
	if (report.capabilities.embeddedMatchesCurrent !== undefined)
		lines.push(
			`Embedded capabilities current: ${yesNo(report.capabilities.embeddedMatchesCurrent)}`
		);
	if (report.capabilities.issue)
		lines.push(`Capability issue: ${report.capabilities.issue}`);
	lines.push('', 'Native projects:');
	for (const project of report.nativeProjects)
		lines.push(
			`  ${project.platform}: ${project.initialized ? 'initialized' : 'missing'} (${project.path})`
		);
	lines.push('', 'Runtime packages:');
	for (const runtimePackage of report.packages)
		lines.push(
			`  ${runtimePackage.name}: ${runtimePackage.installed ?? 'not installed'} (declared ${runtimePackage.declared})`
		);
	const failed = report.release.checks.filter(
		(check) => check.status === 'fail'
	).length;
	const warned = report.release.checks.filter(
		(check) => check.status === 'warn'
	).length;
	lines.push(
		'',
		`Release projection: ${report.release.ready ? 'ready' : 'not ready'} (${failed} failed, ${warned} warnings)`
	);

	return `${lines.join('\n')}\n`;
};
