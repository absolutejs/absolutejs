/* Replays the recorder's event log into per-module cost.
 *
 * Getting this wrong is exactly the failure the diagnostic exists to avoid: a
 * naive "time the import" measurement charges the first importer of a large
 * shared subgraph for the whole subgraph, and then recommends deferring an
 * import that would move the cost rather than remove it.
 *
 * Two costs are separated, because Bun does them in two phases. It loads and
 * parses a whole graph first (every `loadStart`/`loadEnd` pair arrives before
 * the first `enter`), then evaluates it depth-first:
 *
 * - **parse** — the gap between one module's `loadEnd` and the next module's
 *   `loadStart` is Bun parsing that module and resolving its imports. The
 *   plugin's own read-and-rewrite sits between `loadStart` and `loadEnd` and
 *   is charged to nobody, so instrumentation overhead never inflates a saving.
 * - **evaluation** — the gap between a module's `enter` and `exit`, minus any
 *   nested spans. In ESM that is already exclusive of static children: a
 *   module's body does not start until everything it imports has finished.
 *   CommonJS nests instead, and dynamic imports awaited inside a body nest
 *   too; the stack subtracts both.
 *
 * Everything that happens while no module is open and nothing is being parsed
 * — uninstrumented CommonJS dependencies, native modules, the framework's
 * concurrent boot build — lands on whichever module's body is open, which
 * during the entry's evaluation is the process root. The report prints that as
 * unattributed rather than crediting it to one of the entry's imports.
 *
 * Two honesty counters come back with the numbers:
 * - `incomplete`: modules whose exit call never ran (a CommonJS top-level
 *   `return`, or a module that threw).
 * - `interleaved`: exits that arrived out of order, which is what top-level
 *   `await` looks like. */

import { IMPORT_COST_EVENT, IMPORT_COST_EVENT_KINDS } from './recorder';

export type SelfTimes = {
	evalMs: number[];
	/** Timestamp of each module's first enter, or `NaN` if it never ran. */
	firstEnterMs: number[];
	incomplete: number[];
	interleaved: number;
	/** Time spent inside the plugin's own read-and-rewrite, charged to nobody. */
	overheadMs: number;
	/** Time with no module open and nothing being parsed: uninstrumented
	 *  CommonJS dependencies, native modules, and the dev server's own
	 *  concurrent work. Deliberately credited to no import. */
	unownedMs: number;
	parseMs: number[];
	/** Modules' own parse plus evaluation, exclusive of their children. */
	selfMs: number[];
};

type ReplayState = {
	evalMs: number[];
	firstEnterMs: number[];
	inCallback: boolean;
	interleaved: number;
	overheadMs: number;
	parseMs: number[];
	pendingParse: number;
	previousMs: number;
	stack: number[];
	unownedMs: number;
};

const EVENT_STRIDE = 2;
const NONE = -1;

const add = (into: number[], index: number, amount: number) => {
	into[index] = (into[index] ?? 0) + amount;
};

const charge = (state: ReplayState, timeMs: number) => {
	const elapsed = timeMs - state.previousMs;
	state.previousMs = timeMs;
	if (state.inCallback) {
		state.overheadMs += elapsed;

		return;
	}
	if (state.pendingParse !== NONE) {
		add(state.parseMs, state.pendingParse, elapsed);

		return;
	}
	const top = state.stack[state.stack.length - 1];
	if (top === undefined) {
		state.unownedMs += elapsed;

		return;
	}
	add(state.evalMs, top, elapsed);
};

const enterModule = (
	state: ReplayState,
	moduleIndex: number,
	timeMs: number
) => {
	state.pendingParse = NONE;
	state.stack.push(moduleIndex);
	if (Number.isNaN(state.firstEnterMs[moduleIndex] ?? Number.NaN)) {
		state.firstEnterMs[moduleIndex] = timeMs;
	}
};

const exitModule = (state: ReplayState, moduleIndex: number) => {
	const position = state.stack.lastIndexOf(moduleIndex);
	if (position === NONE) {
		state.interleaved += 1;

		return;
	}
	if (position !== state.stack.length - 1) state.interleaved += 1;
	state.stack.length = position;
};

const applyEvent = (
	state: ReplayState,
	kind: number,
	moduleIndex: number,
	timeMs: number
) => {
	if (kind === IMPORT_COST_EVENT.loadStart) state.inCallback = true;
	else if (kind === IMPORT_COST_EVENT.loadEnd) {
		state.inCallback = false;
		state.pendingParse = moduleIndex;
	} else if (kind === IMPORT_COST_EVENT.enter) {
		enterModule(state, moduleIndex, timeMs);
	} else exitModule(state, moduleIndex);
};

export const computeSelfTimes = (
	events: readonly number[],
	moduleCount: number
) => {
	const state: ReplayState = {
		evalMs: new Array<number>(moduleCount).fill(0),
		firstEnterMs: new Array<number>(moduleCount).fill(Number.NaN),
		inCallback: false,
		interleaved: 0,
		overheadMs: 0,
		parseMs: new Array<number>(moduleCount).fill(0),
		pendingParse: NONE,
		previousMs: events[1] ?? 0,
		stack: [],
		unownedMs: 0
	};
	for (let cursor = 0; cursor + 1 < events.length; cursor += EVENT_STRIDE) {
		const code = events[cursor];
		const timeMs = events[cursor + 1];
		if (code === undefined || timeMs === undefined) break;
		charge(state, timeMs);
		applyEvent(
			state,
			code % IMPORT_COST_EVENT_KINDS,
			Math.floor(code / IMPORT_COST_EVENT_KINDS),
			timeMs
		);
	}
	const result: SelfTimes = {
		evalMs: state.evalMs,
		firstEnterMs: state.firstEnterMs,
		incomplete: [...new Set(state.stack)],
		interleaved: state.interleaved,
		overheadMs: state.overheadMs,
		parseMs: state.parseMs,
		selfMs: state.evalMs.map(
			(value, index) => value + (state.parseMs[index] ?? 0)
		),
		unownedMs: state.unownedMs
	};

	return result;
};
