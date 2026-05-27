import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { lockPathForBuildDirectory } from '../../../src/utils/buildDirectoryLock';

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..', '..');
const LOCK_MODULE = resolve(PROJECT_ROOT, 'src/utils/buildDirectoryLock.ts');

const tempDirs = new Set<string>();

const makeTempBuildDir = async () => {
	const projectRoot = await mkdtemp(join(tmpdir(), 'absolute-lock-cleanup-'));
	tempDirs.add(projectRoot);
	const buildDir = join(projectRoot, 'build');
	mkdirSync(buildDir, { recursive: true });

	return { buildDir, projectRoot };
};

afterEach(async () => {
	for (const dir of [...tempDirs]) {
		await rm(dir, { force: true, recursive: true }).catch(() => {});
		tempDirs.delete(dir);
	}
});

describe('buildDirectoryLock — exit-handler cleanup', () => {
	test('SIGINT to a process holding the lock removes the lock file', async () => {
		const { buildDir, projectRoot } = await makeTempBuildDir();
		const lockPath = lockPathForBuildDirectory(buildDir);

		const childScript = join(projectRoot, 'child.ts');
		await writeFile(
			childScript,
			`import { acquireBuildDirectoryLock } from ${JSON.stringify(LOCK_MODULE)};

const buildDir = ${JSON.stringify(buildDir)};

const main = async () => {
	await acquireBuildDirectoryLock(buildDir);
	console.log('LOCK_HELD');
	// setInterval keeps the event loop alive so process.on('exit')
	// doesn't fire on its own — we want SIGINT to be the trigger.
	setInterval(() => {}, 1000);
};

main();
`
		);

		const proc = Bun.spawn(['bun', childScript], {
			cwd: projectRoot,
			stderr: 'pipe',
			stdout: 'pipe'
		});

		// Wait for "LOCK_HELD" line from stdout.
		const reader = proc.stdout.getReader();
		const errReader = proc.stderr.getReader();
		const decoder = new TextDecoder();
		const errDecoder = new TextDecoder();
		let buffer = '';
		let errBuffer = '';
		const drainErr = async () => {
			while (true) {
				try {
					const { value, done } = await errReader.read();
					if (done) return;
					errBuffer += errDecoder.decode(value, { stream: true });
				} catch {
					return;
				}
			}
		};
		const errDrainPromise = drainErr();
		const start = Date.now();
		while (Date.now() - start < 10_000) {
			const { value, done } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			if (buffer.includes('LOCK_HELD')) break;
		}
		try {
			reader.releaseLock();
		} catch {
			/* noop */
		}
		void errDrainPromise;

		expect({
			buffer,
			errBuffer,
			found: buffer.includes('LOCK_HELD')
		}).toEqual({ buffer, errBuffer, found: true });
		expect({
			buffer,
			errBuffer,
			exists: existsSync(lockPath),
			lockPath
		}).toEqual({ buffer, errBuffer, exists: true, lockPath });

		// Send SIGINT — the in-process exit handler should remove the lock
		// before the process dies.
		proc.kill('SIGINT');
		await proc.exited;

		// Allow a tick for the OS to flush the unlink.
		await Bun.sleep(50);

		expect(existsSync(lockPath)).toBe(false);
	}, 15_000);
});
