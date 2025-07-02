import { BuildArtifact } from 'bun';

export const generateManifest = (
	outputs: BuildArtifact[],
	buildDirectoryAbsolute: string
) =>
	outputs.reduce<Record<string, string>>((manifest, artifact) => {
		let relative = artifact.path.startsWith(buildDirectoryAbsolute)
			? artifact.path.slice(buildDirectoryAbsolute.length)
			: artifact.path;
		relative = relative.replace(/^\/+/, '');

		const segments = relative.split('/');
		const fileWithHash = segments.pop();
		if (!fileWithHash) return manifest;

		const [baseName] = fileWithHash.split(`.${artifact.hash}.`);
		if (!baseName) return manifest;

		const folder = segments.length > 1 ? segments[1] : segments[0];

		if (folder === 'indexes') {
			manifest[`${baseName}Index`] = `/${relative}`;
		} else if (folder === 'pages') {
			manifest[baseName] = artifact.path;
		} else {
			manifest[baseName] = `/${relative}`;
		}

		return manifest;
	}, {});
