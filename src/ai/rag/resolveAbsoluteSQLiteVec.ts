import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { arch, platform } from 'node:os';
import { dirname, join } from 'node:path';
import type { SQLiteVecResolution } from '../../../types/ai';

const require = createRequire(import.meta.url);

type AbsoluteSQLiteVecPackage = {
	packageName: string;
	libraryFile: string;
};

type PackageJsonShape = {
	version?: unknown;
};

const PLATFORM_PACKAGE_MAP: Record<string, AbsoluteSQLiteVecPackage> = {
	'darwin-arm64': {
		libraryFile: 'vec0.dylib',
		packageName: '@absolutejs/absolute-rag-sqlite-darwin-arm64'
	},
	'darwin-x64': {
		libraryFile: 'vec0.dylib',
		packageName: '@absolutejs/absolute-rag-sqlite-darwin-x64'
	},
	'linux-arm64': {
		libraryFile: 'vec0.so',
		packageName: '@absolutejs/absolute-rag-sqlite-linux-arm64'
	},
	'linux-x64': {
		libraryFile: 'vec0.so',
		packageName: '@absolutejs/absolute-rag-sqlite-linux-x64'
	},
	'win32-x64': {
		libraryFile: 'vec0.dll',
		packageName: '@absolutejs/absolute-rag-sqlite-windows-x64'
	}
};

const currentPlatformKey = () => `${platform()}-${arch()}`;

const getErrorMessage = (error: unknown) =>
	error instanceof Error ? error.message : String(error);

const isPackageJsonShape = (value: unknown): value is PackageJsonShape =>
	Boolean(value) && typeof value === 'object';

const readPackageVersion = (packageJsonPath: string) => {
	try {
		const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
		if (!isPackageJsonShape(packageJson)) {
			return undefined;
		}

		return typeof packageJson.version === 'string'
			? packageJson.version
			: undefined;
	} catch {
		return undefined;
	}
};

export const resolveAbsoluteSQLiteVec: () => SQLiteVecResolution = () => {
	const platformKey = currentPlatformKey();
	const packageInfo = PLATFORM_PACKAGE_MAP[platformKey];

	if (!packageInfo) {
		return {
			platformKey,
			reason: `No AbsoluteJS sqlite-vec package is defined for ${platformKey}.`,
			source: 'absolute-package',
			status: 'unsupported_platform'
		};
	}

	try {
		const packageJsonPath = require.resolve(
			`${packageInfo.packageName}/package.json`
		);
		const packageRoot = dirname(packageJsonPath);
		const libraryPath = join(packageRoot, packageInfo.libraryFile);
		const packageVersion = readPackageVersion(packageJsonPath);

		if (!existsSync(libraryPath)) {
			return {
				libraryFile: packageInfo.libraryFile,
				libraryPath,
				packageName: packageInfo.packageName,
				packageRoot,
				packageVersion,
				platformKey,
				reason: `Resolved ${packageInfo.packageName} but ${packageInfo.libraryFile} was not found.`,
				source: 'absolute-package',
				status: 'binary_missing'
			};
		}

		return {
			libraryFile: packageInfo.libraryFile,
			libraryPath,
			packageName: packageInfo.packageName,
			packageRoot,
			packageVersion,
			platformKey,
			source: 'absolute-package',
			status: 'resolved'
		};
	} catch (error) {
		return {
			libraryFile: packageInfo.libraryFile,
			packageName: packageInfo.packageName,
			platformKey,
			reason: getErrorMessage(error),
			source: 'absolute-package',
			status: 'package_not_installed'
		};
	}
};

export const resolveAbsoluteSQLiteVecExtensionPath = () => {
	const resolution = resolveAbsoluteSQLiteVec();

	return resolution.status === 'resolved'
		? (resolution.libraryPath ?? null)
		: null;
};
