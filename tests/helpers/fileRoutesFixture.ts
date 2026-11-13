import { mkdir, readdir, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

/* A small app that opts into file routes (React + Svelte). Written from
 * strings so the repo typecheck never sees its `@absolutejs/absolute`
 * imports, which resolve to an older published package from the repo root. */

const repoRoot = resolve(import.meta.dir, '..', '..');

const CONFIG = `import { defineConfig } from '@absolutejs/absolute';

export default defineConfig({
	buildDirectory: './build',
	fileRoutes: { output: './routes.gen.ts' },
	reactDirectory: './react',
	svelteDirectory: './svelte'
});
`;

const SERVER = `import { Elysia } from 'elysia';
import { fileRoutes, networking, prepare } from '@absolutejs/absolute';
import { routeTree } from './routes.gen';

const { absolutejs, manifest } = await prepare();

export const server = new Elysia()
	.use(absolutejs)
	.get('/explicit-first', () => 'EXPLICIT_FIRST')
	.use(fileRoutes(routeTree, manifest))
	.get('/about', () => 'EXPLICIT_ABOUT')
	.use(networking);
`;

const reactDocument = (title: string, body: string) => `<html lang="en">
			<head>
				<title>${title}</title>
			</head>
			<body>
				${body}
			</body>
		</html>`;

export const FILE_ROUTES_FIXTURE: Record<string, string> = {
	'absolute.config.ts': CONFIG,
	'package.json': JSON.stringify(
		{ name: 'file-routes-fixture', private: true, type: 'module' },
		null,
		'\t'
	),
	'react/routes/_parts/Shell.tsx': `import type { ReactNode } from 'react';

export const Shell = ({ children }: { children: ReactNode }) => (
	<main id="shell">{children}</main>
);
`,
	'react/routes/about.tsx': `export default function About() {
	return (
		${reactDocument('About', '<p>FILE_ABOUT</p>')}
	);
}
`,
	'react/routes/blog/[slug].server.ts': `import type { FileRouteContext } from '@absolutejs/absolute';

export const beforeHandle = ({ params, redirect }: FileRouteContext<'/blog/:slug'>) =>
	params.slug === 'secret' ? redirect('/') : undefined;

export const load = ({ params, query }: FileRouteContext<'/blog/:slug'>) => ({
	title: \`POST_\${params.slug.toUpperCase()}\`,
	view: query.view ?? 'full'
});
`,
	'react/routes/blog/[slug].tsx': `import { useState } from 'react';
import { Shell } from '../_parts/Shell';

type PostProps = { title: string; view: string; url?: string };

export default function Post({ title, view }: PostProps) {
	const [count, setCount] = useState(0);

	return (
		<html lang="en">
			<head>
				<title>{title}</title>
			</head>
			<body>
				<Shell>
					<h1 id="title">{title}</h1>
					<p id="view">{view}</p>
					<button id="count" onClick={() => setCount(count + 1)}>
						count {count}
					</button>
				</Shell>
			</body>
		</html>
	);
}
`,
	'react/routes/blog/index.tsx': `export default function Blog() {
	return (
		${reactDocument('Blog', '<p>FILE_BLOG_INDEX</p>')}
	);
}
`,
	'react/routes/explicit-first.tsx': `export default function ExplicitFirst() {
	return (
		${reactDocument('Explicit first', '<p>FILE_EXPLICIT_FIRST</p>')}
	);
}
`,
	'react/routes/index.tsx': `export default function Home() {
	return (
		${reactDocument('Home', '<p>FILE_HOME</p>')}
	);
}
`,
	'server.ts': SERVER,
	'svelte/routes/docs/_Badge.svelte': `<script lang="ts">
	let { label }: { label: string } = $props();
</script>

<span class="badge">{label}</span>
`,
	'svelte/routes/docs/[topic].server.ts': `import type { FileRouteContext } from '@absolutejs/absolute';

export const load = ({ params }: FileRouteContext<'/docs/:topic'>) => ({
	topic: \`TOPIC_\${params.topic}\`
});
`,
	'svelte/routes/docs/[topic].svelte': `<script lang="ts">
	import Badge from './_Badge.svelte';

	let { topic }: { topic: string; url?: string } = $props();
	let clicks = $state(0);
</script>

<h1 id="topic">{topic}</h1>
<Badge label="SVELTE_CHILD" />
<button id="clicks" onclick={() => (clicks += 1)}>clicks {clicks}</button>
`,
	'svelte/routes/docs/index.svelte': `<h1>SVELTE_DOCS_INDEX</h1>
`,
	'tsconfig.json': JSON.stringify(
		{
			compilerOptions: {
				esModuleInterop: true,
				jsx: 'react-jsx',
				module: 'ESNext',
				moduleResolution: 'bundler',
				noEmit: true,
				noUncheckedIndexedAccess: true,
				skipLibCheck: true,
				strict: true,
				target: 'ESNext',
				types: ['bun']
			},
			include: ['server.ts', 'routes.gen.ts', 'react', 'svelte']
		},
		null,
		'\t'
	)
};
export const linkNodeModules = async (projectRoot: string) => {
	const source = join(repoRoot, 'node_modules');
	const target = join(projectRoot, 'node_modules');
	await mkdir(join(target, '@absolutejs'), { recursive: true });
	const [entries, scoped] = await Promise.all([
		readdir(source),
		readdir(join(source, '@absolutejs'))
	]);
	await Promise.all([
		...entries
			.filter((name) => name !== '@absolutejs' && name !== '.bin')
			.map((name) => symlink(join(source, name), join(target, name))),
		...scoped
			.filter((name) => name !== 'absolute' && !name.startsWith('.'))
			.map((name) =>
				symlink(
					join(source, '@absolutejs', name),
					join(target, '@absolutejs', name)
				)
			),
		symlink(repoRoot, join(target, '@absolutejs', 'absolute'))
	]);
};
export const writeFileRoutesFixture = async (root: string) => {
	await Promise.all(
		Object.entries(FILE_ROUTES_FIXTURE).map(async ([path, contents]) => {
			const target = join(root, path);
			await mkdir(dirname(target), { recursive: true });
			await writeFile(target, contents);
		})
	);
};
