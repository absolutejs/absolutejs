export const asset = (
	manifest: Record<string, string | string[]>,
	name: string
) => {
	const assetPath = manifest[name];
	if (assetPath === undefined) {
		throw new Error(`Asset "${name}" not found in manifest.`);
	}
	if (Array.isArray(assetPath)) {
		throw new Error(`"${name}" is an array, use 'assets' instead.`);
	}

	return assetPath;
};

export const assets = (
	manifest: Record<string, string | string[]>,
	name: string
) => {
	const assetPaths = manifest[name];
	if (assetPaths === undefined) {
		throw new Error(`Assets "${name}" not found in manifest.`);
	}
	if (!Array.isArray(assetPaths)) {
		throw new Error(`"${name}" is not an array, use 'asset' instead.`);
	}

	return assetPaths;
};
