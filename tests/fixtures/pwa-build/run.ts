import { resolve } from 'node:path';
import { build } from '../../../src/core/build';

const [, , buildDirectory] = process.argv;
if (!buildDirectory)
	throw new TypeError('PWA fixture requires an output path.');

await build({
	buildDirectory: resolve(buildDirectory),
	htmlDirectory: 'html',
	mode: 'production',
	options: { throwOnError: true },
	publicDirectory: 'public',
	pwa: {
		manifest: {
			icons: [
				{
					sizes: '512x512',
					src: '/icon.svg',
					type: 'image/svg+xml'
				}
			],
			name: 'PWA Build Fixture',
			shortName: 'PWA Fixture'
		},
		serviceWorker: {
			offline: { fallback: '/offline.html' }
		},
		sync: true
	}
});
