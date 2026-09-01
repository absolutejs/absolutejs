import { resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dir, '..');
const MS_PER_SECOND = 1_000;

type GateCommand = {
	command: string[];
	name: string;
};

type CommandResult = {
	durationMs: number;
	exitCode: number;
	name: string;
	output: string;
};

const runCommand = async ({ command, name }: GateCommand) => {
	const startedAt = performance.now();
	const proc = Bun.spawn(command, {
		cwd: REPO_ROOT,
		env: {
			...process.env,
			BUN_RUNTIME_TRANSPILER_CACHE_PATH: '0',
			FORCE_COLOR: '0',
			TELEMETRY_OFF: '1'
		},
		stderr: 'pipe',
		stdout: 'pipe'
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited
	]);

	return {
		durationMs: performance.now() - startedAt,
		exitCode,
		name,
		output: `${stdout}${stderr}`
	} satisfies CommandResult;
};

const formatDuration = (durationMs: number) =>
	`${(durationMs / MS_PER_SECOND).toFixed(1)}s`;

const reportResult = (result: CommandResult) => {
	const status = result.exitCode === 0 ? 'passed' : 'failed';
	console.log(
		`[release-gate] ${result.name} ${status} in ${formatDuration(result.durationMs)}`
	);
	if (result.exitCode !== 0) console.error(result.output.trim());
};

const runStage = async (name: string, commands: GateCommand[]) => {
	console.log(`\n[release-gate] ${name}`);
	// Release checks share generated output, native artifacts, and lint caches.
	// Running them concurrently makes a clean release depend on timing (for
	// example, package build replaces dist while unit tests execute its CLI).
	const results = await commands.reduce<Promise<CommandResult[]>>(
		async (pendingResults, command) => [
			...(await pendingResults),
			await runCommand(command)
		],
		Promise.resolve([])
	);
	results.forEach(reportResult);
	const failures = results.filter((result) => result.exitCode !== 0);
	if (failures.length === 0) return;

	throw new Error(
		`${name} failed: ${failures.map((failure) => failure.name).join(', ')}`
	);
};

const nativePackageDirs = [
	'darwin-arm64',
	'darwin-x64',
	'linux-arm64',
	'linux-x64',
	'windows-arm64',
	'windows-x64'
];

const startedAt = performance.now();

await runStage('immutable source checks', [
	{
		command: ['bun', 'run', 'verify:release-versions'],
		name: 'release versions'
	},
	{ command: ['bun', 'run', 'format:check'], name: 'format' }
]);

await runStage('quality and builds', [
	{ command: ['bun', 'run', 'lint'], name: 'lint' },
	{ command: ['bun', 'run', 'test:unit'], name: 'unit tests' },
	{ command: ['bun', 'run', 'build'], name: 'package build' },
	{
		command: ['bun', 'run', 'verify:client-bundle'],
		name: 'published client bundle isolation'
	},
	{
		command: ['bun', 'run', 'build:native'],
		name: 'six-platform native build'
	}
]);

await runStage('generated declaration checks', [
	{ command: ['bun', 'run', 'typecheck'], name: 'typecheck' }
]);

await runStage('isolated integration inventory', [
	{
		command: ['bun', 'run', 'test:integration'],
		name: 'integration tests'
	}
]);

await runStage('package verification', [
	{
		command: ['bun', 'run', 'test:packed-compile'],
		name: 'fresh local package compile acceptance'
	},
	{
		command: ['npm', 'pack', '--dry-run', '--json'],
		name: 'root package'
	},
	...nativePackageDirs.map((dir) => ({
		command: [
			'npm',
			'pack',
			'--dry-run',
			'--json',
			resolve(REPO_ROOT, 'native', 'packages', dir)
		],
		name: `native ${dir}`
	}))
]);

console.log(
	`\n[release-gate] complete in ${formatDuration(performance.now() - startedAt)}`
);
