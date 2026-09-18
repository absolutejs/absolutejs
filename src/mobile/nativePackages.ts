import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

// One tested Devices pair for application provisioning and generated shells.
export const ABSOLUTE_CAPACITOR_DEVICES_VERSION = '0.8.0';
export const ABSOLUTE_CAPACITOR_SYNC_VERSION = '0.9.3';
export const ABSOLUTE_DEVICES_VERSION = '0.7.0';
export const ABSOLUTE_EXPO_DEVICES_VERSION = '0.0.11';
export const ABSOLUTE_NATIVE_EXACT_PACKAGES = new Set([
	'@absolutejs/devices',
	'@absolutejs/devices-capacitor',
	'@absolutejs/sync-capacitor'
]);
export const CAPACITOR_PACKAGE_SPECS = [
	'@capacitor/core@8.5.0',
	'@capacitor/app@8.1.1',
	'@capacitor/browser@8.0.4',
	'@capacitor/network@8.0.1',
	'@capacitor/preferences@8.0.1',
	'@capacitor/cli@8.5.0',
	'@capacitor/android@8.5.0',
	'@capacitor/ios@8.5.0',
	`@absolutejs/devices@${ABSOLUTE_DEVICES_VERSION}`,
	`@absolutejs/devices-capacitor@${ABSOLUTE_CAPACITOR_DEVICES_VERSION}`
];
export const CAPACITOR_SYNC_PACKAGE_SPECS = [
	`@absolutejs/sync-capacitor@${ABSOLUTE_CAPACITOR_SYNC_VERSION}`,
	'@capacitor-community/sqlite@8.1.1'
];

// Follow node_modules ancestry: workspace packages may be hoisted, while a stale
// nearer installation must never be skipped in favor of a matching ancestor.
const resolvedPackageVersion = async (
	projectRoot: string,
	name: string
): Promise<unknown> => {
	const directory = resolve(projectRoot);
	let source: string;
	try {
		source = await readFile(
			join(directory, 'node_modules', name, 'package.json'),
			'utf8'
		);
	} catch (error) {
		if (
			!(error instanceof Error) ||
			!('code' in error) ||
			error.code !== 'ENOENT'
		)
			return undefined;
		const parent = dirname(directory);

		return parent === directory
			? undefined
			: resolvedPackageVersion(parent, name);
	}
	try {
		const manifest: unknown = JSON.parse(source);

		return typeof manifest === 'object' && manifest !== null
			? Reflect.get(manifest, 'version')
			: undefined;
	} catch {
		return undefined;
	}
};

export const assertNativePackageVersions = async (
	projectRoot: string,
	specs: string[],
	exactPackages: ReadonlySet<string>
) => {
	const stale = await packagesNeedingExactInstall(
		projectRoot,
		specs,
		new Set(specs.map(packageNameFromSpec)),
		exactPackages
	);
	if (stale.length > 0)
		throw new TypeError(
			`Native dependency installation did not resolve the tested versions: ${stale.join(', ')}. A stale workspace-local installation may be shadowing hoisted packages. Restore a clean dependency installation for this app/workspace with your package manager, then retry absolute mobile init or sync. A forced install alone may leave obsolete workspace-local copies in place.`
		);
};
export const packageNameFromSpec = (spec: string) =>
	spec.slice(0, spec.lastIndexOf('@'));
export const packagesNeedingExactInstall = async (
	projectRoot: string,
	specs: string[],
	installed: ReadonlySet<string>,
	exactPackages: ReadonlySet<string>
) =>
	(
		await Promise.all(
			specs.map(async (spec) => {
				const name = packageNameFromSpec(spec);
				if (!installed.has(name)) return spec;
				if (!exactPackages.has(name)) return undefined;
				if (
					(await resolvedPackageVersion(projectRoot, name)) ===
					spec.slice(spec.lastIndexOf('@') + 1)
				)
					return undefined;

				return spec;
			})
		)
	).filter((spec): spec is string => spec !== undefined);
