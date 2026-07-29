import { createHash } from 'node:crypto';
import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, relative, resolve } from 'node:path';
import { createEslintCacheFingerprint } from './eslint';

const DEFAULT_PROOF_LOCATION = '.absolutejs/lint-proof.json';
const PROOF_CONTRACT_VERSION = 1;

type LintProof = {
	command: string[];
	contractVersion: number;
	createdAt: string;
	lintFingerprint: string;
	sourceTree: string;
};

type ProofResult =
	| { valid: true; proof: LintProof }
	| { reason: string; valid: false };

const runGit = (
	args: string[],
	options: { cwd: string; env?: Record<string, string> }
) => {
	const proc = Bun.spawnSync(['git', ...args], {
		cwd: options.cwd,
		env: { ...process.env, ...options.env },
		stderr: 'pipe',
		stdout: 'pipe'
	});
	if (proc.exitCode !== 0) {
		const detail = proc.stderr.toString().trim();
		throw new Error(detail || `git ${args.join(' ')} failed`);
	}

	return proc.stdout.toString().trim();
};

const gitRoot = (cwd: string) =>
	resolve(runGit(['rev-parse', '--show-toplevel'], { cwd }));

/**
 * Build a Git tree from the complete working copy without modifying the real
 * index. Ignored files and the proof itself are excluded. Git performs its
 * normal clean filters, so the digest is stable across checkout platforms.
 */
export const createLintSourceTree = (
	cwd = process.cwd(),
	proofLocation = DEFAULT_PROOF_LOCATION
) => {
	const root = gitRoot(cwd);
	const proofPath = resolve(cwd, proofLocation);
	const proofRelative = relative(root, proofPath).replaceAll('\\', '/');
	if (
		proofRelative === '..' ||
		proofRelative.startsWith('../') ||
		proofRelative === ''
	) {
		throw new Error('lint proof must live inside the Git working tree');
	}

	const temporaryDirectory = mkdtempSync(
		resolve(tmpdir(), 'absolute-lint-proof-')
	);
	const temporaryIndex = resolve(temporaryDirectory, 'index');
	const temporaryObjects = resolve(temporaryDirectory, 'objects');
	mkdirSync(temporaryObjects, { recursive: true });
	const repositoryObjectsPath = runGit(
		['rev-parse', '--git-path', 'objects'],
		{ cwd: root }
	);
	const repositoryObjects = resolve(root, repositoryObjectsPath);
	const existingAlternates =
		process.env.GIT_ALTERNATE_OBJECT_DIRECTORIES?.trim();
	const env = {
		GIT_ALTERNATE_OBJECT_DIRECTORIES: [
			repositoryObjects,
			...(existingAlternates ? [existingAlternates] : [])
		].join(delimiter),
		GIT_INDEX_FILE: temporaryIndex,
		GIT_OBJECT_DIRECTORY: temporaryObjects
	};

	try {
		runGit(['read-tree', '--empty'], { cwd: root, env });
		const files = runGit(
			['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
			{ cwd: root }
		)
			.split('\0')
			.filter((path) => {
				if (!path || path === proofRelative) return false;
				try {
					lstatSync(resolve(root, path));

					return true;
				} catch {
					return false;
				}
			});
		for (let index = 0; index < files.length; index += 200) {
			runGit(['add', '-f', '--', ...files.slice(index, index + 200)], {
				cwd: root,
				env
			});
		}

		return runGit(['write-tree'], { cwd: root, env });
	} finally {
		rmSync(temporaryDirectory, { force: true, recursive: true });
	}
};

const proofFingerprint = (cwd: string) =>
	createHash('sha256')
		.update(`absolute-lint-proof:${PROOF_CONTRACT_VERSION}\0`)
		.update(createEslintCacheFingerprint(cwd))
		.digest('hex');

export const createLintProof = (
	command: string[],
	options: { cwd?: string; proofLocation?: string } = {}
): LintProof => {
	const cwd = options.cwd ?? process.cwd();
	const proofLocation = options.proofLocation ?? DEFAULT_PROOF_LOCATION;

	return {
		command,
		contractVersion: PROOF_CONTRACT_VERSION,
		createdAt: new Date().toISOString(),
		lintFingerprint: proofFingerprint(cwd),
		sourceTree: createLintSourceTree(cwd, proofLocation)
	};
};

export const writeLintProof = (
	command: string[],
	options: { cwd?: string; proofLocation?: string } = {}
) => {
	const cwd = options.cwd ?? process.cwd();
	const proofLocation = options.proofLocation ?? DEFAULT_PROOF_LOCATION;
	const path = resolve(cwd, proofLocation);
	const temporary = `${path}.${process.pid}.tmp`;
	const proof = createLintProof(command, { cwd, proofLocation });
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(temporary, `${JSON.stringify(proof, null, 2)}\n`);
	renameSync(temporary, path);

	return proof;
};

const isLintProof = (value: unknown): value is LintProof => {
	if (value === null || typeof value !== 'object') return false;
	const proof = value as Partial<LintProof>;

	return (
		proof.contractVersion === PROOF_CONTRACT_VERSION &&
		Array.isArray(proof.command) &&
		proof.command.every((part) => typeof part === 'string') &&
		typeof proof.createdAt === 'string' &&
		typeof proof.lintFingerprint === 'string' &&
		typeof proof.sourceTree === 'string'
	);
};

export const verifyLintProof = (
	command: string[],
	options: { cwd?: string; proofLocation?: string } = {}
): ProofResult => {
	const cwd = options.cwd ?? process.cwd();
	const proofLocation = options.proofLocation ?? DEFAULT_PROOF_LOCATION;
	const path = resolve(cwd, proofLocation);
	if (!existsSync(path))
		return { reason: `missing lint proof: ${proofLocation}`, valid: false };

	let proof: unknown;
	try {
		proof = JSON.parse(readFileSync(path, 'utf-8'));
	} catch {
		return { reason: `invalid lint proof: ${proofLocation}`, valid: false };
	}
	if (!isLintProof(proof))
		return { reason: 'unsupported lint proof contract', valid: false };
	if (JSON.stringify(proof.command) !== JSON.stringify(command))
		return {
			reason: 'lint command differs from the recorded command',
			valid: false
		};
	if (proof.lintFingerprint !== proofFingerprint(cwd))
		return {
			reason: 'ESLint configuration or toolchain changed',
			valid: false
		};
	if (proof.sourceTree !== createLintSourceTree(cwd, proofLocation))
		return {
			reason: 'source tree changed since lint passed',
			valid: false
		};

	return { proof, valid: true };
};

const parseArgs = (args: string[]) => {
	const separator = args.indexOf('--');
	const controlArgs = separator === -1 ? args : args.slice(0, separator);
	const command = separator === -1 ? [] : args.slice(separator + 1);
	const proofFlag = controlArgs.indexOf('--proof');
	const proofLocation =
		proofFlag === -1 ? DEFAULT_PROOF_LOCATION : controlArgs[proofFlag + 1];

	if (!proofLocation) throw new Error('--proof requires a path');

	return { command, proofLocation };
};

export const runLintProof = async (args: string[]) => {
	const [operation] = args;
	if (operation !== 'run' && operation !== 'verify') {
		console.error(
			'Usage: absolute lint-proof <run|verify> [--proof path] -- <lint command>'
		);

		return 2;
	}

	let parsed: ReturnType<typeof parseArgs>;
	try {
		parsed = parseArgs(args.slice(1));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));

		return 2;
	}
	if (parsed.command.length === 0) {
		console.error('A lint command is required after --');

		return 2;
	}

	if (operation === 'verify') {
		const result = verifyLintProof(parsed.command, {
			proofLocation: parsed.proofLocation
		});
		if (!result.valid) {
			console.error(`\x1b[31m✗\x1b[0m ${result.reason}`);

			return 1;
		}
		console.log(
			`\x1b[32m✓\x1b[0m Lint proof matches the source tree, command, and lint toolchain`
		);

		return 0;
	}

	const proc = Bun.spawn(parsed.command, {
		stderr: 'inherit',
		stdout: 'inherit'
	});
	const exitCode = await proc.exited;
	if (exitCode !== 0) {
		console.error('\x1b[31m✗\x1b[0m Lint failed; proof was not updated');

		return exitCode;
	}
	writeLintProof(parsed.command, { proofLocation: parsed.proofLocation });
	console.log(
		`\x1b[32m✓\x1b[0m Wrote exact-source lint proof: ${parsed.proofLocation}`
	);

	return 0;
};
