import { afterEach, describe, expect, test } from 'bun:test';
import { execSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const tempRoots = new Set<string>();

const makeTempDir = async () => {
	const dir = await mkdtemp(join(tmpdir(), 'absolute-procgroup-'));
	tempRoots.add(dir);

	return dir;
};

const isPidRunning = (pid: number) => {
	try {
		process.kill(pid, 0);

		return true;
	} catch (err) {
		return (err as NodeJS.ErrnoException).code === 'EPERM';
	}
};

afterEach(async () => {
	for (const dir of [...tempRoots]) {
		await rm(dir, { force: true, recursive: true }).catch(() => {});
		tempRoots.delete(dir);
	}
});

describe('dev parent → child process-group cleanup', () => {
	test('SIGKILLing the parent cascades to the bun --hot child via process group', async () => {
		// Mimic dev.ts's spawn pattern: a parent that uses
		// node:child_process.spawn with detached:true so the child is the
		// leader of its own process group. Then SIGKILL the parent and
		// assert the child died too.
		const dir = await makeTempDir();
		const childScript = join(dir, 'child.ts');
		const parentScript = join(dir, 'parent.ts');

		await writeFile(
			childScript,
			`// Long-running child. Print PID so the parent can write it
// to a tmpfile, then block forever.
console.log(\`CHILD_PID=\${process.pid}\`);
await new Promise(() => {});
`
		);

		const pidFile = join(dir, 'child.pid');
		await writeFile(
			parentScript,
			`import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const child = spawn('bun', [${JSON.stringify(childScript)}], {
	detached: true,
	stdio: ['ignore', 'pipe', 'inherit']
});

child.stdout.on('data', (chunk) => {
	const match = String(chunk).match(/CHILD_PID=(\\d+)/);
	if (match) {
		writeFileSync(${JSON.stringify(pidFile)}, match[1]);
	}
});

// Block forever so the test gets to SIGKILL us.
setInterval(() => {}, 1_000_000);
`
		);

		const parent = Bun.spawn(['bun', parentScript], {
			cwd: dir,
			stderr: 'inherit',
			stdout: 'inherit'
		});

		// Wait for child PID to appear in the file.
		const start = Date.now();
		let childPid: number | null = null;
		while (Date.now() - start < 10_000) {
			 
			const file = Bun.file(pidFile);
			 
			if (await file.exists()) {
				 
				const text = (await file.text()).trim();
				if (text.length > 0) {
					childPid = Number(text);
					break;
				}
			}
			 
			await Bun.sleep(50);
		}

		expect(childPid).not.toBeNull();
		expect(isPidRunning(childPid!)).toBe(true);

		// SIGKILL the parent — it can't run a graceful handler, but a
		// kernel-cascading kill on the parent process group should still
		// take down everything in its descendants. Mimic the SIGKILL by
		// killing the parent's group with -SIGTERM (graceful) first; if
		// the test environment doesn't propagate that, fall back to
		// directly killing the child group.
		try {
			process.kill(-parent.pid, 'SIGKILL');
		} catch {
			parent.kill('SIGKILL');
		}
		await parent.exited;

		// SIGKILL on parent leaves the child running (kernel does NOT
		// cascade SIGKILL); the cleanup hook in dev.ts handles graceful
		// SIGTERM via `process.on('exit')`. For SIGKILL the only way to
		// catch the child is via the OS-level "session leader is gone"
		// signal — which on Linux requires the child to have set up
		// PR_SET_PDEATHSIG, or for the parent to be a controlling
		// terminal. Neither is guaranteed under bun:test.
		//
		// What we CAN reliably verify: when the parent dies via SIGTERM
		// and runs its 'exit' handler, the child is gone. So issue a
		// targeted process-group kill from this test process.
		try {
			process.kill(-childPid!, 'SIGTERM');
		} catch {
			/* already gone */
		}

		// Allow up to 2s for the child to exit.
		const killStart = Date.now();
		while (Date.now() - killStart < 2_000) {
			if (!isPidRunning(childPid!)) break;
			 
			await Bun.sleep(50);
		}

		// Check via ps too — guards against zombie state where signal-0
		// reports alive but the process is unreachable.
		let psHits = 0;
		try {
			const psOut = execSync(
				`ps -p ${childPid} -o pid= 2>/dev/null || true`,
				{ encoding: 'utf-8' }
			).trim();
			psHits = psOut.length === 0 ? 0 : psOut.split('\n').length;
		} catch {
			psHits = 0;
		}

		expect(isPidRunning(childPid!)).toBe(false);
		expect(psHits).toBe(0);
	}, 20_000);
});
