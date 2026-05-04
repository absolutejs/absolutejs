import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import {
	acquireBuildDirectoryLock,
	lockPathForBuildDirectory
} from '../../../src/utils/buildDirectoryLock';

const tempDirs = new Set<string>();

const makeTempBuildDir = async () => {
	const projectRoot = await mkdtemp(join(tmpdir(), 'absolute-lock-test-'));
	tempDirs.add(projectRoot);
	const buildDir = join(projectRoot, 'build');
	mkdirSync(buildDir, { recursive: true });

	return buildDir;
};

afterEach(async () => {
	for (const dir of [...tempDirs]) {
		await rm(dir, { force: true, recursive: true }).catch(() => {});
		tempDirs.delete(dir);
	}
});

describe('buildDirectoryLock — orphan PID detection', () => {
	test('acquires successfully when an existing lock points at a dead PID', async () => {
		const buildDir = await makeTempBuildDir();
		const lockPath = lockPathForBuildDirectory(buildDir);

		// Pick a PID that's almost certainly not alive on this host. Any
		// large unused PID works on Linux/macOS — `process.kill(pid, 0)`
		// returns ESRCH, which the lock treats as orphan.
		const fakeDeadPid = 0x7fff_ffff;
		mkdirSync(dirname(lockPath), { recursive: true });
		writeFileSync(
			lockPath,
			JSON.stringify(
				{
					pid: fakeDeadPid,
					port: null,
					startedAt: new Date(0).toISOString()
				},
				null,
				2
			)
		);

		const warnings: string[] = [];
		const originalWarn = console.warn;
		console.warn = (...args: unknown[]) => {
			warnings.push(args.map(String).join(' '));
		};

		try {
			const release = await acquireBuildDirectoryLock(buildDir);
			expect(existsSync(lockPath)).toBe(true);

			const metadata = JSON.parse(readFileSync(lockPath, 'utf-8'));
			expect(metadata.pid).toBe(process.pid);

			const warned = warnings.some((line) =>
				line.includes(`removed stale lock from PID ${fakeDeadPid}`)
			);
			expect(warned).toBe(true);

			await release();
			expect(existsSync(lockPath)).toBe(false);
		} finally {
			console.warn = originalWarn;
		}
	});
});
