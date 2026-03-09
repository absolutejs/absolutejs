/* Module Version Tracker for Server-Client Synchronization
   Tracks module versions to ensure server and client stay in sync */

/* Module version: increments each time a module is updated */
export type ModuleVersion = number;

/* Module version map: module path -> version */
export type ModuleVersions = Map<string, ModuleVersion>;

/* Global module version counter */
let globalVersionCounter = 0;

/* Get next version number */
export const createModuleVersionTracker = () =>
	new Map<string, ModuleVersion>();
export const getNextVersion = () => ++globalVersionCounter;
export const incrementModuleVersion = (
	versions: ModuleVersions,
	modulePath: string
) => {
	const newVersion = getNextVersion();
	versions.set(modulePath, newVersion);

	return newVersion;
};
export const incrementModuleVersions = (
	versions: ModuleVersions,
	modulePaths: string[]
) => {
	const updated = new Map<string, ModuleVersion>();
	for (const path of modulePaths) {
		const version = incrementModuleVersion(versions, path);
		updated.set(path, version);
	}

	return updated;
};
export const serializeModuleVersions = (versions: ModuleVersions) => {
	const serialized: Record<string, number> = {};
	for (const [path, version] of versions.entries()) {
		serialized[path] = version;
	}

	return serialized;
};
