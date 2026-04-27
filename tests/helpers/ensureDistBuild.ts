import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..');
const TEST_BUILD_BASE = resolve(PROJECT_ROOT, '.test-builds');
const DIST_BUILD_LOCK_DIR = resolve(TEST_BUILD_BASE, 'dist-build.lock');

const DIST_MARKERS = [
	resolve(PROJECT_ROOT, 'dist/index.js'),
	resolve(PROJECT_ROOT, 'dist/react/components/index.js'),
	resolve(PROJECT_ROOT, 'dist/svelte/index.js'),
	resolve(PROJECT_ROOT, 'dist/svelte/components/StreamSlot.svelte'),
	resolve(PROJECT_ROOT, 'dist/vue/index.js'),
	resolve(PROJECT_ROOT, 'dist/angular/index.js')
];

const hasBuiltDist = () => DIST_MARKERS.every((path) => existsSync(path));

const runBuild = async () => {
	const proc = Bun.spawn(['bun', 'run', 'build'], {
		cwd: PROJECT_ROOT,
		env: {
			...process.env,
			FORCE_COLOR: '0',
			TELEMETRY_OFF: '1'
		},
		stderr: 'inherit',
		stdout: 'inherit'
	});
	const exitCode = await proc.exited;
	if (exitCode !== 0) {
		throw new Error(`bun run build exited with code ${exitCode}`);
	}
};

export const ensureDistBuild = async () => {
	await mkdir(TEST_BUILD_BASE, { recursive: true });

	while (true) {
		try {
			await mkdir(DIST_BUILD_LOCK_DIR);
			break;
		} catch (error) {
			if (
				!(error instanceof Error) ||
				!('code' in error) ||
				error.code !== 'EEXIST'
			) {
				throw error;
			}
			await Bun.sleep(250);
		}
	}

	try {
		if (!hasBuiltDist()) {
			await runBuild();
		}
	} finally {
		await rm(DIST_BUILD_LOCK_DIR, { force: true, recursive: true }).catch(
			() => {}
		);
	}
};
