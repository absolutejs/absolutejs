import type { SpawnOptions } from 'node:child_process';

/** Options shared by the detached server child used by `absolute dev`.
 *
 * The child needs its own process group so the parent can clean up the server
 * tree. On Windows, detached children otherwise get a visible console window;
 * keep the process group without opening a second CMD window.
 */
export const devChildSpawnOptions = (
	cwd: string,
	env: NodeJS.ProcessEnv
): SpawnOptions => ({
	cwd,
	detached: true,
	env,
	stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
	windowsHide: process.platform === 'win32'
});
