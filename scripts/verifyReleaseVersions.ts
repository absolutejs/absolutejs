import { resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dir, '..');
type NativeManifest = { name?: unknown; version?: unknown };
const rootPackage: NativeManifest = await Bun.file(
	resolve(REPO_ROOT, 'package.json')
).json();
if (typeof rootPackage.version !== 'string') {
	throw new Error('Root package manifest has no valid version.');
}
const nativePackageDirs = [
	'darwin-arm64',
	'darwin-x64',
	'linux-arm64',
	'linux-x64',
	'windows-arm64',
	'windows-x64'
];

const nativePackages = await Promise.all(
	nativePackageDirs.map(async (dir) => {
		const manifestPath = resolve(
			REPO_ROOT,
			'native',
			'packages',
			dir,
			'package.json'
		);
		const manifest: NativeManifest = await Bun.file(manifestPath).json();
		if (
			typeof manifest.name !== 'string' ||
			typeof manifest.version !== 'string'
		) {
			throw new Error(`Invalid native package manifest: ${manifestPath}`);
		}

		return { name: manifest.name, version: manifest.version };
	})
);
const mismatches = nativePackages
	.filter((manifest) => manifest.version !== rootPackage.version)
	.map((manifest) => `${manifest.name}: ${manifest.version}`);

if (mismatches.length > 0) {
	throw new Error(
		`Native package versions must match ${rootPackage.version}: ${mismatches.join(', ')}`
	);
}

console.log(`All package manifests match ${rootPackage.version}.`);
