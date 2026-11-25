import { extname } from 'node:path';
import type { BuildArtifact } from 'bun';
import { UNFOUND_INDEX } from '../constants';
import {
	getIslandManifestKey,
	getIslandStyleManifestKey
} from '../core/islandManifest';
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
	if (isFromVue && segments.includes('css'))
		return `${pascalName}CompiledCSS`;

	const isFromReact = segments.some((seg) => seg === 'react');
	const isFromSvelte = segments.some((seg) => seg === 'svelte');
	const isFromAngular = segments.some((seg) => seg === 'angular');
	if (isFromReact || isFromVue || isFromSvelte || isFromAngular)
		return `${pascalName}BundledCSS`;

	return `${pascalName}CSS`;
};

const getArtifactBaseName = (fileName: string, hash: string | null) => {
	const ext = extname(fileName);
	const stem = ext ? fileName.slice(0, -ext.length) : fileName;
	if (!hash) return stem;

	const hashSuffix = `.${hash}`;
	if (stem.endsWith(hashSuffix)) return stem.slice(0, -hashSuffix.length);

	return stem;
};

const islandFrameworkOf = (segment: string | undefined) =>
	segment === 'react' ||
	segment === 'svelte' ||
	segment === 'vue' ||
	segment === 'angular'
		? segment
		: undefined;

export type ManifestOutputKey = {
	key: string;
	/* Island keys never warn on a duplicate: the island passes write each
	 * one more than once by design. */
	warnOnDuplicate: boolean;
};

/**
 * The manifest key of one build output, from its path relative to the build
 * directory (`svelte/indexes/pages/Home.js`) and the hash Bun put in its
 * file name, if any; `null` when the output gets no key.
 *
 * This is the one place an output path becomes a key. The build runs every
 * artifact through it, and so does the derivation that types
 * `asset(manifest, key)` without building (build/manifestKeys.ts), so the
 * two cannot name an output differently.
 */
export const generateManifest = (outputs: BuildArtifact[], buildPath: string) =>
	outputs.reduce<Record<string, string>>((manifest, artifact) => {
		// Normalize both paths for consistent comparison across platforms
		const normalizedArtifactPath = normalizePath(artifact.path);
		const normalizedBuildPath = normalizePath(buildPath);

		let relative = normalizedArtifactPath.startsWith(normalizedBuildPath)
			? normalizedArtifactPath.slice(normalizedBuildPath.length)
			: normalizedArtifactPath;
		relative = relative.replace(/^\/+/, '');

		const output = manifestKeyForOutput(relative, artifact.hash);
		if (!output) return manifest;
		const { key, warnOnDuplicate } = output;
		const path = `/${relative}`;

		if (warnOnDuplicate && manifest[key] && manifest[key] !== path) {
			logWarn(
				`Duplicate manifest key "${key}" — "${manifest[key]}" will be overwritten by "${path}". Use unique page names across frameworks.`
			);
		}
		manifest[key] = path;

		return manifest;
	}, {});
export const manifestKeyForOutput = (
	relativePath: string,
	hash: string | null = null
): ManifestOutputKey | null => {
	const segments = relativePath.replace(/^\/+/, '').split('/');
	const fileWithHash = segments.pop();
	if (!fileWithHash) return null;

	const baseName = getArtifactBaseName(fileWithHash, hash);
	if (!baseName) return null;

	const pascalName = toPascal(baseName);
	const ext = extname(fileWithHash);
	const islandIndex = segments.findIndex((seg) => seg === 'islands');
	const islandFramework = islandFrameworkOf(
		islandIndex > UNFOUND_INDEX ? segments[islandIndex + 1] : undefined
	);

	if (ext === '.css') {
		// Server bundles auto-emit a sibling .css for any CSS imported by
		// the SSR entry (Vue scoped styles, etc.). It's never linked from
		// HTML — the indexes-pass CSS is — so skip it to avoid clobbering
		// the same `${Page}BundledCSS` key.
		if (segments.includes('server')) return null;

		// The stylesheet the island client pass emits for an island
		// entry (`islands/<framework>/<Name>.<hash>.css`).
		if (islandFramework)
			return {
				key: getIslandStyleManifestKey(islandFramework, pascalName),
				warnOnDuplicate: false
			};

		// Distinguish CSS from different sources to avoid key collisions.
		// CSS co-emitted from a JS bundle (e.g. CSS Modules) lives under a
		// framework path like react/generated/indexes/, while global
		// stylesheets from the styles directory land directly in indexes/.
		// Vue compiled SFC styles live in assets/css/.
		return { key: getCssKey(pascalName, segments), warnOnDuplicate: true };
	}

	if (islandFramework)
		return {
			key: getIslandManifestKey(islandFramework, pascalName),
			warnOnDuplicate: false
		};

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

	return {
		key: getManifestKey(
			folder,
			pascalName,
			isClientComponent,
			isReact,
			isVue,
			isSvelte,
			isAngular
		),
		warnOnDuplicate: true
	};
};
