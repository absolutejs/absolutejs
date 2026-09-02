import {
	convertCertificateToCertificatePEM,
	convertKeyPairToPEM,
	generateKeyPair,
	generateSelfSignedCodeSigningCertificate,
	validateSelfSignedCertificate
} from '@expo/code-signing-certificates';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

export type GenerateAbsoluteExpoCodeSigningOptions = {
	certificatePath: string;
	commonName: string;
	privateKeyPath: string;
	projectRoot: string;
	publicKeyPath?: string;
	validityYears?: number;
};

const exists = async (path: string) =>
	access(path)
		.then(() => true)
		.catch(() => false);

const inside = (root: string, path: string) => {
	const location = relative(root, path);

	return (
		location === '' ||
		(location !== '..' &&
			!location.startsWith(`..${sep}`) &&
			!isAbsolute(location))
	);
};

export const generateAbsoluteExpoCodeSigning = async (
	options: GenerateAbsoluteExpoCodeSigningOptions
) => {
	const root = resolve(options.projectRoot);
	const certificatePath = resolve(root, options.certificatePath);
	const privateKeyPath = resolve(root, options.privateKeyPath);
	const publicKeyPath = resolve(
		root,
		options.publicKeyPath ??
			resolve(dirname(privateKeyPath), 'public-key.pem')
	);
	if (!inside(root, certificatePath))
		throw new TypeError(
			'Expo code-signing certificate must be written inside the project so store builds can embed it.'
		);
	if (inside(root, privateKeyPath) || inside(root, publicKeyPath))
		throw new TypeError(
			'Expo code-signing private/public key output must remain outside the project and source control.'
		);
	const commonName = options.commonName.trim();
	if (!commonName || commonName.length > 64)
		throw new TypeError(
			'Expo code-signing common name must contain 1 through 64 characters.'
		);
	const validityYears = options.validityYears ?? 10;
	if (
		!Number.isSafeInteger(validityYears) ||
		validityYears < 1 ||
		validityYears > 20
	)
		throw new TypeError(
			'Expo code-signing validity must be an integer from 1 through 20 years.'
		);
	const collisions = (
		await Promise.all(
			[certificatePath, privateKeyPath, publicKeyPath].map(
				async (path) => ({
					exists: await exists(path),
					path
				})
			)
		)
	).filter((entry) => entry.exists);
	if (collisions.length > 0)
		throw new TypeError(
			`Refusing to overwrite Expo code-signing material: ${collisions.map(({ path }) => path).join(', ')}`
		);

	const keyPair = generateKeyPair();
	const validityNotBefore = new Date(Date.now() - 5 * 60_000);
	const validityNotAfter = new Date(validityNotBefore);
	validityNotAfter.setUTCFullYear(
		validityNotAfter.getUTCFullYear() + validityYears
	);
	const certificate = generateSelfSignedCodeSigningCertificate({
		commonName,
		keyPair,
		validityNotAfter,
		validityNotBefore
	});
	validateSelfSignedCertificate(certificate, keyPair);
	const { privateKeyPEM, publicKeyPEM } = convertKeyPairToPEM(keyPair);
	const certificatePem = convertCertificateToCertificatePEM(certificate);
	await Promise.all(
		[certificatePath, privateKeyPath, publicKeyPath].map((path) =>
			mkdir(dirname(path), { recursive: true })
		)
	);
	await Promise.all([
		writeFile(certificatePath, certificatePem, { flag: 'wx', mode: 0o644 }),
		writeFile(privateKeyPath, privateKeyPEM, { flag: 'wx', mode: 0o600 }),
		writeFile(publicKeyPath, publicKeyPEM, { flag: 'wx', mode: 0o644 })
	]);

	return {
		certificatePath,
		privateKeyPath,
		publicKeyPath,
		validityNotAfter: validityNotAfter.toISOString()
	};
};
