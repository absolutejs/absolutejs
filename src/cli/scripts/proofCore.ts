import { createHash, createPrivateKey, createPublicKey } from 'node:crypto';
import {
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, relative, resolve } from 'node:path';

/* What every signed proof shares: Git plumbing, the Ed25519 keys, and the
 * Git tree a proof is bound to. `absolute lint-proof` (one ESLint run) and
 * `absolute proof` (any command) are built on it; each signs its own
 * domain-separated payload, so neither signature can stand in for the other. */

type RunGitOptions = {
	cwd: string;
	env?: Record<string, string>;
};

const STAGE_BATCH_SIZE = 200;

export const gitRoot = (cwd: string) =>
	resolve(runGit(['rev-parse', '--show-toplevel'], { cwd }));
export const isInside = (parent: string, candidate: string) => {
	const path = relative(parent, candidate);

	return path === '' || (!path.startsWith('../') && path !== '..');
};
export const proofPathInTree = (
	cwd: string,
	proofLocation: string,
	label: string
) => {
	const root = gitRoot(cwd);
	const proofRelative = relative(
		root,
		resolve(cwd, proofLocation)
	).replaceAll('\\', '/');
	if (
		proofRelative === '..' ||
		proofRelative.startsWith('../') ||
		proofRelative === ''
	) {
		throw new Error(`${label} must live inside the Git working tree`);
	}

	return { proofRelative, root };
};
export const publicKeyId = (key: ReturnType<typeof createPublicKey>) =>
	createHash('sha256')
		.update(key.export({ format: 'der', type: 'spki' }))
		.digest('hex');
export const readEd25519PrivateKey = (
	cwd: string,
	location: string,
	label: string
) => {
	const path = resolve(cwd, location);
	if (isInside(realpathSync(gitRoot(cwd)), realpathSync(path))) {
		throw new Error(
			`${label} signing key must live outside the Git working tree`
		);
	}
	const key = createPrivateKey(readFileSync(path));
	if (key.asymmetricKeyType !== 'ed25519') {
		throw new Error(`${label} signing key must be an Ed25519 private key`);
	}

	return key;
};
export const readEd25519PublicKey = (
	cwd: string,
	location: string,
	label: string
) => {
	const key = createPublicKey(readFileSync(resolve(cwd, location)));
	if (key.asymmetricKeyType !== 'ed25519') {
		throw new Error(`trusted ${label} key must be an Ed25519 public key`);
	}

	return key;
};
export const runGit = (args: string[], options: RunGitOptions) => {
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
export const visibleFiles = (root: string) =>
	runGit(['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
		cwd: root
	}).split('\0');

/* `git add` in batches, so a large tree never exceeds the argument limit. */
const stagePaths = (
	root: string,
	env: Record<string, string>,
	paths: string[]
) => {
	for (let index = 0; index < paths.length; index += STAGE_BATCH_SIZE)
		runGit(
			[
				'add',
				'-f',
				'--',
				...paths.slice(index, index + STAGE_BATCH_SIZE)
			],
			{ cwd: root, env }
		);
};

/**
 * A Git tree of `files` as they are on disk, built in a temporary index and
 * object store so the real index is never touched. Missing paths (deleted
 * but not yet staged) and `excluded` (the proof itself) are left out. Git
 * applies its normal clean filters, so the digest is the same on every
 * checkout platform.
 */
export const createSourceTree = (
	root: string,
	files: string[],
	excluded: string
) => {
	const temporaryDirectory = mkdtempSync(
		resolve(tmpdir(), 'absolute-proof-')
	);
	const temporaryIndex = resolve(temporaryDirectory, 'index');
	const temporaryObjects = resolve(temporaryDirectory, 'objects');
	mkdirSync(temporaryObjects, { recursive: true });
	const repositoryObjects = resolve(
		root,
		runGit(['rev-parse', '--git-path', 'objects'], { cwd: root })
	);
	const existingAlternates =
		process.env.GIT_ALTERNATE_OBJECT_DIRECTORIES?.trim();
	const env: Record<string, string> = {
		GIT_ALTERNATE_OBJECT_DIRECTORIES: [
			repositoryObjects,
			...(existingAlternates ? [existingAlternates] : [])
		].join(delimiter),
		GIT_INDEX_FILE: temporaryIndex,
		GIT_OBJECT_DIRECTORY: temporaryObjects
	};

	try {
		runGit(['read-tree', '--empty'], { cwd: root, env });
		const present = files.filter((path) => {
			if (!path || path === excluded) return false;
			try {
				lstatSync(resolve(root, path));

				return true;
			} catch {
				return false;
			}
		});
		stagePaths(root, env, present);

		return runGit(['write-tree'], { cwd: root, env });
	} finally {
		rmSync(temporaryDirectory, { force: true, recursive: true });
	}
};
