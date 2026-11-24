import { defineConfig } from '../../../src/utils/defineConfig';
import type { BuildConfig, BunBuildConfigOverride } from '../../../types/build';

const validOverride: BunBuildConfigOverride = {
	minify: {
		identifiers: false,
		keepNames: true,
		syntax: true,
		whitespace: true
	},
	naming: {
		asset: 'assets/[name].[ext]',
		chunk: 'chunks/[name].[ext]',
		entry: 'entries/[name].[ext]'
	},
	sourcemap: 'linked'
};

const validSingleServiceConfig = defineConfig({
	bunBuild: validOverride,
	entry: 'src/backend/server.ts',
	pwa: {
		manifest: {
			icons: [{ sizes: 'any', src: '/icon.svg', type: 'image/svg+xml' }],
			name: 'Absolute App',
			shortName: 'Absolute'
		},
		serviceWorker: {
			offline: { fallback: '/offline.html' }
		},
		sync: true
	},
	reactDirectory: 'src/react'
});

const validWorkspaceConfig = defineConfig({
	api: {
		bunBuild: {
			default: {
				sourcemap: 'linked'
			},
			reactClient: {
				minify: {
					identifiers: false
				}
			}
		},
		entry: 'src/backend/server.ts',
		reactDirectory: 'src/react'
	},
	worker: {
		command: ['bun', 'run', 'worker.ts'],
		kind: 'command'
	}
});

const validWorkspaceSharedBuildNames = defineConfig({
	api: {
		buildDirectory: '../api-build',
		entry: 'src/backend/server.ts',
		reactDirectory: 'src/react'
	},
	web: {
		buildDirectory: '../web-build',
		entry: 'src/web/server.ts',
		reactDirectory: 'src/web/react'
	}
});

// @ts-expect-error duplicate workspace buildDirectory literal.
const invalidWorkspaceDuplicateBuildDirectory = defineConfig({
	api: {
		buildDirectory: '../shared-build',
		entry: 'src/backend/server.ts',
		reactDirectory: 'src/react'
	},
	web: {
		buildDirectory: '../shared-build',
		entry: 'src/web/server.ts',
		reactDirectory: 'src/web/react'
	}
});

const invalidTargetOverride: BunBuildConfigOverride = {
	// @ts-expect-error target is owned by Absolute build passes.
	target: 'browser'
};

/* Typed as `BuildConfig`, not passed to `defineConfig`: `defineConfig`
 * infers its argument, so it sees unknown keys at the top level only and
 * a nested one like this passes it. This pin was written against
 * `defineConfig` and never held; nobody knew, because nothing in this
 * directory was type-checked. The build drops the key either way. */
const invalidOutdirConfig: BuildConfig = {
	bunBuild: {
		reactClient: {
			// @ts-expect-error outdir is owned by Absolute build passes.
			outdir: 'custom'
		}
	},
	entry: 'src/backend/server.ts',
	reactDirectory: 'src/react'
};

void validSingleServiceConfig;
void validWorkspaceConfig;
void validWorkspaceSharedBuildNames;
void invalidWorkspaceDuplicateBuildDirectory;
void invalidTargetOverride;
void invalidOutdirConfig;
