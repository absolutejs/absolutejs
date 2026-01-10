import { extname } from 'node:path';
import { BuildArtifact } from 'bun';
import { UNFOUND_INDEX } from '../constants';
import { toPascal } from '../utils/stringModifiers';

export const generateManifest = (outputs: BuildArtifact[], buildPath: string) =>
	outputs.reduce<Record<string, string>>((manifest, artifact) => {
		let relative = artifact.path.startsWith(buildPath)
			? artifact.path.slice(buildPath.length)
			: artifact.path;
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
			(seg) => seg === 'indexes' || seg === 'pages'
		);
		const folder = idx > UNFOUND_INDEX ? segments[idx] : segments[0];

		if (folder === 'indexes') {
			manifest[`${pascalName}Index`] = `/${relative}`;
		} else if (folder === 'pages') {
			// For React pages, add with "Page" suffix for HMR to find them
			manifest[`${pascalName}Page`] = `/${relative}`;
		} else {
			manifest[pascalName] = `/${relative}`;
		}

		return manifest;
	}, {});
