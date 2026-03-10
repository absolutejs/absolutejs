/* Module version validation and sync */

export const checkModuleVersions = (
	serverVersions: Record<string, number> | undefined,
	clientVersions: Record<string, number> | undefined
) => {
	if (!serverVersions || !clientVersions) {
		return { needsSync: false, stale: [] };
	}

	const stale = Object.entries(serverVersions)
		.filter(([modulePath, serverVersion]) => {
			const clientVersion = clientVersions[modulePath];

			return clientVersion === undefined || clientVersion < serverVersion;
		})
		.map(([modulePath]) => modulePath);

	return { needsSync: stale.length > 0, stale };
};

const resolveManifestPath = (
	modulePath: string,
	manifest: Record<string, string> | undefined
) => {
	if (!manifest) {
		return modulePath;
	}
	for (const key of Object.keys(manifest)) {
		const path = manifest[key]!;
		if (path === modulePath || path.includes(modulePath)) {
			return path;
		}
	}

	return modulePath;
};

export const prefetchModules = (
	modulePaths: string[],
	manifest: Record<string, string> | undefined
) => {
	const prefetchPromises: Promise<unknown>[] = [];

	for (const modulePath of modulePaths) {
		const manifestPath = resolveManifestPath(modulePath, manifest);

		const cacheBuster = `?t=${Date.now()}`;
		const fullPath = manifestPath.startsWith('/')
			? manifestPath + cacheBuster
			: `/${manifestPath}${cacheBuster}`;

		prefetchPromises.push(
			import(/* @vite-ignore */ fullPath).catch(() => {
				/* ignore */
			})
		);
	}

	return Promise.all(prefetchPromises);
};
