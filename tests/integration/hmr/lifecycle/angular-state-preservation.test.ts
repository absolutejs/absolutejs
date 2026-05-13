import { describe, expect, test, afterEach } from 'bun:test';
import { resolve } from 'node:path';
import { startDevServer, type DevServer } from '../../../helpers/devServer';
import { connectHMR, type HMRClient } from '../../../helpers/ws';
import { mutateFile, restoreAllFiles } from '../../../helpers/file';
import {
	openPage,
	type BrowserSession,
	waitForText
} from '../../../helpers/browser';

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..', '..', '..');

let server: DevServer | undefined;
let client: HMRClient | undefined;
let session: BrowserSession | undefined;

afterEach(async () => {
	if (session) {
		await session.close();
		session = undefined;
	}
	client?.close();
	client = undefined;
	if (server) {
		await server.kill();
		server = undefined;
	}
	restoreAllFiles();
});

const counterTemplate = resolve(
	PROJECT_ROOT,
	'example/angular/templates/counter.component.html'
);

const startAll = async () => {
	server = await startDevServer();
	client = await connectHMR(server.port);
	await client.waitFor('manifest');
	await client.waitFor('connected');
	client.drain();
	session = await openPage(`${server.baseUrl}/angular`);
	// Wait for Angular hydration to attach to the counter button.
	await waitForText(session.page, 'app-counter .counter-value', (t) =>
		/\d+/.test(t)
	);
	return { client: client!, server: server!, session: session! };
};

/* State preservation is the whole point of tier-0 surgical updates:
 * the user's interactive state (input contents, counter value,
 * scroll position, expanded panels, dropdown open state) must
 * survive a save. Angular's `ɵɵreplaceMetadata` swaps the component
 * definition in place — existing LViews keep their bindings to
 * existing class instances. The state lives on those instances, so
 * a body-only edit should leave the counter unchanged.
 *
 * Tier-1a remount and Tier-1b rebootstrap deliberately RESET state
 * (the existing host element is destroyed). We assert that
 * contract negatively in `angular-tiering.test.ts` (those tests
 * verify the tier broadcast; the user-visible effect is state loss,
 * which is acceptable for structural / public-API changes). */
describe('Angular state preservation across tier-0 surgical update', () => {
	test('counter value survives a template-only edit', async () => {
		const { client: c, session: s } = await startAll();

		// Click to count=7 — high enough that a reset-to-zero
		// outcome would be unambiguous.
		for (let i = 0; i < 7; i++) {
			await s.page.click('app-counter button');
		}
		await waitForText(
			s.page,
			'app-counter .counter-value',
			(t) => t.trim() === '7'
		);

		// Mutate the counter's template (cosmetic — `<button>` text
		// changes around the `<span>` value). This is a tier-0
		// edit; the dev server's log line will say tier-0.
		c.drain();
		mutateFile(counterTemplate, (text) =>
			text.replace('count is', 'tally is')
		);

		await c.waitFor('angular:component-update', 15_000);

		// Tier-0 surgical preserves the LView instance, so the
		// new "tally is" text is visible AND the counter value
		// stays at 7.
		await waitForText(s.page, 'app-counter button', (t) =>
			t.includes('tally is')
		);
		await waitForText(
			s.page,
			'app-counter .counter-value',
			(t) => t.trim() === '7'
		);
	}, 60_000);
});
