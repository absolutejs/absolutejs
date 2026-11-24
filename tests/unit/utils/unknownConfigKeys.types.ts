import { defineConfig } from '../../../src/utils/defineConfig';
import type { BuildConfig } from '../../../types/build';

/* A config key nothing reads is a setting that silently does not happen.
 * `defineConfig` infers its argument, so TypeScript made no
 * excess-property check on it: a misspelt key passed, and so did
 * `astroDirectory`, which was declared, reserved and copied into the
 * production runtime while no adapter ever read it.
 *
 * This file is here and not beside the other config type tests in
 * tests/unit/build because tsconfig excludes every directory named
 * `build`, so nothing in that one is type-checked. */

const removedKeyAnnotated: BuildConfig = {
	// @ts-expect-error there is no Astro adapter to point at a directory.
	astroDirectory: 'src/astro',
	reactDirectory: 'src/react'
};

const removedKey = defineConfig({
	// @ts-expect-error there is no Astro adapter to point at a directory.
	astroDirectory: 'src/astro',
	reactDirectory: 'src/react'
});

const misspeltKey = defineConfig({
	entry: 'src/server.ts',
	// @ts-expect-error "reactDirectroy" is not an AbsoluteJS config key
	reactDirectroy: 'src/react'
});

/* A workspace: each service is held to its own kind's keys. */
const misspeltServiceKey = defineConfig({
	api: {
		entry: 'src/api/server.ts',
		// @ts-expect-error "prot" is not an AbsoluteJS config key
		prot: 3001
	},
	web: {
		entry: 'src/web/server.ts',
		reactDirectory: 'src/web/react'
	}
});

const misspeltCommandServiceKey = defineConfig({
	db: {
		command: ['docker', 'compose', 'up'],
		kind: 'command',
		// @ts-expect-error a command service has no build to give a directory.
		reactDirectory: 'src/react'
	},
	web: { entry: 'src/web/server.ts' }
});

/* And what must keep passing: every real key, on both kinds of service. */
const validSingle = defineConfig({
	buildDirectory: 'build',
	entry: 'src/server.ts',
	port: 3000,
	reactDirectory: 'src/react',
	svelteDirectory: 'src/svelte'
});

const validWorkspace = defineConfig({
	api: { dependsOn: ['db'], entry: 'src/api/server.ts', port: 3001 },
	db: { command: ['docker', 'compose', 'up'], kind: 'command' },
	web: {
		buildDirectory: 'build/web',
		dependsOn: ['api'],
		entry: 'src/web/server.ts',
		reactDirectory: 'src/web/react'
	}
});

/* `validWorkspace` above also pins a bug it found: `web` sets
 * `buildDirectory` and `api` does not, which was reported as two services
 * sharing a build directory. Two that really do are still refused. */
// @ts-expect-error duplicate workspace buildDirectory literal.
const duplicateBuildDirectory = defineConfig({
	api: { buildDirectory: 'build/shared', entry: 'src/api/server.ts' },
	web: { buildDirectory: 'build/shared', entry: 'src/web/server.ts' }
});

const distinctBuildDirectories = defineConfig({
	api: { buildDirectory: 'build/api', entry: 'src/api/server.ts' },
	web: { buildDirectory: 'build/web', entry: 'src/web/server.ts' }
});

void duplicateBuildDirectory;
void distinctBuildDirectories;
void removedKeyAnnotated;
void removedKey;
void misspeltKey;
void misspeltServiceKey;
void misspeltCommandServiceKey;
void validSingle;
void validWorkspace;
