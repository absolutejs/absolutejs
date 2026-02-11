import { extname } from 'node:path';
import { BuildArtifact } from 'bun';
import { UNFOUND_INDEX } from '../constants';
import { normalizePath } from '../utils/normalizePath';
import { toPascal } from '../utils/stringModifiers';

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

		if (ext === '.css') {
			manifest[`${pascalName}CSS`] = `/${relative}`;

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

		// Check if this is a client component (for official HMR)
		const isClientComponent = segments.includes('client');

		if (folder === 'indexes') {
			manifest[`${pascalName}Index`] = `/${relative}`;
		} else if (isClientComponent) {
			// Client components get {Name}Client key for HMR module imports
			manifest[`${pascalName}Client`] = `/${relative}`;
		} else if (folder === 'pages') {
			// Only add "Page" suffix for React pages
			// Vue and Svelte pages use their base PascalCase name
			if (isReact) {
				manifest[`${pascalName}Page`] = `/${relative}`;
			} else if (isVue || isSvelte) {
				// Vue/Svelte pages use base name without suffix
				manifest[pascalName] = `/${relative}`;
			} else {
				// Default behavior for other frameworks
				manifest[`${pascalName}Page`] = `/${relative}`;
			}
		} else {
			manifest[pascalName] = `/${relative}`;
		}

		return manifest;
	}, {});
