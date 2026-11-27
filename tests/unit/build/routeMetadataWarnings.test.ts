import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { BuildConfig } from '../../../types/build';
import { scanFileRoutes } from '../../../src/build/fileRoutes';
import { routeMetadataWarnings } from '../../../src/build/routeMetadataWarnings';

/* Which pages the build names for rendering a <title> their route's
 * `metadata` also sets. The document is sent with the route's, and a
 * page that renders one puts its own back once it hydrates — which the
 * server cannot prevent and the developer can, by deleting a line. */

const REPO_ROOT = resolve(import.meta.dir, '../../..');
const WITH_TITLE =
	'export default function Page() {\n\treturn <html><head><title>Mine</title></head><body /></html>;\n}\n';
const WITHOUT_TITLE =
	'export default function Page() {\n\treturn <html><head /><body><h1>title case</h1></body></html>;\n}\n';
const METADATA = "export const metadata = { title: 'From the route' };\n";

const FILES: Record<string, string> = {
	// Its own server module sets metadata.
	'react/routes/about.server.ts': METADATA,
	'react/routes/about.tsx': WITH_TITLE,
	// Nothing sets metadata for it: its title is its own business.
	'react/routes/alone.server.ts': 'export const load = () => ({});\n',
	'react/routes/alone.tsx': WITH_TITLE,
	// A folder above it sets metadata.
	'react/routes/blog/layout.server.ts': METADATA,
	'react/routes/blog/post.tsx': WITH_TITLE,
	// Under the same folder, and leaves its head to the route.
	'react/routes/blog/tidy.tsx': WITHOUT_TITLE,
	'svelte/routes/docs/intro.server.ts':
		'export const metadata = () => ({ title: "Docs" });\n',
	'svelte/routes/docs/intro.svelte':
		'<svelte:head><title>Mine</title></svelte:head>\n<main>docs</main>\n'
};

const CONFIG: BuildConfig = {
	fileRoutes: true,
	reactDirectory: 'react',
	svelteDirectory: 'svelte'
};

let project = '';

beforeAll(async () => {
	const parent = join(REPO_ROOT, '.test-builds');
	await mkdir(parent, { recursive: true });
	project = await mkdtemp(join(parent, 'route-metadata-warnings-'));
	await Promise.all(
		Object.entries(FILES).map(([path, contents]) =>
			Bun.write(join(project, path), contents)
		)
	);
	scanFileRoutes(CONFIG, project);
});

afterAll(async () => {
	// Leave the process-wide registry empty for the next test file.
	scanFileRoutes({});
	await rm(project, { force: true, recursive: true });
});

const named = (file: string) =>
	routeMetadataWarnings().some((message) => message.includes(file));

describe('a page that renders its own title', () => {
	test('is named when its route sets metadata', () => {
		expect(named('routes/about.tsx')).toBe(true);
	});

	test('is named when a folder above it does', () => {
		expect(named('routes/blog/post.tsx')).toBe(true);
	});

	test('is named in Svelte too, where the title is in <svelte:head>', () => {
		expect(named('routes/docs/intro.svelte')).toBe(true);
	});

	test('is not named when nothing sets metadata for it', () => {
		expect(named('routes/alone.tsx')).toBe(false);
	});
});

describe('a page that leaves its head to the route', () => {
	/* "title" in its text is not a <title> in its markup. */
	test('is not named', () => {
		expect(named('routes/blog/tidy.tsx')).toBe(false);
	});
});

describe('the message', () => {
	test('says what happens and what to do, once per page', () => {
		const messages = routeMetadataWarnings().filter((message) =>
			message.includes('routes/about.tsx')
		);

		expect(messages).toHaveLength(1);
		expect(messages[0]).toContain('puts its own back once it hydrates');
		expect(messages[0]).toContain('Remove the <title> from the page');
	});
});
