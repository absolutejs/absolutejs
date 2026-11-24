import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import { build } from '../../../src/core/build';
import { openPage } from '../../helpers/browser';
import { ensureDistBuild } from '../../helpers/ensureDistBuild';

/* A client module (build/clientModules.ts): React code an app builds for a
 * page it does not serve. Built for production, it has a manifest URL, keeps
 * its named exports, carries none of the app's pages, and mounts with the
 * app's React into a page that is not a React page at all. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const fixtureRoot = join(
	repoRoot,
	'.test-builds',
	`react-client-modules-${process.pid}`
);

const PAGE = `export function Home() {
	return (
		<html lang="en">
			<head>
				<title>Home</title>
			</head>
			<body>
				<p data-page="home">home page</p>
			</body>
		</html>
	);
}
`;

const MODULE = `import { useState } from 'react';
import { createRoot } from 'react-dom/client';

const Counter = ({ label }: { label: string }) => {
	const [count, setCount] = useState(0);

	return (
		<button id="embedded" onClick={() => setCount(count + 1)} type="button">
			{label} {count}
		</button>
	);
};

export const moduleName = 'counter';

export const mountCounter = (element: HTMLElement, label: string) => {
	const root = createRoot(element);
	root.render(<Counter label={label} />);

	return () => root.unmount();
};
`;

let stop: (() => void) | undefined;
let origin = '';
let manifest: Record<string, string> = {};

beforeAll(async () => {
	await ensureDistBuild();
	await mkdir(join(fixtureRoot, 'react', 'pages'), { recursive: true });
	await mkdir(join(fixtureRoot, 'react', 'embeds'), { recursive: true });
	await writeFile(join(fixtureRoot, 'react', 'pages', 'Home.tsx'), PAGE);
	await writeFile(
		join(fixtureRoot, 'react', 'embeds', 'Counter.tsx'),
		MODULE
	);
	const rel = (path: string) =>
		relative(process.cwd(), join(fixtureRoot, path));
	const result = await build({
		buildDirectory: rel('build'),
		clientModules: { Counter: rel('react/embeds/Counter.tsx') },
		mode: 'production',
		options: { throwOnError: true },
		reactDirectory: rel('react')
	});
	manifest = result?.manifest ?? {};
	const buildDir = join(fixtureRoot, 'build');
	// Another app's page: plain HTML that imports the module and mounts it.
	const host = `<!doctype html><html><body><div id="host"></div>
<script type="module">
const module = await import(${JSON.stringify(manifest.CounterModule ?? '')});
module.mountCounter(document.getElementById('host'), module.moduleName);
</script></body></html>`;

	const server = Bun.serve({
		port: 0,
		fetch: async (request) => {
			const { pathname } = new URL(request.url);
			if (extname(pathname) === '')
				return new Response(host, {
					headers: { 'Content-Type': 'text/html; charset=utf-8' }
				});
			const filePath = join(buildDir, pathname);
			if (!existsSync(filePath))
				return new Response(null, { status: 404 });

			return new Response(await readFile(filePath, 'utf-8'), {
				headers: { 'Content-Type': 'text/javascript; charset=utf-8' }
			});
		}
	});
	origin = `http://localhost:${server.port}`;
	stop = () => server.stop(true);
}, 300_000);

afterAll(async () => {
	stop?.();
	await rm(fixtureRoot, { force: true, recursive: true });
});

describe('a client module', () => {
	test('has its own manifest URL and carries none of the pages', async () => {
		expect(manifest.CounterModule).toMatch(/CounterModule\.[a-z0-9]+\.js$/);
		const code = await readFile(
			join(fixtureRoot, 'build', manifest.CounterModule ?? ''),
			'utf-8'
		);
		expect(code).not.toContain('data-page');
		// The app's React, not a copy of its own.
		expect(code).toContain('/react/vendor/');
	});

	test("mounts with the app's React in a page that is not a React page", async () => {
		const errors: string[] = [];
		const session = await openPage(`${origin}/`, { waitUntil: 'load' });
		try {
			const { page } = session;
			page.on('pageerror', (error) => errors.push(error.message));
			await page.waitForSelector('#embedded', { timeout: 15_000 });
			expect((await page.textContent('#embedded'))?.trim()).toBe(
				'counter 0'
			);
			await page.click('#embedded');
			await page.click('#embedded');
			expect((await page.textContent('#embedded'))?.trim()).toBe(
				'counter 2'
			);
			expect(errors).toEqual([]);
		} finally {
			await session.close();
		}
	});
});
