import { afterAll, describe, expect, test } from 'bun:test';
import { startDevServer, type DevServer } from '../../helpers/devServer';

/* On-demand page builds (dev default): `absolute dev` boots with every
 * page entry deferred, and the first request for a page bundles just that
 * page through the incremental rebuild path. `--eager` /
 * `ABSOLUTE_DEV_EAGER=1` restores the full boot build. */

type LazyStatus = {
	lazyPages:
		| {
				enabled: true;
				buildCount: number;
				inFlight: string[];
				warmed: string[];
		  }
		| { enabled: false };
	manifestKeys: string[];
	isRebuilding: boolean;
};

const readStatus = async (server: DevServer) => {
	const response = await fetch(`${server.baseUrl}/hmr-status`);

	return (await response.json()) as LazyStatus;
};

const lazyBuildCount = (status: LazyStatus) =>
	status.lazyPages.enabled ? status.lazyPages.buildCount : -1;

let lazyServer: DevServer;
let eagerServer: DevServer;

afterAll(async () => {
	await lazyServer?.kill();
	await eagerServer?.kill();
}, 20_000);

describe('dev: pages build on first request', () => {
	test('boots ready before any page is built', async () => {
		lazyServer = await startDevServer();
		const status = await readStatus(lazyServer);

		expect(status.lazyPages.enabled).toBe(true);
		expect(lazyBuildCount(status)).toBe(0);
		// Static pages and global CSS are built at boot; page bundles are not.
		expect(status.manifestKeys).toContain('HTMLExample');
		expect(status.manifestKeys).not.toContain('VueExampleIndex');
		expect(status.manifestKeys).not.toContain('SvelteExample');
		expect(status.manifestKeys).not.toContain('ReactExampleIndex');
	}, 90_000);

	test('first request builds only that page and serves it', async () => {
		const response = await fetch(`${lazyServer.baseUrl}/vue`);
		expect(response.status).toBe(200);
		const html = await response.text();
		expect(html).toContain('_src_indexes/VueExample');

		const status = await readStatus(lazyServer);
		expect(lazyBuildCount(status)).toBe(1);
		expect(status.manifestKeys).toContain('VueExample');
		expect(status.manifestKeys).toContain('VueExampleIndex');
		expect(status.manifestKeys).not.toContain('SvelteExample');
		expect(status.manifestKeys).not.toContain('ReactExampleIndex');
		if (status.lazyPages.enabled) {
			expect(
				status.lazyPages.warmed.some((source) =>
					source.endsWith('/vue/pages/VueExample.vue')
				)
			).toBe(true);
			expect(status.lazyPages.inFlight).toEqual([]);
		}
	}, 60_000);

	test('a second request for the same page does not rebuild', async () => {
		const before = lazyBuildCount(await readStatus(lazyServer));
		const response = await fetch(`${lazyServer.baseUrl}/vue`);
		expect(response.status).toBe(200);
		expect(lazyBuildCount(await readStatus(lazyServer))).toBe(before);
	}, 30_000);

	test('concurrent first requests for one page share a single build', async () => {
		const before = lazyBuildCount(await readStatus(lazyServer));
		const responses = await Promise.all([
			fetch(`${lazyServer.baseUrl}/svelte`),
			fetch(`${lazyServer.baseUrl}/svelte`),
			fetch(`${lazyServer.baseUrl}/svelte`)
		]);
		expect(responses.map((response) => response.status)).toEqual([
			200, 200, 200
		]);
		const status = await readStatus(lazyServer);
		expect(lazyBuildCount(status)).toBe(before + 1);
		expect(status.manifestKeys).toContain('SvelteExampleIndex');
	}, 60_000);

	test('other frameworks build on demand too', async () => {
		const before = lazyBuildCount(await readStatus(lazyServer));
		for (const path of ['/react', '/angular', '/ember']) {
			const response = await fetch(`${lazyServer.baseUrl}${path}`);
			expect(response.status).toBe(200);
		}
		const status = await readStatus(lazyServer);
		expect(lazyBuildCount(status)).toBe(before + 3);
		expect(status.manifestKeys).toContain('ReactExampleIndex');
		expect(status.manifestKeys).toContain('AngularExample');
		expect(status.manifestKeys).toContain('EmberExample');
		expect(status.isRebuilding).toBe(false);
	}, 120_000);

	test('hover prefetches wait for the build instead of caching a 503', async () => {
		const before = lazyBuildCount(await readStatus(lazyServer));
		const response = await fetch(`${lazyServer.baseUrl}/spashell`, {
			headers: { Purpose: 'prefetch', 'Sec-Purpose': 'prefetch' }
		});
		expect(response.status).toBe(200);
		expect(lazyBuildCount(await readStatus(lazyServer))).toBe(before + 1);
	}, 60_000);
});

describe('dev: --eager restores the full boot build', () => {
	test('every page is in the manifest before any request', async () => {
		// One dev server per project at a time: a second one racing the
		// first for the build directory lock boots with an empty manifest.
		await lazyServer.kill();
		eagerServer = await startDevServer({
			env: { ABSOLUTE_DEV_EAGER: '1' }
		});
		const status = await readStatus(eagerServer);
		if (status.manifestKeys.length === 0) {
			console.error(
				`[eager-debug] empty manifest; last 40 server lines:\n${eagerServer.outputLines.slice(-40).join('\n')}`
			);
		}

		expect(status.lazyPages.enabled).toBe(false);
		expect(status.manifestKeys).toContain('VueExampleIndex');
		expect(status.manifestKeys).toContain('SvelteExample');
		expect(status.manifestKeys).toContain('ReactExampleIndex');
		const response = await fetch(`${eagerServer.baseUrl}/vue`);
		expect(response.status).toBe(200);
	}, 120_000);
});
