import { defineConfig } from '../../../src/utils/defineConfig';
import type { BunBuildConfigOverride } from '../../../types/build';

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
	entry: 'src/backend/server.ts',
	reactDirectory: 'src/react',
	bunBuild: validOverride
});

const validWorkspaceConfig = defineConfig({
	api: {
		entry: 'src/backend/server.ts',
		reactDirectory: 'src/react',
		bunBuild: {
			default: {
				sourcemap: 'linked'
			},
			reactClient: {
				minify: {
					identifiers: false
				}
			}
		}
	},
	worker: {
		command: ['bun', 'run', 'worker.ts'],
		kind: 'command'
	}
});

const invalidTargetOverride: BunBuildConfigOverride = {
	// @ts-expect-error target is owned by Absolute build passes.
	target: 'browser'
};

const invalidOutdirConfig = defineConfig({
	entry: 'src/backend/server.ts',
	reactDirectory: 'src/react',
	bunBuild: {
		reactClient: {
			// @ts-expect-error outdir is owned by Absolute build passes.
			outdir: 'custom'
		}
	}
});

void validSingleServiceConfig;
void validWorkspaceConfig;
void invalidTargetOverride;
void invalidOutdirConfig;
