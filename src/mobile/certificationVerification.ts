import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

export const ABSOLUTE_MOBILE_CERTIFICATION_VERIFICATION_FORMAT = 1 as const;
const MAX_VERIFICATION_BYTES = 1_048_576;
const SHA_PATTERN = /^[a-f0-9]{40}$/u;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const REF_PATTERN = /^refs\/(?:heads|tags)\/[^@\s]+$/u;
const WORKFLOW_PATTERN = /^\.github\/workflows\/[^/@]+\.ya?ml$/u;

export type AbsoluteMobileCertificationVerification = {
	bundle: Record<string, unknown>;
	format: typeof ABSOLUTE_MOBILE_CERTIFICATION_VERIFICATION_FORMAT;
	identity: {
		issuer: string;
		ref: string;
		repository: string;
		sha: string;
		workflowPath: string;
	};
	kind: 'sigstore-bundle';
};

export type AbsoluteGithubWorkflowEnvironment = {
	GITHUB_REF?: string;
	GITHUB_REPOSITORY?: string;
	GITHUB_SHA?: string;
	GITHUB_WORKFLOW_REF?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const required = (value: unknown, name: string) => {
	if (typeof value !== 'string' || value.trim() === '')
		throw new TypeError(`${name} is required.`);

	return value.trim();
};

const requireMatch = (value: string, pattern: RegExp, name: string) => {
	if (!pattern.test(value)) throw new TypeError(`${name} is invalid.`);

	return value;
};

export const createAbsoluteMobileCertificationVerification = (
	bundle: unknown,
	environment: AbsoluteGithubWorkflowEnvironment
) => {
	const repository = required(
		environment.GITHUB_REPOSITORY,
		'GITHUB_REPOSITORY'
	);
	const workflowReference = required(
		environment.GITHUB_WORKFLOW_REF,
		'GITHUB_WORKFLOW_REF'
	);
	const prefix = `${repository}/`;
	const separator = workflowReference.lastIndexOf('@');
	if (!workflowReference.startsWith(prefix) || separator <= prefix.length)
		throw new TypeError('GITHUB_WORKFLOW_REF is invalid.');

	return parseAbsoluteMobileCertificationVerification({
		bundle,
		format: ABSOLUTE_MOBILE_CERTIFICATION_VERIFICATION_FORMAT,
		identity: {
			issuer: 'https://token.actions.githubusercontent.com',
			ref: environment.GITHUB_REF,
			repository,
			sha: environment.GITHUB_SHA,
			workflowPath: workflowReference.slice(prefix.length, separator)
		},
		kind: 'sigstore-bundle'
	});
};

export const parseAbsoluteMobileCertificationVerification = (
	value: unknown
) => {
	if (
		!isRecord(value) ||
		value.format !== ABSOLUTE_MOBILE_CERTIFICATION_VERIFICATION_FORMAT ||
		value.kind !== 'sigstore-bundle' ||
		!isRecord(value.bundle) ||
		!isRecord(value.identity)
	)
		throw new TypeError(
			'Mobile certification verification contract is invalid.'
		);
	const issuer = required(value.identity.issuer, 'verification issuer');
	if (issuer !== 'https://token.actions.githubusercontent.com')
		throw new TypeError('verification issuer is invalid.');
	const verification: AbsoluteMobileCertificationVerification = {
		bundle: value.bundle,
		format: ABSOLUTE_MOBILE_CERTIFICATION_VERIFICATION_FORMAT,
		identity: {
			issuer,
			ref: requireMatch(
				required(value.identity.ref, 'verification ref'),
				REF_PATTERN,
				'verification ref'
			),
			repository: requireMatch(
				required(value.identity.repository, 'verification repository'),
				REPOSITORY_PATTERN,
				'verification repository'
			),
			sha: requireMatch(
				required(value.identity.sha, 'verification sha'),
				SHA_PATTERN,
				'verification sha'
			),
			workflowPath: requireMatch(
				required(
					value.identity.workflowPath,
					'verification workflowPath'
				),
				WORKFLOW_PATTERN,
				'verification workflowPath'
			)
		},
		kind: 'sigstore-bundle'
	};
	const bytes = new TextEncoder().encode(JSON.stringify(verification));
	if (bytes.byteLength > MAX_VERIFICATION_BYTES)
		throw new TypeError(
			'Mobile certification verification exceeds the 1 MiB limit.'
		);

	return verification;
};

const projectFile = (projectRoot: string, requested: string) => {
	const root = resolve(projectRoot);
	const path = resolve(root, requested);
	const portable = relative(root, path);
	if (
		portable === '..' ||
		portable.startsWith(`..${sep}`) ||
		isAbsolute(portable)
	)
		throw new TypeError(
			'Mobile certification verification path must remain inside the project.'
		);

	return path;
};

export const readAbsoluteMobileCertificationVerification = async (
	projectRoot: string,
	requested: string
) => {
	const path = projectFile(projectRoot, requested);
	await access(path).catch(() => {
		throw new TypeError(
			`Mobile certification verification does not exist: ${path}`
		);
	});
	const metadata = await stat(path);
	if (!metadata.isFile() || metadata.size > MAX_VERIFICATION_BYTES)
		throw new TypeError(
			'Mobile certification verification file is invalid.'
		);

	return parseAbsoluteMobileCertificationVerification(
		JSON.parse(await readFile(path, 'utf8'))
	);
};

export const readAbsoluteSigstoreBundle = async (
	projectRoot: string,
	requested: string
) => {
	const path = projectFile(projectRoot, requested);
	const metadata = await stat(path).catch(() => null);
	if (!metadata?.isFile() || metadata.size > MAX_VERIFICATION_BYTES)
		throw new TypeError('Sigstore bundle file is invalid.');
	const value: unknown = JSON.parse(await readFile(path, 'utf8'));
	if (!isRecord(value)) throw new TypeError('Sigstore bundle is invalid.');

	return value;
};

export const writeAbsoluteMobileCertificationVerification = async (
	projectRoot: string,
	requested: string,
	verification: AbsoluteMobileCertificationVerification
) => {
	const path = projectFile(projectRoot, requested);
	const parsed = parseAbsoluteMobileCertificationVerification(verification);
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(parsed, null, 2)}\n`, {
		mode: 0o600
	});

	return path;
};
