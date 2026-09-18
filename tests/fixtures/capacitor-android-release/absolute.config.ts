import { defineConfig } from '@absolutejs/absolute';

export default defineConfig({
	buildDirectory: '.absolutejs/build',
	mobile: {
		appId: 'com.absolutejs.capacitorreleaseacceptance',
		appName: 'AbsoluteJS Capacitor Release Acceptance',
		...(process.env.ABSOLUTE_TEST_ANDROID_BRANDING === '1'
			? {
					branding: {
						android: {
							backgroundColor: '#F1E2D3',
							foreground: '.absolutejs/branding-source/icon.png',
							monochrome: '.absolutejs/branding-source/icon.png'
						},
						icon: '.absolutejs/branding-source/icon.png',
						splash: {
							backgroundColor: '#F1E2D3',
							darkBackgroundColor: '#102030'
						}
					}
				}
			: {}),
		deepLinks: {
			android: {
				sha256CertificateFingerprints: ['AA'.repeat(32)]
			},
			hosts: ['release.absolutejs.test']
		},
		entry: '/',
		nativeProject: { directory: '.absolutejs/mobile' },
		platforms: ['android'],
		server: {
			productionOrigin:
				process.env.ABSOLUTE_TEST_RELEASE_ORIGIN ??
				'https://release.absolutejs.test'
		}
	},
	reactDirectory: 'react'
});
