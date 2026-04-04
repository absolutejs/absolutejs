import { extname } from 'node:path';
import { BuildArtifact } from 'bun';
import { UNFOUND_INDEX } from '../constants';
import { getIslandManifestKey } from '../core/islandManifest';
import { logWarn } from '../utils/logger';
import { normalizePath } from '../utils/normalizePath';
import { toPascal } from '../utils/stringModifiers';

const getManifestKey = (
	folder: string | undefined,
	pascalName: string,
	isClientComponent: boolean,
	isReact: boolean,
	isVue: boolean,
	isSvelte: boolean,
	isAngular: boolean
) => {
	if (folder === 'indexes') return `${pascalName}Index`;
	if (isClientComponent) return `${pascalName}Client`;
	if (folder !== 'pages') return pascalName;

	// Only add "Page" suffix for React pages
	// Vue and Svelte pages use their base PascalCase name
	if (isReact) return `${pascalName}Page`;
	if (isVue || isSvelte || isAngular) return pascalName;

	// Default behavior for other frameworks
	return `${pascalName}Page`;
};

const getCssKey = (pascalName: string, segments: string[]) => {
	const isFromVue = segments.some((seg) => seg === 'vue');
	if (isFromVue && segments.includes('css')) return `${pascalName}CompiledCSS`;

	const isFromReact = segments.some((seg) => seg === 'react');
	const isFromSvelte = segments.some((seg) => seg === 'svelte');
	const isFromAngular = segments.some((seg) => seg === 'angular');
	if (isFromReact || isFromVue || isFromSvelte || isFromAngular) return `${pascalName}BundledCSS`;

	return `${pascalName}CSS`;
};

export const generateManifest = (outputs: BuildArtifact[], buildPath: string) =>
	outputs.reduce<Record<string, string>>((manifest, artifact) => {
		// Normalize both paths for consistent comparison across platforms
		const normalizedArtifactPath = normalizePath(artifact.path);
		const normalizedBuildPath = normalizePath(buildPath);

		let relative = normalizedArtifactPath.startsWith(normalizedBuildPath)
			? normalizedArtifactPath.slice(normalizedBuildPath.length)
			: normalizedArtifactPath;
		relative = relative.replace(/^\/+/, '');

		const segments = relative.split('/');
		const fileWithHash = segments.pop();
		if (!fileWithHash) return manifest;

		const [baseName] = fileWithHash.split(`.${artifact.hash}.`);
		if (!baseName) return manifest;

		const pascalName = toPascal(baseName);
		const ext = extname(fileWithHash);
		const islandIndex = segments.findIndex((seg) => seg === 'islands');

		if (ext === '.css') {
			// Distinguish CSS from different sources to avoid key collisions.
			// CSS co-emitted from a JS bundle (e.g. CSS Modules) lives under a
			// framework path like react/generated/indexes/, while global
			// stylesheets from the styles directory land directly in indexes/.
			// Vue compiled SFC styles live in assets/css/.
			const cssKey = getCssKey(pascalName, segments);

			if (manifest[cssKey] && manifest[cssKey] !== `/${relative}`)
				logWarn(
					`Duplicate manifest key "${cssKey}" — "${manifest[cssKey]}" will be overwritten by "/${relative}". Use unique page names across frameworks.`
				);

			manifest[cssKey] = `/${relative}`;

			return manifest;
		}

		const frameworkSegment = islandIndex > UNFOUND_INDEX
			? segments[islandIndex + 1]
			: undefined;
		if (
			frameworkSegment === 'react' ||
			frameworkSegment === 'svelte' ||
			frameworkSegment === 'vue' ||
			frameworkSegment === 'angular'
		) {
			const manifestKey = getIslandManifestKey(
				frameworkSegment,
				pascalName
			);
			manifest[manifestKey] = `/${relative}`;

			return manifest;
		}

		const idx = segments.findIndex(
			(seg) => seg === 'indexes' || seg === 'pages' || seg === 'client'
		);
		const folder = idx > UNFOUND_INDEX ? segments[idx] : segments[0];

		// Detect framework from path segments
		const isReact = segments.some((seg) => seg === 'react');
		const isVue = segments.some((seg) => seg === 'vue');
		const isSvelte = segments.some((seg) => seg === 'svelte');
		const isAngular = segments.some((seg) => seg === 'angular');

		// Check if this is a client component (for official HMR)
		const isClientComponent = segments.includes('client');

		const manifestKey = getManifestKey(
			folder,
			pascalName,
			isClientComponent,
			isReact,
			isVue,
			isSvelte,
			isAngular
		);
		if (manifest[manifestKey] && manifest[manifestKey] !== `/${relative}`) {
			logWarn(
				`Duplicate manifest key "${manifestKey}" — "${manifest[manifestKey]}" will be overwritten by "/${relative}". Use unique page names across frameworks.`
			);
		}
		manifest[manifestKey] = `/${relative}`;

		return manifest;
	}, {});
