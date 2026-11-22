/* `@absolutejs/absolute/testing` — the harness this repository tests
 * itself with, made usable by a project that installs the package.
 *
 * Everything here already existed under `tests/helpers/`, where nobody
 * else could reach it, so every project testing an AbsoluteJS app wrote
 * the same spawn, readiness probe, file-restore registry and teardown
 * again. The teardown is the part people get wrong, and a leaked server
 * holding a port fails the NEXT test rather than the one that caused it.
 *
 * Deliberately dependency-free: node builtins and Bun only. No
 * `bun:test` import, so it works under any runner; no Playwright, which
 * is why the browser helpers are not here — they would make a browser a
 * dependency of the framework. */

export { fetchPage, waitForServer } from './http';
export type { WaitForServerOptions } from './http';
export { getAvailablePort } from './ports';
export {
	createFile,
	mutateFile,
	mutateFileInPlace,
	renameFile,
	restoreAllFiles,
	restoreFile,
	withFileMutation
} from './files';
export { startProject } from './project';
export type { RunningProject, StartProjectOptions } from './project';
