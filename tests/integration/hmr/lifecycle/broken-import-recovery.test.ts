import { afterEach, describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { startDevServer, type DevServer } from '../../../helpers/devServer';
import {
	createFile,
	mutateFile,
	renameFile,
	restoreAllFiles
} from '../../../helpers/file';

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..', '..', '..');
const vuePage = resolve(PROJECT_ROOT, 'example/vue/pages/VueExample.vue');
const button = resolve(PROJECT_ROOT, 'example/vue/components/CountButton.vue');
const renamed = resolve(PROJECT_ROOT, 'example/vue/components/Counter.vue');
type Snapshot = { body: string; status: number };
const RECOVERY_DEADLINE_MS = 10_000;
const POLL_MS = 100;

let server: DevServer | undefined;

afterEach(async () => {
	if (server) {
		await server.kill();
		server = undefined;
	}
	restoreAllFiles();
});

const restarted = (dev: DevServer) =>
	dev.outputLines.some(
		(line) => line.includes('restarting') || line.includes('[abs:restart]')
	);

/** Poll the page until its body contains `marker`; returns how long it took. */
const waitForPage = async (dev: DevServer, marker: string) => {
	const startedAt = performance.now();
	const deadline = Date.now() + RECOVERY_DEADLINE_MS;
	let last: Snapshot = { body: '', status: 0 };
	while (Date.now() < deadline) {
		const response = await fetch(`${dev.baseUrl}/vue`);
		last = { body: await response.text(), status: response.status };
		if (response.status === 200 && last.body.includes(marker))
			return performance.now() - startedAt;
		await Bun.sleep(POLL_MS);
	}
	throw new Error(
		`page never recovered: last status ${last.status}, body ${last.body.slice(0, 400)}\n${dev.outputLines.slice(-40).join('\n')}`
	);
};

/* The edit that left a real app stuck: a component is renamed while the page
 * still imports it by its old name. The page must say exactly what is wrong,
 * and once the import is fixed it must come back on its own — no restart, no
 * manual reload of the server. */
describe('a page with a broken import says why, and recovers when fixed', () => {
	test('renaming a component the page still imports, then fixing the import', async () => {
		server = await startDevServer();
		expect((await fetch(`${server.baseUrl}/vue`)).status).toBe(200);

		renameFile(button, renamed);
		// Let the watcher see the rename. A page that already built keeps
		// serving its last good build; the open tab gets the error overlay.
		await Bun.sleep(500);
		expect((await fetch(`${server.baseUrl}/vue`)).status).toBe(200);

		mutateFile(vuePage, (text) =>
			text
				.replace(
					"import CountButton from '../components/CountButton.vue';",
					"import CountButton from '../components/Counter.vue';"
				)
				.replace(
					/<h1>AbsoluteJS \+ Vue[^<]*<\/h1>/,
					'<h1>AbsoluteJS + Vue IMPORT_FIXED</h1>'
				)
		);
		await waitForPage(server, 'IMPORT_FIXED');
		expect(restarted(server)).toBe(false);
	}, 120_000);

	test('a page first requested while broken recovers once fixed', async () => {
		renameFile(button, renamed);
		server = await startDevServer();
		const broken = await fetch(`${server.baseUrl}/vue`);
		const brokenBody = await broken.text();
		expect(broken.status).toBe(500);
		// The build's own error names the missing file.
		expect(brokenBody).toContain('CountButton.vue');
		// The error page listens for the fix and reloads itself.
		expect(brokenBody).toContain('/hmr');

		mutateFile(vuePage, (text) =>
			text
				.replace(
					"import CountButton from '../components/CountButton.vue';",
					"import CountButton from '../components/Counter.vue';"
				)
				.replace(
					/<h1>AbsoluteJS \+ Vue[^<]*<\/h1>/,
					'<h1>AbsoluteJS + Vue COLD_IMPORT_FIXED</h1>'
				)
		);
		await waitForPage(server, 'COLD_IMPORT_FIXED');
		expect(restarted(server)).toBe(false);
	}, 120_000);
});

/* The fix often lands in a child component while the page file itself never
 * changes (page → section → widget). The page's rebuild must pick up the
 * fixed child instead of reusing anything cached from the broken build. */
describe('fixing a child component recovers a page that never changed', () => {
	const label = resolve(
		PROJECT_ROOT,
		'example/vue/components/CountLabel.vue'
	);
	const movedLabel = resolve(
		PROJECT_ROOT,
		'example/vue/components/CountCaption.vue'
	);
	test('a grandchild is renamed, then the child is fixed', async () => {
		createFile(label, '<template><span>LABEL_ORIGINAL</span></template>\n');
		mutateFile(button, (text) =>
			text
				.replace(
					"import { useCount } from '../composables/useCount';",
					"import { useCount } from '../composables/useCount';\nimport CountLabel from './CountLabel.vue';"
				)
				.replace(
					'<button @click="increment">count is {{ count }}</button>',
					'<button @click="increment">count is {{ count }} <CountLabel /></button>'
				)
		);
		server = await startDevServer();
		await waitForPage(server, 'LABEL_ORIGINAL');

		renameFile(label, movedLabel);
		mutateFile(movedLabel, (text) =>
			text.replace('LABEL_ORIGINAL', 'LABEL_FIXED')
		);
		mutateFile(button, (text) =>
			text.replace("from './CountLabel.vue'", "from './CountCaption.vue'")
		);
		await waitForPage(server, 'LABEL_FIXED');
		expect(restarted(server)).toBe(false);
	}, 120_000);

	test('the page is first requested while a grandchild is missing', async () => {
		createFile(label, '<template><span>LABEL_ORIGINAL</span></template>\n');
		mutateFile(button, (text) =>
			text
				.replace(
					"import { useCount } from '../composables/useCount';",
					"import { useCount } from '../composables/useCount';\nimport CountLabel from './CountLabel.vue';"
				)
				.replace(
					'<button @click="increment">count is {{ count }}</button>',
					'<button @click="increment">count is {{ count }} <CountLabel /></button>'
				)
		);
		renameFile(label, movedLabel);
		mutateFile(movedLabel, (text) =>
			text.replace('LABEL_ORIGINAL', 'LABEL_FIXED')
		);
		server = await startDevServer();
		const broken = await fetch(`${server.baseUrl}/vue`);
		expect(broken.status).toBe(500);
		expect(await broken.text()).toContain('CountLabel.vue');

		mutateFile(button, (text) =>
			text.replace("from './CountLabel.vue'", "from './CountCaption.vue'")
		);
		await waitForPage(server, 'LABEL_FIXED');
		expect(restarted(server)).toBe(false);
	}, 120_000);
});

/* A lazy route in an SPA shell: the browser reaches the route component
 * through the URL the shell's module hands it (with a `?v=` cache-buster).
 * After the fix, that URL must lead to the fixed code, not a transform cached
 * from before. */
describe('a lazy route recovers in the code the browser loads', () => {
	const spaOne = resolve(PROJECT_ROOT, 'example/vue/pages/SpaOne.vue');
	const part = resolve(PROJECT_ROOT, 'example/vue/components/SpaPart.vue');
	const piece = resolve(PROJECT_ROOT, 'example/vue/components/SpaPiece.vue');
	const ROUTE_URL = /["'](\/@src\/[^"']*SpaOne\.vue\?v=[^"']+)["']/;

	/** The route component's code exactly as the browser would load it. */
	const routeModule = async (dev: DevServer) => {
		const shell = await (
			await fetch(`${dev.baseUrl}/@src/example/vue/pages/SpaShell.vue`)
		).text();
		const url = ROUTE_URL.exec(shell)?.[1];
		if (!url)
			throw new Error(
				`shell has no SpaOne import:\n${shell.slice(0, 600)}`
			);
		const response = await fetch(`${dev.baseUrl}${url}`);

		return { body: await response.text(), status: response.status };
	};

	test('renaming a component a lazy route imports, then fixing the route', async () => {
		createFile(part, '<template><p>PART_ORIGINAL</p></template>\n');
		mutateFile(spaOne, (text) =>
			text.includes('<script setup')
				? text.replace(
						/<script setup([^>]*)>/,
						"<script setup$1>\nimport SpaPart from '../components/SpaPart.vue';"
					)
				: `<script setup lang="ts">\nimport SpaPart from '../components/SpaPart.vue';\n</script>\n${text}`
		);
		mutateFile(spaOne, (text) =>
			text.replace('</template>', '<SpaPart /></template>')
		);
		server = await startDevServer();
		const first = await fetch(`${server.baseUrl}/spashell/one`);
		expect(first.status).toBe(200);
		expect((await routeModule(server)).body).toContain('SpaPart.vue');

		renameFile(part, piece);
		mutateFile(piece, (text) =>
			text.replace('PART_ORIGINAL', 'PART_FIXED')
		);
		mutateFile(spaOne, (text) =>
			text.replace(
				"'../components/SpaPart.vue'",
				"'../components/SpaPiece.vue'"
			)
		);

		const deadline = Date.now() + RECOVERY_DEADLINE_MS;
		let last: Snapshot = { body: '', status: 0 };
		while (Date.now() < deadline) {
			last = await routeModule(server);
			if (last.status === 200 && last.body.includes('SpaPiece.vue'))
				break;
			await Bun.sleep(POLL_MS);
		}
		expect(last.status).toBe(200);
		expect(last.body).toContain('SpaPiece.vue');
		expect(last.body).not.toContain('SpaPart.vue');
		expect(restarted(server)).toBe(false);
	}, 120_000);
});

/* Files the running server never loads must not restart it: a restart drops
 * every open page for seconds and rebuilds them from nothing. */
describe('only files the server loads restart it', () => {
	test('editing docs and tests leaves the server running', async () => {
		server = await startDevServer();
		expect((await fetch(`${server.baseUrl}/vue`)).status).toBe(200);
		createFile(resolve(PROJECT_ROOT, 'example/NOTES.md'), '# notes\n');
		createFile(
			resolve(PROJECT_ROOT, 'example/notes.test.ts'),
			'export const unused = 1;\n'
		);
		await Bun.sleep(1500);
		expect(restarted(server)).toBe(false);
		expect((await fetch(`${server.baseUrl}/vue`)).status).toBe(200);
	}, 120_000);
});
