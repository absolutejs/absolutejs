import { createHash } from 'node:crypto';
import {
	access,
	mkdir,
	mkdtemp,
	readFile,
	rename,
	rm,
	writeFile
} from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { AbsoluteAndroidRelease } from './androidReleaseAcceptance';
import type { AbsoluteIosRelease } from './iosReleaseAcceptance';

export const ABSOLUTE_MOBILE_RELEASE_CERTIFICATION_FORMAT = 1 as const;

export type AbsoluteMobileCertificationRequirement =
	| 'device'
	| 'installed'
	| 'simulator'
	| 'store';

export type AbsoluteMobileCertificationStrength =
	| 'installed'
	| 'simulator'
	| 'device'
	| 'store';

export type AbsoluteMobileCertificationRelease = {
	appBuild: string;
	appId: string;
	artifactBytes: number;
	artifactSha256: string;
	buildNumber?: number;
	engine: 'capacitor' | 'expo';
	marketingVersion?: string;
	platform: 'android' | 'ios';
	releaseId: string;
	runtime: string;
	signed: true;
	versionCode?: number;
};

export type AbsoluteMobileCertificationEvidence = {
	artifactExactness?:
		| 'archive-equivalent'
		| 'source-equivalent'
		| 'store-delivered';
	distribution?:
		| 'apple-processed'
		| 'registered-device'
		| 'simulator-release';
	generatedAt: string;
	networkUnavailable: 'not-proven' | 'proven';
	remote: boolean;
	reportSha256: string;
	strength: AbsoluteMobileCertificationStrength;
};

export type AbsoluteMobileReleaseCertification = {
	certificationId: string;
	evidence: AbsoluteMobileCertificationEvidence[];
	format: typeof ABSOLUTE_MOBILE_RELEASE_CERTIFICATION_FORMAT;
	generatedAt: string;
	release: AbsoluteMobileCertificationRelease;
	requirement: AbsoluteMobileCertificationRequirement;
	status: 'certified';
	strength: AbsoluteMobileCertificationStrength;
};

export type AbsoluteMobileCertifiableRelease =
	| AbsoluteAndroidRelease
	| AbsoluteIosRelease;

export type CreateAbsoluteMobileReleaseCertificationOptions = {
	evidencePaths: string[];
	generatedAt?: string;
	projectRoot: string;
	release: AbsoluteMobileCertifiableRelease;
	requirement?: AbsoluteMobileCertificationRequirement;
};

export type AbsoluteMobileReleaseCertificationPaths = {
	directory: string;
	jsonPath: string;
	markdownPath: string;
};

const CERTIFICATION_PREFIX = 'amobile_cert_';
const SHA256 = /^[a-f0-9]{64}$/u;
const STRENGTH_RANK: Record<AbsoluteMobileCertificationStrength, number> = {
	device: 1,
	installed: 0,
	simulator: 0,
	store: 2
};

const isRequirement = (
	value: unknown
): value is AbsoluteMobileCertificationRequirement =>
	value === 'installed' ||
	value === 'simulator' ||
	value === 'device' ||
	value === 'store';

const isStrength = (
	value: unknown
): value is AbsoluteMobileCertificationStrength =>
	value === 'installed' ||
	value === 'simulator' ||
	value === 'device' ||
	value === 'store';

const isArtifactExactness = (
	value: unknown
): value is NonNullable<
	AbsoluteMobileCertificationEvidence['artifactExactness']
> =>
	value === 'archive-equivalent' ||
	value === 'source-equivalent' ||
	value === 'store-delivered';

const isDistribution = (
	value: unknown
): value is NonNullable<AbsoluteMobileCertificationEvidence['distribution']> =>
	value === 'apple-processed' ||
	value === 'registered-device' ||
	value === 'simulator-release';

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const inside = (root: string, candidate: string) => {
	const path = relative(resolve(root), resolve(candidate));

	return (
		path === '' ||
		(!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`))
	);
};

const exists = async (path: string) => {
	try {
		await access(path);

		return true;
	} catch {
		return false;
	}
};

const sha256 = (bytes: Uint8Array | string) =>
	createHash('sha256').update(bytes).digest('hex');

const requireString = (value: unknown, name: string) => {
	if (typeof value !== 'string' || !value)
		throw new TypeError(`Mobile certification ${name} is invalid.`);

	return value;
};

const requirePositiveInteger = (value: unknown, name: string) => {
	if (!Number.isSafeInteger(value) || Number(value) < 1)
		throw new TypeError(`Mobile certification ${name} is invalid.`);

	return Number(value);
};

const resolveEvidencePath = async (projectRoot: string, requested: string) => {
	const selected = resolve(projectRoot, requested);
	if (!inside(projectRoot, selected))
		throw new TypeError(
			'Mobile certification evidence must remain inside the project.'
		);
	if (basename(selected) === 'report.json') return selected;
	const report = join(selected, 'report.json');
	if (!(await exists(report)))
		throw new TypeError(
			`Mobile certification evidence does not contain report.json: ${requested}`
		);

	return report;
};

const releaseIdentity = (
	release: AbsoluteMobileCertifiableRelease
): AbsoluteMobileCertificationRelease => {
	const { metadata } = release;
	if (!metadata.signed)
		throw new TypeError(
			'Mobile release certification requires a signed native release.'
		);
	const common: AbsoluteMobileCertificationRelease = {
		appBuild: metadata.appBuild,
		appId: metadata.appId,
		artifactBytes: metadata.bytes,
		artifactSha256: metadata.sha256,
		engine: metadata.engine,
		platform: metadata.platform,
		releaseId: metadata.releaseId,
		runtime: metadata.runtime,
		signed: true as const
	};
	if (metadata.platform === 'android')
		return {
			...common,
			...(metadata.versionCode === undefined
				? {}
				: { versionCode: metadata.versionCode })
		};

	return {
		...common,
		...(metadata.buildNumber === undefined
			? {}
			: { buildNumber: metadata.buildNumber }),
		marketingVersion: metadata.marketingVersion
	};
};

const requireCheck = (
	report: Record<string, unknown>,
	id: string,
	accepted: readonly string[] = ['PASS']
) => {
	const checks = report.automatedChecks;
	if (!Array.isArray(checks))
		throw new TypeError(
			'Mobile certification evidence has invalid automated checks.'
		);
	const check = checks.find(
		(candidate) => isRecord(candidate) && candidate.id === id
	);
	if (!isRecord(check) || !accepted.includes(String(check.result)))
		throw new TypeError(
			`Mobile certification evidence does not satisfy ${id}.`
		);
};

const validateCommonReport = (
	report: Record<string, unknown>,
	release: AbsoluteMobileCertificationRelease
) => {
	if (
		report.reportVersion !== 1 ||
		report.platform !== release.platform ||
		!isRecord(report.metadata) ||
		report.metadata.provider !== release.engine ||
		!isRecord(report.run) ||
		report.run.status !== 'pass' ||
		report.run.appId !== release.appId
	)
		throw new TypeError(
			'Mobile certification evidence does not match the release platform, provider, application, or successful-run contract.'
		);
	requireCheck(report, 'AUTO-DEV-01');

	return {
		generatedAt: requireString(report.generatedAt, 'evidence generatedAt'),
		run: report.run
	};
};

const validateReleaseFields = (
	value: Record<string, unknown>,
	release: AbsoluteMobileCertificationRelease
) => {
	if (
		value.releaseId !== release.releaseId ||
		value.artifactSha256 !== release.artifactSha256 ||
		value.artifactBytes !== release.artifactBytes ||
		value.engine !== release.engine ||
		value.signed !== true
	)
		throw new TypeError(
			'Mobile certification evidence does not match the immutable release identity.'
		);
};

const validateAndroidEvidence = (
	report: Record<string, unknown>,
	run: Record<string, unknown>,
	release: AbsoluteMobileCertificationRelease,
	reportSha256: string,
	generatedAt: string
): AbsoluteMobileCertificationEvidence => {
	if (!isRecord(run.release))
		throw new TypeError(
			'Android certification evidence has no installed release result.'
		);
	validateReleaseFields(run.release, release);
	if (run.release.embeddedOffline !== true)
		throw new TypeError(
			'Android certification evidence did not prove embedded offline relaunch.'
		);
	requireCheck(report, 'AUTO-RELEASE-01');
	requireCheck(report, 'AUTO-RELEASE-OFFLINE-01');

	return {
		generatedAt,
		networkUnavailable: 'proven',
		remote: false,
		reportSha256,
		strength: 'installed'
	};
};

const validateIosEvidence = (
	report: Record<string, unknown>,
	run: Record<string, unknown>,
	release: AbsoluteMobileCertificationRelease,
	reportSha256: string,
	generatedAt: string
): AbsoluteMobileCertificationEvidence => {
	if (!isRecord(run.iosRelease))
		throw new TypeError(
			'iOS certification evidence has no installed release result.'
		);
	const ios = run.iosRelease;
	validateReleaseFields(ios, release);
	if (ios.embeddedLocal !== true)
		throw new TypeError(
			'iOS certification evidence did not prove embedded local rendering.'
		);
	requireCheck(report, 'AUTO-IOS-RELEASE-01');
	let strength: AbsoluteMobileCertificationStrength;
	if (
		ios.distribution === 'simulator-release' &&
		ios.artifactExactness === 'source-equivalent' &&
		run.targetKind === 'simulator' &&
		ios.networkUnavailable === 'not-proven'
	)
		strength = 'simulator';
	else if (
		ios.distribution === 'registered-device' &&
		ios.artifactExactness === 'archive-equivalent' &&
		run.targetKind === 'device' &&
		ios.networkUnavailable === 'user-confirmed'
	)
		strength = 'device';
	else if (
		ios.distribution === 'apple-processed' &&
		ios.artifactExactness === 'store-delivered' &&
		run.targetKind === 'device' &&
		ios.networkUnavailable === 'user-confirmed'
	)
		strength = 'store';
	else
		throw new TypeError(
			'iOS certification evidence contains an invalid target, distribution, exactness, or offline-strength combination.'
		);
	if (strength === 'simulator')
		requireCheck(report, 'AUTO-IOS-RELEASE-OFFLINE-01', ['SKIPPED']);
	else requireCheck(report, 'AUTO-IOS-RELEASE-OFFLINE-01');

	return {
		artifactExactness: ios.artifactExactness,
		distribution: ios.distribution,
		generatedAt,
		networkUnavailable:
			ios.networkUnavailable === 'user-confirmed'
				? 'proven'
				: 'not-proven',
		remote: ios.remote === true,
		reportSha256,
		strength
	};
};

const validateEvidence = async (
	projectRoot: string,
	requested: string,
	release: AbsoluteMobileCertificationRelease
) => {
	const path = await resolveEvidencePath(projectRoot, requested);
	const bytes = await readFile(path);
	let value: unknown;
	try {
		value = JSON.parse(bytes.toString('utf8'));
	} catch {
		throw new TypeError(
			'Mobile certification evidence report is not valid JSON.'
		);
	}
	if (!isRecord(value))
		throw new TypeError(
			'Mobile certification evidence report must contain an object.'
		);
	const { generatedAt, run } = validateCommonReport(value, release);
	const digest = sha256(bytes);

	return release.platform === 'android'
		? validateAndroidEvidence(value, run, release, digest, generatedAt)
		: validateIosEvidence(value, run, release, digest, generatedAt);
};

const defaultRequirement = (platform: 'android' | 'ios') =>
	platform === 'android' ? 'installed' : 'simulator';

const validateRequirement = (
	platform: 'android' | 'ios',
	requirement: AbsoluteMobileCertificationRequirement
) => {
	if (platform === 'android' && requirement !== 'installed')
		throw new TypeError(
			'Android certification currently uses its fixed installed/offline requirement; --require simulator, device, and store are iOS policies.'
		);
	if (platform === 'ios' && requirement === 'installed')
		throw new TypeError(
			'iOS certification requires simulator, device, or store evidence.'
		);
};

const satisfiesRequirement = (
	strength: AbsoluteMobileCertificationStrength,
	requirement: AbsoluteMobileCertificationRequirement
) => {
	if (requirement === 'installed') return strength === 'installed';
	if (strength === 'installed') return false;

	return STRENGTH_RANK[strength] >= STRENGTH_RANK[requirement];
};

const validateCertifiedEvidence = (
	platform: 'android' | 'ios',
	evidence: AbsoluteMobileCertificationEvidence
) => {
	if (platform === 'android') {
		if (
			evidence.strength !== 'installed' ||
			evidence.networkUnavailable !== 'proven' ||
			evidence.artifactExactness !== undefined ||
			evidence.distribution !== undefined ||
			evidence.remote
		)
			throw new TypeError(
				'Android release certification contains invalid evidence strength.'
			);

		return;
	}
	const simulator =
		evidence.strength === 'simulator' &&
		evidence.artifactExactness === 'source-equivalent' &&
		evidence.distribution === 'simulator-release' &&
		evidence.networkUnavailable === 'not-proven';
	const device =
		evidence.strength === 'device' &&
		evidence.artifactExactness === 'archive-equivalent' &&
		evidence.distribution === 'registered-device' &&
		evidence.networkUnavailable === 'proven';
	const store =
		evidence.strength === 'store' &&
		evidence.artifactExactness === 'store-delivered' &&
		evidence.distribution === 'apple-processed' &&
		evidence.networkUnavailable === 'proven';
	if (!simulator && !device && !store)
		throw new TypeError(
			'iOS release certification contains invalid evidence strength.'
		);
};

const canonicalJsonValue = (value: unknown): unknown => {
	if (Array.isArray(value)) return value.map(canonicalJsonValue);
	if (!isRecord(value)) return value;
	const sorted: Record<string, unknown> = {};
	for (const key of Object.keys(value).sort())
		sorted[key] = canonicalJsonValue(value[key]);

	return sorted;
};

const certificationBody = (
	certification: Omit<AbsoluteMobileReleaseCertification, 'certificationId'>
) => JSON.stringify(canonicalJsonValue(certification));

export const createAbsoluteMobileReleaseCertification = async (
	options: CreateAbsoluteMobileReleaseCertificationOptions
): Promise<AbsoluteMobileReleaseCertification> => {
	if (options.evidencePaths.length === 0)
		throw new TypeError(
			'Mobile release certification requires at least one --evidence report.'
		);
	const release = releaseIdentity(options.release);
	const requirement =
		options.requirement ?? defaultRequirement(release.platform);
	validateRequirement(release.platform, requirement);
	const evidence = await Promise.all(
		options.evidencePaths.map((path) =>
			validateEvidence(options.projectRoot, path, release)
		)
	);
	evidence.sort((left, right) =>
		left.reportSha256.localeCompare(right.reportSha256)
	);
	const [firstEvidence] = evidence;
	if (!firstEvidence)
		throw new TypeError(
			'Mobile release certification requires valid evidence.'
		);
	const strength = evidence.reduce<AbsoluteMobileCertificationStrength>(
		(strongest, candidate) =>
			STRENGTH_RANK[candidate.strength] > STRENGTH_RANK[strongest]
				? candidate.strength
				: strongest,
		firstEvidence.strength
	);
	if (!satisfiesRequirement(strength, requirement))
		throw new TypeError(
			`Mobile release evidence strength ${strength} does not satisfy required ${requirement} certification.`
		);
	const body: Omit<AbsoluteMobileReleaseCertification, 'certificationId'> = {
		evidence,
		format: ABSOLUTE_MOBILE_RELEASE_CERTIFICATION_FORMAT,
		generatedAt:
			options.generatedAt ??
			evidence.reduce(
				(latest, candidate) =>
					candidate.generatedAt > latest
						? candidate.generatedAt
						: latest,
				firstEvidence.generatedAt
			),
		release,
		requirement,
		status: 'certified' as const,
		strength
	};

	return {
		certificationId: `${CERTIFICATION_PREFIX}${sha256(certificationBody(body))}`,
		...body
	};
};

const parseCertification = (value: unknown) => {
	if (
		!isRecord(value) ||
		value.format !== ABSOLUTE_MOBILE_RELEASE_CERTIFICATION_FORMAT ||
		value.status !== 'certified' ||
		!isRecord(value.release) ||
		!Array.isArray(value.evidence)
	)
		throw new TypeError(
			'Mobile release certification contract is invalid.'
		);
	const { release } = value;
	const { platform } = release;
	const { engine } = release;
	if (
		(platform !== 'android' && platform !== 'ios') ||
		(engine !== 'capacitor' && engine !== 'expo') ||
		release.signed !== true
	)
		throw new TypeError(
			'Mobile release certification identity is invalid.'
		);
	const { requirement } = value;
	const { strength } = value;
	if (!isRequirement(requirement) || !isStrength(strength))
		throw new TypeError('Mobile release certification policy is invalid.');
	validateRequirement(platform, requirement);
	if (!satisfiesRequirement(strength, requirement))
		throw new TypeError(
			'Mobile release certification does not satisfy its declared policy.'
		);
	const artifactBytes = requirePositiveInteger(
		release.artifactBytes,
		'release artifactBytes'
	);
	const artifactSha256 = requireString(
		release.artifactSha256,
		'release artifactSha256'
	);
	if (!SHA256.test(artifactSha256))
		throw new TypeError(
			'Mobile release certification artifact digest is invalid.'
		);
	const parsedRelease: AbsoluteMobileCertificationRelease = {
		appBuild: requireString(release.appBuild, 'release appBuild'),
		appId: requireString(release.appId, 'release appId'),
		artifactBytes,
		artifactSha256,
		engine,
		platform,
		releaseId: requireString(release.releaseId, 'release releaseId'),
		runtime: requireString(release.runtime, 'release runtime'),
		signed: true,
		...(release.buildNumber === undefined
			? {}
			: {
					buildNumber: requirePositiveInteger(
						release.buildNumber,
						'release buildNumber'
					)
				}),
		...(release.marketingVersion === undefined
			? {}
			: {
					marketingVersion: requireString(
						release.marketingVersion,
						'release marketingVersion'
					)
				}),
		...(release.versionCode === undefined
			? {}
			: {
					versionCode: requirePositiveInteger(
						release.versionCode,
						'release versionCode'
					)
				})
	};
	const evidence = value.evidence.map((candidate) => {
		if (
			!isRecord(candidate) ||
			!SHA256.test(String(candidate.reportSha256)) ||
			!isStrength(candidate.strength) ||
			(candidate.networkUnavailable !== 'not-proven' &&
				candidate.networkUnavailable !== 'proven') ||
			typeof candidate.remote !== 'boolean' ||
			typeof candidate.generatedAt !== 'string' ||
			(candidate.artifactExactness !== undefined &&
				!isArtifactExactness(candidate.artifactExactness)) ||
			(candidate.distribution !== undefined &&
				!isDistribution(candidate.distribution))
		)
			throw new TypeError(
				'Mobile release certification evidence is invalid.'
			);

		const parsedEvidence: AbsoluteMobileCertificationEvidence = {
			generatedAt: candidate.generatedAt,
			networkUnavailable: candidate.networkUnavailable,
			remote: candidate.remote,
			reportSha256: String(candidate.reportSha256),
			strength: candidate.strength,
			...(candidate.artifactExactness === undefined
				? {}
				: {
						artifactExactness: candidate.artifactExactness
					}),
			...(candidate.distribution === undefined
				? {}
				: { distribution: candidate.distribution })
		};
		validateCertifiedEvidence(platform, parsedEvidence);

		return parsedEvidence;
	});
	const strongestEvidence =
		evidence.reduce<AbsoluteMobileCertificationStrength>(
			(strongest, candidate) =>
				STRENGTH_RANK[candidate.strength] > STRENGTH_RANK[strongest]
					? candidate.strength
					: strongest,
			evidence[0]?.strength ?? 'installed'
		);
	if (evidence.length === 0 || strongestEvidence !== strength)
		throw new TypeError(
			'Mobile release certification evidence does not support its declared strength.'
		);
	const parsed: AbsoluteMobileReleaseCertification = {
		certificationId: requireString(
			value.certificationId,
			'certificationId'
		),
		evidence,
		format: ABSOLUTE_MOBILE_RELEASE_CERTIFICATION_FORMAT,
		generatedAt: requireString(value.generatedAt, 'generatedAt'),
		release: parsedRelease,
		requirement,
		status: 'certified' as const,
		strength
	};
	const { certificationId, ...body } = parsed;
	if (
		certificationId !==
		`${CERTIFICATION_PREFIX}${sha256(certificationBody(body))}`
	)
		throw new TypeError(
			'Mobile release certification content digest is invalid.'
		);

	return parsed;
};

export const readAbsoluteMobileReleaseCertification = async (
	projectRoot: string,
	requested: string
) => {
	const selected = resolve(projectRoot, requested);
	if (!inside(projectRoot, selected))
		throw new TypeError(
			'Mobile release certification must remain inside the project.'
		);
	const path =
		basename(selected) === 'certification.json'
			? selected
			: join(selected, 'certification.json');
	const value: unknown = JSON.parse(await readFile(path, 'utf8'));

	return { certification: parseCertification(value), path };
};
export const renderAbsoluteMobileReleaseCertification = (
	certification: AbsoluteMobileReleaseCertification
) => {
	const { release } = certification;
	const version =
		release.platform === 'ios'
			? `${release.marketingVersion ?? 'unknown'} (${release.buildNumber ?? 'unallocated'})`
			: String(release.versionCode ?? 'unallocated');
	const evidence = certification.evidence
		.map(
			(item) =>
				`| ${item.strength} | ${item.networkUnavailable} | ${item.remote ? 'paired Mac' : 'local host'} | ${item.reportSha256} |`
		)
		.join('\n');

	return `# AbsoluteJS mobile release certification

- Status: CERTIFIED
- Certification: ${certification.certificationId}
- Generated: ${certification.generatedAt}
- Platform: ${release.platform}
- Engine: ${release.engine}
- Requirement: ${certification.requirement}
- Evidence strength: ${certification.strength}
- Release: ${release.releaseId}
- Artifact SHA-256: ${release.artifactSha256}
- Runtime fingerprint: ${release.runtime}
- Embedded app build: ${release.appBuild}
- Version/build: ${version}

This certification is local and contains no signing credentials, device identifiers, SSH destinations, report paths, application data, or page contents. Re-run verification against the immutable release before using it as a CI or promotion gate.

| Strength | Network unavailable | Execution | Report SHA-256 |
| --- | --- | --- | --- |
${evidence}
`;
};
export const verifyAbsoluteMobileReleaseCertification = (
	certification: AbsoluteMobileReleaseCertification,
	release: AbsoluteMobileCertifiableRelease,
	requirement?: AbsoluteMobileCertificationRequirement
) => {
	const parsed = parseCertification(certification);
	const expected = releaseIdentity(release);
	if (JSON.stringify(parsed.release) !== JSON.stringify(expected))
		throw new TypeError(
			'Mobile release certification was invalidated by a release identity, artifact, runtime, signing, version, build, or embedded-bundle change.'
		);
	if (requirement) {
		validateRequirement(expected.platform, requirement);
		if (!satisfiesRequirement(parsed.strength, requirement))
			throw new TypeError(
				`Mobile release certification strength ${parsed.strength} does not satisfy required ${requirement} policy.`
			);
	}

	return parsed;
};
export const writeAbsoluteMobileReleaseCertification = async (
	projectRoot: string,
	certification: AbsoluteMobileReleaseCertification,
	outputDirectory?: string
) => {
	const root = resolve(projectRoot);
	const parent = resolve(
		root,
		outputDirectory ??
			join(
				'.absolutejs',
				'mobile',
				'certifications',
				certification.release.platform,
				certification.release.releaseId
			)
	);
	if (!inside(root, parent))
		throw new TypeError(
			'Mobile certification output must remain inside the project.'
		);
	await mkdir(parent, { recursive: true });
	const destination = join(parent, certification.certificationId);
	const paths: AbsoluteMobileReleaseCertificationPaths = {
		directory: destination,
		jsonPath: join(destination, 'certification.json'),
		markdownPath: join(destination, 'certification.md')
	};
	const json = `${JSON.stringify(certification, null, 2)}\n`;
	const markdown = renderAbsoluteMobileReleaseCertification(certification);
	const verifyExisting = async () => {
		const [existingJson, existingMarkdown] = await Promise.all([
			readFile(paths.jsonPath, 'utf8'),
			readFile(paths.markdownPath, 'utf8')
		]);
		if (existingJson !== json || existingMarkdown !== markdown)
			throw new TypeError(
				`Immutable mobile certification ${certification.certificationId} already exists with different content.`
			);
	};
	if (await exists(destination)) {
		await verifyExisting();

		return paths;
	}
	const staging = await mkdtemp(join(parent, '.certification-'));
	try {
		await Promise.all([
			writeFile(join(staging, 'certification.json'), json, {
				flag: 'wx'
			}),
			writeFile(join(staging, 'certification.md'), markdown, {
				flag: 'wx'
			})
		]);
		await rename(staging, destination).catch(async (error) => {
			if (await exists(destination)) return;
			throw error;
		});
	} finally {
		await rm(staging, { force: true, recursive: true });
	}
	await verifyExisting();

	return paths;
};
