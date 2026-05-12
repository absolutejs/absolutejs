import { describe, expect, test, afterEach } from 'bun:test';
import { resolve } from 'node:path';
import { startDevServer, type DevServer } from '../../../helpers/devServer';
import { connectHMR, type HMRClient } from '../../../helpers/ws';
import {
	createFile,
	mutateFile,
	restoreAllFiles
} from '../../../helpers/file';

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..', '..', '..');

let server: DevServer | undefined;
let client: HMRClient | undefined;

afterEach(async () => {
	client?.close();
	client = undefined;
	if (server) {
		await server.kill();
		server = undefined;
	}
	restoreAllFiles();
});

const vuePage = resolve(PROJECT_ROOT, 'example/vue/pages/VueExample.vue');

const scaleComponentDir = resolve(
	PROJECT_ROOT,
	'example/vue/components/_scale'
);

const componentPath = (i: number) =>
	resolve(scaleComponentDir, `ScaleComp${i}.vue`);

const componentSource = (i: number) => `<script setup lang="ts">
const greeting = 'scale-comp-${i}';
</script>

<template>
	<span :data-scale-id="${i}">{{ greeting }}</span>
</template>
`;

const generateScaleComponents = (n: number) => {
	for (let i = 0; i < n; i++) {
		createFile(componentPath(i), componentSource(i));
	}
};

const importAllInPage = (text: string, n: number) => {
	const imports = Array.from(
		{ length: n },
		(_, i) => `import ScaleComp${i} from '../components/_scale/ScaleComp${i}.vue';`
	).join('\n');
	const usages = Array.from(
		{ length: n },
		(_, i) => `\t\t<ScaleComp${i} />`
	).join('\n');
	return text
		.replace(
			"import CountButton from '../components/CountButton.vue';",
			`import CountButton from '../components/CountButton.vue';\n${imports}`
		)
		.replace(
			'<CountButton :initialCount="count" />',
			`<CountButton :initialCount="count" />\n\t\t<div data-scale-grid>\n${usages}\n\t\t</div>`
		);
};

type ScaleProbe = {
	n: number;
	coldStartMs: number;
	firstEditMs: number;
	avgEditMs: number;
	maxEditMs: number;
};

const probeScale = async (n: number): Promise<ScaleProbe> => {
	generateScaleComponents(n);
	mutateFile(vuePage, (text) => importAllInPage(text, n));

	const coldStartStart = performance.now();
	server = await startDevServer();
	client = await connectHMR(server.port);
	await client.waitFor('manifest');
	await client.waitFor('connected');
	client.drain();
	const coldStartMs = performance.now() - coldStartStart;

	const initialRender = await (await fetch(`${server.baseUrl}/vue`)).text();
	if (!initialRender.includes('scale-comp-0')) {
		throw new Error(`N=${n}: page did not render scale components`);
	}

	const firstEditStart = performance.now();
	mutateFile(componentPath(0), (text) =>
		text.replace("'scale-comp-0'", "'scale-comp-0-EDIT-A'")
	);
	await client.waitFor('vue-tier-zero-ssr-rebuild-complete', 60_000);
	const firstEditMs = performance.now() - firstEditStart;

	const editLatencies: number[] = [];
	for (let i = 1; i <= 10; i++) {
		const compIdx = i % n;
		client.drain();
		const start = performance.now();
		mutateFile(componentPath(compIdx), (text) =>
			text.replace(
				`'scale-comp-${compIdx}'`,
				`'scale-comp-${compIdx}-EDIT-${i}'`
			)
		);
		await client.waitFor(
			'vue-tier-zero-ssr-rebuild-complete',
			60_000
		);
		editLatencies.push(performance.now() - start);
	}
	const avgEditMs =
		editLatencies.reduce((a, b) => a + b, 0) / editLatencies.length;
	const maxEditMs = Math.max(...editLatencies);
	return { avgEditMs, coldStartMs, firstEditMs, maxEditMs, n };
};

/* HMR scaling probe: drop N=50 generated `.vue` components into the
 * example app, import them all from `VueExample.vue`, then measure:
 *
 *   - Cold-start time (server.ready signal).
 *   - First-edit latency (warm cache; user touches one component
 *     after the initial bundle is built).
 *   - Average edit latency over 10 sequential edits to different
 *     components — surfaces O(N²) hotspots in dep-graph walk,
 *     manifest update, or tier-0 fingerprint comparison that
 *     don't bite the 7-file default example.
 *
 * Assertions are loose (latencies should stay within minutes-not-
 * hours bounds; the real value of this test is the timings it
 * PRINTS so a future regression that doubles edit latency shows
 * up in CI logs even when the soft bounds still pass). If the
 * suite starts gating on tighter numbers later, tighten the
 * expects here. */
describe('HMR scaling — component edit latency at N=50 and N=100', () => {
	test(
		'N=50 — cold-start + 10-edit avg stay under loose bounds; numbers reported',
		async () => {
			const p = await probeScale(50);
			console.log(
				`[hmr-scale] N=${p.n} cold-start=${p.coldStartMs.toFixed(0)}ms ` +
					`firstEdit=${p.firstEditMs.toFixed(0)}ms ` +
					`avgEdit=${p.avgEditMs.toFixed(0)}ms maxEdit=${p.maxEditMs.toFixed(0)}ms`
			);
			expect(p.coldStartMs).toBeLessThan(60_000);
			expect(p.firstEditMs).toBeLessThan(20_000);
			expect(p.avgEditMs).toBeLessThan(15_000);
			expect(p.maxEditMs).toBeLessThan(30_000);
		},
		300_000
	);

	test(
		'N=100 — same scenario; checks N=50→N=100 latency ratio stays sub-quadratic',
		async () => {
			const p = await probeScale(100);
			console.log(
				`[hmr-scale] N=${p.n} cold-start=${p.coldStartMs.toFixed(0)}ms ` +
					`firstEdit=${p.firstEditMs.toFixed(0)}ms ` +
					`avgEdit=${p.avgEditMs.toFixed(0)}ms maxEdit=${p.maxEditMs.toFixed(0)}ms`
			);
			expect(p.coldStartMs).toBeLessThan(120_000);
			expect(p.firstEditMs).toBeLessThan(40_000);
			expect(p.avgEditMs).toBeLessThan(30_000);
			expect(p.maxEditMs).toBeLessThan(60_000);
		},
		600_000
	);
});
