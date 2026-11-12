import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/* A plain Svelte `{#await}` must behave exactly as in Svelte: the server
 * renders the pending branch, the client resolves the promise and hydrates
 * every branch, components and logic included. beta.168 lowered every
 * non-shorthand block into a streaming slot, which turned branch components
 * into literal text, broke `{#if}` in a branch ("Unexpected token"), let a
 * shorthand block's regex match run into the next block ("Unterminated
 * regular expression"), and switched hydration off for the whole page.
 * Streaming is now opt-in with `<!-- absolute:stream -->`.
 *
 * Each case compiles through `compileSvelte`, renders through
 * `handleSveltePageRequest` and, for hydration, runs the compiled client
 * component against the SSR markup under happy-dom. That runs in a child
 * process so happy-dom's globals never leak into other test files. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const fixtureRoot = join(
	repoRoot,
	'.test-builds',
	`svelte-native-await-${process.pid}`
);

const FILES: Record<string, string> = {
	'Badge.svelte': `<script lang="ts">
	let { value }: { value: string } = $props();
</script>

<strong class="badge">{value}</strong>
`,
	'MixedAwait.svelte': `<script lang="ts">
	const first = Promise.resolve('first');
	const second = Promise.resolve('second');
</script>

{#await first then value}
	<p>{value}</p>
{/await}

{#await second}
	<p>second pending</p>
{:then value}
	<p>{value}</p>
{/await}
`,
	'NativeAwait.svelte': `<script lang="ts">
	import Badge from './Badge.svelte';

	let count = $state(0);
	const data = new Promise<string>((resolve) =>
		setTimeout(() => resolve('loaded'), 10)
	);
</script>

<button id="inc" onclick={() => count++}>clicks: {count}</button>
{#await data}
	<p id="pending">pending</p>
{:then value}
	{#if value === 'loaded'}
		<Badge {value} />
	{:else}
		<p>unexpected</p>
	{/if}
{:catch error}
	<p>{error.message}</p>
{/await}
`,
	'StreamedAwait.svelte': `<script lang="ts">
	const data = new Promise<string>((resolve) =>
		setTimeout(() => resolve('streamed value'), 5)
	);
</script>

<!-- absolute:stream -->
{#await data}
	<p>stream pending</p>
{:then value}
	<section>{value}</section>
{/await}
`
};

type ProbeResult = {
	clientImportsBadge: boolean;
	hydratedAfterClick: string;
	indexes: Record<string, string>;
	mixedHtml: string;
	nativeHtml: string;
};

const PROBE = `
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { compileSvelte } from ${JSON.stringify(join(repoRoot, 'src', 'build', 'compileSvelte.ts'))};
import { handleSveltePageRequest } from ${JSON.stringify(join(repoRoot, 'src', 'svelte', 'index.ts'))};

const root = ${JSON.stringify(fixtureRoot)};
const pages = ['NativeAwait', 'MixedAwait', 'StreamedAwait'];
const { svelteClientPaths, svelteIndexPaths, svelteServerPaths } = await compileSvelte(
	pages.map((name) => join(root, name + '.svelte')),
	root,
	new Map(),
	false
);
const byName = (paths, name) => paths.find((path) => basename(path) === name + '.js');
const renderPage = async (name, extra = {}) => {
	const response = await handleSveltePageRequest({
		indexPath: '/' + name + '-index.js',
		pagePath: byName(svelteServerPaths, name),
		...extra
	});

	return response.text();
};

const nativeHtml = await renderPage('NativeAwait');
const mixedHtml = await renderPage('MixedAwait');
const indexes = Object.fromEntries(
	pages.map((name) => [name, readFileSync(byName(svelteIndexPaths, name), 'utf8')])
);
const nativeClient = byName(svelteClientPaths, 'NativeAwait');

GlobalRegistrator.register();
const rootMarkup = nativeHtml.match(/<div id="${'$'}{ROOT_ID}">([\\s\\S]*)<\\/div><script/)?.[1] ?? '';
document.body.innerHTML = '<div id="root">' + rootMarkup + '</div>';
const { hydrate } = await import(${JSON.stringify(join(repoRoot, 'node_modules', 'svelte', 'src', 'index-client.js'))});
const Client = (await import(nativeClient)).default;
hydrate(Client, { target: document.getElementById('root') });
await new Promise((done) => setTimeout(done, 60));
document.getElementById('inc').click();
await new Promise((done) => setTimeout(done, 20));
const hydratedAfterClick = document.getElementById('root').innerHTML.replace(/<!--[^>]*-->/g, '');
await GlobalRegistrator.unregister();

console.log(JSON.stringify({
	clientImportsBadge: readFileSync(nativeClient, 'utf8').includes('Badge'),
	hydratedAfterClick,
	indexes,
	mixedHtml,
	nativeHtml
}));
`;

let result: ProbeResult | undefined;
const probeResult = () => {
	if (!result) throw new Error('probe did not run');

	return result;
};

beforeAll(async () => {
	await mkdir(fixtureRoot, { recursive: true });
	await Promise.all(
		Object.entries(FILES).map(([name, source]) =>
			writeFile(join(fixtureRoot, name), source)
		)
	);
	const { SVELTE_PAGE_ROOT_ID } = await import(
		'../../../src/svelte/renderToReadableStream'
	);
	const probePath = join(fixtureRoot, 'probe.ts');
	await writeFile(
		probePath,
		PROBE.replace('${ROOT_ID}', SVELTE_PAGE_ROOT_ID)
	);
	const proc = Bun.spawn(['bun', probePath], {
		cwd: fixtureRoot,
		env: { ...process.env, NODE_ENV: 'production', TELEMETRY_OFF: '1' },
		stderr: 'pipe',
		stdout: 'pipe'
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		proc.exited,
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text()
	]);
	if (exitCode !== 0) throw new Error(`probe failed:\n${stderr}\n${stdout}`);
	result = JSON.parse(stdout.trim().split('\n').at(-1) ?? '{}');
}, 120_000);

afterAll(async () => {
	await rm(fixtureRoot, { force: true, recursive: true });
});

const HYDRATES = '? false : true;';
const NEVER_HYDRATES = '? false : false;';

describe('plain {#await}', () => {
	test('server-renders the pending branch', () => {
		const html = probeResult().nativeHtml;

		expect(html).toContain('id="pending"');
		expect(html).toContain('clicks: 0');
		expect(html).not.toContain('AbsoluteAwaitSlot');
		expect(html).not.toContain('&lt;');
	});

	test('keeps hydration on and resolves branch components and {#if} on the client', () => {
		const { clientImportsBadge, hydratedAfterClick, indexes } =
			probeResult();

		expect(indexes.NativeAwait).toContain(HYDRATES);
		expect(clientImportsBadge).toBe(true);
		expect(hydratedAfterClick).toContain('clicks: 1');
		expect(hydratedAfterClick).toContain(
			'<strong class="badge">loaded</strong>'
		);
		expect(hydratedAfterClick).not.toContain('pending');
	});

	test('builds a shorthand block followed by a normal block', () => {
		const { indexes, mixedHtml } = probeResult();

		// Svelte renders nothing on the server for a shorthand block (it has
		// no pending branch) and the pending branch of the normal one.
		expect(mixedHtml).toContain('<p>second pending</p>');
		expect(mixedHtml).not.toContain('SSR Error');
		expect(indexes.MixedAwait).toContain(HYDRATES);
	});
});

// The streamed response itself is covered by
// tests/unit/svelte/pageHandlerStreaming.test.ts (AwaitStreamingPage fixture).
describe('<!-- absolute:stream --> {#await}', () => {
	test('keeps hydration off only for the page that streams', () => {
		expect(probeResult().indexes.StreamedAwait).toContain(NEVER_HYDRATES);
	});
});
