import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { nonceAttr } from '../utils/cspNonceRef';
import { logWarn } from '../utils/logger';

/* The script tag Angular's event replay needs the HOST to provide.
 *
 * `provideClientHydration(withEventReplay())` makes the SSR render stamp
 * `jsaction` attributes on the elements it will replay events for, and
 * then `@angular/platform-server` looks for an element with this id in the
 * document it was handed (`findEventDispatchScript`). Finding one, it
 * inserts a sibling script calling `window.__jsaction_bootstrap(...)` with
 * the event types to listen for; finding none, it REMOVES the replay
 * machinery and the feature silently does nothing.
 *
 * So the contract script has to be in the document before Angular renders
 * into it, and its contents are Angular's own 476-byte
 * `event-dispatch-contract.min.js`, which defines `__jsaction_bootstrap`.
 * The Angular CLI injects this into index.html; a framework that builds
 * its own document shell has to do it here.
 *
 * Inlined rather than served as an asset: it has to run before anything
 * else on the page to catch the first tap, and one more blocking request
 * at the top of every Angular document would cost more than the bytes. */

const SCRIPT_ID = 'ng-event-dispatch-contract';
const CONTRACT_MODULE = '@angular/core/event-dispatch-contract.min.js';

let cached: string | null | undefined;

const loadContract = () => {
	if (cached !== undefined) return cached;
	try {
		const require = createRequire(import.meta.url);
		cached = readFileSync(require.resolve(CONTRACT_MODULE), 'utf8');
	} catch {
		/* An Angular install without the file (or a bundler that dropped
		 * it): replay is an enhancement, so the page renders without it
		 * rather than failing. Said once, because a silent downgrade is
		 * how this feature came to be missing in the first place. */
		logWarn(
			`Angular event replay is unavailable: ${CONTRACT_MODULE} could not be read, so clicks made before a page hydrates will not be replayed.`
		);
		cached = null;
	}

	return cached;
};

/** The `<script>` to put in an Angular document shell, or `''` when the
 *  contract script cannot be read. */
export const eventDispatchContractScript = () => {
	const contract = loadContract();
	if (contract === null) return '';

	return `<script id="${SCRIPT_ID}" type="text/javascript"${nonceAttr()}>${contract}</script>`;
};
