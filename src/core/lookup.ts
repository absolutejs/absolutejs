export const asset = (source: Record<string, string>, name: string) => {
	const assetPath = source[name];

	if (assetPath === undefined) {
		throw new Error(`Asset "${name}" not found in manifest.`);
	}

	return assetPath;
};
