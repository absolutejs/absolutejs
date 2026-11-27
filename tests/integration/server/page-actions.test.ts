import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	symlink,
	writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openPage } from '../../helpers/browser';

/* A file route's own form action (`export const action` in its server
 * module), under `absolute start`.
 *
 * The action is registered as `POST` on the route's own path, so a page
 * posts to the address it is at. Checked the three ways a form reaches
 * a server: the browser helpers (fetch and JSON), a plain form with no
 * JavaScript (a redirect back, the result in a cookie), and a real
 * browser — and on a pre-rendered page, whose address is otherwise
 * answered from a file.
 *
 * The CLI and the framework are this checkout's sources: the fixture's
 * tsconfig points the package's names at `src/`. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const CLI_ENTRY = join(repoRoot, 'src', 'cli', 'index.ts');
const fromSource = (path: string) =>
	join(repoRoot, 'src', path).replace(/\\/g, '/');
const PORT = 4637;

/* A post and its comments. The form has no `action`: it posts to the
 * page's own address. `data-absolute-action` lets the browser helpers
 * take it over when JavaScript is there. */
const POST_PAGE = `import { useEffect } from 'react';
import { enhanceForms } from '@absolutejs/absolute/client';

type Props = {
	comments: string[];
	error?: string;
	slug: string;
};

export default function Post({ comments, error, slug }: Props) {
	useEffect(() => {
		const stop = enhanceForms();
		Reflect.set(window, '__hydrated', true);

		return stop;
	}, []);

	return (
		<html lang="en">
			<head>
				<title>{slug}</title>
			</head>
			<body>
				<h1 id="slug">{slug}</h1>
				<ul id="comments">
					{comments.map((comment) => (
						<li key={comment}>{comment}</li>
					))}
				</ul>
				<form data-absolute-action="" id="comment-form" method="post">
					<input id="comment" name="comment" type="text" />
					<p data-action-error="comment" id="comment-error">{error}</p>
					<button id="send" type="submit">send</button>
				</form>
			</body>
		</html>
	);
}
`;

const POST_SERVER = `import { t } from 'elysia';
import { defineAction, getActionState } from '@absolutejs/absolute';

const comments = new Map<string, string[]>();

export const load = ({ params }: { params: { slug: string } }) => {
	const state = getActionState('/blog/:slug');

	return {
		comments: comments.get(params.slug) ?? [],
		error: state?.status === 'error' ? state.errors.comment : undefined,
		slug: params.slug
	};
};

export const action = defineAction(
	t.Object({ comment: t.String({ error: 'Say a little more', minLength: 2 }) }),
	({ body, fail, params }) => {
		if (body.comment === 'spam') return fail({ comment: 'No spam' });
		const slug = params.slug ?? '';
		comments.set(slug, [...(comments.get(slug) ?? []), body.comment]);

		return { count: comments.get(slug)?.length ?? 0 };
	}
);
`;

const CONTACT_PAGE = `export default function Contact() {
	return (
		<html lang="en">
			<head>
				<title>Contact</title>
			</head>
			<body>
				<h1 id="contact">contact</h1>
				<form method="post">
					<input name="message" type="text" />
				</form>
			</body>
		</html>
	);
}
`;

const CONTACT_SERVER = `import { t } from 'elysia';
import { defineAction } from '@absolutejs/absolute';

export const action = defineAction(
	t.Object({ message: t.String({ minLength: 1 }) }),
	({ body }) => ({ received: body.message })
);
`;

const FILES: Record<string, string> = {
	'absolute.config.ts': `import { defineConfig } from '${fromSource('index.ts')}';

export default defineConfig({
	buildDirectory: './build',
	fileRoutes: { output: './routes.gen.ts' },
	reactDirectory: './react',
	static: { routes: ['/contact'] }
});
`,
	'package.json': JSON.stringify({
		name: 'page-actions-fixture',
		type: 'module'
	}),
	'react/routes/blog/[slug].server.ts': POST_SERVER,
	'react/routes/blog/[slug].tsx': POST_PAGE,
	// Pre-rendered: its address is answered from a file, for a GET.
	'react/routes/contact.server.ts': CONTACT_SERVER,
	'react/routes/contact.tsx': CONTACT_PAGE,
	'server.ts': `import { Elysia } from 'elysia';
import { fileRoutes, networking, prepare } from '${fromSource('index.ts')}';
import { routeActions, routeTree } from './routes.gen';

const { absolutejs, manifest } = await prepare();

export const server = new Elysia()
	.use(absolutejs)
	.use(fileRoutes(routeTree, manifest))
	.use(routeActions)
	.get('/ready', () => 'ready')
	.use(networking);
`,
	'tsconfig.json': JSON.stringify({
		compilerOptions: {
			jsx: 'react-jsx',
			paths: {
				'@absolutejs/absolute': [fromSource('index.ts')],
				'@absolutejs/absolute/client': [fromSource('client/index.ts')],
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
	root = await mkdtemp(join(tmpdir(), 'absolute-page-actions-'));
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

const origin = `http://localhost:${PORT}`;

/* What the browser helpers send: fetch, and an answer in JSON. */
const postAsHelper = async (path: string, fields: Record<string, string>) => {
	const response = await fetch(url(path), {
		body: new URLSearchParams(fields),
		headers: {
			accept: 'application/json',
			'content-type': 'application/x-www-form-urlencoded',
			origin,
			'x-absolute-action': '1'
		},
		method: 'POST'
	});
	const result: Record<string, unknown> = await response.json();

	return result;
};

/* What a browser with no JavaScript sends: a form post from the page. */
const postAsForm = (path: string, fields: Record<string, string>) =>
	fetch(url(path), {
		body: new URLSearchParams(fields),
		headers: {
			accept: 'text/html',
			'content-type': 'application/x-www-form-urlencoded',
			origin,
			referer: url(path)
		},
		method: 'POST',
		redirect: 'manual'
	});

const pageAt = async (path: string, cookie = '') => {
	const response = await fetch(url(path), {
		headers: { accept: 'text/html', cookie }
	});

	return (await response.text()).replace(/<!-- -->/g, '');
};

describe('the generated route module', () => {
	test('registers each action as a form route on its page’s path', async () => {
		const generated = await readFile(join(root, 'routes.gen.ts'), 'utf8');

		expect(generated).toContain('export const routeActions');
		expect(generated).toContain(".post('/blog/:slug', { form:");
		expect(generated).toContain(".post('/contact', { form:");
	});
});

describe('a page’s own action, posted by the browser helpers', () => {
	test('runs with the route’s params and answers with its result', async () => {
		const result = await postAsHelper('/blog/first', { comment: 'hello' });

		expect(result).toEqual({ data: { count: 1 }, status: 'success' });
		expect(await pageAt('/blog/first')).toContain('<li>hello</li>');
		// Another post's comments are its own.
		expect(await pageAt('/blog/second')).not.toContain('<li>hello</li>');
	});

	test('has its schema enforced, with the schema’s own message', async () => {
		const result = await postAsHelper('/blog/first', { comment: 'x' });

		expect(result).toMatchObject({
			errors: { comment: 'Say a little more' },
			status: 'error'
		});
	});

	test('can fail a field itself', async () => {
		const result = await postAsHelper('/blog/first', { comment: 'spam' });

		expect(result).toMatchObject({
			errors: { comment: 'No spam' },
			status: 'error'
		});
	});
});

describe('a page’s own action, posted by a plain form', () => {
	test('sends the browser back to the page, which shows what went wrong', async () => {
		const response = await postAsForm('/blog/plain', { comment: 'spam' });

		expect(response.status).toBe(303);
		expect(response.headers.get('location')).toBe('/blog/plain');
		const [cookie] = (response.headers.get('set-cookie') ?? '').split(';');
		// The page reads the result under the ROUTE it was posted to,
		// though the address posted to was this post's own.
		expect(await pageAt('/blog/plain', cookie ?? '')).toContain(
			'id="comment-error">No spam<'
		);
	});

	test('and after a success, shows what the action changed', async () => {
		const response = await postAsForm('/blog/plain', {
			comment: 'by form'
		});

		expect(response.status).toBe(303);
		expect(await pageAt('/blog/plain')).toContain('<li>by form</li>');
	});
});

describe('a pre-rendered page’s own action', () => {
	test('is reached by a POST to an address that a GET answers from a file', async () => {
		const page = await fetch(url('/contact'), {
			headers: { accept: 'text/html' }
		});
		const html = await page.text();

		expect(html).toContain('id="contact"');
		expect(await postAsHelper('/contact', { message: 'hi' })).toEqual({
			data: { received: 'hi' },
			status: 'success'
		});
	});
});

describe('a page’s own action, in a browser', () => {
	test('is posted to from the page’s form, and the page shows the result without reloading', async () => {
		const session = await openPage(url('/blog/live'), {
			waitUntil: 'load'
		});
		try {
			const { page: tab } = session;
			await tab.waitForFunction(
				() => Reflect.get(window, '__hydrated') === true,
				undefined,
				{ timeout: 30_000 }
			);
			await tab.evaluate(() => {
				Reflect.set(window, '__sameDocument', true);
			});

			await tab.fill('#comment', 'from a browser');
			await tab.click('#send');
			await tab.waitForFunction(
				() => document.querySelectorAll('#comments li').length === 1,
				undefined,
				{ timeout: 30_000 }
			);

			expect(await tab.locator('#comments li').textContent()).toBe(
				'from a browser'
			);
			expect(
				await tab.evaluate(() => Reflect.get(window, '__sameDocument'))
			).toBe(true);

			// And a refusal is shown beside the field it is about.
			await tab.fill('#comment', 'spam');
			await tab.click('#send');
			await tab.waitForFunction(
				() =>
					document.getElementById('comment-error')?.textContent ===
					'No spam',
				undefined,
				{ timeout: 30_000 }
			);
			expect(await tab.locator('#comments li').count()).toBe(1);
		} finally {
			await session.close();
		}
	}, 120_000);
});
