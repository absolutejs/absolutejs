import { createPublicKey, sign, verify } from 'node:crypto';
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync
} from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import {
	createSourceTree,
	proofPathInTree,
	publicKeyId,
	readEd25519PrivateKey,
	readEd25519PublicKey,
	visibleFiles
} from './proofCore';

/**
 * `absolute proof`: a signed statement that one command passed on one exact
 * source tree, under one exact Bun, so CI can verify it in seconds instead of
 * running the command again (a test suite, most often).
 *
 *   absolute proof run --proof .absolutejs/test-proof.json \
 *     --signing-key ~/.config/absolutejs/app.pem -- bash scripts/test.sh
 *   absolute proof verify --proof .absolutejs/test-proof.json \
 *     --trusted-key .absolutejs/lint-proof-ed25519.pub -- bash scripts/test.sh
 *
 * Bound to:
 * - the WHOLE tree, every file Git would track except the proof itself
 *   (anything can change a test result, unlike a lint run, which
 *   `lint-proof` scopes to its targets);
 * - the exact command;
 * - the exact Bun (`Bun.version`, build label included: a patched build is
 *   a different runtime), so the verifying side must run the same one.
 *
 * `--exclude <path>` (repeatable, on both run and verify) leaves named files
 * out of the tree: another proof, most often, so that re-signing the lint
 * proof does not invalidate the test proof. The excluded paths are signed,
 * and verify must name exactly the same ones, so a proof can never be
 * stretched afterwards to ignore anything else. Only files can be excluded,
 * never a directory.
 *
 * `run` computes the tree before and after the command and refuses to sign
 * if they differ: a command that edits files (a formatter, a codegen step)
 * would otherwise sign a tree it never checked.
 *
 * The payload is domain-separated from `lint-proof`'s, so a lint signature
 * can never pass for a command proof or the reverse.
 */

const DEFAULT_PROOF_LOCATION = '.absolutejs/proof.json';
const CONTRACT_VERSION = 1;
const PAYLOAD_DOMAIN = 'absolute-command-proof-attestation:1';
const LABEL = 'command proof';
const FLAG_NOT_FOUND = -1;
const EXIT_USAGE = 2;
const JSON_INDENT = 2;

type Attestation = { algorithm: 'ed25519'; keyId: string; signature: string };

export type CommandProof = {
	attestation?: Attestation;
	bun: string;
	command: string[];
	contractVersion: number;
	createdAt: string;
	/** Files left out of `sourceTree`, repo-relative and sorted. Absent when none. */
	excluded?: string[];
	sourceTree: string;
};

type Result =
	{ proof: CommandProof; valid: true } | { reason: string; valid: false };

type Options = { cwd?: string; excluded?: string[]; proofLocation?: string };

type ParsedArgs = {
	command: string[];
	excluded: string[];
	proofLocation: string;
	signingKeyLocation?: string;
	trustedKeyLocation?: string;
};

/* Exclusions join the signed payload only when there are any, so proofs
 * signed before they existed still verify. */
const payload = (proof: CommandProof) =>
	Buffer.from(
		[
			PAYLOAD_DOMAIN,
			JSON.stringify({
				bun: proof.bun,
				command: proof.command,
				contractVersion: proof.contractVersion,
				createdAt: proof.createdAt,
				...(proof.excluded?.length ? { excluded: proof.excluded } : {}),
				sourceTree: proof.sourceTree
			})
		].join('\0')
	);

/** Repo-relative, forward-slashed, sorted and unique: one spelling per set. */
const normalizeExcluded = (root: string, cwd: string, paths: string[]) =>
	[
		...new Set(
			paths.map((path) => {
				const relativePath = relative(
					root,
					resolve(cwd, path)
				).replaceAll('\\', '/');
				if (
					!relativePath ||
					relativePath === '..' ||
					relativePath.startsWith('../')
				)
					throw new Error(
						`--exclude ${path} is not a file inside the repository`
					);
				const absolute = resolve(root, relativePath);
				if (existsSync(absolute) && !lstatSync(absolute).isFile())
					throw new Error(
						`--exclude ${path} must name a file, not a directory`
					);

				return relativePath;
			})
		)
	].sort();

/** The tree a proof at `proofLocation` attests: every visible file but it
 *  and the `excluded` files. */
export const createCommandSourceTree = (
	cwd = process.cwd(),
	proofLocation = DEFAULT_PROOF_LOCATION,
	excluded: string[] = []
) => {
	const { proofRelative, root } = proofPathInTree(cwd, proofLocation, LABEL);

	return createSourceTree(root, visibleFiles(root), [
		proofRelative,
		...normalizeExcluded(root, cwd, excluded)
	]);
};

const excludedOf = (cwd: string, proofLocation: string, excluded: string[]) =>
	normalizeExcluded(
		proofPathInTree(cwd, proofLocation, LABEL).root,
		cwd,
		excluded
	);

const isRecord = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === 'object';

const isAttestation = (value: unknown): value is Attestation =>
	isRecord(value) &&
	value.algorithm === 'ed25519' &&
	typeof value.keyId === 'string' &&
	typeof value.signature === 'string';

const isCommandProof = (value: unknown): value is CommandProof =>
	isRecord(value) &&
	value.contractVersion === CONTRACT_VERSION &&
	Array.isArray(value.command) &&
	value.command.every((part) => typeof part === 'string') &&
	typeof value.bun === 'string' &&
	typeof value.createdAt === 'string' &&
	typeof value.sourceTree === 'string' &&
	(value.excluded === undefined ||
		(Array.isArray(value.excluded) &&
			value.excluded.every((path) => typeof path === 'string'))) &&
	(value.attestation === undefined || isAttestation(value.attestation));

/** Sign and write a proof for a command that already passed on `sourceTree`. */
export const writeCommandProof = (
	command: string[],
	sourceTree: string,
	signingKeyLocation: string,
	options: Options = {}
) => {
	const cwd = options.cwd ?? process.cwd();
	const proofLocation = options.proofLocation ?? DEFAULT_PROOF_LOCATION;
	const excluded = excludedOf(cwd, proofLocation, options.excluded ?? []);
	const proof: CommandProof = {
		bun: Bun.version,
		command,
		contractVersion: CONTRACT_VERSION,
		createdAt: new Date().toISOString(),
		...(excluded.length > 0 ? { excluded } : {}),
		sourceTree
	};
	const privateKey = readEd25519PrivateKey(cwd, signingKeyLocation, LABEL);
	proof.attestation = {
		algorithm: 'ed25519',
		keyId: publicKeyId(createPublicKey(privateKey)),
		signature: sign(null, payload(proof), privateKey).toString('base64')
	};
	const path = resolve(cwd, proofLocation);
	const temporary = `${path}.${process.pid}.tmp`;
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(temporary, `${JSON.stringify(proof, null, JSON_INDENT)}\n`);
	renameSync(temporary, path);

	return proof;
};

const readProof = (path: string, proofLocation: string): Result => {
	if (!existsSync(path))
		return { reason: `missing ${LABEL}: ${proofLocation}`, valid: false };
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(path, 'utf-8'));
	} catch {
		return { reason: `invalid ${LABEL}: ${proofLocation}`, valid: false };
	}
	if (!isCommandProof(parsed))
		return { reason: `unsupported ${LABEL} contract`, valid: false };

	return { proof: parsed, valid: true };
};

const checkSignature = (
	proof: CommandProof,
	cwd: string,
	trustedKeyLocation: string
): Result => {
	if (!proof.attestation)
		return { reason: `${LABEL} is not signed`, valid: false };
	let trustedKey: ReturnType<typeof createPublicKey>;
	try {
		trustedKey = readEd25519PublicKey(cwd, trustedKeyLocation, LABEL);
	} catch (error) {
		return {
			reason: error instanceof Error ? error.message : String(error),
			valid: false
		};
	}
	if (proof.attestation.keyId !== publicKeyId(trustedKey))
		return {
			reason: `${LABEL} was signed by an untrusted key`,
			valid: false
		};
	if (
		!verify(
			null,
			payload(proof),
			trustedKey,
			Buffer.from(proof.attestation.signature, 'base64')
		)
	)
		return { reason: `${LABEL} signature is invalid`, valid: false };

	return { proof, valid: true };
};

/* A failed check, typed as the result so callers can narrow on `valid`. */
const invalid = (reason: string): Result => ({ reason, valid: false });

/** Whether the committed proof covers this exact command, tree and Bun,
 *  signed by the trusted key. Fails closed with the first reason found. */
export const verifyCommandProof = (
	command: string[],
	trustedKeyLocation: string,
	options: Options = {}
) => {
	const cwd = options.cwd ?? process.cwd();
	const proofLocation = options.proofLocation ?? DEFAULT_PROOF_LOCATION;
	const read = readProof(resolve(cwd, proofLocation), proofLocation);
	if (!read.valid) return read;
	const { proof } = read;
	if (JSON.stringify(proof.command) !== JSON.stringify(command))
		return invalid('command differs from the recorded command');
	if (proof.bun !== Bun.version)
		return invalid(
			`recorded on Bun ${proof.bun}, verifying on Bun ${Bun.version}`
		);
	const excluded = excludedOf(cwd, proofLocation, options.excluded ?? []);
	if (JSON.stringify(proof.excluded ?? []) !== JSON.stringify(excluded))
		return invalid('excluded files differ from the recorded exclusions');
	if (
		proof.sourceTree !==
		createCommandSourceTree(cwd, proofLocation, excluded)
	)
		return invalid('source tree changed since the command passed');

	return checkSignature(proof, cwd, trustedKeyLocation);
};

const flagValue = (args: string[], flag: string) => {
	const index = args.indexOf(flag);
	if (index === FLAG_NOT_FOUND) return undefined;
	const value = args[index + 1];
	if (!value || value.startsWith('--'))
		throw new Error(`${flag} requires a path`);

	return value;
};

const parseArgs = (args: string[]): ParsedArgs => {
	const separator = args.indexOf('--');
	const control =
		separator === FLAG_NOT_FOUND ? args : args.slice(0, separator);

	return {
		command: separator === FLAG_NOT_FOUND ? [] : args.slice(separator + 1),
		excluded: control.flatMap((arg, index) =>
			arg === '--exclude'
				? [flagValue(control.slice(index), '--exclude') ?? '']
				: []
		),
		proofLocation: flagValue(control, '--proof') ?? DEFAULT_PROOF_LOCATION,
		signingKeyLocation: flagValue(control, '--signing-key'),
		trustedKeyLocation: flagValue(control, '--trusted-key')
	};
};

const USAGE =
	'Usage: absolute proof <run|verify> [--proof path] [--exclude path]... (--signing-key path | --trusted-key path) -- <command>';

const runAndSign = async (
	parsed: ParsedArgs,
	signingKeyLocation: string,
	cwd: string
) => {
	const options: Options = {
		cwd,
		excluded: parsed.excluded,
		proofLocation: parsed.proofLocation
	};
	const before = createCommandSourceTree(
		cwd,
		parsed.proofLocation,
		parsed.excluded
	);
	const exitCode = await Bun.spawn(parsed.command, {
		cwd,
		stderr: 'inherit',
		stdin: 'inherit',
		stdout: 'inherit'
	}).exited;
	if (exitCode !== 0) {
		console.error(
			'\x1b[31m✗\x1b[0m The command failed; no proof was written'
		);

		return exitCode;
	}
	const after = createCommandSourceTree(
		cwd,
		parsed.proofLocation,
		parsed.excluded
	);
	if (after !== before) {
		console.error(
			'\x1b[31m✗\x1b[0m The command changed files; commit or discard the changes and run it again'
		);

		return 1;
	}
	writeCommandProof(parsed.command, before, signingKeyLocation, options);
	console.log(
		`\x1b[32m✓\x1b[0m Wrote a signed proof (Bun ${Bun.version}): ${parsed.proofLocation}`
	);

	return 0;
};

/* Why these arguments can't run, or null when they can. */
const usageProblem = (operation: string | undefined, parsed: ParsedArgs) => {
	if (
		(operation !== 'run' && operation !== 'verify') ||
		parsed.command.length === 0
	)
		return USAGE;
	if (
		operation === 'run' &&
		(!parsed.signingKeyLocation || parsed.trustedKeyLocation)
	)
		return 'proof run takes --signing-key (and no --trusted-key)';
	if (
		operation === 'verify' &&
		(!parsed.trustedKeyLocation || parsed.signingKeyLocation)
	)
		return 'proof verify takes --trusted-key (and no --signing-key)';

	return null;
};

const reportVerification = (
	parsed: ParsedArgs,
	trustedKeyLocation: string,
	cwd: string
) => {
	const result = verifyCommandProof(parsed.command, trustedKeyLocation, {
		cwd,
		excluded: parsed.excluded,
		proofLocation: parsed.proofLocation
	});
	if (!result.valid) {
		console.error(`\x1b[31m✗\x1b[0m ${result.reason}`);

		return 1;
	}
	console.log(
		`\x1b[32m✓\x1b[0m Signed proof matches this tree, command and Bun ${result.proof.bun}`
	);

	return 0;
};

export const runCommandProof = async (args: string[], cwd = process.cwd()) => {
	const [operation] = args;
	let parsed: ParsedArgs;
	try {
		parsed = parseArgs(args.slice(1));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));

		return EXIT_USAGE;
	}
	const problem = usageProblem(operation, parsed);
	if (problem !== null) {
		console.error(problem);

		return EXIT_USAGE;
	}
	if (operation === 'run' && parsed.signingKeyLocation)
		return runAndSign(parsed, parsed.signingKeyLocation, cwd);
	if (parsed.trustedKeyLocation)
		return reportVerification(parsed, parsed.trustedKeyLocation, cwd);

	return EXIT_USAGE;
};
