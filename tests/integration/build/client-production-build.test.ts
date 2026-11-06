import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { build } from '../../../src/core/build';

const tempDirs: string[] = [];
const testBuildRoot = join(
	resolve(import.meta.dir, '..', '..', '..'),
	'.test-builds'
);

afterEach(async () => {
	for (const dir of tempDirs.splice(0)) {
		await rm(dir, { force: true, recursive: true });
	}
});

const CHOOSES_A_BUILD = `export const whichBuild = () =>
	process.env.NODE_ENV === 'production' ? 'BUILD-IS-PRODUCTION' : 'BUILD-IS-DEVELOPMENT';
`;

const clientJavaScript = async (root: string) => {
	const files = await readdir(root, { recursive: true });
	const sources = await Promise.all(
		files
			.filter((file) => file.endsWith('.js') && !file.includes('vendor'))
			.map((file) => readFile(join(root, file), 'utf8'))
	);

	return sources.join('\n');
};

describe('production client bundles', () => {
	test('packages choose their production build, in pages and in workers', async () => {
		await mkdir(testBuildRoot, { recursive: true });
		const fixtureRoot = await mkdtemp(
			join(testBuildRoot, 'absolute-production-define-')
		);
		tempDirs.push(fixtureRoot);
		const reactRoot = join(fixtureRoot, 'react');
		const buildRoot = join(fixtureRoot, 'build');
		await mkdir(join(reactRoot, 'client'), { recursive: true });
		await mkdir(join(reactRoot, 'pages'), { recursive: true });
		await writeFile(join(reactRoot, 'client', 'chooses.ts'), CHOOSES_A_BUILD);
		await writeFile(
			join(reactRoot, 'client', 'featureWorker.ts'),
			`import { whichBuild } from './chooses';
self.postMessage(whichBuild());`
		);
		await writeFile(
			join(reactRoot, 'pages', 'home.tsx'),
			`import { whichBuild } from '../client/chooses';
export function Home() {
	new Worker(new URL('../client/featureWorker.ts', import.meta.url));
	return <div>{whichBuild()}</div>;
}`
		);

		await build({
			buildDirectory: buildRoot,
			cwd: fixtureRoot,
			mode: 'production',
			options: { throwOnError: true },
			reactDirectory: reactRoot
		});
		const javaScript = await clientJavaScript(buildRoot);

		expect(javaScript).toContain('BUILD-IS-PRODUCTION');
		expect(javaScript).not.toContain('BUILD-IS-DEVELOPMENT');
	});
});
