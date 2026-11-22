import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { isReactFastRefreshSupported } from '../../../src/dev/moduleServer';
import { openPage } from '../../helpers/browser';
import { startDevServer, type DevServer } from '../../helpers/devServer';

const repo = resolve(import.meta.dir, '../../..');
const root = join(repo, '.hmr-temp', 'client-module-' + process.pid);
const dir = relative(repo, root);
const source = relative(root, join(repo, 'src'));
const counter = (label: string) => `import { useState } from 'react';
export function Counter() {
	const [n,set] = useState(0);
	return <button onClick={()=>set(n+1)}>${label} {n}</button>;
}`;
let server: DevServer | undefined;
beforeAll(async () => {
	await mkdir(join(root, 'react/pages'), { recursive: true });
	await writeFile(
		join(root, 'react/pages/Home.tsx'),
		'export function Home(){ return <html><body>home</body></html>; }'
	);
	await writeFile(join(root, 'react/Counter.tsx'), counter('old'));
	await writeFile(
		join(root, 'react/label.ts'),
		"export const label = 'first';"
	);
	await writeFile(
		join(root, 'react/embed.tsx'),
		`import { createRoot } from 'react-dom/client';
import { Counter } from './Counter';
import { label } from './label';
export function mount(host) {
	const root = createRoot(host);
	root.render(<section title={label}><Counter /></section>);
	return () => root.unmount();
}`
	);
	await writeFile(
		join(root, 'config.ts'),
		`export default {
		buildDirectory:'${dir}/build', reactDirectory:'${dir}/react',
		clientModules:{ Embed:'${dir}/react/embed.tsx' }
	};`
	);
	const html = `<!doctype html><div id="host"></div><script type="module">
import * as runtime from '/react/vendor/react-refresh_runtime.js';
runtime.injectIntoGlobalHook(window);
window.$RefreshRuntime$ = runtime;
window.$RefreshReg$ = runtime.register;
window.$RefreshSig$ = runtime.createSignatureFunctionForTransform;
const embed = await import('/embed.js');
let dispose;
embed.onClientModuleReplace(module => {
	dispose?.();
	dispose = module.mount(document.querySelector('#host'));
});
</script>`;
	await writeFile(
		join(root, 'server.ts'),
		`import { Elysia } from 'elysia';
import { prepare } from '${source}';
import { networking } from '${source}/plugins/networking';
const {absolutejs, manifest} = await prepare();
new Elysia().use(absolutejs)
.get('/host', () => new Response(${JSON.stringify(html)}, { headers: {'Content-Type':'text/html'}}))
.get('/embed.js', ({redirect}) => redirect(manifest.EmbedModule))
.use(networking);`
	);
	server = await startDevServer({
		configPath: join(root, 'config.ts'),
		serverEntry: join(root, 'server.ts')
	});
}, 180_000);
afterAll(async () => {
	await server?.kill();
	await rm(root, { recursive: true, force: true });
});
test('a foreign page refreshes its embedded component and remounts for mount-time code', async () => {
	if (!server) throw new Error('Dev server did not start');
	const session = await openPage(server.baseUrl + '/host');
	try {
		const { page } = session;
		await page.getByText('old 0').click();
		await page.evaluate(() => Reflect.set(window, 'sameDocument', true));
		await writeFile(join(root, 'react/Counter.tsx'), counter('updated'));
		await page
			.getByText(
				isReactFastRefreshSupported() ? 'updated 1' : 'updated 0'
			)
			.waitFor();
		await writeFile(
			join(root, 'react/label.ts'),
			"export const label = 'second';"
		);
		await page.locator('section[title=second]').waitFor();
		expect(
			await page.evaluate(() => Reflect.get(window, 'sameDocument'))
		).toBe(true);
	} finally {
		await session.close();
	}
}, 100_000);
