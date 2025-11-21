/* Module Version Tracker for Server-Client Synchronization
   Tracks module versions to ensure server and client stay in sync */

/* Module version: increments each time a module is updated */
export type ModuleVersion = number;

/* Module version map: module path -> version */
export type ModuleVersions = Map<string, ModuleVersion>;

/* Global module version counter */
let globalVersionCounter = 0;

/* Get next version number */
export const getNextVersion = () => ++globalVersionCounter;

/* Create a new module version tracker */
export const createModuleVersionTracker = () => new Map<string, ModuleVersion>();

/* Increment version for a module */
export const incrementModuleVersion = (
  versions: ModuleVersions,
  modulePath: string
) => {
  const newVersion = getNextVersion();
  versions.set(modulePath, newVersion);

  return newVersion;
}

/* Get version for a module */
export const getModuleVersion = (
  versions: ModuleVersions,
  modulePath: string
) => versions.get(modulePath)

/* Increment versions for multiple modules */
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
}

/* Check if a module version is stale
   Returns true if client version is older than server version */
export const isModuleStale = (
  clientVersion: ModuleVersion | undefined,
  serverVersion: ModuleVersion | undefined
) => {
  if (serverVersion === undefined) {
    return false; // Server doesn't have this module, not stale
  }
  if (clientVersion === undefined) {
    return true; // Client doesn't have this module, consider it stale
  }

  return clientVersion < serverVersion;
}

/* Get all stale modules (client versions < server versions) */
export const getStaleModules = (
  clientVersions: ModuleVersions,
  serverVersions: ModuleVersions
) => {
  const stale: string[] = [];
  
  for (const [modulePath, serverVersion] of serverVersions.entries()) {
    const clientVersion = clientVersions.get(modulePath);
    if (isModuleStale(clientVersion, serverVersion)) {
      stale.push(modulePath);
    }
  }
  
  return stale;
}

/* Serialize module versions for transmission */
export const serializeModuleVersions = (versions: ModuleVersions) => {
  const serialized: Record<string, number> = {};
  for (const [path, version] of versions.entries()) {
    serialized[path] = version;
  }

  return serialized;
}

/* Deserialize module versions from transmission */
export const deserializeModuleVersions = (
  serialized: Record<string, number>
) => {
  const versions = new Map<string, ModuleVersion>();
  for (const [path, version] of Object.entries(serialized)) {
    versions.set(path, version);
  }

  return versions;
}

