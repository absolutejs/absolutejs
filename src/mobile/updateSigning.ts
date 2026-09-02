import { createHash, sign, verify } from 'node:crypto';
import {
	cp,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rename,
	rm,
	stat,
	writeFile
} from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import {
	ABSOLUTE_MOBILE_UPDATE_FORMAT,
	absoluteMobileUpdateSigningPayload,
	canonicalizeAbsoluteMobileUpdate,
	parseAbsoluteMobileUpdateManifest,
	type AbsoluteMobileUpdateClassification,
	type AbsoluteMobileUpdateFile,
	type AbsoluteMobileUnsignedUpdateManifest,
	unsignedAbsoluteMobileUpdate
} from './updateProtocol';

export type BuildAbsoluteMobileUpdateOptions = {
	appId: string;
	bundleDirectory: string;
	channel: string;
	classification: AbsoluteMobileUpdateClassification;
	createdAt?: Date;
	keyId: string;
	outputDirectory: string;
	privateKey: string | Buffer;
	runtimeFingerprint: string;
};

const UPDATE_MANIFEST_FILE = 'update.json';
const UPDATE_FILES_DIRECTORY = 'files';

const sha256 = (value: Uint8Array | string) =>
	createHash('sha256').update(value).digest('hex');

const listFiles = async (root: string, directory = root): Promise<string[]> => {
	const entries = await readdir(directory, { withFileTypes: true });
	const paths = await Promise.all(
		entries.map(async (entry) => {
			const path = join(directory, entry.name);
			if (entry.isDirectory()) return listFiles(root, path);
			if (!entry.isFile())
				throw new TypeError(
					'Mobile updates cannot contain links or special files.'
				);

			return [relative(root, path).replaceAll('\\', '/')];
		})
	);

	return paths.flat().sort((left, right) => left.localeCompare(right));
};

const inspectFiles = async (root: string, paths: readonly string[]) =>
	Promise.all(
		paths.map(async (path): Promise<AbsoluteMobileUpdateFile> => {
			const source = join(root, path);
			const [metadata, contents] = await Promise.all([
				stat(source),
				readFile(source)
			]);

			return { bytes: metadata.size, path, sha256: sha256(contents) };
		})
	);

const releaseIdFor = (
	value: Omit<AbsoluteMobileUnsignedUpdateManifest, 'releaseId'>
) => `amu_${sha256(canonicalizeAbsoluteMobileUpdate(value))}`;

export const buildAbsoluteMobileUpdate = async (
	options: BuildAbsoluteMobileUpdateOptions
) => {
	const bundleDirectory = resolve(options.bundleDirectory);
	const outputRoot = resolve(options.outputDirectory);
	if (
		outputRoot === bundleDirectory ||
		outputRoot.startsWith(`${bundleDirectory}/`)
	)
		throw new TypeError(
			'Mobile update output must be outside the embedded bundle.'
		);
	const paths = await listFiles(bundleDirectory);
	const files = await inspectFiles(bundleDirectory, paths);
	const withoutId: Omit<AbsoluteMobileUnsignedUpdateManifest, 'releaseId'> = {
		appId: options.appId,
		channel: options.channel,
		classification: options.classification,
		createdAt: (options.createdAt ?? new Date()).toISOString(),
		files,
		format: ABSOLUTE_MOBILE_UPDATE_FORMAT,
		runtimeFingerprint: options.runtimeFingerprint,
		withinSubmittedPurpose: true as const
	};
	const unsigned: AbsoluteMobileUnsignedUpdateManifest = {
		...withoutId,
		releaseId: releaseIdFor(withoutId)
	};
	const signature = sign(
		'sha256',
		absoluteMobileUpdateSigningPayload(unsigned),
		{ dsaEncoding: 'ieee-p1363', key: options.privateKey }
	);
	const manifest = parseAbsoluteMobileUpdateManifest({
		...unsigned,
		signature: {
			algorithm: 'ecdsa-p256-sha256',
			keyId: options.keyId,
			value: signature.toString('base64')
		}
	});
	await mkdir(outputRoot, { recursive: true });
	const outputDirectory = join(outputRoot, manifest.releaseId);
	const staging = await mkdtemp(join(outputRoot, '.stage-'));
	try {
		await cp(bundleDirectory, join(staging, UPDATE_FILES_DIRECTORY), {
			force: true,
			recursive: true
		});
		await writeFile(
			join(staging, UPDATE_MANIFEST_FILE),
			`${JSON.stringify(manifest, null, '\t')}\n`
		);
		await rename(staging, outputDirectory);
	} catch (error) {
		await rm(staging, { force: true, recursive: true });
		if (
			typeof error === 'object' &&
			error !== null &&
			Reflect.get(error, 'code') === 'EEXIST'
		)
			throw new TypeError(
				`Mobile update ${manifest.releaseId} already exists.`,
				{ cause: error }
			);
		throw error;
	}

	return {
		manifest,
		manifestPath: join(outputDirectory, UPDATE_MANIFEST_FILE),
		outputDirectory
	};
};
export const copyAbsoluteMobileUpdateFile = async (
	updateDirectory: string,
	path: string,
	destination: string
) => {
	const source = resolve(updateDirectory, UPDATE_FILES_DIRECTORY, path);
	const root = resolve(updateDirectory, UPDATE_FILES_DIRECTORY);
	if (!source.startsWith(`${root}/`))
		throw new TypeError('Update file escaped its release.');
	await mkdir(dirname(destination), { recursive: true });
	await cp(source, destination, { force: true });
};
export const readAbsoluteMobileUpdate = async (directory: string) =>
	parseAbsoluteMobileUpdateManifest(
		JSON.parse(
			await readFile(
				join(resolve(directory), UPDATE_MANIFEST_FILE),
				'utf8'
			)
		)
	);
export const verifyAbsoluteMobileUpdateSignature = (
	manifestValue: unknown,
	publicKey: string | Buffer
) => {
	const manifest = parseAbsoluteMobileUpdateManifest(manifestValue);
	const valid = verify(
		'sha256',
		absoluteMobileUpdateSigningPayload(
			unsignedAbsoluteMobileUpdate(manifest)
		),
		{ dsaEncoding: 'ieee-p1363', key: publicKey },
		Buffer.from(manifest.signature.value, 'base64')
	);
	if (!valid)
		throw new TypeError('Mobile update signature verification failed.');

	return manifest;
};
