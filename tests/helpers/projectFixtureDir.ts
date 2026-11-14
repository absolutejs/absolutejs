import { mkdir, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';

/* A fixture directory inside the project root (under `.test-builds`, which
 * the test preload removes after the run). Vue mirrors a source file that
 * shares only the filesystem root with the project — any tmpdir fixture —
 * into a hashed directory per source directory, so tests that assert the
 * generated layout keep their fixtures inside the project instead. */
export const projectFixtureDir = async (prefix: string) => {
	const base = join(process.cwd(), '.test-builds');
	await mkdir(base, { recursive: true });

	return mkdtemp(join(base, prefix));
};
