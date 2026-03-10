import { basename, resolve } from 'node:path';
import { toPascal } from '../utils/stringModifiers';
import {
	classifyComponent,
	type ComponentType
} from './reactComponentClassifier';

/* Maps source files to their manifest entries
   This handles the "what modules changed" problem for Smart Module Updates */
export type ModuleUpdate = {
	sourceFile: string;
	framework: string;
	moduleKeys: string[]; // Manifest keys for this module (e.g., ['ReactExampleIndex', 'ReactExampleCSS'])
	modulePaths: Record<string, string>; // Map of manifest keys to their new paths
	componentType?: ComponentType; // 'client' | 'server' - only for React components
};

/* Map a source file to its manifest entry keys
   This handles framework-specific manifest key derivation */
const buildModulePaths = (
	moduleKeys: string[],
	manifest: Record<string, string>
) => {
	const modulePaths: Record<string, string> = {};
	moduleKeys.forEach((key) => {
		if (manifest[key]) {
			modulePaths[key] = manifest[key];
		}
	});

	return modulePaths;
};

const processChangedFile = (
	sourceFile: string,
	framework: string,
	manifest: Record<string, string>,
	resolvedPaths:
		| {
				reactDir?: string;
				svelteDir?: string;
				vueDir?: string;
				angularDir?: string;
		  }
		| undefined,
	processedFiles: Set<string>
) => {
	const normalizedFile = resolve(sourceFile);
	const normalizedPath = normalizedFile.replace(/\\/g, '/');

	if (processedFiles.has(normalizedFile)) {
		return null;
	}
	processedFiles.add(normalizedFile);

	const moduleKeys = mapSourceFileToManifestKeys(
		normalizedFile,
		framework,
		resolvedPaths
	);

	const isReactPage = resolvedPaths?.reactDir
		? normalizedPath.startsWith(
				`${resolvedPaths.reactDir.replace(/\\/g, '/')}/pages/`
			)
		: normalizedPath.includes('/react/pages/');

	if (framework === 'react' && !isReactPage) {
		return null;
	}

	const modulePaths = buildModulePaths(moduleKeys, manifest);

	if (Object.keys(modulePaths).length === 0) {
		return null;
	}

	const componentType =
		framework === 'react' ? classifyComponent(normalizedFile) : undefined;

	return {
		componentType,
		framework,
		moduleKeys: Object.keys(modulePaths),
		modulePaths,
		sourceFile: normalizedFile
	} satisfies ModuleUpdate;
};

export const createModuleUpdates = (
	changedFiles: string[],
	framework: string,
	manifest: Record<string, string>,
	resolvedPaths?: {
		reactDir?: string;
		svelteDir?: string;
		vueDir?: string;
		angularDir?: string;
	}
) => {
	const processedFiles = new Set<string>();

	return changedFiles
		.map((sourceFile) =>
			processChangedFile(
				sourceFile,
				framework,
				manifest,
				resolvedPaths,
				processedFiles
			)
		)
		.filter((update) => update !== null);
};
export const groupModuleUpdatesByFramework = (updates: ModuleUpdate[]) => {
	const grouped = new Map<string, ModuleUpdate[]>();

	updates.forEach((update) => {
		if (!grouped.has(update.framework)) {
			grouped.set(update.framework, []);
		}
		grouped.get(update.framework)!.push(update);
	});

	return grouped;
};
export const mapSourceFileToManifestKeys = (
	sourceFile: string,
	framework: string,
	resolvedPaths?: {
		reactDir?: string;
		svelteDir?: string;
		vueDir?: string;
		angularDir?: string;
	}
) => {
	const normalizedFile = resolve(sourceFile);
	const fileName = basename(normalizedFile);

	// Extract base name without extension
	const baseName = fileName.replace(/\.(tsx?|jsx?|vue|svelte|css|html)$/, '');
	const pascalName = toPascal(baseName);

	const keys: string[] = [];

	const inSubdir = (dir: string | undefined, sub: string) => {
		if (!dir) return false;
		const prefix = `${dir.replace(/\\/g, '/')}/${sub}/`;

		return normalizedFile.startsWith(prefix);
	};

	switch (framework) {
		case 'react':
			// React pages (in pages/ directory) have Index entries
			if (
				inSubdir(resolvedPaths?.reactDir, 'pages') ||
				normalizedFile.includes('/react/pages/')
			) {
				keys.push(`${pascalName}Index`);
				keys.push(`${pascalName}CSS`); // CSS might exist
			}
			// React components don't have direct manifest entries
			// They're bundled into the page that imports them
			// The dependency graph ensures the page is rebuilt when a component changes
			break;

		case 'svelte':
			// Svelte pages have both main entry and index
			if (
				inSubdir(resolvedPaths?.svelteDir, 'pages') ||
				normalizedFile.includes('/svelte/pages/')
			) {
				keys.push(pascalName);
				keys.push(`${pascalName}Index`);
				keys.push(`${pascalName}CSS`); // CSS might exist
			}
			break;

		case 'vue':
			// Vue pages have main entry, index, and CSS
			if (
				inSubdir(resolvedPaths?.vueDir, 'pages') ||
				normalizedFile.includes('/vue/pages/')
			) {
				keys.push(pascalName);
				keys.push(`${pascalName}Index`);
				keys.push(`${pascalName}CSS`);
			}
			break;

		case 'angular':
			// Angular pages have main entry and index
			if (
				inSubdir(resolvedPaths?.angularDir, 'pages') ||
				normalizedFile.includes('/angular/pages/')
			) {
				keys.push(pascalName);
				keys.push(`${pascalName}Index`);
			}
			break;

		case 'html':
		case 'htmx':
			// HTML/HTMX files are directly referenced, no manifest entries needed
			break;

		case 'assets':
			// CSS files use CSS suffix
			if (normalizedFile.endsWith('.css')) {
				keys.push(`${pascalName}CSS`);
			}
			break;
	}

	return keys;
};
