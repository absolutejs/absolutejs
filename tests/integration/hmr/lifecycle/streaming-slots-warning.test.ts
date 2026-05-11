import { describe, expect, test, afterEach } from 'bun:test';
import { resolve } from 'node:path';
import { startDevServer, type DevServer } from '../../../helpers/devServer';
import { mutateFile, restoreAllFiles } from '../../../helpers/file';

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..', '..', '..');

let server: DevServer | undefined;

afterEach(async () => {
	if (server) {
		await server.kill();
		server = undefined;
	}
	restoreAllFiles();
});

const STREAM_SLOT_IMPORT =
	"import StreamSlot from '../../../src/svelte/components/StreamSlot.svelte';";
const STREAM_SLOT_WARNING_PATTERN =
	/StreamSlot rendered during SSR without streaming slot collection enabled/;

const insertStreamSlot = (svelteSource: string, slotId: string) =>
	svelteSource
		.replace(
			"import Counter from '../components/Counter.svelte';",
			`import Counter from '../components/Counter.svelte';\n\t${STREAM_SLOT_IMPORT}`
		)
		.replace(
			'<Counter {initialCount} />',
			`<Counter {initialCount} />\n\t<StreamSlot\n\t\tid="${slotId}"\n\t\tfallbackHtml="<span>STREAM_FALLBACK</span>"\n\t\tresolve={() => '<span>STREAM_RESOLVED</span>'}\n\t/>`
		);

/* `<StreamSlot>` (Svelte) primes the streaming-slot registrar on
 * SSR. If the page handler doesn't opt-in via `collectStreamingSlots:
 * true`, `warnMissingStreamingSlotCollector` calls `logWarn` with a
 * message telling the user to add the option. Setting it enables
 * collection — the warning is silenced and the slot's fallback
 * HTML is streamed as-is.
 *
 * Two-test pairing:
 *   1. Without the option → warning logged on stdout exactly once.
 *   2. With the option → no warning appears on stdout for the same
 *      page over two render passes. (Asserting absence — the
 *      warning is emitted synchronously inside the same render pass
 *      that produces the response body, so by the time `fetch`
 *      resolves the message would already be in the stdout buffer
 *      if it were going to fire.) */
describe('collectStreamingSlots option silences the streaming-slot warning', () => {
	test(
		'warning fires when handler omits `collectStreamingSlots`',
		async () => {
			const page = resolve(
				PROJECT_ROOT,
				'example/svelte/pages/SvelteExample.svelte'
			);
			mutateFile(page, (c) => insertStreamSlot(c, 'stream-warn-test'));

			server = await startDevServer();
			await (await fetch(`${server.baseUrl}/svelte`)).text();
			await server.waitForOutput(STREAM_SLOT_WARNING_PATTERN);
		},
		30_000
	);

	test(
		'warning is silenced when handler passes `collectStreamingSlots: true`',
		async () => {
			const page = resolve(
				PROJECT_ROOT,
				'example/svelte/pages/SvelteExample.svelte'
			);
			const serverEntry = resolve(PROJECT_ROOT, 'example/server.ts');
			mutateFile(page, (c) => insertStreamSlot(c, 'stream-ok-test'));
			mutateFile(serverEntry, (c) =>
				c.replace(
					'handleSveltePageRequest<typeof SvelteExample>({',
					'handleSveltePageRequest<typeof SvelteExample>({\n\t\t\tcollectStreamingSlots: true,'
				)
			);

			server = await startDevServer();
			await (await fetch(`${server.baseUrl}/svelte`)).text();
			await (await fetch(`${server.baseUrl}/svelte`)).text();
			// Allow any pending microtasks to drain before the
			// absence check (the warning would be emitted synchronously
			// inside SSR, but stream pumping straddles event-loop
			// ticks; one tick is enough to flush stdout writes).
			await new Promise<void>((tick) => setImmediate(tick));

			const sawWarning = server.outputLines.some((line) =>
				STREAM_SLOT_WARNING_PATTERN.test(line)
			);
			expect(sawWarning).toBe(false);
		},
		30_000
	);
});
