const isWrapped = (
	source: Record<string, string> | { manifest: Record<string, string> }
): source is { manifest: Record<string, string> } =>
	'manifest' in source &&
	typeof source.manifest === 'object' &&
	!Array.isArray(source.manifest);

export const asset = (
	source: Record<string, string> | { manifest: Record<string, string> },
	name: string
): string => {
	const assetPath = isWrapped(source) ? source.manifest[name] : source[name];

	if (assetPath === undefined) {
		throw new Error(`Asset "${name}" not found in manifest.`);
	}

	return assetPath;
};
