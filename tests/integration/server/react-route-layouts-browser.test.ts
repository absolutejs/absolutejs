import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openPage } from '../../helpers/browser';
import { ensureDistBuild } from '../../helpers/ensureDistBuild';
import {
	linkNodeModules,
	writeFileRoutesFixture
} from '../../helpers/fileRoutesFixture';

/* A React file route under nested layouts has to HYDRATE onto the markup
 * the server sent.
 *
 * The server composes the chain in `react/fileRoute.ts` and the generated
 * hydration index composes it again in `generateReactIndexes.ts`. Those are
 * two separate pieces of code building the same tree, and if they disagree
 * — a different order, a missing layout — React does not fail. It discards
 * the server's tree and renders the root again on the client, which looks
 * correct on screen and throws away the server render. So "the page looks
 * right" cannot be the assertion.
 *
 * What distinguishes the two is whether the server's own DOM survived: the
 * outer layout runs an inline script while the document parses, marking
 * every element the server sent. A kept tree still carries the marks; a
 * re-rendered one does not. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const CLI_ENTRY = join(repoRoot, 'dist', 'cli', 'index.js');
const PORT = 4526;
const READY_ATTEMPTS = 240;
const READY_INTERVAL_MS = 250;

let root = '';
let server: ReturnType<typeof Bun.spawn> | undefined;

const pageUrl = `http://localhost:${PORT}/plans/pricing`;

beforeAll(async () => {
	await ensureDistBuild();
	root = await mkdtemp(join(tmpdir(), 'absolute-route-layouts-'));
	await writeFileRoutesFixture(root);
	await linkNodeModules(root);
	server = Bun.spawn(
		['bun', CLI_ENTRY, 'start', 'server.ts', '--outdir', 'start-build'],
		{
			cwd: root,
			env: {
				...process.env,
				FORCE_COLOR: '0',
				NODE_ENV: 'production',
				PORT: String(PORT),
				TELEMETRY_OFF: '1'
			},
			stderr: 'pipe',
			stdout: 'pipe'
		}
	);
	const ready = async () => {
		try {
			return (await fetch(pageUrl)).status === 200;
		} catch {
			return false;
		}
	};
	for (let attempt = 0; attempt < READY_ATTEMPTS; attempt += 1) {
		if (await ready()) return;
		await Bun.sleep(READY_INTERVAL_MS);
	}
	throw new Error('timed out waiting for the production server');
}, 600_000);

afterAll(async () => {
	server?.kill();
	await server?.exited;
	if (root) await rm(root, { force: true, recursive: true });
});

describe('a React file route under nested layouts', () => {
	test('hydrates onto the server markup the layouts produced', async () => {
		const consoleMessages: string[] = [];
		const session = await openPage(pageUrl, {
			waitUntil: 'load',
			consoleLog: (message: string) => consoleMessages.push(message)
		});
		try {
			const { page } = session;
			await page.waitForFunction(
				() => Reflect.get(window, '__pricingHydrated') === true,
				undefined,
				{ timeout: 30_000 }
			);

			// The layouts are in the live DOM, nested outer → inner.
			expect(
				await page
					.locator('#marketing-layout #plans-layout #pricing')
					.count()
			).toBe(1);

			/* And every one of them is the server's own element. A chain
			 * composed differently on the client would have cost all three
			 * marks, the page's included. */
			expect(
				await page.evaluate(() =>
					['marketing-layout', 'plans-layout', 'pricing'].map((id) =>
						document
							.getElementById(id)
							?.hasAttribute('data-from-server')
					)
				)
			).toEqual([true, true, true]);

			// Interactive, so this is hydration rather than inert markup.
			await page.click('#pricing-clicks');
			await page.waitForFunction(
				() =>
					document
						.querySelector('#pricing-clicks')
						?.textContent?.trim() === 'clicks 1',
				undefined,
				{ timeout: 10_000 }
			);

			// A mismatch is reported through this path; there was none.
			expect(consoleMessages.join(' ')).not.toContain(
				'React recoverable error'
			);
		} finally {
			await session.close();
		}
	}, 300_000);
});
