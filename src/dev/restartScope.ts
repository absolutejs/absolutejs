import { realpathSync } from 'node:fs';
import { isTestSourcePath } from '../utils/isTestSourcePath';

/* Which file changes need the dev server process restarted. Files no HMR
 * pipeline handles used to restart it unconditionally, so editing a doc or
 * a test dropped every open page for seconds. Now:
 *   - documents and test files never do: the server doesn't run them;
 *   - code modules do only when this process has loaded them (Bun's
 *     `require.cache` lists static and dynamic imports alike). A module
 *     nothing has imported yet loads fresh on first use anyway;
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

const isLoadedByThisProcess = (path: string) =>
	path in require.cache || realPath(path) in require.cache;

export const changeNeedsRestart = (
	path: string,
	isLoaded: (path: string) => boolean = isLoadedByThisProcess
) => {
	if (DOCUMENT_FILE.test(path) || isTestSourcePath(path)) return false;
	if (MODULE_FILE.test(path)) return isLoaded(path);

	return true;
};
