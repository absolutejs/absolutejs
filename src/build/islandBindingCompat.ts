import { resolve } from 'node:path';

type FrameworkDirs = {
	angular?: string;
	react?: string;
	svelte?: string;
	vue?: string;
};

const packageToFramework = {
	'@absolutejs/absolute/angular': 'angular',
	'@absolutejs/absolute/react': 'react',
	'@absolutejs/absolute/svelte': 'svelte',
	'@absolutejs/absolute/vue': 'vue'
} as const;

type FrameworkPackage = keyof typeof packageToFramework;

const compatFileNames = {
	angular: 'absolute-angular.ts',
	react: 'absolute-react.ts',
	svelte: 'absolute-svelte.ts',
	vue: 'absolute-vue.ts'
} as const;

const normalize = (value: string) => value.replace(/\\/g, '/');

const isFrameworkPackage = (value: string): value is FrameworkPackage =>
	value in packageToFramework;

export const resolveIslandCompatModule = (
	specifier: string,
	importer: string,
	frameworkDirs: FrameworkDirs
) => {
	if (!isFrameworkPackage(specifier)) {
		return null;
	}

	const framework = packageToFramework[specifier];
	const frameworkDir = frameworkDirs[framework];
	if (!frameworkDir) {
		return null;
	}

	const normalizedImporter = normalize(importer);
	const normalizedFrameworkDir = normalize(resolve(frameworkDir));
	if (!normalizedImporter.startsWith(normalizedFrameworkDir)) {
		return null;
	}

	if (
		normalizedImporter.includes('/generated/absolute-') ||
		normalizedImporter.includes('/generated/Island.') ||
		normalizedImporter.includes('/generated/islands.')
	) {
		return null;
	}

	return resolve(
		frameworkDir,
		'generated',
		compatFileNames[framework]
	);
};
