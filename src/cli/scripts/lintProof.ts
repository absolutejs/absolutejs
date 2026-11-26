import { createHash, createPublicKey, sign, verify } from 'node:crypto';
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync
} from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import {
	createEslintCacheFingerprint,
	createEslintConfigDigest,
	findEslintConfigPath
} from './eslint';
import { gitVisibleFiles, resolveLintTargets } from './eslintChunked';
import {
	createSourceTree,
	proofPathInTree,
	publicKeyId,
	readEd25519PrivateKey,
	readEd25519PublicKey,
	visibleFiles
} from './proofCore';

const DEFAULT_PROOF_LOCATION = '.absolutejs/lint-proof.json';
const PROOF_CONTRACT_VERSION = 2;
const FLAG_NOT_FOUND = -1;
const CHUNKED_FLAG = '--chunked';
/** `tsconfig.json`, `tsconfig.build.json`, … — type-aware rules read these, so
 *  they belong in the attested set even though ESLint never lints them. */
const TSCONFIG_PATTERN = /(?:^|\/)tsconfig[^/]*\.json$/;
const ABSOLUTE_BINARY = /(?:^|[\\/])absolute(?:\.[cm]?[jt]s|\.exe)?$/;

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
	{ valid: true; proof: LintProof } | { reason: string; valid: false };

type ValidationResult = { valid: true } | { reason: string; valid: false };

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

/**
 * The `absolute eslint --chunked` args inside a recorded lint command, or null
 * when the command is anything else. Requires the token before `eslint` to be
 * an `absolute` binary so an unrelated command that merely mentions ESLint
 * can't narrow what the proof attests to.
 */
const eslintChunkedArgs = (command: string[]) => {
	const index = command.indexOf('eslint');
	if (index <= 0) return null;
	const binary = command[index - 1];
	if (binary === undefined || !ABSOLUTE_BINARY.test(binary)) return null;
	const args = command.slice(index + 1);

	return args.includes(CHUNKED_FLAG) ? args : null;
};

/**
 * The files a recorded lint command actually inspects: its resolved lint set
 * plus the inputs that silently change results (the flat config and any
 * tsconfig feeding type-aware rules). Returns null when the command's file set
 * can't be derived, so the proof falls back to attesting the whole tree.
 *
 * Scoping matters because the proof is the prod gate: hashing the entire
 * working copy meant editing a README, a migration snapshot, or an image
 * invalidated a perfectly good lint and forced a full re-run before shipping.
 */
const lintScopedFiles = (command: string[], root: string) => {
	const args = eslintChunkedArgs(command);
	if (args === null) return null;
	const auxiliary = gitVisibleFiles(root).filter((file) =>
		TSCONFIG_PATTERN.test(file)
	);
	const configPath = findEslintConfigPath(root);
	const configRelative =
		configPath === null
			? null
			: relative(root, configPath).replaceAll('\\', '/');

	return [
		...new Set([
			...resolveLintTargets(args, root),
			...auxiliary,
			...(configRelative === null || configRelative.startsWith('../')
				? []
				: [configRelative])
		])
	].sort();
};

/**
 * Build a Git tree from the files the lint command covers, without modifying
 * the real index. Ignored files and the proof itself are excluded. Git
 * performs its normal clean filters, so the digest is stable across checkout
 * platforms.
 */
export const createLintSourceTree = (
	cwd = process.cwd(),
	proofLocation = DEFAULT_PROOF_LOCATION,
	command: string[] = []
) => {
	const { proofRelative, root } = proofPathInTree(
		cwd,
		proofLocation,
		'lint proof'
	);

	return createSourceTree(
		root,
		lintScopedFiles(command, root) ?? visibleFiles(root),
		proofRelative
	);
};

/**
 * The proof must fail closed on any config edit, so it pairs the cache
 * fingerprint (installed lint toolchain) with the config file's own digest —
 * the cache fingerprint deliberately omits config text so one override edit
 * can't cost a whole-repo re-lint.
 */
const proofFingerprint = (cwd: string) =>
	createHash('sha256')
		.update(`absolute-lint-proof:${PROOF_CONTRACT_VERSION}\0`)
		.update(createEslintCacheFingerprint(cwd))
		.update('\0')
		.update(createEslintConfigDigest(cwd))
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
		sourceTree: createLintSourceTree(cwd, proofLocation, command)
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
			options.signingKeyLocation,
			'lint proof'
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
		trustedKey = readEd25519PublicKey(
			cwd,
			trustedKeyLocation,
			'lint proof'
		);
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
	if (proof.sourceTree !== createLintSourceTree(cwd, proofLocation, command))
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
