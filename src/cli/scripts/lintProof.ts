import {
	createHash,
	createPrivateKey,
	createPublicKey,
	sign,
	verify
} from 'node:crypto';
import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, relative, resolve } from 'node:path';
import { createEslintCacheFingerprint } from './eslint';

const DEFAULT_PROOF_LOCATION = '.absolutejs/lint-proof.json';
const PROOF_CONTRACT_VERSION = 1;
const FLAG_NOT_FOUND = -1;

type LintProofAttestation = {
	algorithm: 'ed25519';
	keyId: string;
	signature: string;
};

type LintProof = {
	attestation?: LintProofAttestation;
	command: string[];
	contractVersion: number;
	createdAt: string;
	lintFingerprint: string;
	sourceTree: string;
};

type ProofResult =
	| { valid: true; proof: LintProof }
	| { reason: string; valid: false };

type ValidationResult = { valid: true } | { reason: string; valid: false };

type RunGitOptions = {
	cwd: string;
	env?: Record<string, string>;
};

type CreateLintProofOptions = {
	cwd?: string;
	proofLocation?: string;
};

type WriteLintProofOptions = CreateLintProofOptions & {
	signingKeyLocation?: string;
};

type VerifyLintProofOptions = CreateLintProofOptions & {
	trustedKeyLocation?: string;
};

type ParsedArgs = {
	command: string[];
	proofLocation: string;
	signingKeyLocation?: string;
	trustedKeyLocation?: string;
};

const runGit = (args: string[], options: RunGitOptions) => {
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

const isInside = (parent: string, candidate: string) => {
	const path = relative(parent, candidate);

	return path === '' || (!path.startsWith('../') && path !== '..');
};

const attestationPayload = (proof: LintProof) =>
	Buffer.from(
		[
			'absolute-lint-proof-attestation:1',
			JSON.stringify({
				command: proof.command,
				contractVersion: proof.contractVersion,
				createdAt: proof.createdAt,
				lintFingerprint: proof.lintFingerprint,
				sourceTree: proof.sourceTree
			})
		].join('\0')
	);

const publicKeyId = (key: ReturnType<typeof createPublicKey>) =>
	createHash('sha256')
		.update(key.export({ format: 'der', type: 'spki' }))
		.digest('hex');

const readEd25519PrivateKey = (cwd: string, location: string) => {
	const path = resolve(cwd, location);
	if (isInside(realpathSync(gitRoot(cwd)), realpathSync(path))) {
		throw new Error(
			'lint proof signing key must live outside the Git working tree'
		);
	}
	const key = createPrivateKey(readFileSync(path));
	if (key.asymmetricKeyType !== 'ed25519') {
		throw new Error(
			'lint proof signing key must be an Ed25519 private key'
		);
	}

	return key;
};

const readEd25519PublicKey = (cwd: string, location: string) => {
	const key = createPublicKey(readFileSync(resolve(cwd, location)));
	if (key.asymmetricKeyType !== 'ed25519') {
		throw new Error('trusted lint proof key must be an Ed25519 public key');
	}

	return key;
};

const stageFiles = (
	files: string[],
	root: string,
	env: Record<string, string>
) => {
	const batchSize = 200;
	for (let index = 0; index < files.length; index += batchSize) {
		runGit(['add', '-f', '--', ...files.slice(index, index + batchSize)], {
			cwd: root,
			env
		});
	}
};

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
		stageFiles(files, root, env);

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
	options: CreateLintProofOptions = {}
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
	options: WriteLintProofOptions = {}
) => {
	const cwd = options.cwd ?? process.cwd();
	const proofLocation = options.proofLocation ?? DEFAULT_PROOF_LOCATION;
	const path = resolve(cwd, proofLocation);
	const temporary = `${path}.${process.pid}.tmp`;
	const proof = createLintProof(command, { cwd, proofLocation });
	if (options.signingKeyLocation) {
		const privateKey = readEd25519PrivateKey(
			cwd,
			options.signingKeyLocation
		);
		const publicKey = createPublicKey(privateKey);
		proof.attestation = {
			algorithm: 'ed25519',
			keyId: publicKeyId(publicKey),
			signature: sign(
				null,
				attestationPayload(proof),
				privateKey
			).toString('base64')
		};
	}
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(temporary, `${JSON.stringify(proof, null, 2)}\n`);
	renameSync(temporary, path);

	return proof;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === 'object';

const isLintProofAttestation = (
	value: unknown
): value is LintProofAttestation => {
	if (!isRecord(value)) return false;

	return (
		Reflect.get(value, 'algorithm') === 'ed25519' &&
		typeof Reflect.get(value, 'keyId') === 'string' &&
		typeof Reflect.get(value, 'signature') === 'string'
	);
};

const isLintProof = (value: unknown): value is LintProof => {
	if (value === null || typeof value !== 'object') return false;
	const command = Reflect.get(value, 'command');
	const attestation = Reflect.get(value, 'attestation');

	return (
		Reflect.get(value, 'contractVersion') === PROOF_CONTRACT_VERSION &&
		Array.isArray(command) &&
		command.every((part) => typeof part === 'string') &&
		typeof Reflect.get(value, 'createdAt') === 'string' &&
		typeof Reflect.get(value, 'lintFingerprint') === 'string' &&
		typeof Reflect.get(value, 'sourceTree') === 'string' &&
		(attestation === undefined || isLintProofAttestation(attestation))
	);
};

const verifyAttestation = (
	proof: LintProof,
	cwd: string,
	trustedKeyLocation: string
): ValidationResult => {
	if (!proof.attestation)
		return {
			reason: 'lint proof is not signed',
			valid: false
		};
	let trustedKey: ReturnType<typeof createPublicKey>;
	try {
		trustedKey = readEd25519PublicKey(cwd, trustedKeyLocation);
	} catch (error) {
		return {
			reason:
				error instanceof Error
					? error.message
					: 'trusted lint proof key is invalid',
			valid: false
		};
	}
	if (proof.attestation.keyId !== publicKeyId(trustedKey))
		return {
			reason: 'lint proof was signed by an untrusted key',
			valid: false
		};
	if (
		!verify(
			null,
			attestationPayload(proof),
			trustedKey,
			Buffer.from(proof.attestation.signature, 'base64')
		)
	)
		return {
			reason: 'lint proof signature is invalid',
			valid: false
		};

	return { valid: true };
};

export const verifyLintProof = (
	command: string[],
	options: VerifyLintProofOptions = {}
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
	if (options.trustedKeyLocation) {
		const result = verifyAttestation(
			proof,
			cwd,
			options.trustedKeyLocation
		);
		if (!result.valid) return result;
	}

	return { proof, valid: true };
};

const parseArgs = (args: string[]): ParsedArgs => {
	const separator = args.indexOf('--');
	const controlArgs =
		separator === FLAG_NOT_FOUND ? args : args.slice(0, separator);
	const command =
		separator === FLAG_NOT_FOUND ? [] : args.slice(separator + 1);
	const proofFlag = controlArgs.indexOf('--proof');
	const proofLocation =
		proofFlag === FLAG_NOT_FOUND
			? DEFAULT_PROOF_LOCATION
			: controlArgs[proofFlag + 1];
	const signingKeyFlag = controlArgs.indexOf('--signing-key');
	const signingKeyLocation =
		signingKeyFlag === FLAG_NOT_FOUND
			? undefined
			: controlArgs[signingKeyFlag + 1];
	const trustedKeyFlag = controlArgs.indexOf('--trusted-key');
	const trustedKeyLocation =
		trustedKeyFlag === FLAG_NOT_FOUND
			? undefined
			: controlArgs[trustedKeyFlag + 1];

	if (!proofLocation) throw new Error('--proof requires a path');
	if (signingKeyFlag !== FLAG_NOT_FOUND && !signingKeyLocation)
		throw new Error('--signing-key requires a path');
	if (trustedKeyFlag !== FLAG_NOT_FOUND && !trustedKeyLocation)
		throw new Error('--trusted-key requires a path');

	return {
		command,
		proofLocation,
		signingKeyLocation,
		trustedKeyLocation
	};
};

const runVerification = (parsed: ParsedArgs) => {
	const result = verifyLintProof(parsed.command, {
		proofLocation: parsed.proofLocation,
		trustedKeyLocation: parsed.trustedKeyLocation
	});
	if (!result.valid) {
		console.error(`\x1b[31m✗\x1b[0m ${result.reason}`);

		return 1;
	}
	console.log(
		`\x1b[32m✓\x1b[0m Lint proof matches the source tree, command, and lint toolchain${
			parsed.trustedKeyLocation ? ', with a trusted signature' : ''
		}`
	);

	return 0;
};

export const runLintProof = async (args: string[]) => {
	const [operation] = args;
	if (operation !== 'run' && operation !== 'verify') {
		console.error(
			'Usage: absolute lint-proof <run|verify> [--proof path] [--signing-key path | --trusted-key path] -- <lint command>'
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
	if (operation === 'run' && parsed.trustedKeyLocation) {
		console.error('--trusted-key is only valid with lint-proof verify');

		return 2;
	}
	if (operation === 'verify' && parsed.signingKeyLocation) {
		console.error('--signing-key is only valid with lint-proof run');

		return 2;
	}

	if (operation === 'verify') return runVerification(parsed);

	const proc = Bun.spawn(parsed.command, {
		stderr: 'inherit',
		stdout: 'inherit'
	});
	const exitCode = await proc.exited;
	if (exitCode !== 0) {
		console.error('\x1b[31m✗\x1b[0m Lint failed; proof was not updated');

		return exitCode;
	}
	writeLintProof(parsed.command, {
		proofLocation: parsed.proofLocation,
		signingKeyLocation: parsed.signingKeyLocation
	});
	console.log(
		`\x1b[32m✓\x1b[0m Wrote exact-source lint proof${
			parsed.signingKeyLocation ? ' with an Ed25519 attestation' : ''
		}: ${parsed.proofLocation}`
	);

	return 0;
};
