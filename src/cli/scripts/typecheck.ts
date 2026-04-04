import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { loadConfig } from '../../utils/loadConfig';

type CheckerResult = { name: string; exitCode: number; output: string };

const run = async (name: string, command: string[]): Promise<CheckerResult> => {
	const proc = Bun.spawn(command, {
		stderr: 'pipe',
		stdout: 'pipe'
	});
	const [stdout, stderr] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text()
	]);
	const exitCode = await proc.exited;

	return { exitCode, name, output: (stdout + stderr).trim() };
};

const findBin = (name: string) => {
	const local = resolve('node_modules', '.bin', name);

	return existsSync(local) ? local : null;
};

// eslint-disable-next-line no-control-regex
const stripAnsi = (str: string) => str.replace(/\x1b\[[0-9;]*m/g, '');

const formatSvelteOutput = (output: string) => {
	const cwd = `${process.cwd()}/`;

	// Extract error count for summary
	const summaryMatch = stripAnsi(output).match(
		/svelte-check found (\d+) error/
	);
	const errorCount = summaryMatch ? parseInt(summaryMatch[1] ?? '0', 10) : 0;

	const formatted = output
		.split('\n')
		.filter((line) => {
			const plain = stripAnsi(line);

			return (
				!plain.startsWith('Loading svelte-check') &&
				!plain.startsWith('Getting Svelte') &&
				!plain.startsWith('====') &&
				!plain.startsWith('svelte-check found') &&
				!/^\d+ (START|COMPLETED)/.test(plain) &&
				plain.trim() !== ''
			);
		})
		.flatMap((line) => {
			// Strip cwd prefix
			const result = line.replaceAll(cwd, '');

			// Recolor file paths to match tsc/vue-tsc style (cyan file, yellow line:col)
			const plain = stripAnsi(result);
			const pathMatch = plain.match(/^(\S+\.svelte):(\d+:\d+)$/);
			if (pathMatch) {
				return [
					`\x1b[96m${pathMatch[1]}\x1b[0m:\x1b[93m${pathMatch[2]}\x1b[0m`
				];
			}

			// Convert purple-highlighted tokens to red underlines like tsc.
			// Only show the error line (with highlight) + underline, skip context lines.
			if (result.includes('\x1b[35m')) {
				const plainLine = stripAnsi(result);
				const before = stripAnsi(result.split('\x1b[35m')[0] ?? '');
				const token = stripAnsi(
					(result.split('\x1b[35m')[1] ?? '').split(
						/\x1b\[3[69]m/ // eslint-disable-line no-control-regex
					)[0] ?? ''
				);
				if (!token) return [result];

				// Expand tabs to match terminal display
				const expanded = before.replace(/\t/g, '        ');
				const expandedLine = plainLine.replace(/\t/g, '        ');
				const underline = '~'.repeat(token.length);

				return [
					`\x1b[0m${expandedLine}`,
					`${' '.repeat(expanded.length)}\x1b[91m${underline}\x1b[0m`
				];
			}

			// Skip context lines (cyan code blocks surrounding the error line)
			if (
				/^\x1b\[36m|\t/.test(result) && // eslint-disable-line no-control-regex
				!result.includes('Error') &&
				!result.includes('\x1b[35m')
			) {
				return [];
			}

			return [result];
		})
		.join('\n');

	if (errorCount > 0) {
		const suffix = errorCount === 1 ? '' : 's';

		return `${formatted}\n\nFound ${errorCount} error${suffix}.`;
	}

	return formatted;
};

const buildVueTscCheck = (cacheDir: string) => {
	const vueTscBin = findBin('vue-tsc');
	if (!vueTscBin) {
		console.error(
			'\x1b[31m✗\x1b[0m vue-tsc is required for Vue type checking. Install it: bun add -d vue-tsc'
		);
		process.exit(1);
	}

	const vueTsconfigPath = join(cacheDir, 'tsconfig.vue-check.json');
	const exclude = [
		'../**/.absolutejs/**/*',
		'../**/build/**/*',
		'../**/dist/**/*',
		'../**/generated/**/*'
	];

	return writeFile(
		vueTsconfigPath,
		JSON.stringify(
			{
				exclude,
				extends: resolve('tsconfig.json')
			},
			null,
			'\t'
		)
	).then(() =>
		run('vue-tsc', [
			vueTscBin,
			'--noEmit',
			'--project',
			resolve(vueTsconfigPath),
			'--incremental',
			'--tsBuildInfoFile',
			join(cacheDir, 'vue-tsc.tsbuildinfo'),
			'--pretty'
		])
	);
};

const buildTscCheck = (cacheDir: string) => {
	const tscBin = findBin('tsc');
	if (!tscBin) {
		console.error(
			'\x1b[31m✗\x1b[0m typescript is required for type checking. Install it: bun add -d typescript'
		);
		process.exit(1);
	}

	const tscConfigPath = join(cacheDir, 'tsconfig.typecheck.json');
	const exclude = [
		'../**/.absolutejs/**/*',
		'../**/build/**/*',
		'../**/dist/**/*',
		'../**/generated/**/*'
	];

	return writeFile(
		tscConfigPath,
		JSON.stringify(
			{
				exclude,
				extends: resolve('tsconfig.json')
			},
			null,
			'\t'
		)
	).then(() =>
		run('tsc', [
			tscBin,
			'--noEmit',
			'--project',
			resolve(tscConfigPath),
			'--incremental',
			'--tsBuildInfoFile',
			join(cacheDir, 'tsc.tsbuildinfo'),
			'--pretty'
		])
	);
};

const buildSvelteCheck = async (cacheDir: string, svelteDir: string) => {
	const svelteBin = findBin('svelte-check');
	if (!svelteBin) {
		console.error(
			'\x1b[31m✗\x1b[0m svelte-check is required for Svelte type checking. Install it: bun add -d svelte-check'
		);
		process.exit(1);
	}

	const svelteTsconfigPath = join(cacheDir, 'tsconfig.svelte-check.json');
	await writeFile(
		svelteTsconfigPath,
		JSON.stringify(
			{
				extends: resolve('tsconfig.json'),
				include: [`../${svelteDir}/**/*`]
			},
			null,
			'\t'
		)
	);

	return run('svelte-check', [
		svelteBin,
		'--tsconfig',
		resolve(svelteTsconfigPath),
		'--threshold',
		'error',
		'--compiler-warnings',
		'css-unused-selector:ignore',
		'--output',
		'human-verbose',
		'--color'
	]);
};

export const typecheck = async (configPath?: string) => {
	const config = await loadConfig(configPath);
	const { generateIslandBindings } = await import(
		'../../build/generateIslandBindings'
	);
	generateIslandBindings(process.cwd(), config);

	const hasSvelte = Boolean(config.svelteDirectory);
	const hasVue = Boolean(config.vueDirectory);

	const cacheDir = '.absolutejs';
	await mkdir(cacheDir, { recursive: true });
	const checks: Promise<CheckerResult>[] = [];

	// vue-tsc is a superset of tsc — it checks .ts, .tsx, AND .vue files.
	// Any .ts file can import from .vue, so vue-tsc must check everything
	// when Vue is present. When Vue is absent, plain tsc suffices.
	checks.push(hasVue ? buildVueTscCheck(cacheDir) : buildTscCheck(cacheDir));

	// svelte-check scoped to the Svelte directory only
	if (hasSvelte) {
		checks.push(buildSvelteCheck(cacheDir, config.svelteDirectory ?? ''));
	}

	const results = await Promise.all(checks);
	const failed = results.filter((res) => res.exitCode !== 0);

	if (failed.length === 0) {
		console.log('\x1b[32m✓\x1b[0m Typecheck passed');

		return;
	}

	for (const result of failed) {
		console.error(`\n\x1b[31m[${result.name}]\x1b[0m`);
		const output =
			result.name === 'svelte-check'
				? formatSvelteOutput(result.output)
				: result.output;
		console.error(output);
	}
	console.error(
		`\n\x1b[31m✗\x1b[0m Typecheck failed: ${failed.map((res) => res.name).join(', ')}`
	);
	process.exit(1);
};
