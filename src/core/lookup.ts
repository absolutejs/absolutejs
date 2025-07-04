export const asset = (manifest: Record<string, string>, name: string) => {
	const assetPath = manifest[name];
	if (assetPath === undefined) {
		throw new Error(`Asset "${name}" not found in manifest.`);
	}

	return assetPath;
};
