import { mkdirSync, unlinkSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const heldLocks = new Map<
	string,
	{ count: number; release: () => Promise<void>; releaseSync: () => void }
>();
const HELD_LOCKS_ENV = 'ABSOLUTE_HELD_BUILD_DIRECTORY_LOCKS';

let exitHandlersRegistered = false;

const registerExitHandlersOnce = () => {
	if (exitHandlersRegistered) return;
	exitHandlersRegistered = true;

	const releaseAllSync = () => {
		for (const lock of heldLocks.values()) {
			try {
				lock.releaseSync();
			} catch {
				/* best effort */
			}
		}
		heldLocks.clear();
	};

	process.on('exit', releaseAllSync);
	process.on('SIGINT', () => {
		releaseAllSync();
		process.exit(130);
	});
	process.on('SIGTERM', () => {
		releaseAllSync();
		process.exit(143);
	});
	process.on('uncaughtException', (err) => {
		releaseAllSync();
		throw err;
	});
};

const isAlreadyExistsError = (error: unknown) =>
	error instanceof Error &&
	'code' in error &&
	(error as NodeJS.ErrnoException).code === 'EEXIST';

/** Lock file path: `<projectRoot>/.absolutejs/build.lock` where
 *  projectRoot is `dirname(buildDirectory)`. Single file (NOT a dir
 *  inside build/) — placing it inside .absolutejs avoids interfering
 *  with watcher includes scoped to src/, db/, assets/, styles/. */
export const lockPathForBuildDirectory = (buildDirectory: string) =>
	join(dirname(buildDirectory), '.absolutejs', 'build.lock');

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

type LockMetadata = {
	pid: number;
	port: number | null;
	startedAt: string;
};

const writeLockFileSync = (lockPath: string, metadata: LockMetadata) => {
	mkdirSync(dirname(lockPath), { recursive: true });
	// `wx` flag → atomic create; throws EEXIST if file already exists.
	writeFileSync(lockPath, JSON.stringify(metadata, null, 2), { flag: 'wx' });
};

const readLockMetadata = (lockPath: string) => {
	try {
		const raw = readFileSync(lockPath, 'utf-8');
		const parsed = JSON.parse(raw);
		if (
			typeof parsed === 'object' &&
			parsed !== null &&
			typeof parsed.pid === 'number'
		) {
			return {
				pid: parsed.pid,
				port: typeof parsed.port === 'number' ? parsed.port : null,
				startedAt:
					typeof parsed.startedAt === 'string'
						? parsed.startedAt
						: new Date().toISOString()
			};
		}
	} catch {
		/* unreadable / unparseable — treat as no metadata */
	}

	return null;
};

const isProcessAlive = (pid: number) => {
	try {
		// Signal 0 — no-op kill, just liveness check.
		process.kill(pid, 0);

		return true;
	} catch (err) {
		const {code} = (err as NodeJS.ErrnoException);
		if (code === 'ESRCH') return false; // no such process
		if (code === 'EPERM') return true; // alive but not ours

		return true;
	}
};

const removeStaleLockSync = (lockPath: string, pid: number) => {
	try {
		unlinkSync(lockPath);
		console.warn(`[absolutejs] removed stale lock from PID ${pid}`);
	} catch {
		/* lock disappeared between read and unlink — fine */
	}
};

/** Update the metadata in an already-acquired lock (e.g. fill in the
 *  resolved dev-server port once it's been chosen). No-op if we don't
 *  hold the lock for this build dir. */
export const updateLockMetadata = (
	buildDirectory: string,
	updates: { pid?: number; port?: number | null }
) => {
	const lockPath = lockPathForBuildDirectory(buildDirectory);
	const current = readLockMetadata(lockPath);
	if (!current) return;
	if (current.pid !== process.pid && updates.pid !== current.pid) {
		// Don't stomp on a lock we don't own.
		return;
	}
	const next: LockMetadata = {
		pid: updates.pid ?? current.pid,
		port: updates.port !== undefined ? updates.port : current.port,
		startedAt: current.startedAt
	};
	try {
		writeFileSync(lockPath, JSON.stringify(next, null, 2));
	} catch {
		/* best effort */
	}
};

const LOCK_POLL_MS = 250;
const DEFAULT_WAIT_TIMEOUT_MS = 120_000;

export const acquireBuildDirectoryLock = async (
	buildDirectory: string,
	options: {
		port?: number | null;
		/** When true, an alive holder makes us wait (polling every
		 *  250ms up to `waitTimeoutMs`) instead of throwing immediately.
		 *  Default: true. Dev-server startup passes `wait: false` so
		 *  the user gets a fast Vite-style error pointing them at the
		 *  next free port. CLI build/compile leave it true so concurrent
		 *  invocations against a shared outdir serialize cleanly. */
		wait?: boolean;
		waitTimeoutMs?: number;
	} = {}
) => {
	registerExitHandlersOnce();

	if (readHeldLockEnv().has(buildDirectory)) {
		return async () => {
			/* lock not held by this process */
		};
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
	const wait = options.wait !== false;
	const waitTimeoutMs = options.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
	const start = Date.now();

	const tryCreate = () => {
		writeLockFileSync(lockPath, {
			pid: process.pid,
			port: options.port ?? null,
			startedAt: new Date().toISOString()
		});
	};

	while (true) {
		try {
			tryCreate();
			break;
		} catch (error) {
			if (!isAlreadyExistsError(error)) throw error;

			const existing = readLockMetadata(lockPath);
			if (!existing) {
				// Lock file exists but unreadable — treat as orphan and remove.
				try {
					unlinkSync(lockPath);
				} catch {
					/* lock vanished */
				}
				continue;
			}

			if (!isProcessAlive(existing.pid)) {
				removeStaleLockSync(lockPath, existing.pid);
				continue;
			}

			if (wait && Date.now() - start < waitTimeoutMs) {
				// Live holder — back off and retry. Concurrent build
				// invocations from a CI matrix or shell loop want the
				// second call to wait, not error.
				// eslint-disable-next-line no-await-in-loop
				await Bun.sleep(LOCK_POLL_MS);
				continue;
			}

			const portInfo = existing.port ? ` on port ${existing.port}` : '';
			const elapsedNote = wait
				? ` Waited ${Math.round((Date.now() - start) / 1000)}s.`
				: '';
			throw new Error(
				`AbsoluteJS build lock is held by PID ${existing.pid}${portInfo} (started ${existing.startedAt}).${elapsedNote} ` +
					`Another process owns ${buildDirectory}. ` +
					`Run \`kill ${existing.pid}\` (or wait for it to finish) and try again.`
			);
		}
	}

	const releaseSync = () => {
		try {
			unlinkSync(lockPath);
		} catch {
			/* already gone */
		}
	};

	const release = async () => {
		releaseSync();
	};

	heldLocks.set(buildDirectory, { count: 1, release, releaseSync });
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
};

export const withBuildDirectoryLock = async <T>(
	buildDirectory: string,
	action: () => Promise<T>,
	options: {
		port?: number | null;
		wait?: boolean;
		waitTimeoutMs?: number;
	} = {}
) => {
	const release = await acquireBuildDirectoryLock(buildDirectory, options);
	try {
		return await action();
	} finally {
		await release();
	}
};
