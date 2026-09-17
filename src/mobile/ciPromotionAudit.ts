import {
	access,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rename,
	rm,
	stat,
	writeFile
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { readAbsoluteAndroidRelease } from './androidReleaseAcceptance';
import {
	readAbsoluteMobileCertificationVerification,
	readAbsoluteSigstoreBundle
} from './certificationVerification';
import { readAbsoluteIosRelease } from './iosReleaseAcceptance';
import {
	readAbsoluteMobileReleaseCertification,
	verifyAbsoluteMobileReleaseCertification
} from './releaseCertification';

export const ABSOLUTE_MOBILE_CI_PROMOTION_AUDIT_FORMAT = 1 as const;
export const ABSOLUTE_MOBILE_CI_PROMOTION_CONTEXT_FORMAT = 2 as const;
const MAX_GITHUB_OUTPUT_BYTES = 1_048_576;
const MAX_AUDIT_JSON_BYTES = 1_048_576;
const MAX_SEARCH_FILES = 20_000;
const RUN_ID_PATTERN = /^[1-9][0-9]*$/u;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const DISPATCH_ID_PATTERN = /^amp_[a-f0-9]{32}$/u;
const PROMOTION_DISCOVERY_ATTEMPTS = 60;
const PROMOTION_DISCOVERY_INTERVAL_MS = 1_000;

export type AbsoluteMobileCiPlatform = 'android' | 'ios';

export type AbsoluteMobileCiCommandResult = {
	exitCode: number;
	stderr: string;
	stdout: string;
};

export type AbsoluteMobileCiCommandRunner = (
	command: string[],
	options: {
		cwd: string;
		env?: Record<string, string | undefined>;
	}
) => Promise<AbsoluteMobileCiCommandResult>;

export type AbsoluteMobileCiRunStatus = {
	conclusion: string | null;
	createdAt: string;
	displayTitle: string;
	headBranch: string;
	headSha: string;
	jobs: readonly {
		conclusion: string | null;
		name: string;
		status: string;
	}[];
	runId: string;
	startedAt: string | null;
	status: string;
	updatedAt: string;
	url: string;
	workflowName: string;
};

export type AbsoluteMobilePromotionContext = {
	dispatchId: string | null;
	format: 1 | typeof ABSOLUTE_MOBILE_CI_PROMOTION_CONTEXT_FORMAT;
	platform: AbsoluteMobileCiPlatform;
	promotionRunId: string;
	sourceArtifact: string;
	sourceRunId: string;
};

export type AbsoluteMobilePromotionRun = {
	dispatchId: string;
	runId: string;
	url: string;
};

export type AbsoluteMobilePromotionAudit = {
	certification: {
		certificationId: string;
		requirement: string;
		strength: string;
	};
	format: typeof ABSOLUTE_MOBILE_CI_PROMOTION_AUDIT_FORMAT;
	github: {
		conclusion: string;
		dispatchId: string | null;
		promotionRunId: string;
		repository: string | null;
		sourceRunId: string;
		url: string;
		workflowName: string;
	};
	platform: AbsoluteMobileCiPlatform;
	provenance: {
		issuer: string;
		ref: string;
		repository: string;
		sha: string;
		workflowPath: string;
	};
	publication: {
		channel: string | null;
		provider: 'app-store-connect' | 'google-play' | 'registry';
		reused: boolean;
		stage: string | null;
	};
	release: {
		appId: string;
		bytes: number;
		engine: 'capacitor' | 'expo';
		releaseId: string;
		runtime: string;
		sha256: string;
	};
	status: 'verified';
	verifiedAt: string;
};

type AuditOptions = {
	outputDirectory?: string;
	projectRoot: string;
	repository?: string;
	run?: AbsoluteMobileCiCommandRunner;
	runId: string;
	sourceRunId?: string;
};

type PromotionDiscoveryOptions = {
	attempts?: number;
	dispatchId: string;
	pollIntervalMs?: number;
	projectRoot: string;
	repository?: string;
	run?: AbsoluteMobileCiCommandRunner;
	sleep?: (milliseconds: number) => Promise<void>;
	workflow: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const requiredString = (value: unknown, name: string) => {
	if (typeof value !== 'string' || value.trim() === '')
		throw new TypeError(`${name} is invalid.`);

	return value.trim();
};

const optionalString = (value: unknown, name: string) => {
	if (value === null || value === undefined) return null;

	return requiredString(value, name);
};

const runId = (value: string, name: string) => {
	if (!RUN_ID_PATTERN.test(value)) throw new TypeError(`${name} is invalid.`);

	return value;
};

const dispatchId = (value: string) => {
	if (!DISPATCH_ID_PATTERN.test(value))
		throw new TypeError('Mobile promotion dispatch ID is invalid.');

	return value;
};

const promotionRunTitle = (value: string) =>
	`AbsoluteJS mobile promotion [${dispatchId(value)}]`;

const promotionDiscoveryCommand = (
	workflow: string,
	repository: string | undefined
) => [
	'gh',
	'run',
	'list',
	'--workflow',
	workflow,
	'--event',
	'workflow_dispatch',
	'--limit',
	'50',
	...repositoryArgs(repository),
	'--json',
	'databaseId,displayTitle,event,url'
];

const repositoryArgs = (repository: string | undefined) => {
	if (repository === undefined) return [];
	if (!REPOSITORY_PATTERN.test(repository))
		throw new TypeError('GitHub repository must be owner/name.');

	return ['--repo', repository];
};

const projectPath = (projectRoot: string, requested: string) => {
	const root = resolve(projectRoot);
	const path = resolve(root, requested);
	const portable = relative(root, path);
	if (
		portable === '..' ||
		portable.startsWith(`..${sep}`) ||
		isAbsolute(portable)
	)
		throw new TypeError(
			'Mobile CI audit output must remain inside the project.'
		);

	return path;
};

const defaultRunner: AbsoluteMobileCiCommandRunner = async (
	command,
	options
) => {
	const child = Bun.spawn(command, {
		cwd: options.cwd,
		env: options.env,
		stderr: 'pipe',
		stdin: 'ignore',
		stdout: 'pipe'
	});
	const [exitCode, stderr, stdout] = await Promise.all([
		child.exited,
		new Response(child.stderr).text(),
		new Response(child.stdout).text()
	]);

	return { exitCode, stderr, stdout };
};

const requireCommand = async (
	run: AbsoluteMobileCiCommandRunner,
	command: string[],
	options: { cwd: string; env?: Record<string, string | undefined> },
	label: string
) => {
	const result = await run(command, options);
	if (result.exitCode !== 0)
		throw new TypeError(
			`${label} failed: ${result.stderr.trim() || result.stdout.trim() || `exit ${result.exitCode}`}`
		);
	if (
		result.stdout.length > MAX_GITHUB_OUTPUT_BYTES ||
		result.stderr.length > MAX_GITHUB_OUTPUT_BYTES
	)
		throw new TypeError(`${label} output exceeded the 1 MiB limit.`);

	return result;
};

const parseJob = (value: unknown) => {
	if (!isRecord(value)) throw new TypeError('GitHub run job is invalid.');

	return {
		conclusion: optionalString(value.conclusion, 'GitHub job conclusion'),
		name: requiredString(value.name, 'GitHub job name'),
		status: requiredString(value.status, 'GitHub job status')
	};
};

export const discoverAbsoluteMobilePromotionRun = async (
	options: PromotionDiscoveryOptions
) => {
	const requestedDispatchId = dispatchId(options.dispatchId);
	const attempts = options.attempts ?? PROMOTION_DISCOVERY_ATTEMPTS;
	if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 300)
		throw new TypeError('Mobile promotion discovery attempts are invalid.');
	const pollIntervalMs =
		options.pollIntervalMs ?? PROMOTION_DISCOVERY_INTERVAL_MS;
	if (
		!Number.isSafeInteger(pollIntervalMs) ||
		pollIntervalMs < 0 ||
		pollIntervalMs > 10_000
	)
		throw new TypeError('Mobile promotion discovery interval is invalid.');
	const sleep = options.sleep ?? Bun.sleep;
	const discover = async (
		attempt: number
	): Promise<AbsoluteMobilePromotionRun> => {
		const result = await requireCommand(
			options.run ?? defaultRunner,
			promotionDiscoveryCommand(options.workflow, options.repository),
			{ cwd: options.projectRoot },
			'GitHub promotion run discovery'
		);
		const discovered = parseAbsoluteMobilePromotionRunList(
			JSON.parse(result.stdout),
			requestedDispatchId
		);
		if (discovered) return discovered;
		if (attempt >= attempts)
			throw new TypeError(
				`GitHub did not expose promotion dispatch ${requestedDispatchId} within ${attempts} attempts.`
			);
		await sleep(pollIntervalMs);

		return discover(attempt + 1);
	};

	return discover(1);
};

export const inspectAbsoluteMobileCiRun = async (options: {
	projectRoot: string;
	repository?: string;
	run?: AbsoluteMobileCiCommandRunner;
	runId: string;
}) => {
	const requestedRunId = runId(options.runId, 'GitHub run ID');
	const result = await requireCommand(
		options.run ?? defaultRunner,
		[
			'gh',
			'run',
			'view',
			requestedRunId,
			...repositoryArgs(options.repository),
			'--json',
			'conclusion,createdAt,databaseId,displayTitle,headBranch,headSha,jobs,startedAt,status,updatedAt,url,workflowName'
		],
		{ cwd: options.projectRoot },
		'GitHub workflow inspection'
	);

	return parseAbsoluteMobileCiRunStatus(
		JSON.parse(result.stdout),
		requestedRunId
	);
};

export const parseAbsoluteMobileCiRunStatus = (
	value: unknown,
	requestedRunId: string
): AbsoluteMobileCiRunStatus => {
	if (!isRecord(value) || !Array.isArray(value.jobs))
		throw new TypeError('GitHub workflow run response is invalid.');
	const { databaseId } = value;
	if (
		(typeof databaseId !== 'number' && typeof databaseId !== 'string') ||
		String(databaseId) !== requestedRunId
	)
		throw new TypeError('GitHub workflow run identity does not match.');

	return {
		conclusion: optionalString(value.conclusion, 'GitHub run conclusion'),
		createdAt: requiredString(value.createdAt, 'GitHub run createdAt'),
		displayTitle: requiredString(
			value.displayTitle,
			'GitHub run displayTitle'
		),
		headBranch: requiredString(value.headBranch, 'GitHub run headBranch'),
		headSha: requiredString(value.headSha, 'GitHub run headSha'),
		jobs: value.jobs.map(parseJob),
		runId: requestedRunId,
		startedAt: optionalString(value.startedAt, 'GitHub run startedAt'),
		status: requiredString(value.status, 'GitHub run status'),
		updatedAt: requiredString(value.updatedAt, 'GitHub run updatedAt'),
		url: requiredString(value.url, 'GitHub run URL'),
		workflowName: requiredString(value.workflowName, 'GitHub workflow name')
	};
};

export const parseAbsoluteMobilePromotionContext = (
	value: unknown
): AbsoluteMobilePromotionContext => {
	if (
		!isRecord(value) ||
		(value.format !== 1 &&
			value.format !== ABSOLUTE_MOBILE_CI_PROMOTION_CONTEXT_FORMAT) ||
		(value.platform !== 'android' && value.platform !== 'ios')
	)
		throw new TypeError('Mobile promotion context is invalid.');
	const { platform } = value;
	const sourceArtifact = requiredString(
		value.sourceArtifact,
		'promotion source artifact'
	);
	if (sourceArtifact !== `absolute-mobile-${platform}`)
		throw new TypeError('Mobile promotion source artifact is invalid.');

	return {
		dispatchId:
			value.format === 1
				? null
				: dispatchId(
						requiredString(
							value.dispatchId,
							'promotion dispatch ID'
						)
					),
		format: value.format,
		platform,
		promotionRunId: runId(
			requiredString(value.promotionRunId, 'promotion run ID'),
			'promotion run ID'
		),
		sourceArtifact,
		sourceRunId: runId(
			requiredString(value.sourceRunId, 'source run ID'),
			'source run ID'
		)
	};
};

export const parseAbsoluteMobilePromotionRunList = (
	value: unknown,
	requestedDispatchId: string
) => {
	if (!Array.isArray(value))
		throw new TypeError('GitHub workflow run list response is invalid.');
	const expectedTitle = promotionRunTitle(requestedDispatchId);
	const matches = value.filter(
		(candidate) =>
			isRecord(candidate) && candidate.displayTitle === expectedTitle
	);
	if (matches.length === 0) return null;
	if (matches.length !== 1)
		throw new TypeError(
			'GitHub returned multiple runs for one promotion dispatch identity.'
		);
	const [match] = matches;
	if (!isRecord(match) || match.event !== 'workflow_dispatch')
		throw new TypeError('GitHub promotion run identity is invalid.');
	const databaseId =
		typeof match.databaseId === 'number' ||
		typeof match.databaseId === 'string'
			? String(match.databaseId)
			: '';
	const requestedRunId = runId(databaseId, 'GitHub promotion run ID');
	const url = requiredString(match.url, 'GitHub promotion run URL');
	if (!url.endsWith(`/actions/runs/${requestedRunId}`))
		throw new TypeError('GitHub promotion run URL does not match its ID.');

	return {
		dispatchId: requestedDispatchId,
		runId: requestedRunId,
		url
	} satisfies AbsoluteMobilePromotionRun;
};

export const watchAbsoluteMobileCiRun = async (options: {
	projectRoot: string;
	repository?: string;
	run?: AbsoluteMobileCiCommandRunner;
	runId: string;
}) => {
	const requestedRunId = runId(options.runId, 'GitHub run ID');
	await requireCommand(
		options.run ?? defaultRunner,
		[
			'gh',
			'run',
			'watch',
			requestedRunId,
			...repositoryArgs(options.repository),
			'--exit-status'
		],
		{ cwd: options.projectRoot },
		'GitHub workflow watch'
	);

	return inspectAbsoluteMobileCiRun({ ...options, runId: requestedRunId });
};

const readBoundedJson = async (path: string, label: string) => {
	const metadata = await stat(path).catch(() => null);
	if (!metadata?.isFile() || metadata.size > MAX_AUDIT_JSON_BYTES)
		throw new TypeError(`${label} is missing or exceeds the 1 MiB limit.`);

	const value: unknown = JSON.parse(await readFile(path, 'utf8'));

	return value;
};

const findFiles = async (root: string, name: string) => {
	const found: string[] = [];
	let visited = 0;
	const walk = async (directory: string): Promise<void> => {
		const entries = await readdir(directory, { withFileTypes: true });
		await Promise.all(
			entries.map(async (entry) => {
				visited += 1;
				if (visited > MAX_SEARCH_FILES)
					throw new TypeError(
						'Downloaded GitHub artifact contains too many files.'
					);
				const path = join(directory, entry.name);
				if (entry.isDirectory()) {
					await walk(path);

					return;
				}
				if (entry.isFile() && entry.name === name) found.push(path);
			})
		);
	};
	await walk(root);

	return found;
};

const inferPromotionPlatform = (status: AbsoluteMobileCiRunStatus) => {
	const matched = status.jobs.flatMap((job) => {
		if (job.name === 'Promote exact certified Android release')
			return ['android' as const];
		if (job.name === 'Promote exact certified iOS release')
			return ['ios' as const];

		return [];
	});
	if (matched.length !== 1)
		throw new TypeError(
			'GitHub run does not contain exactly one mobile promotion job.'
		);

	const [platform] = matched;
	if (!platform) throw new TypeError('Mobile promotion platform is missing.');

	return platform;
};

const onlyPath = (paths: string[], label: string) => {
	const [path] = paths;
	if (paths.length !== 1 || !path)
		throw new TypeError(`${label} must contain exactly one matching file.`);

	return path;
};

const canonicalJson = (value: unknown): string => {
	if (Array.isArray(value))
		return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
	if (isRecord(value))
		return `{${Object.keys(value)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
			.join(',')}}`;

	return JSON.stringify(value);
};

const publicationSummary = (
	value: unknown,
	platform: AbsoluteMobileCiPlatform,
	release: {
		metadata: {
			appId: string;
			releaseId: string;
			sha256: string;
		};
	},
	certification: {
		certificationId: string;
		requirement: string;
		strength: string;
	}
): AbsoluteMobilePromotionAudit['publication'] => {
	if (
		!isRecord(value) ||
		!isRecord(value.record) ||
		!isRecord(value.record.metadata)
	)
		throw new TypeError('Mobile promotion receipt is invalid.');
	const { metadata } = value.record;
	if (
		metadata.appId !== release.metadata.appId ||
		metadata.releaseId !== release.metadata.releaseId ||
		metadata.sha256 !== release.metadata.sha256
	)
		throw new TypeError(
			'Mobile promotion receipt release identity does not match.'
		);
	if (
		!isRecord(value.certification) ||
		!isRecord(value.certification.provenance)
	)
		throw new TypeError(
			'Mobile promotion receipt lacks trusted certification provenance.'
		);
	if (
		value.certification.certificationId !== certification.certificationId ||
		value.certification.releaseId !== release.metadata.releaseId ||
		value.certification.requirement !== certification.requirement ||
		value.certification.strength !== certification.strength ||
		value.certification.provenance.subject !== release.metadata.releaseId
	)
		throw new TypeError(
			'Mobile promotion certification receipt does not match.'
		);
	requiredString(
		value.certification.provenance.issuer,
		'promotion provenance issuer'
	);
	requiredString(
		value.certification.provenance.verificationId,
		'promotion provenance verification ID'
	);
	const provenanceTime = requiredString(
		value.certification.provenance.verifiedAt,
		'promotion provenance verification time'
	);
	if (Number.isNaN(Date.parse(provenanceTime)))
		throw new TypeError('Mobile promotion provenance time is invalid.');
	if (typeof value.reused !== 'boolean')
		throw new TypeError('Mobile promotion reuse status is invalid.');
	const channel = isRecord(value.channel)
		? optionalString(value.channel.channel, 'promotion channel')
		: null;
	if (
		isRecord(value.channel) &&
		value.channel.releaseId !== release.metadata.releaseId
	)
		throw new TypeError('Mobile promotion channel receipt does not match.');
	const providerReceipt =
		platform === 'android' ? value.googlePlay : value.appStoreConnect;
	if (providerReceipt === undefined)
		return {
			channel,
			provider: 'registry' as const,
			reused: value.reused,
			stage: null
		};
	if (!isRecord(providerReceipt) || !isRecord(providerReceipt.receipt))
		throw new TypeError('Mobile store promotion receipt is invalid.');
	if (typeof providerReceipt.reused !== 'boolean')
		throw new TypeError('Mobile store promotion reuse status is invalid.');
	const expectedProvider =
		platform === 'android' ? 'google-play' : 'app-store-connect';
	if (
		providerReceipt.receipt.provider !== expectedProvider ||
		providerReceipt.receipt.releaseId !== release.metadata.releaseId ||
		providerReceipt.receipt.sha256 !== release.metadata.sha256
	)
		throw new TypeError('Mobile store promotion receipt does not match.');

	return {
		channel,
		provider: expectedProvider,
		reused: providerReceipt.reused,
		stage: requiredString(
			providerReceipt.receipt.stage,
			'Mobile store promotion stage'
		)
	};
};

const renderAuditMarkdown = (
	audit: AbsoluteMobilePromotionAudit
) => `# AbsoluteJS mobile promotion audit

- Status: **VERIFIED**
- Platform: ${audit.platform}
- Release: \`${audit.release.releaseId}\`
- Artifact SHA-256: \`${audit.release.sha256}\`
- Source workflow run: ${audit.github.sourceRunId}
- Promotion workflow run: ${audit.github.promotionRunId}
- Dispatch correlation: ${audit.github.dispatchId ?? 'legacy workflow (not recorded)'}
- Workflow: ${audit.github.workflowName}
- GitHub identity: \`${audit.provenance.repository}/${audit.provenance.workflowPath}@${audit.provenance.ref}\`
- Certification: \`${audit.certification.certificationId}\` (${audit.certification.strength})
- Publication: ${audit.publication.provider}${audit.publication.stage ? ` / ${audit.publication.stage}` : ''}
- Verified at: ${audit.verifiedAt}

This report contains no credentials, device identifiers, local absolute paths, application data, or GitHub token.
`;

export const auditAbsoluteMobileCiPromotion = async (options: AuditOptions) => {
	const runner = options.run ?? defaultRunner;
	const promotionRunId = runId(options.runId, 'GitHub promotion run ID');
	const status = await inspectAbsoluteMobileCiRun({
		projectRoot: options.projectRoot,
		...(options.repository ? { repository: options.repository } : {}),
		run: runner,
		runId: promotionRunId
	});
	if (status.status !== 'completed' || status.conclusion !== 'success')
		throw new TypeError(
			'Mobile promotion run has not completed successfully.'
		);
	const platform = inferPromotionPlatform(status);
	const output = projectPath(
		options.projectRoot,
		options.outputDirectory ??
			`.absolutejs/mobile-ci/audits/${promotionRunId}`
	);
	if (
		await access(output)
			.then(() => true)
			.catch(() => false)
	)
		throw new TypeError(`Mobile CI audit output already exists: ${output}`);
	await mkdir(dirname(output), { recursive: true });
	const staging = await mkdtemp(join(dirname(output), '.promotion-audit-'));
	try {
		const evidenceRoot = join(staging, 'promotion-evidence');
		await mkdir(evidenceRoot);
		await requireCommand(
			runner,
			[
				'gh',
				'run',
				'download',
				promotionRunId,
				...repositoryArgs(options.repository),
				'--name',
				`absolute-mobile-${platform}-promotion-${promotionRunId}`,
				'--dir',
				evidenceRoot
			],
			{ cwd: options.projectRoot },
			'GitHub promotion artifact download'
		);
		const contextPaths = await findFiles(
			evidenceRoot,
			'promotion-context.json'
		);
		let context: AbsoluteMobilePromotionContext | undefined;
		if (contextPaths.length === 1)
			context = parseAbsoluteMobilePromotionContext(
				await readBoundedJson(
					onlyPath(contextPaths, 'Promotion context'),
					'Promotion context'
				)
			);
		else if (contextPaths.length > 1)
			throw new TypeError(
				'Promotion artifact contains duplicate contexts.'
			);
		if (context && context.promotionRunId !== promotionRunId)
			throw new TypeError(
				'Promotion context run identity does not match.'
			);
		if (context && context.platform !== platform)
			throw new TypeError('Promotion context platform does not match.');
		if (
			context?.dispatchId &&
			status.displayTitle !== promotionRunTitle(context.dispatchId)
		)
			throw new TypeError(
				'Promotion dispatch identity does not match the GitHub run.'
			);
		const sourceRunId = options.sourceRunId
			? runId(options.sourceRunId, 'GitHub source run ID')
			: context?.sourceRunId;
		if (!sourceRunId)
			throw new TypeError(
				'Promotion artifact predates source-run context; pass --source-run-id.'
			);
		if (
			context &&
			options.sourceRunId &&
			context.sourceRunId !== sourceRunId
		)
			throw new TypeError(
				'Requested source run does not match promotion context.'
			);
		const sourceArtifact =
			context?.sourceArtifact ?? `absolute-mobile-${platform}`;
		const sourceRoot = join(staging, 'source-release');
		await mkdir(sourceRoot);
		await requireCommand(
			runner,
			[
				'gh',
				'run',
				'download',
				sourceRunId,
				...repositoryArgs(options.repository),
				'--name',
				sourceArtifact,
				'--dir',
				sourceRoot
			],
			{ cwd: options.projectRoot },
			'GitHub source release download'
		);
		const releaseMetadata = await findFiles(sourceRoot, 'release.json');
		if (releaseMetadata.length !== 1)
			throw new TypeError(
				'Source artifact must contain exactly one immutable mobile release.'
			);
		const releaseMetadataPath = onlyPath(
			releaseMetadata,
			'Source artifact'
		);
		const release =
			platform === 'android'
				? await readAbsoluteAndroidRelease(
						options.projectRoot,
						releaseMetadataPath
					)
				: await readAbsoluteIosRelease(
						options.projectRoot,
						releaseMetadataPath
					);
		const certificationPaths = await findFiles(
			evidenceRoot,
			'certification.json'
		);
		const verificationPaths = await findFiles(
			evidenceRoot,
			'verification.json'
		);
		const receiptPaths = await findFiles(
			evidenceRoot,
			'promotion-receipt.json'
		);
		if (
			certificationPaths.length !== 1 ||
			verificationPaths.length !== 1 ||
			receiptPaths.length !== 1
		)
			throw new TypeError(
				'Promotion audit artifact is incomplete or ambiguous.'
			);
		const certificationPath = onlyPath(
			certificationPaths,
			'Promotion certification'
		);
		const verificationPath = onlyPath(
			verificationPaths,
			'Promotion verification'
		);
		const receiptPath = onlyPath(receiptPaths, 'Promotion receipt');
		const loadedCertification =
			await readAbsoluteMobileReleaseCertification(
				options.projectRoot,
				certificationPath
			);
		const certification = verifyAbsoluteMobileReleaseCertification(
			loadedCertification.certification,
			release
		);
		const verification = await readAbsoluteMobileCertificationVerification(
			options.projectRoot,
			verificationPath
		);
		if (verification.identity.sha !== status.headSha)
			throw new TypeError(
				'Sigstore workflow commit does not match the promotion run.'
			);
		if (
			options.repository &&
			verification.identity.repository !== options.repository
		)
			throw new TypeError(
				'Sigstore repository does not match the requested repository.'
			);
		const bundlePath = `${certificationPath}.sigstore.json`;
		const bundle = await readAbsoluteSigstoreBundle(
			options.projectRoot,
			bundlePath
		);
		if (canonicalJson(bundle) !== canonicalJson(verification.bundle))
			throw new TypeError(
				'Sigstore bundle does not match verification envelope.'
			);
		await requireCommand(
			runner,
			[
				'bunx',
				'@absolutejs/attest@0.2.0',
				'verify-blobs',
				certificationPath
			],
			{
				cwd: options.projectRoot,
				env: {
					...process.env,
					GITHUB_REF: verification.identity.ref,
					GITHUB_REPOSITORY: verification.identity.repository,
					GITHUB_SHA: verification.identity.sha,
					GITHUB_WORKFLOW_REF: `${verification.identity.repository}/${verification.identity.workflowPath}@${verification.identity.ref}`
				}
			},
			'Sigstore certification verification'
		);
		const publication = publicationSummary(
			await readBoundedJson(receiptPath, 'Mobile promotion receipt'),
			platform,
			release,
			certification
		);
		const audit: AbsoluteMobilePromotionAudit = {
			certification: {
				certificationId: certification.certificationId,
				requirement: certification.requirement,
				strength: certification.strength
			},
			format: ABSOLUTE_MOBILE_CI_PROMOTION_AUDIT_FORMAT,
			github: {
				conclusion: status.conclusion,
				dispatchId: context?.dispatchId ?? null,
				promotionRunId,
				repository: verification.identity.repository,
				sourceRunId,
				url: status.url,
				workflowName: status.workflowName
			},
			platform,
			provenance: verification.identity,
			publication,
			release: {
				appId: release.metadata.appId,
				bytes: release.metadata.bytes,
				engine: release.metadata.engine,
				releaseId: release.metadata.releaseId,
				runtime: release.metadata.runtime,
				sha256: release.metadata.sha256
			},
			status: 'verified',
			verifiedAt: new Date().toISOString()
		};
		await Promise.all([
			writeFile(
				join(staging, 'audit.json'),
				`${JSON.stringify(audit, null, 2)}\n`,
				{ mode: 0o600 }
			),
			writeFile(join(staging, 'audit.md'), renderAuditMarkdown(audit), {
				mode: 0o600
			})
		]);
		await rename(staging, output);

		return { audit, directory: output };
	} catch (error) {
		await rm(staging, { force: true, recursive: true });
		throw error;
	}
};
