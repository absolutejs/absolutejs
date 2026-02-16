/* Module version validation and sync */

export function checkModuleVersions(
	serverVersions: Record<string, number> | undefined,
	clientVersions: Record<string, number> | undefined
): { needsSync: boolean; stale: string[] } {
	if (!serverVersions || !clientVersions) {
		return { needsSync: false, stale: [] };
	}

	const stale: string[] = [];
	let needsSync = false;

	for (const [modulePath, serverVersion] of Object.entries(serverVersions)) {
		const clientVersion = clientVersions[modulePath];

		if (clientVersion === undefined || clientVersion < serverVersion) {
			stale.push(modulePath);
			needsSync = true;
		}
	}

	return { needsSync, stale };
}

export function prefetchModules(
	modulePaths: string[],
	manifest: Record<string, string> | undefined
): Promise<unknown[]> {
	const prefetchPromises: Promise<unknown>[] = [];

	for (const modulePath of modulePaths) {
		let manifestPath = modulePath;
		for (const key in manifest || {}) {
			if (Object.prototype.hasOwnProperty.call(manifest, key)) {
				const path = manifest![key]!;
				if (path === modulePath || path.includes(modulePath)) {
					manifestPath = path;
					break;
				}
			}
		}

		const cacheBuster = '?t=' + Date.now();
		const fullPath = manifestPath.startsWith('/')
			? manifestPath + cacheBuster
			: '/' + manifestPath + cacheBuster;

		prefetchPromises.push(
			import(/* @vite-ignore */ fullPath).catch(function () {
				/* ignore */
			})
		);
	}

	return Promise.all(prefetchPromises);
}
