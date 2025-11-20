/* Module Version Tracker for Server-Client Synchronization
   Tracks module versions to ensure server and client stay in sync */

/* Module version: increments each time a module is updated */
export type ModuleVersion = number;

/* Module version map: module path -> version */
export type ModuleVersions = Map<string, ModuleVersion>;

/* Global module version counter */
let globalVersionCounter = 0;

/* Get next version number */
export function getNextVersion(): ModuleVersion {
  return ++globalVersionCounter;
}

/* Create a new module version tracker */
export function createModuleVersionTracker(): ModuleVersions {
  return new Map<string, ModuleVersion>();
}

/* Increment version for a module */
export function incrementModuleVersion(
  versions: ModuleVersions,
  modulePath: string
): ModuleVersion {
  const currentVersion = versions.get(modulePath) || 0;
  const newVersion = getNextVersion();
  versions.set(modulePath, newVersion);
  return newVersion;
}

/* Get version for a module */
export function getModuleVersion(
  versions: ModuleVersions,
  modulePath: string
): ModuleVersion | undefined {
  return versions.get(modulePath);
}

/* Increment versions for multiple modules */
export function incrementModuleVersions(
  versions: ModuleVersions,
  modulePaths: string[]
): Map<string, ModuleVersion> {
  const updated = new Map<string, ModuleVersion>();
  for (const path of modulePaths) {
    const version = incrementModuleVersion(versions, path);
    updated.set(path, version);
  }
  return updated;
}

/* Check if a module version is stale
   Returns true if client version is older than server version */
export function isModuleStale(
  clientVersion: ModuleVersion | undefined,
  serverVersion: ModuleVersion | undefined
): boolean {
  if (serverVersion === undefined) {
    return false; // Server doesn't have this module, not stale
  }
  if (clientVersion === undefined) {
    return true; // Client doesn't have this module, consider it stale
  }
  return clientVersion < serverVersion;
}

/* Get all stale modules (client versions < server versions) */
export function getStaleModules(
  clientVersions: ModuleVersions,
  serverVersions: ModuleVersions
): string[] {
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
export function serializeModuleVersions(versions: ModuleVersions): Record<string, number> {
  const serialized: Record<string, number> = {};
  for (const [path, version] of versions.entries()) {
    serialized[path] = version;
  }
  return serialized;
}

/* Deserialize module versions from transmission */
export function deserializeModuleVersions(
  serialized: Record<string, number>
): ModuleVersions {
  const versions = new Map<string, ModuleVersion>();
  for (const [path, version] of Object.entries(serialized)) {
    versions.set(path, version);
  }
  return versions;
}

