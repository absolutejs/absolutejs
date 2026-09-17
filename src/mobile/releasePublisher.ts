import { access } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AbsoluteAndroidReleaseMetadata } from './androidRelease';
import type { AbsoluteIosReleaseMetadata } from './iosRelease';
import type { AbsoluteMobileCertificationVerification } from './certificationVerification';
import {
	verifyAbsoluteMobileReleaseCertification,
	type AbsoluteMobileCertificationRequirement,
	type AbsoluteMobileReleaseCertification
} from './releaseCertification';

export type AbsoluteGooglePlayReleaseTarget = {
	changesNotSentForReview?: boolean;
	inAppUpdatePriority?: number;
	name?: string;
	releaseNotes?: readonly { language: string; text: string }[];
	reviewBehavior?: 'CANCEL_IN_REVIEW_AND_SUBMIT' | 'ERROR_IF_IN_REVIEW';
	status?: 'completed' | 'draft' | 'halted' | 'inProgress';
	track: string;
	userFraction?: number;
};

export type AbsoluteAppStoreConnectReleaseTarget = {
	groups?: readonly string[];
	submitForReview?: boolean;
	whatsNew?: readonly { locale: string; text: string }[];
};

export type AbsoluteNativeReleasePublication = {
	channel?: {
		channel: string;
		releaseId: string;
	};
	record: {
		metadata: AbsoluteAndroidReleaseMetadata | AbsoluteIosReleaseMetadata;
	};
	reused: boolean;
	certification?: {
		certificationId: string;
		releaseId: string;
		requirement: AbsoluteMobileCertificationRequirement;
		strength: AbsoluteMobileReleaseCertification['strength'];
		provenance?: {
			issuer: string;
			subject: string;
			verifiedAt: string;
			verificationId: string;
		};
	};
	googlePlay?: {
		receipt: {
			intent: { track: string };
			packageName: string;
			provider: 'google-play';
			releaseId: string;
			sha256: string;
			stage: string;
			versionCode?: string;
		};
		reused: boolean;
	};
	appStoreConnect?: {
		receipt: {
			appleAppId: string;
			buildId?: string;
			buildNumber: number;
			intent: { groups: string[]; submitForReview: boolean };
			marketingVersion: string;
			provider: 'app-store-connect';
			releaseId: string;
			sha256: string;
			stage: string;
		};
		reused: boolean;
	};
};

export type AbsoluteNativeReleasePublisher = {
	prepareAndroidRelease?: (options: {
		buildIdentity: string;
		googlePlay?: AbsoluteGooglePlayReleaseTarget;
		packageName: string;
		signal?: AbortSignal;
	}) => Promise<{ versionCode?: number }>;
	prepareIosRelease?: (options: {
		buildIdentity: string;
		bundleId: string;
		marketingVersion: string;
		signal?: AbortSignal;
	}) => Promise<{ buildNumber: number }>;
	publish: (options: {
		allowUnsigned?: boolean;
		appStoreConnect?: AbsoluteAppStoreConnectReleaseTarget;
		channel?: string;
		certification?: AbsoluteMobileReleaseCertification;
		certificationRequirement?: AbsoluteMobileCertificationRequirement;
		certificationVerification?: AbsoluteMobileCertificationVerification;
		googlePlay?: AbsoluteGooglePlayReleaseTarget;
		releaseRoot: string;
		signal?: AbortSignal;
	}) => Promise<AbsoluteNativeReleasePublication>;
};

export const prepareAbsoluteIosRelease = async (
	publisher: AbsoluteNativeReleasePublisher,
	options: {
		buildIdentity: string;
		bundleId: string;
		marketingVersion: string;
		signal?: AbortSignal;
	}
) => {
	if (typeof publisher.prepareIosRelease !== 'function') {
		throw new TypeError(
			'App Store Connect publishing requires a registry module created with @absolutejs/deploy/app-store-connect.'
		);
	}
	const { buildNumber } = await publisher.prepareIosRelease(options);
	if (!Number.isSafeInteger(buildNumber) || buildNumber < 1) {
		throw new TypeError(
			'App Store Connect publisher returned an invalid iOS build number.'
		);
	}

	return buildNumber;
};

type PrepareAbsoluteAndroidReleaseOptions = {
	buildIdentity: string;
	googlePlay: AbsoluteGooglePlayReleaseTarget;
	packageName: string;
	signal?: AbortSignal;
};

export const prepareAbsoluteAndroidRelease = async (
	publisher: AbsoluteNativeReleasePublisher,
	options: PrepareAbsoluteAndroidReleaseOptions
) => {
	if (typeof publisher.prepareAndroidRelease !== 'function') {
		throw new TypeError(
			'Google Play publishing requires a registry module created with @absolutejs/deploy/google-play.'
		);
	}
	const prepared = await publisher.prepareAndroidRelease(options);
	const { versionCode } = prepared;
	if (
		typeof versionCode !== 'number' ||
		!Number.isSafeInteger(versionCode) ||
		versionCode < 1 ||
		versionCode > 2_100_000_000
	) {
		throw new TypeError(
			'Google Play publisher returned an invalid Android versionCode.'
		);
	}

	return versionCode;
};

export type PublishAbsoluteAndroidReleaseOptions = {
	allowUnsigned?: boolean;
	channel?: string;
	certification?: AbsoluteMobileReleaseCertification;
	certificationRequirement?: AbsoluteMobileCertificationRequirement;
	certificationVerification?: AbsoluteMobileCertificationVerification;
	googlePlay?: AbsoluteGooglePlayReleaseTarget;
	modulePath: string;
	projectRoot: string;
	release: {
		metadata: AbsoluteAndroidReleaseMetadata;
		releaseRoot: string;
	};
	signal?: AbortSignal;
};

const requireCertificationReceipt = (
	publication: AbsoluteNativeReleasePublication,
	certification: AbsoluteMobileReleaseCertification | undefined,
	requirement: AbsoluteMobileCertificationRequirement | undefined,
	releaseId: string,
	verification: AbsoluteMobileCertificationVerification | undefined
) => {
	if (!certification && !requirement && !verification) return;
	if (!certification || !requirement)
		throw new TypeError(
			'Native release publication certification contract is incomplete.'
		);
	const receipt = publication.certification;
	if (
		!receipt ||
		receipt.certificationId !== certification.certificationId ||
		receipt.releaseId !== releaseId ||
		receipt.requirement !== requirement ||
		receipt.strength !== certification.strength
	)
		throw new TypeError(
			'Native release registry did not retain the required release certification.'
		);
	if (
		verification &&
		(!receipt.provenance || receipt.provenance.subject !== releaseId)
	)
		throw new TypeError(
			'Native release registry did not retain trusted certification provenance.'
		);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const isPublisher = (value: unknown): value is AbsoluteNativeReleasePublisher =>
	isRecord(value) && typeof value.publish === 'function';

const publisherModulePath = (projectRoot: string, requested: string) => {
	const root = resolve(projectRoot);
	const path = resolve(root, requested);
	const projectRelative = relative(root, path);
	if (
		projectRelative === '..' ||
		projectRelative.startsWith(`..${sep}`) ||
		isAbsolute(projectRelative)
	) {
		throw new TypeError(
			'mobile publish --registry must remain inside the project.'
		);
	}

	return path;
};

export const loadAbsoluteNativeReleasePublisher = async (
	projectRoot: string,
	requestedModulePath: string
) => {
	const modulePath = publisherModulePath(projectRoot, requestedModulePath);
	await access(modulePath).catch(() => {
		throw new TypeError(
			`Native release registry module does not exist: ${modulePath}`
		);
	});
	const loaded: unknown = await import(pathToFileURL(modulePath).href);
	const publisher = isRecord(loaded)
		? (loaded.default ?? loaded.registry)
		: undefined;
	if (!isPublisher(publisher)) {
		throw new TypeError(
			'Native release registry module must default-export a registry with publish(options).'
		);
	}

	return publisher;
};

export const publishAbsoluteAndroidRelease = async (
	options: PublishAbsoluteAndroidReleaseOptions
) => {
	const certificationRequirement =
		options.certificationRequirement ?? options.certification?.requirement;
	if (options.certificationVerification && !options.certification)
		throw new TypeError(
			'Android certification verification requires certification.'
		);
	if (options.certification)
		verifyAbsoluteMobileReleaseCertification(
			options.certification,
			options.release,
			certificationRequirement
		);
	else if (certificationRequirement)
		throw new TypeError(
			`Android release publication requires ${certificationRequirement} certification.`
		);
	const publisher = await loadAbsoluteNativeReleasePublisher(
		options.projectRoot,
		options.modulePath
	);
	const publication = await publisher.publish({
		allowUnsigned: options.allowUnsigned,
		certification: options.certification,
		certificationRequirement,
		certificationVerification: options.certificationVerification,
		channel: options.channel,
		googlePlay: options.googlePlay,
		releaseRoot: options.release.releaseRoot,
		signal: options.signal
	});
	const expected = options.release.metadata;
	const actual = publication.record?.metadata;
	if (
		!actual ||
		actual.appId !== expected.appId ||
		actual.platform !== 'android' ||
		actual.releaseId !== expected.releaseId ||
		actual.sha256 !== expected.sha256 ||
		actual.signed !== expected.signed ||
		actual.versionCode !== expected.versionCode ||
		typeof publication.reused !== 'boolean'
	) {
		throw new TypeError(
			'Native release registry returned a different Android release identity.'
		);
	}
	requireCertificationReceipt(
		publication,
		options.certification,
		certificationRequirement,
		expected.releaseId,
		options.certificationVerification
	);
	if (
		options.channel !== undefined &&
		(publication.channel?.channel !== options.channel ||
			publication.channel.releaseId !== expected.releaseId)
	) {
		throw new TypeError(
			'Native release registry did not promote the requested channel.'
		);
	}
	const { googlePlay } = publication;
	if (options.googlePlay) {
		if (
			!expected.versionCode ||
			!googlePlay ||
			googlePlay.receipt.provider !== 'google-play' ||
			googlePlay.receipt.packageName !== expected.appId ||
			googlePlay.receipt.releaseId !== expected.releaseId ||
			googlePlay.receipt.sha256 !== expected.sha256 ||
			googlePlay.receipt.stage !== 'committed' ||
			googlePlay.receipt.intent.track !== options.googlePlay.track ||
			typeof googlePlay.receipt.versionCode !== 'string' ||
			!/^\d+$/.test(googlePlay.receipt.versionCode) ||
			Number(googlePlay.receipt.versionCode) !== expected.versionCode ||
			typeof googlePlay.reused !== 'boolean'
		) {
			throw new TypeError(
				'Native release publisher did not commit the requested Google Play release.'
			);
		}
	}

	return publication;
};

export const publishAbsoluteIosRelease = async (options: {
	allowUnsigned?: boolean;
	appStoreConnect?: AbsoluteAppStoreConnectReleaseTarget;
	channel?: string;
	certification?: AbsoluteMobileReleaseCertification;
	certificationRequirement?: AbsoluteMobileCertificationRequirement;
	certificationVerification?: AbsoluteMobileCertificationVerification;
	modulePath: string;
	projectRoot: string;
	release: {
		metadata: AbsoluteIosReleaseMetadata;
		releaseRoot: string;
	};
	signal?: AbortSignal;
}) => {
	const certificationRequirement =
		options.certificationRequirement ?? options.certification?.requirement;
	if (options.certificationVerification && !options.certification)
		throw new TypeError(
			'iOS certification verification requires certification.'
		);
	if (options.certification)
		verifyAbsoluteMobileReleaseCertification(
			options.certification,
			options.release,
			certificationRequirement
		);
	else if (certificationRequirement)
		throw new TypeError(
			`iOS release publication requires ${certificationRequirement} certification.`
		);
	const publisher = await loadAbsoluteNativeReleasePublisher(
		options.projectRoot,
		options.modulePath
	);
	const publication = await publisher.publish({
		allowUnsigned: options.allowUnsigned,
		appStoreConnect: options.appStoreConnect,
		certification: options.certification,
		certificationRequirement,
		certificationVerification: options.certificationVerification,
		channel: options.channel,
		releaseRoot: options.release.releaseRoot,
		signal: options.signal
	});
	const expected = options.release.metadata;
	const actual = publication.record?.metadata;
	if (
		!actual ||
		actual.appId !== expected.appId ||
		actual.platform !== 'ios' ||
		actual.releaseId !== expected.releaseId ||
		actual.sha256 !== expected.sha256 ||
		actual.signed !== expected.signed ||
		actual.buildNumber !== expected.buildNumber ||
		actual.marketingVersion !== expected.marketingVersion ||
		typeof publication.reused !== 'boolean'
	) {
		throw new TypeError(
			'Native release registry returned a different iOS release identity.'
		);
	}
	requireCertificationReceipt(
		publication,
		options.certification,
		certificationRequirement,
		expected.releaseId,
		options.certificationVerification
	);
	if (
		options.channel !== undefined &&
		(publication.channel?.channel !== options.channel ||
			publication.channel.releaseId !== expected.releaseId)
	) {
		throw new TypeError(
			'Native release registry did not promote the requested channel.'
		);
	}
	if (options.appStoreConnect) {
		const distributed = publication.appStoreConnect;
		if (
			!expected.buildNumber ||
			!distributed ||
			distributed.receipt.provider !== 'app-store-connect' ||
			distributed.receipt.releaseId !== expected.releaseId ||
			distributed.receipt.sha256 !== expected.sha256 ||
			distributed.receipt.buildNumber !== expected.buildNumber ||
			distributed.receipt.marketingVersion !==
				expected.marketingVersion ||
			!['distributed', 'review-submitted'].includes(
				distributed.receipt.stage
			) ||
			JSON.stringify([...distributed.receipt.intent.groups].sort()) !==
				JSON.stringify(
					[...(options.appStoreConnect.groups ?? [])].sort()
				) ||
			distributed.receipt.intent.submitForReview !==
				(options.appStoreConnect.submitForReview ?? false) ||
			typeof distributed.reused !== 'boolean'
		) {
			throw new TypeError(
				'Native release publisher did not complete the requested App Store Connect release.'
			);
		}
	}

	return publication;
};
