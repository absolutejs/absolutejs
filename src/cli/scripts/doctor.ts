import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { arch, platform } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_PORT } from '../../constants';
import { loadRawConfig } from '../../utils/loadConfig';
import { scanListeners } from '../../utils/portScan';
import { colors } from '../tuiPrimitives';
import { collectEnvVars } from './env';

type CheckStatus = 'fail' | 'ok' | 'warn';

type Check = { detail: string; label: string; status: CheckStatus };

const FRAMEWORK_FIELDS = [
	'reactDirectory',
	'vueDirectory',
	'svelteDirectory',
	'angularDirectory',
	'htmlDirectory',
	'htmxDirectory'
];

const projectRequire = createRequire(join(process.cwd(), 'package.json'));

// Typed factory: the `status` parameter constrains callers to a valid status,
// so every Check is correct without annotating each function's return type.
const check = (status: CheckStatus, label: string, detail: string) => ({
	detail,
	label,
	status
});

const readString = (source: object, key: string) => {
	const value: unknown = Reflect.get(source, key);

	return typeof value === 'string' ? value : undefined;
};

const resolveVersion = (specifier: string) => {
	try {
		const pkg: unknown = projectRequire(`${specifier}/package.json`);
		const version: unknown =
			pkg && typeof pkg === 'object' ? Reflect.get(pkg, 'version') : null;

		return typeof version === 'string' ? version : null;
	} catch {
		return null;
	}
};

const checkBun = () => check('ok', 'Bun runtime', `v${Bun.version}`);

const checkAbsolute = () => {
	const version = resolveVersion('@absolutejs/absolute');

	return version === null
		? check('fail', '@absolutejs/absolute', 'not resolvable here')
		: check('ok', '@absolutejs/absolute', `v${version}`);
};

const checkNative = () => {
	const target = `@absolutejs/native-${platform()}-${arch()}`;
	const version = resolveVersion(target);

	return version === null
		? check('warn', 'Native binary', `${target} not installed`)
		: check('ok', 'Native binary', `v${version}`);
};

const loadConfigOrNull = async () => {
	try {
		return await loadRawConfig();
	} catch {
		return null;
	}
};

const frameworkChecks = (config: object) =>
	FRAMEWORK_FIELDS.flatMap((field) => {
		const dir = readString(config, field);
		if (dir === undefined) return [];
		const label = `${field.replace('Directory', '')} pages`;

		return [
			existsSync(join(process.cwd(), dir))
				? check('ok', label, dir)
				: check('fail', label, `${dir} (missing)`)
		];
	});

const envCheck = async () => {
	const vars = await collectEnvVars();
	const missing = vars.filter((entry) => !entry.set);
	if (vars.length === 0) return check('ok', 'Env vars', 'no getEnv() usage');
	if (missing.length === 0) {
		return check('ok', 'Env vars', `all ${vars.length} set`);
	}

	return check(
		'fail',
		'Env vars',
		`missing ${missing.map((entry) => entry.key).join(', ')}`
	);
};

const devPort = (config: object) => {
	const dev: unknown = Reflect.get(config, 'dev');
	const port =
		dev && typeof dev === 'object' ? Reflect.get(dev, 'port') : undefined;

	return typeof port === 'number' ? port : DEFAULT_PORT;
};

const portCheck = async (config: object) => {
	const port = devPort(config);
	const holder = (await scanListeners()).find(
		(listener) => listener.port === port
	);

	return holder
		? check('warn', 'Dev port', `${port} in use by pid ${holder.pid}`)
		: check('ok', 'Dev port', `${port} free`);
};

const STATUS_MARK: Record<CheckStatus, string> = {
	fail: `${colors.red}✗${colors.reset}`,
	ok: `${colors.green}✓${colors.reset}`,
	warn: `${colors.yellow}⚠${colors.reset}`
};

const renderCheck = (entry: Check, labelWidth: number) =>
	`  ${STATUS_MARK[entry.status]} ${entry.label.padEnd(labelWidth)}  ${colors.dim}${entry.detail}${colors.reset}`;

const printReport = (checks: Check[]) => {
	const labelWidth = Math.max(...checks.map((entry) => entry.label.length));
	const failed = checks.filter((entry) => entry.status === 'fail').length;
	const warned = checks.filter((entry) => entry.status === 'warn').length;
	const summary =
		failed > 0
			? `${colors.red}${failed} failed${colors.reset}`
			: `${colors.green}all good${colors.reset}`;
	const lines = checks.map((entry) => renderCheck(entry, labelWidth));
	process.stdout.write(
		`${lines.join('\n')}\n\n${colors.dim}${checks.length} checks · ${colors.reset}${summary}${colors.dim} · ${warned} warning${warned === 1 ? '' : 's'}${colors.reset}\n`
	);
};

const gatherChecks = async () => {
	const config = await loadConfigOrNull();
	const configCheck =
		config === null
			? check('fail', 'Config', 'absolute.config.ts not found or invalid')
			: check('ok', 'Config', 'absolute.config.ts loaded');
	const [env, port] = await Promise.all([
		envCheck(),
		config === null
			? check('warn', 'Dev port', 'skipped (no config)')
			: portCheck(config)
	]);

	return [
		checkBun(),
		checkAbsolute(),
		checkNative(),
		configCheck,
		...(config === null ? [] : frameworkChecks(config)),
		env,
		port
	];
};

// Create the framework directory (+ pages/) when it's configured but missing.
const fixFrameworkDirs = (cwd: string, config: object) => {
	const fixes: string[] = [];
	for (const field of FRAMEWORK_FIELDS) {
		const dir = readString(config, field);
		if (dir === undefined || existsSync(join(cwd, dir))) continue;
		mkdirSync(join(cwd, dir, 'pages'), { recursive: true });
		fixes.push(`created ${dir}/pages`);
	}

	return fixes;
};

// Scaffold any unset getEnv() keys into .env.example (placeholders only — never
// invents secret values).
const fixEnvExample = async (cwd: string) => {
	const missing = (await collectEnvVars()).filter((entry) => !entry.set);
	if (missing.length === 0) return null;
	const envExample = join(cwd, '.env.example');
	const existing = existsSync(envExample)
		? readFileSync(envExample, 'utf-8')
		: '';
	const existingKeys = new Set(
		existing.split('\n').map((line) => line.split('=')[0]?.trim())
	);
	const toAdd = missing.filter((entry) => !existingKeys.has(entry.key));
	if (toAdd.length === 0) return null;
	const prefix =
		existing === '' || existing.endsWith('\n') ? existing : `${existing}\n`;
	writeFileSync(
		envExample,
		`${prefix}${toAdd.map((entry) => `${entry.key}=`).join('\n')}\n`
	);

	return `added ${toAdd.length} key(s) to .env.example`;
};

const applyFixes = async () => {
	const cwd = process.cwd();
	const config = await loadConfigOrNull();
	const fixes = config ? fixFrameworkDirs(cwd, config) : [];
	const envFix = await fixEnvExample(cwd);
	if (envFix) fixes.push(envFix);

	return fixes;
};

export const runDoctor = async (args: string[]) => {
	const fixes = args.includes('--fix') ? await applyFixes() : null;
	if (fixes && !args.includes('--json')) {
		const head = fixes.length
			? fixes
					.map(
						(fix) => `  ${colors.green}fixed${colors.reset} ${fix}`
					)
					.join('\n')
			: `  ${colors.dim}nothing to fix${colors.reset}`;
		process.stdout.write(`${head}\n\n`);
	}

	const checks = await gatherChecks();
	if (args.includes('--json')) {
		process.stdout.write(`${JSON.stringify({ checks, fixes }, null, 2)}\n`);
	} else {
		printReport(checks);
	}

	if (checks.some((entry) => entry.status === 'fail')) {
		process.exitCode = 1;
	}
};
