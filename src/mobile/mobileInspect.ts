import { access, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import type { NormalizedAbsoluteMobileConfig } from './config';
import { resolveAbsoluteDeviceCapabilityPlan } from './deviceCapabilities';
import { inspectAbsoluteMobileRelease } from './releaseDoctor';
import {
	inspectAbsoluteMobileBundle,
	type MobileBundleInspection
} from './mobileBundleInspection';

export const ABSOLUTE_MOBILE_INSPECTION_FORMAT = 1 as const;

type JsonObject = Record<string, unknown>;

type MobilePackageInspection = {
	declared: string;
	installed?: string;
	name: string;
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
	const bundle = await inspectAbsoluteMobileBundle(config, projectRoot);
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
