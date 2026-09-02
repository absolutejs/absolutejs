export const ABSOLUTE_MOBILE_UPDATE_FORMAT = 1 as const;
export const ABSOLUTE_MOBILE_UPDATE_MAX_FILE_BYTES = 32 * 1024 * 1024;
export const ABSOLUTE_MOBILE_UPDATE_MAX_FILES = 10_000;
export const ABSOLUTE_MOBILE_UPDATE_MAX_TOTAL_BYTES = 128 * 1024 * 1024;
export const ABSOLUTE_MOBILE_UPDATE_SIGNATURE_ALGORITHM =
	'ecdsa-p256-sha256' as const;

export type AbsoluteMobileUpdateClassification =
	| 'bug-fix'
	| 'content'
	| 'security';

export type AbsoluteMobileUpdateFile = {
	bytes: number;
	path: string;
	sha256: string;
};

export type AbsoluteMobileUnsignedUpdateManifest = {
	appId: string;
	channel: string;
	classification: AbsoluteMobileUpdateClassification;
	createdAt: string;
	files: AbsoluteMobileUpdateFile[];
	format: typeof ABSOLUTE_MOBILE_UPDATE_FORMAT;
	/** A content identity for the complete update, excluding its signature. */
	releaseId: string;
	/** Locks an update to the native plugins, bridge, Auth, and local-data ABI. */
	runtimeFingerprint: string;
	/** Store-policy attestation. Feature/primary-purpose changes require a store build. */
	withinSubmittedPurpose: true;
};

export type AbsoluteMobileUpdateManifest =
	AbsoluteMobileUnsignedUpdateManifest & {
		signature: {
			algorithm: typeof ABSOLUTE_MOBILE_UPDATE_SIGNATURE_ALGORITHM;
			keyId: string;
			value: string;
		};
	};

const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const RELEASE_PATTERN = /^amu_[a-f0-9]{64}$/u;
const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const CHANNEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const isClassification = (
	value: unknown
): value is AbsoluteMobileUpdateClassification =>
	value === 'bug-fix' || value === 'content' || value === 'security';

const object = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const canonicalValue = (value: unknown): unknown => {
	if (Array.isArray(value)) return value.map(canonicalValue);
	if (!object(value)) return value;

	return Object.fromEntries(
		Object.keys(value)
			.sort()
			.map((key) => [key, canonicalValue(value[key])])
	);
};

export const absoluteMobileUpdateSigningPayload = (
	manifest: AbsoluteMobileUnsignedUpdateManifest
) => new TextEncoder().encode(canonicalizeAbsoluteMobileUpdate(manifest));
export const canonicalizeAbsoluteMobileUpdate = (value: unknown) =>
	JSON.stringify(canonicalValue(value));

const requireText = (value: unknown, field: string) => {
	if (typeof value !== 'string' || value.length === 0)
		throw new TypeError(`${field} must be a non-empty string.`);

	return value;
};

export const normalizeAbsoluteMobileUpdatePath = (value: unknown) => {
	const path = requireText(value, 'Update file path').replaceAll('\\', '/');
	if (
		path.startsWith('/') ||
		path.includes('\0') ||
		path
			.split('/')
			.some((segment) => !segment || segment === '.' || segment === '..')
	) {
		throw new TypeError(
			'Update file paths must be normalized relative paths.'
		);
	}

	return path;
};

const parseFile = (value: unknown): AbsoluteMobileUpdateFile => {
	if (!object(value)) throw new TypeError('Update files must be objects.');
	const path = normalizeAbsoluteMobileUpdatePath(value.path);
	if (
		typeof value.bytes !== 'number' ||
		!Number.isSafeInteger(value.bytes) ||
		value.bytes < 0 ||
		value.bytes > ABSOLUTE_MOBILE_UPDATE_MAX_FILE_BYTES
	) {
		throw new TypeError(`Update file ${path} has an invalid byte length.`);
	}
	if (typeof value.sha256 !== 'string' || !HASH_PATTERN.test(value.sha256))
		throw new TypeError(
			`Update file ${path} has an invalid SHA-256 digest.`
		);

	return { bytes: value.bytes, path, sha256: value.sha256 };
};

export const parseAbsoluteMobileUnsignedUpdateManifest = (
	value: unknown
): AbsoluteMobileUnsignedUpdateManifest => {
	if (!object(value) || value.format !== ABSOLUTE_MOBILE_UPDATE_FORMAT)
		throw new TypeError('Invalid AbsoluteJS mobile update manifest.');
	const appId = requireText(value.appId, 'Update appId');
	const channel = requireText(value.channel, 'Update channel');
	if (!CHANNEL_PATTERN.test(channel))
		throw new TypeError('Update channel contains unsupported characters.');
	if (!isClassification(value.classification))
		throw new TypeError('Update classification is invalid.');
	const createdAt = requireText(value.createdAt, 'Update createdAt');
	if (
		!Number.isFinite(Date.parse(createdAt)) ||
		new Date(createdAt).toISOString() !== createdAt
	)
		throw new TypeError(
			'Update createdAt must be a canonical ISO timestamp.'
		);
	if (!Array.isArray(value.files) || value.files.length === 0)
		throw new TypeError('An update must contain at least one file.');
	if (value.files.length > ABSOLUTE_MOBILE_UPDATE_MAX_FILES)
		throw new TypeError('Update contains too many files.');
	const files = value.files.map(parseFile);
	const sorted = [...files].sort((left, right) =>
		left.path.localeCompare(right.path)
	);
	if (files.some((file, index) => file.path !== sorted[index]?.path))
		throw new TypeError('Update files must be sorted by path.');
	if (new Set(files.map(({ path }) => path)).size !== files.length)
		throw new TypeError('Update file paths must be unique.');
	if (
		files.reduce((total, file) => total + file.bytes, 0) >
		ABSOLUTE_MOBILE_UPDATE_MAX_TOTAL_BYTES
	)
		throw new TypeError('Update exceeds the maximum uncompressed size.');
	if (
		typeof value.releaseId !== 'string' ||
		!RELEASE_PATTERN.test(value.releaseId)
	)
		throw new TypeError('Update releaseId is invalid.');
	if (
		typeof value.runtimeFingerprint !== 'string' ||
		!HASH_PATTERN.test(value.runtimeFingerprint)
	)
		throw new TypeError('Update runtime fingerprint is invalid.');
	if (value.withinSubmittedPurpose !== true)
		throw new TypeError(
			'OTA updates must attest that they remain within the submitted app purpose.'
		);

	return {
		appId,
		channel,
		classification: value.classification,
		createdAt,
		files,
		format: ABSOLUTE_MOBILE_UPDATE_FORMAT,
		releaseId: value.releaseId,
		runtimeFingerprint: value.runtimeFingerprint,
		withinSubmittedPurpose: true
	};
};

export const parseAbsoluteMobileUpdateManifest = (
	value: unknown
): AbsoluteMobileUpdateManifest => {
	if (!object(value))
		throw new TypeError('Invalid AbsoluteJS mobile update manifest.');
	const { signature: signatureValue, ...unsignedValue } = value;
	const unsigned = parseAbsoluteMobileUnsignedUpdateManifest(unsignedValue);
	if (!object(signatureValue))
		throw new TypeError('Update signature is missing.');
	if (signatureValue.algorithm !== ABSOLUTE_MOBILE_UPDATE_SIGNATURE_ALGORITHM)
		throw new TypeError('Update signature algorithm is unsupported.');
	const keyId = requireText(signatureValue.keyId, 'Update signature keyId');
	if (!KEY_ID_PATTERN.test(keyId))
		throw new TypeError('Update signature keyId is invalid.');
	const signature = requireText(
		signatureValue.value,
		'Update signature value'
	);
	let signatureBytes: Uint8Array;
	try {
		signatureBytes = Uint8Array.from(atob(signature), (character) =>
			character.charCodeAt(0)
		);
	} catch {
		signatureBytes = new Uint8Array();
	}
	if (
		!/^[A-Za-z0-9+/]+={0,2}$/u.test(signature) ||
		signatureBytes.byteLength !== 64 ||
		btoa(String.fromCharCode(...signatureBytes)) !== signature
	)
		throw new TypeError('Update signature is not canonical base64.');

	return {
		...unsigned,
		signature: {
			algorithm: ABSOLUTE_MOBILE_UPDATE_SIGNATURE_ALGORITHM,
			keyId,
			value: signature
		}
	};
};

export const unsignedAbsoluteMobileUpdate = (
	manifest: AbsoluteMobileUpdateManifest
) => {
	const { signature: _signature, ...unsigned } = manifest;

	return unsigned;
};
