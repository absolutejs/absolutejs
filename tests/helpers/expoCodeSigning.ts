import {
	convertCertificateToCertificatePEM,
	generateKeyPair,
	generateSelfSignedCodeSigningCertificate
} from '@expo/code-signing-certificates';

export const createExpoTestCertificate = () => {
	const keyPair = generateKeyPair();

	return convertCertificateToCertificatePEM(
		generateSelfSignedCodeSigningCertificate({
			commonName: 'AbsoluteJS Test Updates',
			keyPair,
			validityNotAfter: new Date('2036-01-01T00:00:00.000Z'),
			validityNotBefore: new Date('2026-01-01T00:00:00.000Z')
		})
	);
};
