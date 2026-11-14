import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
	cp,
	mkdir,
	mkdtemp,
	readdir,
	rm,
	symlink,
	writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openPage } from '../../helpers/browser';
import { ensureDistBuild } from '../../helpers/ensureDistBuild';

/* react-router is an optional peer. A React project that links pages with
 * <Link> and enableNavigation() — no client-side routing — must not need it:
 *
 *  - <Link> from `react/components` builds and soft-navigates without
 *    react-router installed;
 *  - <Link> from `react/router` (whose entry also exports the
 *    react-router-based <UniversalRouter>) fails the build with a message
 *    that says to install react-router and why, and names the
 *    react-router-free import, instead of a bare "Could not resolve".
 *
 * Fixtures live in the OS temp directory, not under the repo, because the
 * repo's own node_modules has react-router and would hide the bug. Each
 * links every repo dependency except react-router, plus a copy (not a
 * symlink) of this package's dist, and builds in a child process whose cwd
 * is the fixture. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const fixtures: string[] = [];
const OMITTED = new Set(['.bin', '@absolutejs', 'react-router', 'react-router-dom']);

const createFixture = async (prefix: string) => {
	const root = await mkdtemp(join(tmpdir(), prefix));
	fixtures.push(root);
	const source = join(repoRoot, 'node_modules');
	const target = join(root, 'node_modules');
	const packageRoot = join(target, '@absolutejs', 'absolute');
	await mkdir(packageRoot, { recursive: true });
	const [entries, scoped] = await Promise.all([
		readdir(source),
		readdir(join(source, '@absolutejs'))
	]);
	await Promise.all([
		...entries
			.filter((name) => !OMITTED.has(name))
			.map((name) => symlink(join(source, name), join(target, name))),
		...scoped
			.filter((name) => name !== 'absolute' && !name.startsWith('.'))
			.map((name) =>
				symlink(
					join(source, '@absolutejs', name),
					join(target, '@absolutejs', name)
				)
			),
		cp(join(repoRoot, 'package.json'), join(packageRoot, 'package.json')),
		cp(join(repoRoot, 'dist'), join(packageRoot, 'dist'), {
			dereference: true,
			recursive: true
		})
	]);

	return root;
};

const pageSource = (
	name: string,
	linkImport: string,
	target: string,
	label: string
) => `import { useEffect, useState } from 'react';
import { enableNavigation } from '@absolutejs/absolute/client/navigation';
import { Link } from '${linkImport}';

export const ${name} = () => {
	const [hydrated, setHydrated] = useState(false);
	useEffect(() => {
		enableNavigation();
		setHydrated(true);
	}, []);

	return (
		<html lang="en">
			<head>
				<meta charSet="utf-8" />
				<title>${name}</title>
			</head>
			<body>
				<main id="${name}" data-hydrated={hydrated ? 'true' : 'false'}>
					<Link href="${target}" id="link" prefetch="none">
						${label}
					</Link>
				</main>
			</body>
		</html>
	);
};
`;

const writePages = async (root: string, linkImport: string) => {
	await mkdir(join(root, 'react', 'pages'), { recursive: true });
	await writeFile(
		join(root, 'react', 'pages', 'LinkHome.tsx'),
		pageSource('LinkHome', linkImport, '/other', 'Other')
	);
	await writeFile(
		join(root, 'react', 'pages', 'LinkOther.tsx'),
		pageSource('LinkOther', linkImport, '/', 'Home')
	);
};

const BUILD_CONFIG = "{ reactDirectory: 'react' }";

const buildScript = (mode: string) => `import { build } from ${JSON.stringify(
	join(repoRoot, 'src', 'core', 'build.ts')
)};

const result = await build({
	...${BUILD_CONFIG},
	buildDirectory: 'build-${mode}',
	mode: '${mode}',
	options: { throwOnError: true }
});
console.log(JSON.stringify(result?.manifest ?? {}));
`;

const runBuild = async (root: string, mode: 'development' | 'production') => {
	const scriptPath = join(root, `build-${mode}.ts`);
	await writeFile(scriptPath, buildScript(mode));
	const proc = Bun.spawn(['bun', scriptPath], {
		cwd: root,
		env: { ...process.env, FORCE_COLOR: '0', TELEMETRY_OFF: '1' },
		stderr: 'pipe',
		stdout: 'pipe'
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		proc.exited,
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text()
	]);
	const manifestLine = stdout.trim().split('\n').at(-1) ?? '{}';
	const manifest: Record<string, string> =
		exitCode === 0 ? JSON.parse(manifestLine) : {};

	return { exitCode, manifest, output: `${stdout}\n${stderr}` };
};

/* Serves the production build with the real React page handler, in a child
 * process so the pages resolve `@absolutejs/absolute` from the fixture. */
const SERVER_SCRIPT = `import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { handleReactPageRequest } from ${JSON.stringify(
	join(repoRoot, 'src', 'react', 'pageHandler.ts')
)};
import { LinkHome } from './react/pages/LinkHome';
import { LinkOther } from './react/pages/LinkOther';

const manifest = JSON.parse(process.env.FIXTURE_MANIFEST ?? '{}');
const buildDir = join(process.cwd(), 'build-production');
const server = Bun.serve({
	port: 0,
	fetch: (request) => {
		const { pathname } = new URL(request.url);
		if (pathname === '/') {
			return handleReactPageRequest({ index: manifest.LinkHomeIndex, Page: LinkHome, request });
		}
		if (pathname === '/other') {
			return handleReactPageRequest({ index: manifest.LinkOtherIndex, Page: LinkOther, request });
		}
		const filePath = join(buildDir, pathname);
		if (extname(pathname) === '' || !existsSync(filePath)) {
			return new Response('not found', { status: 404 });
		}

		return new Response(Bun.file(filePath), {
			headers: { 'Content-Type': pathname.endsWith('.js') ? 'text/javascript' : 'text/css' }
		});
	}
});
console.log('LISTENING ' + server.port);
`;

beforeAll(async () => {
	await ensureDistBuild();
}, 600_000);

afterAll(async () => {
	await Promise.all(
		fixtures.map((root) => rm(root, { force: true, recursive: true }))
	);
});

describe('<Link> from react/components without react-router installed', () => {
	let root = '';
	let manifest: Record<string, string> = {};
	let server: ReturnType<typeof Bun.spawn> | undefined;
	let baseUrl = '';

	beforeAll(async () => {
		root = await createFixture('absolute-link-no-router-');
		await writePages(root, '@absolutejs/absolute/react/components');
	});

	afterAll(() => {
		server?.kill();
	});

	test.each(['development', 'production'] as const)(
		'%s build succeeds',
		async (mode) => {
			const result = await runBuild(root, mode);

			expect(result.output).not.toContain('Could not resolve');
			expect(result.exitCode).toBe(0);
			expect(result.manifest.LinkHomeIndex).toBeDefined();
			expect(result.manifest.LinkOtherIndex).toBeDefined();
			if (mode === 'production') manifest = result.manifest;
		},
		120_000
	);

	test('clicking the Link soft-navigates with enableNavigation()', async () => {
		expect(manifest.LinkHomeIndex).toBeDefined();
		await writeFile(join(root, 'server.ts'), SERVER_SCRIPT);
		const proc = Bun.spawn(['bun', join(root, 'server.ts')], {
			cwd: root,
			env: {
				...process.env,
				FIXTURE_MANIFEST: JSON.stringify(manifest),
				NODE_ENV: 'production',
				TELEMETRY_OFF: '1'
			},
			stderr: 'inherit',
			stdout: 'pipe'
		});
		server = proc;
		const reader = proc.stdout.getReader();
		let printed = '';
		while (!printed.includes('\n')) {
			// eslint-disable-next-line no-await-in-loop
			const { done, value } = await reader.read();
			if (done) break;
			printed += new TextDecoder().decode(value);
		}
		const port = printed.match(/LISTENING (\d+)/)?.[1];
		expect(port).toBeDefined();
		baseUrl = `http://localhost:${port}`;

		const session = await openPage(`${baseUrl}/`, { waitUntil: 'load' });
		try {
			const { page } = session;
			const errors: string[] = [];
			const documentLoads: string[] = [];
			page.on('pageerror', (error) => errors.push(error.message));
			page.on('request', (request) => {
				if (request.resourceType() === 'document') {
					documentLoads.push(request.url());
				}
			});
			await page.waitForSelector('#LinkHome[data-hydrated="true"]', {
				timeout: 15_000
			});
			await page.evaluate(() => Reflect.set(window, '__sameDocument', true));

			await page.click('#link');
			await page.waitForSelector('#LinkOther[data-hydrated="true"]', {
				timeout: 15_000
			});

			expect(new URL(page.url()).pathname).toBe('/other');
			expect(
				await page.evaluate(
					() => Reflect.get(window, '__sameDocument') === true
				)
			).toBe(true);
			expect(documentLoads).toEqual([]);
			expect(errors).toEqual([]);
		} finally {
			await session.close();
		}
	}, 60_000);
});

describe('<Link> from react/router without react-router installed', () => {
	let root = '';

	beforeAll(async () => {
		root = await createFixture('absolute-router-link-no-router-');
		await writePages(root, '@absolutejs/absolute/react/router');
	});

	test.each(['development', 'production'] as const)(
		'%s build fails with install advice and the react-router-free import',
		async (mode) => {
			const { exitCode, output } = await runBuild(root, mode);

			expect(exitCode).not.toBe(0);
			expect(output).toContain(
				'"@absolutejs/absolute/react/router" needs the optional peer dependency "react-router"'
			);
			expect(output).toContain('bun add react-router');
			expect(output).toContain(
				"import { Link } from '@absolutejs/absolute/react/components'"
			);
		},
		120_000
	);
});
