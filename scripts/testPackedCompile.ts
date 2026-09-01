import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dir, '..');
const packRoot = await mkdtemp(join(tmpdir(), 'absolute-packed-compile-'));

const run = async (command: string[], env?: Record<string, string>) => {
	const proc = Bun.spawn(command, {
		cwd: repoRoot,
		env: { ...process.env, ...env },
		stderr: 'pipe',
		stdout: 'pipe'
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited
	]);
	if (exitCode !== 0) {
		throw new Error(
			`Command failed with code ${exitCode}: ${command.join(' ')}\n${stdout}\n${stderr}`
		);
	}

	return stdout.trim();
};

try {
	const packOutput = await run([
		'npm',
		'pack',
		'--pack-destination',
		packRoot,
		'--silent'
	]);
	const tarballNames = packOutput.split('\n');
	const tarballPath = join(packRoot, tarballNames.pop() ?? '');

	await run(['bun', 'test', 'tests/integration/compile-published.test.ts'], {
		ABSOLUTE_TEST_OMIT_OPTIONAL: '1',
		ABSOLUTE_TEST_PACKAGE_SPEC: tarballPath,
		ABSOLUTE_TEST_PUBLISHED_BETA: '1'
	});
	console.log('Fresh local package compile and browser acceptance passed.');
} finally {
	await rm(packRoot, { force: true, recursive: true });
}
