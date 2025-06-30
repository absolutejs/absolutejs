import { BuildArtifact } from 'bun';

export const generateManifest = (
	outputs: BuildArtifact[],
	buildDirectoryAbsolute: string,
	svelteDirName?: string
) => {
  const prefix = svelteDirName ? `(?:${svelteDirName}/)?` : '';
	const pagesRegex = new RegExp(`^${prefix}pages/`);
	const indexesRegex = new RegExp(`^${prefix}indexes/`);

	return outputs.reduce<Record<string, string>>((manifest, artifact) => {
		let relativePath = artifact.path.startsWith(buildDirectoryAbsolute)
			? artifact.path.slice(buildDirectoryAbsolute.length)
			: artifact.path;
		relativePath = relativePath.replace(/^\/+/, '');
		const segments = relativePath.split('/');
		const fileWithHash = segments.pop();
		if (!fileWithHash) return manifest;
		const [baseName] = fileWithHash.split(`.${artifact.hash}.`);

		if (indexesRegex.test(relativePath)) {
			manifest[`${baseName}Index`] = `/${relativePath}`;
		} else if (pagesRegex.test(relativePath)) {
			manifest[baseName] = artifact.path;
		} else {
			manifest[baseName] = `/${relativePath}`;
		}

		return manifest;
	}, {});
};
