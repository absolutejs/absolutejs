import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const DEFAULT_LOCK_TIMEOUT_MS = 120_000;
const DEFAULT_STALE_LOCK_MS = 10 * 60_000;
const LOCK_POLL_MS = 250;
const heldLocks = new Map<
	string,
	{ count: number; release: () => Promise<void> }
>();
const HELD_LOCKS_ENV = 'ABSOLUTE_HELD_BUILD_DIRECTORY_LOCKS';

const isAlreadyExistsError = (error: unknown) =>
	error instanceof Error &&
	'code' in error &&
	(error as NodeJS.ErrnoException).code === 'EEXIST';

const lockPathForBuildDirectory = (buildDirectory: string) =>
	join(
		dirname(buildDirectory),
		`.${buildDirectory.split(/[\\/]/).pop()}.lock`
	);

const readHeldLockEnv = () =>
	new Set(
		(process.env[HELD_LOCKS_ENV] ?? '')
			.split('\n')
			.filter((entry) => entry.length > 0)
	);

const writeHeldLockEnv = (locks: Set<string>) => {
	if (locks.size === 0) {
		delete process.env[HELD_LOCKS_ENV];

		return;
	}

	process.env[HELD_LOCKS_ENV] = Array.from(locks).join('\n');
};

const markHeldLock = (buildDirectory: string) => {
	const locks = readHeldLockEnv();
	locks.add(buildDirectory);
	writeHeldLockEnv(locks);
};

const unmarkHeldLock = (buildDirectory: string) => {
	const locks = readHeldLockEnv();
	locks.delete(buildDirectory);
	writeHeldLockEnv(locks);
};

export const acquireBuildDirectoryLock = async (
	buildDirectory: string,
	options: {
		staleLockMs?: number;
		timeoutMs?: number;
	} = {}
) => {
	if (readHeldLockEnv().has(buildDirectory)) {
		return async () => {};
	}

	const heldLock = heldLocks.get(buildDirectory);
	if (heldLock) {
		heldLock.count += 1;

		return async () => {
			heldLock.count -= 1;
			if (heldLock.count === 0) {
				heldLocks.delete(buildDirectory);
				await heldLock.release();
			}
		};
	}

	const lockPath = lockPathForBuildDirectory(buildDirectory);
	const staleLockMs = options.staleLockMs ?? DEFAULT_STALE_LOCK_MS;
	const timeoutMs = options.timeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
	const start = Date.now();

	while (true) {
		try {
			await mkdir(dirname(lockPath), { recursive: true });
			await mkdir(lockPath);
			await writeFile(
				join(lockPath, 'owner'),
				JSON.stringify(
					{
						buildDirectory,
						createdAt: new Date().toISOString(),
						pid: process.pid
					},
					null,
					2
				)
			);

			const release = async () => {
				await rm(lockPath, { force: true, recursive: true }).catch(
					() => {}
				);
			};
			heldLocks.set(buildDirectory, { count: 1, release });
			markHeldLock(buildDirectory);

			return async () => {
				const current = heldLocks.get(buildDirectory);
				if (!current) return;
				current.count -= 1;
				if (current.count > 0) return;
				heldLocks.delete(buildDirectory);
				unmarkHeldLock(buildDirectory);
				await current.release();
			};
		} catch (error) {
			if (!isAlreadyExistsError(error)) throw error;

			try {
				const lockStat = await stat(lockPath);
				if (Date.now() - lockStat.mtimeMs > staleLockMs) {
					await rm(lockPath, { force: true, recursive: true });
					continue;
				}
			} catch {
				// The lock was removed between attempts.
			}

			if (Date.now() - start > timeoutMs) {
				throw new Error(
					`Timed out waiting for AbsoluteJS build directory lock: ${buildDirectory}`
				);
			}

			await Bun.sleep(LOCK_POLL_MS);
		}
	}
};

export const withBuildDirectoryLock = async <T>(
	buildDirectory: string,
	action: () => Promise<T>
) => {
	const release = await acquireBuildDirectoryLock(buildDirectory);
	try {
		return await action();
	} finally {
		await release();
	}
};
