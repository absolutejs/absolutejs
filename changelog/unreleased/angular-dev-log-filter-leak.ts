import type { Change } from '@absolutejs/changelog';
import type * as Api from '../../src/index';

export const change: Change<typeof Api> = {
	detail:
		'Angular logs "Angular is running in development mode." on every ' +
		'`bootstrapApplication`, which on a server is once per request, so ' +
		'the SSR renderer filtered it by saving `console.log`, replacing ' +
		'it, and restoring it in a `finally` — around each render. Under ' +
		'concurrency that leaks: each render captures whatever is ' +
		'installed when IT starts and reinstalls that when IT finishes, so ' +
		'the last render to finish wins and a wrapper is left behind. One ' +
		'accumulates per round of concurrent renders, and every ' +
		'`console.log` anywhere in the process then walks the whole chain. ' +
		'Measured with eight concurrent renders completing in start order: ' +
		'after 60 rounds — 480 renders, a few seconds of traffic — 20,000 ' +
		'`console.log` calls went from 0.3ms to 79.7ms, a 240x ' +
		'degradation that keeps climbing, and a message containing the ' +
		'filtered phrase was swallowed for the life of the process. The ' +
		'accumulation does not depend on anything logging during a render; ' +
		'the install and restore were unconditional, so a production ' +
		'server rendering Angular pages concurrently made all of its own ' +
		'logging progressively slower. The filter is now installed once, ' +
		'with a counter marking whether a render is in flight: nothing ' +
		'nests, nothing accumulates, and it is only active while rendering ' +
		"rather than forever. It is also narrowed to Angular's own " +
		'wording, so an application line that merely shares the phrase is ' +
		'no longer hidden. This does not change render throughput — ' +
		'measured at 4,138 req/s against 3,960-4,401 before, which is the ' +
		'same noise band. Angular SSR costs a full application bootstrap ' +
		'per request and that is where its time goes.',
	kind: 'fixed',
	summary:
		'the Angular SSR dev-log filter no longer leaks a console.log wrapper per render'
};
