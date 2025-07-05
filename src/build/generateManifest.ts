import { extname } from 'node:path';
import { BuildArtifact } from 'bun';
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

		const ext = extname(fileWithHash);
		if (ext === '.css') {
			manifest[`${toPascal(baseName)}CSS`] = `/${relative}`;

			return manifest;
		}

		const folder = segments.length > 1 ? segments[1] : segments[0];

		if (folder === 'indexes') {
			manifest[`${baseName}Index`] = `/${relative}`;
		} else if (folder === 'pages') {
			manifest[baseName] ??= artifact.path;
		} else {
			manifest[baseName] = `/${relative}`;
		}

		return manifest;
	}, {});
