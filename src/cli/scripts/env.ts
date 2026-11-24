import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { env, Glob } from 'bun';
import { Value } from '@sinclair/typebox/value';
import { LIST_TUI_COLUMN_GAP } from '../../constants';
import { colors, padLine } from '../tuiPrimitives';
import {
	type EnvDeclaration,
	readEnvSchema,
	resolveEnvModule
} from './envSchema';

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

type CheckedVar = {
	declaration: EnvDeclaration;
	satisfied: boolean;
	status: string;
};

/* Presence is the easy half. A declared `PORT` set to "notanumber"
 * satisfies a scan for its name and fails the schema, and that second
 * half is the one worth running in CI. */
const describeValue = (declaration: EnvDeclaration): CheckedVar => {
	const raw = env[declaration.key];
	const present = typeof raw === 'string' && raw !== '';
	if (!present && declaration.default !== undefined)
		return {
			declaration,
			satisfied: true,
			status: `${colors.dim}default ${JSON.stringify(declaration.default)}${colors.reset}`
		};
	if (!present && declaration.optional)
		return {
			declaration,
			satisfied: true,
			status: `${colors.dim}unset (optional)${colors.reset}`
		};
	if (!present)
		return {
			declaration,
			satisfied: false,
			status: `${colors.red}missing${colors.reset}`
		};
	const converted = Value.Convert(declaration.schema, raw);
	const valid = Value.Check(declaration.schema, converted);

	return {
		declaration,
		satisfied: valid,
		status: valid
			? 'set'
			: `${colors.red}invalid${colors.reset} ${colors.dim}${JSON.stringify(raw)}${colors.reset}`
	};
};

const printDeclarations = (checked: CheckedVar[]) => {
	const keyWidth = Math.max(
		...checked.map((entry) => entry.declaration.key.length)
	);
	const typeWidth = Math.max(
		...checked.map((entry) => entry.declaration.type.length)
	);
	const lines = checked.map((entry) => {
		const mark = entry.satisfied
			? `${colors.green}\u2713${colors.reset}`
			: `${colors.red}\u2717${colors.reset}`;
		const gap = ' '.repeat(LIST_TUI_COLUMN_GAP);

		return `  ${mark} ${padLine(entry.declaration.key, keyWidth)}${gap}${colors.dim}${padLine(entry.declaration.type, typeWidth)}${colors.reset}${gap}${entry.status}`;
	});
	process.stdout.write(`${lines.join('\n')}\n`);
};

const flagValue = (args: string[], flag: string) => {
	const index = args.indexOf(flag);

	return index === -1 ? undefined : args[index + 1];
};

/* Both sources, labelled, because they answer different questions: the
 * schema says what the project DECLARES — with a type, a default and
 * whether it is optional — and the scan says where a variable is read. A
 * key in the scan and not the schema is usually one that should be
 * declared. */
export const runEnv = async (args: string[]) => {
	const asJson = args.includes('--json');
	const modulePath = resolveEnvModule(flagValue(args, '--file'));
	const schema =
		modulePath === undefined ? undefined : await readEnvSchema(modulePath);
	const declarations = schema?.declarations ?? [];
	const checked = declarations.map(describeValue);
	const vars = await collectEnvVars();
	const undeclared = vars.filter(
		(entry) => !declarations.some((one) => one.key === entry.key)
	);
	const unsatisfied = checked.filter((entry) => !entry.satisfied);

	if (asJson) {
		process.stdout.write(
			`${JSON.stringify(
				{
					declared: checked.map((entry) => ({
						default: entry.declaration.default,
						key: entry.declaration.key,
						optional: entry.declaration.optional,
						satisfied: entry.satisfied,
						type: entry.declaration.type
					})),
					missing: undeclared.filter((entry) => !entry.set),
					schemaError: schema?.error,
					schemaFile:
						modulePath === undefined
							? undefined
							: relative(process.cwd(), modulePath),
					used: vars
				},
				null,
				2
			)}\n`
		);
		if (args.includes('--check') && unsatisfied.length > 0)
			process.exitCode = 1;

		return;
	}

	if (schema?.error !== undefined) {
		process.stdout.write(
			`${colors.red}Could not read ${relative(process.cwd(), modulePath ?? '')}${colors.reset}\n  ${schema.error}\n\n`
		);
	}

	if (checked.length > 0) {
		process.stdout.write(
			`${colors.dim}declared in ${relative(process.cwd(), modulePath ?? '')}${colors.reset}\n`
		);
		printDeclarations(checked);
		const summary =
			unsatisfied.length === 0
				? `${colors.green}all ${checked.length} satisfied${colors.reset}`
				: `${colors.red}${unsatisfied.length} unsatisfied${colors.reset}`;
		process.stdout.write(
			`\n${colors.dim}${checked.length} declared \u00b7 ${colors.reset}${summary}\n`
		);
	}

	if (undeclared.length > 0) {
		const heading =
			checked.length > 0
				? `\n${colors.dim}read with getEnv(), not declared${colors.reset}\n`
				: '';
		process.stdout.write(heading);
		printTable(undeclared);
		const missing = undeclared.filter((entry) => !entry.set);
		const summary =
			missing.length === 0
				? `${colors.green}all ${undeclared.length} set${colors.reset}`
				: `${colors.red}${missing.length} missing${colors.reset}`;
		process.stdout.write(
			`\n${colors.dim}${undeclared.length} referenced \u00b7 ${colors.reset}${summary}\n`
		);
		if (args.includes('--check') && missing.length > 0)
			process.exitCode = 1;
	}

	if (checked.length === 0 && undeclared.length === 0) {
		process.stdout.write(
			`${colors.dim}No environment variables declared with defineEnv() or read with getEnv().${colors.reset}\n`
		);
	}

	if (args.includes('--check') && unsatisfied.length > 0)
		process.exitCode = 1;
};
