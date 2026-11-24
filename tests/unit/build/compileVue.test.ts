import { rm, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { describe, expect, test } from 'bun:test';
import { createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { clearVueHmrCaches, compileVue } from '../../../src/build/compileVue';
import { projectFixtureDir } from '../../helpers/projectFixtureDir';

const writeTempFile = async (path: string, content: string) => {
	await Bun.write(path, content);
};

describe('compileVue', () => {
	test('resolves prop types re-exported from a directory index', async () => {
		const root = await mkdtemp(join(tmpdir(), 'absolutejs-compile-vue-'));
		const pagePath = join(root, 'StatusPage.vue');

		try {
			await Promise.all([
				writeTempFile(
					pagePath,
					`<script setup lang="ts">
import type { Status } from './types';
defineProps<{ status: Status }>();
</script>

<template><p>{{ status }}</p></template>`
				),
				// Like a package's index.d.ts: `export * from './status'`
				// names a directory, which resolves to its index file.
				writeTempFile(join(root, 'types.ts'), "export * from './status';\n"),
				writeTempFile(
					join(root, 'status', 'index.ts'),
					"export type Status = 'on' | 'off';\n"
				)
			]);

			const { vueClientPaths } = await compileVue([pagePath], root, false);
			expect(
				vueClientPaths.some((path) => path.endsWith('StatusPage.js'))
			).toBe(true);
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	});

	test('copies helpers that are only re-exported (export { } from, export * from)', async () => {
		const root = await projectFixtureDir('compile-vue-');
		const pagePath = join(root, 'SignalsPage.vue');

		try {
			await Promise.all([
				writeTempFile(
					pagePath,
					`<script setup lang="ts">
import { level, shout } from './utils/signals';
const label = shout(level(2));
</script>

<template><p>{{ label }}</p></template>`
				),
				writeTempFile(
					join(root, 'utils', 'signals.ts'),
					"export { level } from './level';\nexport * from './shout';\n"
				),
				writeTempFile(
					join(root, 'utils', 'level.ts'),
					'export const level = (value: number) => `level ${value}`;\n'
				),
				writeTempFile(
					join(root, 'utils', 'shout.ts'),
					'export const shout = (text: string) => text.toUpperCase();\n'
				)
			]);

			const { vueClientPaths, vueServerPaths } = await compileVue(
				[pagePath],
				root,
				false
			);
			for (const paths of [vueClientPaths, vueServerPaths]) {
				const entry = paths.find((path) => path.endsWith('SignalsPage.js'));
				expect(entry).toBeDefined();
				if (!entry) continue;
				for (const helper of ['signals.js', 'level.js', 'shout.js'])
					expect(
						await Bun.file(join(entry, '..', 'utils', helper)).exists()
					).toBe(true);
			}
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	});

	test('compiles Vue components referenced only by literal dynamic imports', async () => {
		const root = await projectFixtureDir('compile-vue-');
		const pagePath = join(root, 'LazyPage.vue');
		const childPath = join(root, 'components', 'LazyPanel.vue');

		try {
			await Promise.all([
				writeTempFile(
					pagePath,
					`<script setup lang="ts">
import { defineAsyncComponent } from 'vue';

const LazyPanel = defineAsyncComponent(
  () => import('./components/LazyPanel.vue'),
);
</script>

<template><LazyPanel /></template>`
				),
				writeTempFile(
					childPath,
					'<template><aside>Loaded lazily</aside></template>'
				)
			]);

			const { vueClientPaths, vueServerPaths } = await compileVue(
				[pagePath],
				root,
				false
			);
			const clientEntry = vueClientPaths.find((path) =>
				path.endsWith('LazyPage.js')
			);
			const serverEntry = vueServerPaths.find((path) =>
				path.endsWith('LazyPage.js')
			);
			expect(clientEntry).toBeDefined();
			expect(serverEntry).toBeDefined();

			for (const entry of [clientEntry, serverEntry]) {
				if (!entry) continue;
				const entrySource = await Bun.file(entry).text();
				expect(entrySource).toContain(
					'import("./components/LazyPanel.js")'
				);
				expect(
					await Bun.file(
						join(entry, '..', 'components', 'LazyPanel.js')
					).exists()
				).toBe(true);
			}
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	});

	test('SSR-renders setup state from a dynamically imported Vue component after the production server bundle', async () => {
		const root = await mkdtemp(join(tmpdir(), 'absolutejs-compile-vue-'));
		const pagePath = join(root, 'LazyPage.vue');
		const childPath = join(root, 'components', 'LazyPanel.vue');

		try {
			await Promise.all([
				writeTempFile(
					pagePath,
					`<script setup lang="ts">
import { defineAsyncComponent } from 'vue';

const LazyPanel = defineAsyncComponent({
  loader: () => import('./components/LazyPanel.vue'),
});
</script>

<template><main><LazyPanel /><footer>complete page</footer></main></template>`
				),
				writeTempFile(
					childPath,
					`<script setup lang="ts">
import { ref } from 'vue';

const selectedIndex = ref<number | null>(null);
const rows = [{ name: 'first row' }];
</script>

<template>
  <section>
    <p>lazy setup rendered</p>
    <dialog v-if="selectedIndex !== null">{{ rows[selectedIndex].name }}</dialog>
  </section>
</template>`
				)
			]);

			const { vueServerPaths } = await compileVue([pagePath], root, false);
			const serverEntry = vueServerPaths.find((path) =>
				path.endsWith('LazyPage.js')
			);
			expect(serverEntry).toBeDefined();
			if (!serverEntry) return;

			const bundled = await Bun.build({
				entrypoints: [serverEntry],
				outdir: join(root, 'bundle'),
				target: 'bun'
			});
			expect(bundled.success).toBe(true);
			const output = bundled.outputs.find((artifact) =>
				artifact.path.endsWith('LazyPage.js')
			);
			expect(output).toBeDefined();
			if (!output) return;

			const pageModule = await import(
				`${pathToFileURL(output.path).href}?test=${Date.now()}`
			);
			const html = await renderToString(createSSRApp(pageModule.default));

			expect(html).toContain('lazy setup rendered');
			expect(html).toContain('<footer>complete page</footer>');
			expect(html).not.toContain('<dialog');
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	});

	test('resolves inherited props from imported TypeScript interfaces', async () => {
		const root = await mkdtemp(join(tmpdir(), 'absolutejs-compile-vue-'));
		const pagePath = join(root, 'ImportedProps.vue');

		try {
			await Promise.all([
				writeTempFile(
					join(root, 'primitiveProps.ts'),
					`export interface PrimitiveProps {
	title: string;
}`
				),
				writeTempFile(
					join(root, 'pageProps.ts'),
					`import type { PrimitiveProps } from './primitiveProps';

export interface PageProps extends PrimitiveProps {
	count?: number;
}`
				),
				writeTempFile(
					pagePath,
					`<script setup lang="ts">
import type { PageProps } from './pageProps';

defineProps<PageProps>();
</script>

<template>
  <h1>{{ title }}</h1>
</template>`
				)
			]);

			const result = await compileVue([pagePath], root, false);

			expect(
				result.vueIndexPaths.some((path) =>
					path.endsWith('ImportedProps.js')
				)
			).toBe(true);
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	});

	test('adds streaming slot hydration pending handling to client bootstrap', async () => {
		const root = await mkdtemp(join(tmpdir(), 'absolutejs-compile-vue-'));
		const pagePath = join(root, 'StreamingPage.vue');

		try {
			await writeTempFile(
				pagePath,
				`<template>
  <main>
    <h1>Vue Stream Test</h1>
  </main>
</template>`
			);

			const { vueIndexPaths } = await compileVue([pagePath], root, false);
			const indexPath = vueIndexPaths.find((path) =>
				path.endsWith('StreamingPage.js')
			);
			expect(indexPath).toBeDefined();

			const indexContent = indexPath
				? await Bun.file(indexPath).text()
				: '';

			expect(indexContent).toContain(
				'const shouldHydrate = typeof window === "undefined" ? false : !(isHMR || isSsrDirty || isClientRender);'
			);
			expect(indexContent).toContain(
				'import { prepareBrowserTranslationHydration } from "@absolutejs/absolute/vue";'
			);
			expect(indexContent).toContain(
				'prepareBrowserTranslationHydration(document.querySelector("#root"))'
			);
			expect(indexContent).toContain('restoreBrowserTranslation();');
			expect(indexContent).toContain(
				'window.__ABSOLUTE_PAGE_DISPOSE__ = async function()'
			);
			expect(indexContent).toContain('window.__ABS_SLOT_HYDRATION_PENDING__ = shouldHydrate;');
			expect(indexContent).toContain(
				'if (shouldHydrate && typeof requestAnimationFrame === "function") {'
			);
			expect(indexContent).toContain('requestAnimationFrame(releaseStreamingSlots);');
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	});

	test('hydrates routed SPA pages rather than fresh-mounting them', async () => {
		const root = await mkdtemp(join(tmpdir(), 'absolutejs-compile-vue-'));
		const pagePath = join(root, 'Portal.vue');

		try {
			await writeTempFile(
				pagePath,
				`<script lang="ts">
import { defineRoutes } from '@absolutejs/absolute/vue';

export const routes = defineRoutes([
  { path: '/portal/dashboard', component: () => import('./Dashboard.vue') },
  { path: '/portal/intake', component: () => import('./Intake.vue') },
]);
</script>

<template>
  <RouterView />
</template>`
			);
			await writeTempFile(
				join(root, 'Dashboard.vue'),
				`<template><h1>Dashboard</h1></template>`
			);
			await writeTempFile(
				join(root, 'Intake.vue'),
				`<template><h1>Intake</h1></template>`
			);

			const { vueIndexPaths } = await compileVue([pagePath], root, false);
			const indexPath = vueIndexPaths.find((path) =>
				path.endsWith('Portal.js')
			);
			expect(indexPath).toBeDefined();

			const indexContent = indexPath
				? await Bun.file(indexPath).text()
				: '';

			/* Routed pages HYDRATE the server's markup; they used to
			 * fresh-mount, which is why the handler shipped an empty
			 * `#root` for them — the mount discarded the markup, so
			 * rendering it wasted a render and fired every CSS entrance
			 * animation twice. Both halves changed together (parity item
			 * 3.8), so `hasSpaRoutes` is no longer part of the decision
			 * and `createApp` is reserved for HMR, an SSR-dirty document
			 * and an explicitly client-rendered page. */
			expect(indexContent).toContain(
				'const shouldHydrate = typeof window === "undefined" ? false : !(isHMR || isSsrDirty || isClientRender);'
			);
			expect(indexContent).not.toContain('|| hasSpaRoutes');
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	});

	test('a hydration mismatch reaches the error overlay in development, and only there', async () => {
		const root = await mkdtemp(join(tmpdir(), 'absolutejs-compile-vue-'));
		const pagePath = join(root, 'Account.vue');

		try {
			await writeTempFile(
				pagePath,
				`<template><h1>Account</h1></template>`
			);
			const indexOf = async (isDev: boolean) => {
				const { vueIndexPaths } = await compileVue(
					[pagePath],
					root,
					isDev
				);
				const indexPath = vueIndexPaths.find((path) =>
					path.endsWith('Account.js')
				);

				return indexPath ? Bun.file(indexPath).text() : '';
			};

			const development = await indexOf(true);
			// Collected from Vue's warnings, chained after any app handler...
			expect(development).toContain('app.config.warnHandler = function');
			expect(development).toContain('if (appWarnHandler) appWarnHandler(');
			// ...and handed to the overlay once the page has mounted.
			expect(development).toContain('"absolute:dev-error"');
			expect(development.indexOf('app.mount("#root")')).toBeLessThan(
				development.indexOf('"absolute:dev-error"')
			);
			// The generated entry still parses.
			expect(() =>
				new Bun.Transpiler({ loader: 'js' }).scan(development)
			).not.toThrow();

			const production = await indexOf(false);
			expect(production).not.toContain('warnHandler');
			expect(production).not.toContain('absolute:dev-error');
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	});

	test('compiles pages whose only script block is a plain <script>', async () => {
		const root = await projectFixtureDir('compile-vue-plain-script-');
		const pages: Record<string, string> = {
			BothScripts: `<script lang="ts">
export const pageLabel = 'BOTH';
</script>

<script setup lang="ts">
const word = 'BOTH_SCRIPTS';
</script>

<template><p>{{ word }}</p></template>`,
			NamedOnly: `<script lang="ts">
export const pageLabel = 'NAMED';
</script>

<template><p>NAMED_ONLY</p></template>`,
			NoScript: `<template><p>NO_SCRIPT</p></template>`,
			PlainDefault: `<script lang="ts">
import { defineComponent, ref } from 'vue';

export default defineComponent({
  setup() {
    return { count: ref(7) };
  }
});
</script>

<template><p>PLAIN {{ count }}</p></template>`,
			RoutedShell: `<script lang="ts">
export const routes = [
  { path: '/app/one', component: () => import('./RouteOne.vue').then((m) => m.default) },
  { path: '/app/two', component: () => import('./RouteTwo.vue').then((m) => m.default) }
];
</script>

<template><RouterView /></template>`
		};

		try {
			await Promise.all([
				...Object.entries(pages).map(([name, source]) =>
					writeTempFile(join(root, `${name}.vue`), source)
				),
				writeTempFile(
					join(root, 'RouteOne.vue'),
					`<template><h1>ROUTE_ONE <RouterLink to="/app/two">two</RouterLink></h1></template>`
				),
				writeTempFile(
					join(root, 'RouteTwo.vue'),
					`<template><h1>ROUTE_TWO</h1></template>`
				)
			]);
			const pagePaths = Object.keys(pages).map((name) =>
				join(root, `${name}.vue`)
			);
			const { vueServerPaths } = await compileVue(pagePaths, root, false);
			const serverEntries = Object.keys(pages).map((name) => {
				const entry = vueServerPaths.find((path) =>
					path.endsWith(`/${name}.js`)
				);
				if (!entry) throw new Error(`no server output for ${name}`);

				return entry;
			});
			const bundled = await Bun.build({
				entrypoints: serverEntries,
				// Share this test's Vue runtime: a second bundled copy
				// would not see the components app.use(router) registers.
				external: ['vue', 'vue-router', 'vue/server-renderer'],
				outdir: join(root, 'bundle'),
				target: 'bun'
			});
			expect(bundled.success).toBe(true);
			const load = async (name: string) => {
				const output = bundled.outputs.find(
					(artifact) =>
						artifact.kind === 'entry-point' &&
						artifact.path.endsWith(`/${name}.js`)
				);
				if (!output) throw new Error(`no bundle for ${name}`);

				return import(`${pathToFileURL(output.path).href}?t=${Date.now()}`);
			};

			const expected: Record<string, string> = {
				BothScripts: 'BOTH_SCRIPTS',
				NamedOnly: 'NAMED_ONLY',
				NoScript: 'NO_SCRIPT',
				PlainDefault: 'PLAIN 7'
			};
			for (const [name, text] of Object.entries(expected)) {
				const pageModule = await load(name);
				const html = await renderToString(
					createSSRApp(pageModule.default)
				);
				expect({ html: html.includes(text), name }).toEqual({
					html: true,
					name
				});
			}
			expect((await load('NamedOnly')).pageLabel).toBe('NAMED');
			expect((await load('BothScripts')).pageLabel).toBe('BOTH');

			const routed = await load('RoutedShell');
			expect(Array.isArray(routed.routes)).toBe(true);
			for (const [url, text] of [
				['/app/one', 'ROUTE_ONE'],
				['/app/two', 'ROUTE_TWO']
			] as const) {
				const app = createSSRApp(routed.default);
				let notFound = false;
				await routed.setupApp(app, {
					isServer: true,
					setNotFound: () => {
						notFound = true;
					},
					url
				});
				expect(notFound).toBe(false);
				const html = await renderToString(app);
				expect(html).toContain(text);
			}
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	});
});


test('shared child CSS is emitted once with the same cascade after a cache restart', async () => {
	const root = await mkdtemp(join(tmpdir(), 'absolutejs-css-diamond-'));
	const page = join(root, 'Diamond.vue');
	try {
		await Promise.all([
			writeTempFile(page, `<script setup>import Left from './Left.vue'; import Right from './Right.vue';</script><template><Left /><Right /></template>`),
			writeTempFile(join(root, 'Left.vue'), `<script setup>import Shared from './Shared.vue';</script><template><Shared /></template><style>.diamond-value { color: green; }</style>`),
			writeTempFile(join(root, 'Right.vue'), `<script setup>import Shared from './Shared.vue';</script><template><Shared /></template><style>.diamond-value { color: blue; }</style>`),
			writeTempFile(join(root, 'Shared.vue'), `<template><span class="diamond-value">Shared</span></template><style>.diamond-value { color: red; }</style>`)
		]);
		const first = await compileVue([page], root, false);
		const css = await Bun.file(first.vueCssPaths[0]!).text();
		expect(css.match(/color: red/g)).toHaveLength(1);
		expect(css.indexOf('color: red')).toBeGreaterThan(css.indexOf('color: blue'));
		clearVueHmrCaches();
		const warm = await compileVue([page], root, false);
		expect(await Bun.file(warm.vueCssPaths[0]!).text()).toBe(css);
	} finally {
		clearVueHmrCaches();
		await rm(root, { force: true, recursive: true });
	}
});
