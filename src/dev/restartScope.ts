import { realpathSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { currentI18nRouting } from '../utils/i18nRoutingRef';
import { isTestSourcePath } from '../utils/isTestSourcePath';

/* Which file changes need the dev server process restarted. Files no HMR
 * pipeline handles used to restart it unconditionally, so editing a doc or
 * a test dropped every open page for seconds. Now:
 *   - documents and test files never do: the server doesn't run them;
 *   - code modules do only when this process has loaded them (Bun's
 *     `require.cache` lists static and dynamic imports alike). A module
 *     nothing has imported yet loads fresh on first use anyway;
 *   - directories never do: the server reads files, and every file
 *     change inside a directory arrives as its own event. Watchers also
 *     report a bare directory (an mtime touch, e.g. right after a project
 *     is copied and first booted), which used to restart for nothing;
 *   - a message catalog the config names (`i18n.catalogs`) does only
 *     when this process has loaded it as a module. One a loader reads
 *     when a request needs it is read again by the next request, so
 *     there is nothing to restart for;
 *   - anything else (`.env`, `package.json`, `tsconfig.json`, …) still
 *     does, since it is read once at startup. */

const MODULE_FILE = /\.(?:[cm]?[jt]sx?|mts|cts)$/;
const DOCUMENT_FILE = /\.(?:md|mdx|markdown|txt|rst|adoc|log|csv)$/i;

const realPath = (path: string) => {
	try {
		return realpathSync(path);
	} catch {
		return path;
	}
};

const isDirectory = (path: string) => {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
};

const isLoadedByThisProcess = (path: string) =>
	path in require.cache || realPath(path) in require.cache;

/* Whether the config's `i18n.catalogs` names this file. */
const isDeclaredCatalog = (path: string) => {
	const real = realPath(path);

	return Object.values(currentI18nRouting()?.catalogs ?? {}).some(
		(catalog) =>
			catalog !== undefined && realPath(resolve(catalog)) === real
	);
};

export const changeNeedsRestart = (
	path: string,
	isLoaded: (path: string) => boolean = isLoadedByThisProcess
) => {
	if (DOCUMENT_FILE.test(path) || isTestSourcePath(path)) return false;
	if (MODULE_FILE.test(path) || isDeclaredCatalog(path))
		return isLoaded(path);

	return !isDirectory(path);
};
