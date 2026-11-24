import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { startDevServer, type DevServer } from '../../../helpers/devServer';
import { mutateFile, restoreAllFiles } from '../../../helpers/file';
import { connectHMR, type HMRClient } from '../../../helpers/ws';

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..', '..', '..');
const STYLESHEET = resolve(
	PROJECT_ROOT,
	'example/styles/indexes/react-example.css'
);
const LINK = /href="([^"]*react-example\.[a-z0-9]{8}\.css)"/;

let server: DevServer;
let client: HMRClient;

afterEach(() => {
	restoreAllFiles();
});

afterAll(async () => {
	client?.close();
	await server?.kill();
});

/* A page rendered just before a stylesheet rebuild (a reload during an
 * edit) asks for the stylesheet by its previous hash. The rebuild removed
 * that file, and a 404 left the whole page unstyled. The dev server now
 * answers an old stylesheet hash with the current build of it. */
describe('a stylesheet asked for by a hash a rebuild replaced', () => {
	test('redirects to the current build instead of 404', async () => {
		server = await startDevServer();
		const before = await (await fetch(`${server.baseUrl}/react`)).text();
		const oldHref = before.match(LINK)?.[1];
		expect(oldHref).toBeTruthy();
		client = await connectHMR(server.port);
		await client.waitFor('manifest');
		await client.waitFor('connected');
		client.drain();

		mutateFile(
			STYLESHEET,
			(css) => `${css}\n.stale-hash-probe { color: rebeccapurple; }\n`
		);
		await client.waitFor('style-update', 30_000);

		const after = await (await fetch(`${server.baseUrl}/react`)).text();
		const newHref = after.match(LINK)?.[1];
		expect(newHref).toBeTruthy();
		expect(newHref).not.toBe(oldHref);

		const stale = await fetch(new URL(oldHref ?? '', server.baseUrl), {
			redirect: 'manual'
		});
		expect(stale.status).toBe(302);
		expect(stale.headers.get('location')).toBe(newHref ?? '');
		const followed = await fetch(new URL(oldHref ?? '', server.baseUrl));
		expect(followed.status).toBe(200);
		expect(await followed.text()).toContain('stale-hash-probe');
	}, 90_000);
});
