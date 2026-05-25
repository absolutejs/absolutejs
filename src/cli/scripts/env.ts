import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { env, Glob } from 'bun';
import { LIST_TUI_COLUMN_GAP } from '../../constants';
import { colors, padLine } from '../tuiPrimitives';

type EnvVar = { files: string[]; key: string; set: boolean };

const EXTENSIONS = 'ts,tsx,js,jsx,mjs,cjs,svelte,vue';
const STATUS_WIDTH = 'missing'.length;

// getEnv('X') / getEnv("X") — the runtime's single env accessor.
const keysInFile = (text: string) =>
	[...text.matchAll(/getEnv\(\s*['"]([^'"]+)['"]\s*\)/g)]
		.map((match) => match[1])
		.filter((key): key is string => key !== undefined);

const scanPatterns = () =>
	existsSync(join(process.cwd(), 'src'))
		? [`src/**/*.{${EXTENSIONS}}`]
		: [`*.{${EXTENSIONS}}`];

// Source files that reference each env key. Scans src/ (the AbsoluteJS layout)
// or the project root, so it never has to walk node_modules.
export const scanEnvUsage = async () => {
	const scans = scanPatterns().map((pattern) =>
		Array.fromAsync(new Glob(pattern).scan({ cwd: process.cwd() }))
	);
	const files = (await Promise.all(scans)).flat();
	const usage = new Map<string, string[]>();
	files.forEach((file) => {
		keysInFile(readFileSync(file, 'utf-8')).forEach((key) => {
			usage.set(key, [...(usage.get(key) ?? []), file]);
		});
	});

	return usage;
};

const isSet = (key: string) => typeof env[key] === 'string' && env[key] !== '';

export const collectEnvVars = async () => {
	const usage = await scanEnvUsage();

	return [...usage.keys()].sort().map((key) => ({
		files: usage.get(key) ?? [],
		key,
		set: isSet(key)
	}));
};

const printTable = (vars: EnvVar[]) => {
	const keyWidth = Math.max(...vars.map((entry) => entry.key.length));
	const lines = vars.map((entry) => {
		const mark = entry.set
			? `${colors.green}✓${colors.reset}`
			: `${colors.red}✗${colors.reset}`;
		const status = entry.set
			? 'set'
			: `${colors.red}missing${colors.reset}`;
		const count = `${colors.dim}${entry.files.length} file${entry.files.length === 1 ? '' : 's'}${colors.reset}`;

		return `  ${mark} ${padLine(entry.key, keyWidth)}${' '.repeat(LIST_TUI_COLUMN_GAP)}${padLine(status, STATUS_WIDTH)}${' '.repeat(LIST_TUI_COLUMN_GAP)}${count}`;
	});
	process.stdout.write(`${lines.join('\n')}\n`);
};

export const runEnv = async (args: string[]) => {
	const vars = await collectEnvVars();
	if (vars.length === 0) {
		process.stdout.write(
			`${colors.dim}No getEnv() usage found under src/.${colors.reset}\n`
		);

		return;
	}

	const missing = vars.filter((entry) => !entry.set);

	if (args.includes('--json')) {
		process.stdout.write(`${JSON.stringify({ missing, vars }, null, 2)}\n`);

		return;
	}

	printTable(vars);
	const summary =
		missing.length === 0
			? `${colors.green}all ${vars.length} set${colors.reset}`
			: `${colors.red}${missing.length} missing${colors.reset}`;
	process.stdout.write(
		`\n${colors.dim}${vars.length} referenced · ${colors.reset}${summary}\n`
	);

	if (args.includes('--check') && missing.length > 0) {
		process.exitCode = 1;
	}
};
