import { createHash } from 'node:crypto';

export type AbsoluteMobileUpdateRequestIdentity = {
	appId: string;
	channel: string;
	currentReleaseId: string;
	installationId: string;
	runtimeFingerprint: string;
};

export type AbsoluteMobileUpdateRolloutOptions = {
	appId: string;
	channel: string;
	installationId: string;
	releaseId: string;
	rollout: number;
};

const UUID_PATTERN =
	/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;

const requireHeader = (headers: Headers, name: string) => {
	const value = headers.get(name);
	if (!value)
		throw new TypeError(`Mobile update request is missing ${name}.`);

	return value;
};

export const isAbsoluteMobileUpdateRolloutMember = (
	options: AbsoluteMobileUpdateRolloutOptions
) => {
	if (
		!Number.isFinite(options.rollout) ||
		options.rollout < 0 ||
		options.rollout > 1
	)
		throw new TypeError('Mobile update rollout must be between 0 and 1.');
	if (options.rollout === 0) return false;
	if (options.rollout === 1) return true;
	const digest = createHash('sha256')
		.update(
			`${options.appId}\0${options.channel}\0${options.releaseId}\0${options.installationId}`
		)
		.digest();
	const bucket = digest.readUInt32BE(0) / 0x1_0000_0000;

	return bucket < options.rollout;
};
export const parseAbsoluteMobileUpdateRequest = (request: Request) => {
	const identity: AbsoluteMobileUpdateRequestIdentity = {
		appId: requireHeader(request.headers, 'x-absolute-mobile-app'),
		channel: requireHeader(request.headers, 'x-absolute-mobile-channel'),
		currentReleaseId: requireHeader(
			request.headers,
			'x-absolute-mobile-release'
		),
		installationId: requireHeader(
			request.headers,
			'x-absolute-mobile-installation'
		),
		runtimeFingerprint: requireHeader(
			request.headers,
			'x-absolute-mobile-runtime'
		)
	};
	if (!UUID_PATTERN.test(identity.installationId))
		throw new TypeError('Mobile update installation identity is invalid.');
	if (!/^[a-f0-9]{64}$/u.test(identity.runtimeFingerprint))
		throw new TypeError('Mobile update runtime identity is invalid.');

	return identity;
};
