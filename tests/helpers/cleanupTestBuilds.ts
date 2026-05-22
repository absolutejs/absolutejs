import { afterAll } from 'bun:test';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';

// Integration tests stage real production builds under <root>/.test-builds
// because build output must live inside PROJECT_ROOT to satisfy validateSafePath.
// Each test removes its own mkdtemp subdir, but the base dir — plus anything a
// crashed test left behind — would otherwise linger. Loaded as a bun:test
// preload so this runs once after the whole run, keeping no test output around.
const TEST_BUILD_BASE = resolve(import.meta.dir, '..', '..', '.test-builds');

afterAll(() =>
	rm(TEST_BUILD_BASE, { force: true, recursive: true }).catch(() => {})
);
