import {
	access,
	link,
	lstat,
	mkdir,
	open,
	readFile,
	readdir,
	rename,
	rm
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';

export const ABSOLUTE_MOBILE_CI_PROMOTION_OPERATION_FORMAT = 1 as const;
const MAX_OPERATION_BYTES = 65_536;
const MAX_OPERATIONS = 1_000;
const DISPATCH_ID_PATTERN = /^amp_[a-f0-9]{32}$/u;
const RUN_ID_PATTERN = /^[1-9][0-9]*$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const CERTIFICATION_ID_PATTERN = /^amobile_cert_[a-f0-9]{64}$/u;
const RELEASE_ID_PATTERN = /^amobile_(?:android|ios)_[a-f0-9]{64}$/u;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const LAST_ASCII_CONTROL = 31;
const DELETE_CHARACTER = 127;
const PHASES = [
	'dispatching',
	'dispatched',
	'discovered',
	'completed',
	'audited'
] as const;

export type AbsoluteMobilePromotionOperationPhase = (typeof PHASES)[number];

export type AbsoluteMobilePromotionOperation = {
	auditDirectory: string | null;
	auditOutputDirectory: string | null;
	auditRequested: boolean;
	certificationId: string;
	certificationSha256: string;
	channel: string | null;
	conclusion: string | null;
	createdAt: string;
	dispatchId: string;
	format: typeof ABSOLUTE_MOBILE_CI_PROMOTION_OPERATION_FORMAT;
	githubStatus: string | null;
	phase: AbsoluteMobilePromotionOperationPhase;
	platform: 'android' | 'ios';
	playTrack: string | null;
	ref: string | null;
	releaseId: string;
	repository: string | null;
	runId: string | null;
	sourceRunId: string;
	testflightGroup: string | null;
	testflightSubmitReview: boolean;
	updatedAt: string;
	url: string | null;
	watchRequested: boolean;
	workflow: string;
};

export type CreateAbsoluteMobilePromotionOperationOptions = Omit<
	AbsoluteMobilePromotionOperation,
	| 'auditDirectory'
	| 'conclusion'
	| 'createdAt'
	| 'format'
	| 'githubStatus'
	| 'phase'
	| 'runId'
	| 'updatedAt'
	| 'url'
> & {
	now?: () => Date;
};

export type AdvanceAbsoluteMobilePromotionOperationOptions = {
	auditDirectory?: string | null;
	conclusion?: string | null;
	githubStatus?: string | null;
	phase: AbsoluteMobilePromotionOperationPhase;
	runId?: string | null;
	url?: string | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const requiredString = (value: unknown, label: string, max = 512) => {
	const hasControlCharacter =
		typeof value === 'string' &&
		Array.from(value).some((character) => {
			const code = character.codePointAt(0);

			return (
				code !== undefined &&
				(code <= LAST_ASCII_CONTROL || code === DELETE_CHARACTER)
			);
		});
	if (
		typeof value !== 'string' ||
		value.trim() === '' ||
		value !== value.trim() ||
		value.length > max ||
		hasControlCharacter
	)
		throw new TypeError(`${label} is invalid.`);

	return value;
};

const optionalString = (value: unknown, label: string, max = 512) => {
	if (value === null) return null;

	return requiredString(value, label, max);
};

const boolean = (value: unknown, label: string) => {
	if (typeof value !== 'boolean') throw new TypeError(`${label} is invalid.`);

	return value;
};

const timestamp = (value: unknown, label: string) => {
	const parsed = requiredString(value, label, 64);
	if (!Number.isFinite(Date.parse(parsed)))
		throw new TypeError(`${label} is invalid.`);

	return parsed;
};

const projectRelativePath = (value: unknown, label: string) => {
	const parsed = requiredString(value, label, 512);
	if (
		isAbsolute(parsed) ||
		parsed === '..' ||
		parsed.startsWith(`..${sep}`) ||
		parsed.split(/[\\/]/u).includes('..')
	)
		throw new TypeError(`${label} must be project-relative.`);

	return parsed.replaceAll('\\', '/');
};

const nullableProjectRelativePath = (value: unknown, label: string) =>
	value === null ? null : projectRelativePath(value, label);

const dispatchId = (value: unknown) => {
	const parsed = requiredString(value, 'Promotion dispatch ID', 36);
	if (!DISPATCH_ID_PATTERN.test(parsed))
		throw new TypeError('Promotion dispatch ID is invalid.');

	return parsed;
};

const runId = (value: unknown, label: string) => {
	const parsed = requiredString(value, label, 32);
	if (!RUN_ID_PATTERN.test(parsed))
		throw new TypeError(`${label} is invalid.`);

	return parsed;
};

const nullableRunId = (value: unknown, label: string) =>
	value === null ? null : runId(value, label);

const operationRoot = (projectRoot: string) =>
	join(resolve(projectRoot), '.absolutejs', 'mobile-ci', 'promotions');

export const absoluteMobilePromotionOperationPath = (
	projectRoot: string,
	requestedDispatchId: string
) =>
	join(
		operationRoot(projectRoot),
		dispatchId(requestedDispatchId),
		'operation.json'
	);

const operationPhase = (value: unknown) => {
	const phase = PHASES.find((candidate) => candidate === value);
	if (!phase)
		throw new TypeError('Mobile promotion operation phase is invalid.');

	return phase;
};

export const parseAbsoluteMobilePromotionOperation = (value: unknown) => {
	if (
		!isRecord(value) ||
		value.format !== ABSOLUTE_MOBILE_CI_PROMOTION_OPERATION_FORMAT ||
		(value.platform !== 'android' && value.platform !== 'ios')
	)
		throw new TypeError('Mobile promotion operation is invalid.');
	const parsed: AbsoluteMobilePromotionOperation = {
		auditDirectory: nullableProjectRelativePath(
			value.auditDirectory,
			'Promotion audit directory'
		),
		auditOutputDirectory: nullableProjectRelativePath(
			value.auditOutputDirectory,
			'Promotion requested audit directory'
		),
		auditRequested: boolean(
			value.auditRequested,
			'Promotion audit request'
		),
		certificationId: requiredString(
			value.certificationId,
			'Promotion certification ID',
			256
		),
		certificationSha256: requiredString(
			value.certificationSha256,
			'Promotion certification digest',
			64
		),
		channel: optionalString(value.channel, 'Promotion channel', 128),
		conclusion: optionalString(
			value.conclusion,
			'Promotion conclusion',
			64
		),
		createdAt: timestamp(value.createdAt, 'Promotion creation time'),
		dispatchId: dispatchId(value.dispatchId),
		format: ABSOLUTE_MOBILE_CI_PROMOTION_OPERATION_FORMAT,
		githubStatus: optionalString(
			value.githubStatus,
			'Promotion GitHub status',
			64
		),
		phase: operationPhase(value.phase),
		platform: value.platform,
		playTrack: optionalString(value.playTrack, 'Promotion Play track', 128),
		ref: optionalString(value.ref, 'Promotion ref', 256),
		releaseId: requiredString(value.releaseId, 'Promotion release ID', 256),
		repository: optionalString(
			value.repository,
			'Promotion repository',
			256
		),
		runId: nullableRunId(value.runId, 'Promotion run ID'),
		sourceRunId: runId(value.sourceRunId, 'Promotion source run ID'),
		testflightGroup: optionalString(
			value.testflightGroup,
			'Promotion TestFlight group',
			128
		),
		testflightSubmitReview: boolean(
			value.testflightSubmitReview,
			'Promotion TestFlight review setting'
		),
		updatedAt: timestamp(value.updatedAt, 'Promotion update time'),
		url: optionalString(value.url, 'Promotion run URL', 1_024),
		watchRequested: boolean(
			value.watchRequested,
			'Promotion watch request'
		),
		workflow: projectRelativePath(value.workflow, 'Promotion workflow')
	};
	if (!SHA256_PATTERN.test(parsed.certificationSha256))
		throw new TypeError('Promotion certification digest is invalid.');
	if (!CERTIFICATION_ID_PATTERN.test(parsed.certificationId))
		throw new TypeError('Promotion certification ID is invalid.');
	if (!RELEASE_ID_PATTERN.test(parsed.releaseId))
		throw new TypeError('Promotion release ID is invalid.');
	if (
		parsed.repository !== null &&
		!REPOSITORY_PATTERN.test(parsed.repository)
	)
		throw new TypeError('Promotion repository is invalid.');
	const discovered =
		PHASES.indexOf(parsed.phase) >= PHASES.indexOf('discovered');
	const completed =
		PHASES.indexOf(parsed.phase) >= PHASES.indexOf('completed');
	if (
		(discovered && (!parsed.runId || !parsed.url)) ||
		(!discovered && (parsed.runId || parsed.url)) ||
		(completed &&
			(parsed.githubStatus !== 'completed' || !parsed.conclusion)) ||
		(!completed && (parsed.githubStatus || parsed.conclusion)) ||
		(parsed.phase === 'audited' && !parsed.auditDirectory) ||
		(parsed.phase !== 'audited' && parsed.auditDirectory)
	)
		throw new TypeError('Mobile promotion operation phase is incomplete.');
	if (parsed.url && parsed.runId) {
		const url = new URL(parsed.url);
		if (
			url.protocol !== 'https:' ||
			url.username !== '' ||
			url.password !== '' ||
			url.search !== '' ||
			url.hash !== '' ||
			!url.pathname.endsWith(`/actions/runs/${parsed.runId}`)
		)
			throw new TypeError('Promotion run URL is invalid.');
	}
	if (Date.parse(parsed.updatedAt) < Date.parse(parsed.createdAt))
		throw new TypeError('Promotion operation time moved backwards.');

	return parsed;
};

const serialize = (operation: AbsoluteMobilePromotionOperation) =>
	`${JSON.stringify(parseAbsoluteMobilePromotionOperation(operation), null, 2)}\n`;

const writeSynced = async (path: string, source: string) => {
	const handle = await open(path, 'wx', 0o600);
	try {
		await handle.writeFile(source);
		await handle.sync();
	} finally {
		await handle.close();
	}
};

const atomicWrite = async (
	path: string,
	source: string,
	exclusive: boolean
) => {
	await mkdir(dirname(path), { recursive: true });
	const temporary = join(dirname(path), `.operation-${randomUUID()}.tmp`);
	try {
		await writeSynced(temporary, source);
		if (exclusive) await link(temporary, path);
		else await rename(temporary, path);
	} finally {
		await rm(temporary, { force: true });
	}
};

export const advanceAbsoluteMobilePromotionOperation = async (
	projectRoot: string,
	requestedDispatchId: string,
	options: AdvanceAbsoluteMobilePromotionOperationOptions,
	now: () => Date = () => new Date()
) => {
	const current = await readAbsoluteMobilePromotionOperation(
		projectRoot,
		requestedDispatchId
	);
	if (PHASES.indexOf(options.phase) < PHASES.indexOf(current.phase))
		throw new TypeError(
			'Mobile promotion operation cannot move backwards.'
		);
	if (
		(current.runId && options.runId && current.runId !== options.runId) ||
		(current.url && options.url && current.url !== options.url) ||
		(current.auditDirectory &&
			options.auditDirectory &&
			current.auditDirectory !== options.auditDirectory)
	)
		throw new TypeError(
			'Mobile promotion operation identity is immutable.'
		);
	const next = parseAbsoluteMobilePromotionOperation({
		...current,
		auditDirectory:
			options.auditDirectory === undefined
				? current.auditDirectory
				: options.auditDirectory,
		conclusion:
			options.conclusion === undefined
				? current.conclusion
				: options.conclusion,
		githubStatus:
			options.githubStatus === undefined
				? current.githubStatus
				: options.githubStatus,
		phase: options.phase,
		runId: options.runId === undefined ? current.runId : options.runId,
		updatedAt: now().toISOString(),
		url: options.url === undefined ? current.url : options.url
	});
	await atomicWrite(
		absoluteMobilePromotionOperationPath(projectRoot, requestedDispatchId),
		serialize(next),
		false
	);

	return next;
};
export const createAbsoluteMobilePromotionOperation = async (
	projectRoot: string,
	options: CreateAbsoluteMobilePromotionOperationOptions
) => {
	const now = (options.now ?? (() => new Date()))().toISOString();
	const operation = parseAbsoluteMobilePromotionOperation({
		...options,
		auditDirectory: null,
		conclusion: null,
		createdAt: now,
		format: ABSOLUTE_MOBILE_CI_PROMOTION_OPERATION_FORMAT,
		githubStatus: null,
		phase: 'dispatching',
		runId: null,
		updatedAt: now,
		url: null
	});
	await atomicWrite(
		absoluteMobilePromotionOperationPath(projectRoot, operation.dispatchId),
		serialize(operation),
		true
	);

	return operation;
};
export const listAbsoluteMobilePromotionOperations = async (
	projectRoot: string
) => {
	const root = operationRoot(projectRoot);
	if (
		!(await access(root)
			.then(() => true)
			.catch(() => false))
	)
		return [];
	const entries = await readdir(root, { withFileTypes: true });
	if (entries.length > MAX_OPERATIONS)
		throw new TypeError(
			'Mobile promotion operation count exceeds the limit.'
		);
	const operations = await Promise.all(
		entries
			.filter(
				(entry) =>
					entry.isDirectory() && DISPATCH_ID_PATTERN.test(entry.name)
			)
			.map((entry) =>
				readAbsoluteMobilePromotionOperation(projectRoot, entry.name)
			)
	);

	return operations.sort((left, right) =>
		right.updatedAt.localeCompare(left.updatedAt)
	);
};
export const readAbsoluteMobilePromotionOperation = async (
	projectRoot: string,
	requestedDispatchId: string
) => {
	const path = absoluteMobilePromotionOperationPath(
		projectRoot,
		requestedDispatchId
	);
	const metadata = await lstat(path).catch(() => null);
	if (!metadata?.isFile() || metadata.size > MAX_OPERATION_BYTES)
		throw new TypeError(
			`Mobile promotion operation ${requestedDispatchId} was not found or is invalid.`
		);
	const operation = parseAbsoluteMobilePromotionOperation(
		JSON.parse(await readFile(path, 'utf8'))
	);
	if (operation.dispatchId !== requestedDispatchId)
		throw new TypeError(
			'Mobile promotion operation identity does not match.'
		);

	return operation;
};
export const relativeAbsoluteMobilePromotionOperationPath = (
	projectRoot: string,
	dispatchIdValue: string
) =>
	relative(
		resolve(projectRoot),
		absoluteMobilePromotionOperationPath(projectRoot, dispatchIdValue)
	).replaceAll('\\', '/');
