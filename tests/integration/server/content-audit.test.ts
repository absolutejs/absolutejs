import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
	mkdir,
	mkdtemp,
	readdir,
	rm,
	symlink,
	writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/* `absolute content`, against a server under `absolute start`.
 *
 * The command fetches each page the way a crawler that runs no
 * JavaScript does and says what text it is given. The fixture has one
 * page of each kind such a reader meets: one rendered in full, one not
 * rendered on the server, one whose content is a streamed slot, one
 * that renders nothing until it has fetched in the browser, and a
 * dynamic route nothing enumerates.
 *
 * The CLI and the framework are this checkout's sources: the fixture's
 * tsconfig points the package's names at `src/`. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const CLI_ENTRY = join(repoRoot, 'src', 'cli', 'index.ts');
const fromSource = (path: string) =>
	join(repoRoot, 'src', path).replace(/\\/g, '/');
const PORT = 4652;

const page = (body: string, imports = '') => `${imports}
export default function Page() {
	return (
		<html lang="en">
			<head>
				<meta charSet="utf-8" />
				<title>A title is not the page’s text</title>
			</head>
			<body>
				${body}
				<script>{'var notText = "these words are in a script";'}</script>
			</body>
		</html>
	);
}
`;

const FILES: Record<string, string> = {
	'absolute.config.ts': `import { defineConfig } from '${fromSource('index.ts')}';

export default defineConfig({
	buildDirectory: './build',
	fileRoutes: { output: './routes.gen.ts' },
	llms: { full: true, summary: 'An example site.', title: 'Acme' },
	markdown: true,
	reactDirectory: './react',
	sitemap: { baseUrl: 'https://acme.test' }
});
`,
	'package.json': JSON.stringify({
		name: 'content-audit-fixture',
		type: 'module'
	}),
	// Not rendered on the server at all.
	'react/routes/app.server.ts':
		"export const ssr = false;\n\nexport const load = () => ({ plan: 'pro' });\n\nexport const markdown = ({ data }: { data: { plan: string } }) => '# The app\\n\\nYou are on the ' + data.plan + ' plan.';\n",
	'react/routes/app.tsx': page(
		'<main>an app with eight words of its own</main>'
	),
	'react/routes/blog/[slug].tsx': page('<main>a post</main>'),
	// The heading is rendered; the list is a streamed slot.
	'react/routes/feed.server.ts':
		"export const holes = { latest: async () => '<ul><li>the newest post of them all</li></ul>' };\n",
	'react/routes/feed.tsx': page(
		'<h1>Feed</h1><StreamSlot fallbackHtml="<p>loading</p>" id="latest" />',
		"import { StreamSlot } from '@absolutejs/absolute/react/components';\n"
	),
	'react/routes/index.tsx': page(
		'<main><h1>Acme anvils</h1><p>Made to order &amp; shipped by rail.</p></main>'
	),
	// Renders nothing until it has fetched, which no marker says.
	'react/routes/late.tsx': page(
		'<main>{text}</main>',
		"import { useEffect, useState } from 'react';\n"
	).replace(
		'\treturn (',
		"\tconst [text, setText] = useState('');\n\tuseEffect(() => setText('fetched in the browser'), []);\n\n\treturn ("
	),
	'server.ts': `import { Elysia } from 'elysia';
import { fileRoutes, networking, prepare } from '${fromSource('index.ts')}';
import { routeTree } from './routes.gen';

const { absolutejs, manifest } = await prepare();

export const server = new Elysia()
	.use(absolutejs)
	.use(fileRoutes(routeTree, manifest))
	.get('/ready', () => 'ready')
	.use(networking);
`,
	'tsconfig.json': JSON.stringify({
		compilerOptions: {
			jsx: 'react-jsx',
			paths: {
				'@absolutejs/absolute': [fromSource('index.ts')],
				'@absolutejs/absolute/client': [fromSource('client/index.ts')],
				'@absolutejs/absolute/client/navigation': [
					fromSource('client/navigation.ts')
				],
				'@absolutejs/absolute/react': [fromSource('react/index.ts')],
				'@absolutejs/absolute/react/components': [
					fromSource('react/components/index.ts')
				],
				'@absolutejs/absolute/react/server': [
					fromSource('react/server.ts')
				]
			}
		}
	})
};

let root = '';
let server: ReturnType<typeof Bun.spawn> | undefined;

const linkNodeModules = async (projectRoot: string) => {
	const source = join(repoRoot, 'node_modules');
	const target = join(projectRoot, 'node_modules');
	await mkdir(target, { recursive: true });
	const entries = await readdir(source);
	await Promise.all(
		entries
			.filter((name) => name !== '.bin')
			.map((name) => symlink(join(source, name), join(target, name)))
	);
};

const url = (path: string) => `http://localhost:${PORT}${path}`;

const waitForServer = async (attempt = 0): Promise<void> => {
	if (attempt >= 480) throw new Error('production server did not start');
	const up = await fetch(url('/ready'))
		.then(async (response) => {
			await response.body?.cancel();

			return response.ok;
		})
		.catch(() => false);
	if (up) return;
	await Bun.sleep(250);
	await waitForServer(attempt + 1);
};

beforeAll(async () => {
	root = await mkdtemp(join(tmpdir(), 'absolute-content-audit-'));
	await Promise.all(
		Object.entries(FILES).map(async ([path, contents]) => {
			await mkdir(join(root, path, '..'), { recursive: true });
			await writeFile(join(root, path), contents);
		})
	);
	await linkNodeModules(root);

	server = Bun.spawn(['bun', CLI_ENTRY, 'start', 'server.ts'], {
		cwd: root,
		env: {
			...process.env,
			FORCE_COLOR: '0',
			NODE_ENV: 'production',
			PORT: String(PORT),
			TELEMETRY_OFF: '1'
		},
		stderr: 'inherit',
		stdout: 'inherit'
	});
	await waitForServer();
}, 600_000);

afterAll(async () => {
	server?.kill();
	await server?.exited;
	if (root) await rm(root, { force: true, recursive: true });
});

const run = async (...args: string[]) => {
	const child = Bun.spawn(
		['bun', CLI_ENTRY, 'content', '--url', url(''), ...args],
		{
			cwd: root,
			env: { ...process.env, FORCE_COLOR: '0', TELEMETRY_OFF: '1' },
			stderr: 'pipe',
			stdout: 'pipe'
		}
	);
	const [stdout, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		child.exited
	]);

	return { exitCode, stdout };
};

type Report = {
	checked: { findings: { kind: string }[]; path: string; words: number }[];
	unchecked: { path: string; reason: string }[];
};

const report = async (...args: string[]) => {
	const { exitCode, stdout } = await run('--json', ...args);
	const parsed: Report = JSON.parse(stdout);

	return { exitCode, ...parsed };
};

const kindsAt = (checked: Report['checked'], path: string) =>
	checked
		.find((entry) => entry.path === path)
		?.findings.map((finding) => finding.kind);

describe('absolute content', () => {
	test('reads every page in the sitemap and exits 1 on a finding', async () => {
		const { checked, exitCode } = await report();

		expect(exitCode).toBe(1);
		expect(checked.map((entry) => entry.path)).toEqual([
			'/',
			'/app',
			'/feed',
			'/late'
		]);
	}, 60_000);

	test('counts the words in the HTML, and not a script’s or the title’s', async () => {
		const { checked } = await report();

		// "Acme anvils" and "Made to order & shipped by rail."
		expect(checked.find((entry) => entry.path === '/')?.words).toBe(8);
		expect(kindsAt(checked, '/')).toEqual([]);
	}, 60_000);

	test('says why a page’s text is not in its HTML', async () => {
		const { checked } = await report();

		expect(kindsAt(checked, '/app')).toEqual(['client-only']);
		// "Feed" and the fallback's "loading": the list is in a script.
		expect(checked.find((entry) => entry.path === '/feed')?.words).toBe(2);
		expect(kindsAt(checked, '/feed')).toEqual(['slots']);
		// No marker says this one: it is simply empty.
		expect(kindsAt(checked, '/late')).toEqual(['empty']);
	}, 60_000);

	test('lists the dynamic route it could not check, until given a page of it', async () => {
		const without = await report();

		expect(without.unchecked).toEqual([
			{
				path: '/blog/:slug',
				reason: 'is dynamic and nothing lists its pages: pass one as an argument'
			}
		]);

		const given = await report('/blog/hello');

		expect(given.unchecked).toEqual([]);
		expect(kindsAt(given.checked, '/blog/hello')).toEqual([]);
	}, 60_000);

	test('holds a page to --min-words', async () => {
		const { checked } = await report('--min-words', '20');

		expect(kindsAt(checked, '/')).toEqual(['below-minimum']);
	}, 60_000);

	test('prints a line a page, and what it left out', async () => {
		const { stdout } = await run();

		expect(stdout).toContain(
			'4 pages at http://localhost:4652, read as a crawler that runs no JavaScript:'
		);
		expect(stdout).toMatch(/✓ \/ +8 words/);
		expect(stdout).toMatch(
			/✗ \/app +0 words {2}not rendered on the server \(ssr: false\)/
		);
		expect(stdout).toContain('Not checked:\n  /blog/:slug  is dynamic');
	}, 60_000);
});

/* The same pages as Markdown (`markdown: true`): the text, for a reader
 * that asks for it. */
describe('a page as Markdown', () => {
	const markdownAt = async (path: string, accept?: string) => {
		const response = await fetch(url(path), {
			headers: accept ? { accept } : {}
		});

		return {
			link: response.headers.get('link'),
			status: response.status,
			text: await response.text(),
			type: response.headers.get('content-type')
		};
	};

	test('is at the page’s address with .md after it', async () => {
		const { link, status, text, type } = await markdownAt('/index.md');

		expect(status).toBe(200);
		expect(type).toBe('text/markdown; charset=utf-8');
		expect(link).toBe('</>; rel="canonical"');
		expect(text).toBe(
			'# Acme anvils\n\nMade to order & shipped by rail.\n'
		);
	});

	test('is the page itself for a request that accepts only Markdown', async () => {
		const asked = await markdownAt('/', 'text/markdown');

		expect(asked.type).toBe('text/markdown; charset=utf-8');
		expect(asked.text).toStartWith('# Acme anvils');

		const browser = await markdownAt(
			'/',
			'text/html,application/xhtml+xml,text/markdown;q=0.5'
		);

		expect(browser.type).toContain('text/html');
	});

	/* The audit above counts two words on this page: the list is in a
	 * script. Here the script's swap is done first. */
	test('has a streamed slot’s content, not its fallback', async () => {
		const { text } = await markdownAt('/feed.md');

		expect(text).toBe('# Feed\n\n- the newest post of them all\n');
	});

	test('is headed by the title when the page has no heading', async () => {
		const { text } = await markdownAt('/blog/hello.md');

		expect(text).toBe('# A title is not the page’s text\n\na post\n');
	});

	/* Not rendered on the server, so there is nothing to convert: the
	 * route says what its Markdown is. */
	test('is the route’s own, when its server module exports one', async () => {
		const { text, type } = await markdownAt('/app.md');

		expect(type).toBe('text/markdown; charset=utf-8');
		expect(text).toBe('# The app\n\nYou are on the pro plan.\n');
		expect((await markdownAt('/app', 'text/markdown')).text).toBe(text);
	});

	test('is named by a Link header on the page', async () => {
		const linkOf = async (path: string) =>
			(await fetch(url(path))).headers.get('link') ?? '';

		expect(await linkOf('/feed')).toContain(
			'</feed.md>; rel="alternate"; type="text/markdown"'
		);
		expect(await linkOf('/')).toContain(
			'</index.md>; rel="alternate"; type="text/markdown"'
		);
		expect(await linkOf('/ready')).toBe('');
	});

	test('is not served for an address that is not a page', async () => {
		expect((await markdownAt('/nope.md')).status).toBe(404);
		expect((await markdownAt('/ready.md')).status).toBe(404);
	});
});

/* Every page's text in one file (`llms: { full: true }`), made by the
 * server the first time it is asked for. */
describe('llms-full.txt', () => {
	const fullText = async () => {
		const response = await fetch(url('/llms-full.txt'));

		return {
			status: response.status,
			text: await response.text(),
			type: response.headers.get('content-type')
		};
	};

	test('is every page’s text, each under where it is', async () => {
		const { status, text, type } = await fullText();

		expect(status).toBe(200);
		expect(type).toBe('text/plain; charset=utf-8');
		expect(text).toBe(
			[
				'# Acme\n\n> An example site.',
				'# Acme anvils\n\nSource: https://acme.test/\n\nMade to order & shipped by rail.',
				// Not rendered on the server: the route's own Markdown.
				'# The app\n\nSource: https://acme.test/app\n\nYou are on the pro plan.',
				// The streamed slot's content, not its fallback.
				'# Feed\n\nSource: https://acme.test/feed\n\n- the newest post of them all\n'
			].join('\n\n---\n\n')
		);
	});

	/* `/late` renders nothing on the server: a title and no text. */
	test('leaves out a page that says nothing', async () => {
		expect((await fullText()).text).not.toContain('/late');
	});

	test('is the kept copy the second time', async () => {
		const first = await fullText();
		const started = performance.now();
		const second = await fullText();

		expect(second.text).toBe(first.text);
		expect(performance.now() - started).toBeLessThan(200);
	});

	test('is linked from llms.txt', async () => {
		const text = await (await fetch(url('/llms.txt'))).text();

		expect(text).toContain(
			'## Full text\n\n- [llms-full.txt](https://acme.test/llms-full.txt): The text of every page, in one file.\n\n## Pages'
		);
	});
});
