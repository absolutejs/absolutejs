import { afterEach, describe, expect, test } from 'bun:test';
import {
	existsSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	writeFileSync
} from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import {
	acquireBuildDirectoryLock,
	lockPathForBuildDirectory
} from '../../../src/utils/buildDirectoryLock';

/* A project folder copied while its dev server runs carries the original's
 * .absolutejs/build.lock along. The lock names a live PID, but that process
 * owns the original folder, so the copy must not refuse to start. */

const tempDirs = new Set<string>();

const makeTempBuildDir = async () => {
	const projectRoot = await mkdtemp(join(tmpdir(), 'absolute-lock-copy-'));
	tempDirs.add(projectRoot);
	const buildDir = join(projectRoot, 'build');
	mkdirSync(buildDir, { recursive: true });

	return buildDir;
};

const writeLock = (buildDir: string, metadata: Record<string, unknown>) => {
	const lockPath = lockPathForBuildDirectory(buildDir);
	mkdirSync(dirname(lockPath), { recursive: true });
	writeFileSync(lockPath, JSON.stringify(metadata, null, 2));

	return lockPath;
};

// The parent of this test process: alive, and not this process.
const liveForeignPid = process.ppid;

const captureWarnings = () => {
	const warnings: string[] = [];
	const originalWarn = console.warn;
	console.warn = (...args: unknown[]) => {
		warnings.push(args.map(String).join(' '));
	};

	const restore = () => {
		console.warn = originalWarn;
	};

	return { restore, warnings };
};

afterEach(async () => {
	for (const dir of [...tempDirs]) {
		await rm(dir, { force: true, recursive: true }).catch(() => {});
		tempDirs.delete(dir);
	}
});

describe('buildDirectoryLock — copied project folders', () => {
	test('the lock records the real path of the project it belongs to', async () => {
		const buildDir = await makeTempBuildDir();
		const release = await acquireBuildDirectoryLock(buildDir);
		try {
			const metadata = JSON.parse(
				readFileSync(lockPathForBuildDirectory(buildDir), 'utf-8')
			);
			expect(metadata.projectRoot).toBe(
				realpathSync.native(dirname(buildDir))
			);
		} finally {
			await release();
		}
	});

	test('a live lock copied from another project path is ignored', async () => {
		const buildDir = await makeTempBuildDir();
		const lockPath = writeLock(buildDir, {
			pid: liveForeignPid,
			port: 3000,
			projectRoot: '/somewhere/else/original-project',
			startedAt: new Date(0).toISOString()
		});
		const { restore, warnings } = captureWarnings();
		try {
			const release = await acquireBuildDirectoryLock(buildDir, {
				wait: false
			});
			const metadata = JSON.parse(readFileSync(lockPath, 'utf-8'));
			expect(metadata.pid).toBe(process.pid);
			expect(
				warnings.some((line) =>
					line.includes(
						'removed a build lock copied from /somewhere/else/original-project'
					)
				)
			).toBe(true);
			await release();
			expect(existsSync(lockPath)).toBe(false);
		} finally {
			restore();
		}
	});

	test('a live lock for this same project path still blocks', async () => {
		const buildDir = await makeTempBuildDir();
		writeLock(buildDir, {
			pid: liveForeignPid,
			port: 3000,
			projectRoot: realpathSync.native(dirname(buildDir)),
			startedAt: new Date(0).toISOString()
		});
		await expect(
			acquireBuildDirectoryLock(buildDir, { wait: false })
		).rejects.toThrow(`build lock is held by PID ${liveForeignPid}`);
	});

	test('an old lock file without a project path still blocks while its PID lives', async () => {
		const buildDir = await makeTempBuildDir();
		writeLock(buildDir, {
			pid: liveForeignPid,
			port: null,
			startedAt: new Date(0).toISOString()
		});
		await expect(
			acquireBuildDirectoryLock(buildDir, { wait: false })
		).rejects.toThrow(`build lock is held by PID ${liveForeignPid}`);
	});
});
