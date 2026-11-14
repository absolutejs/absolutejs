import { beforeAll, describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

/* The streaming slot components of every framework (Angular DeferSlot and
 * StreamSlot, Svelte StreamSlot, Vue slots) import the streaming-slot
 * registrar, which reads NODE_ENV through utils/runtimeMode. That code ends
 * up in browser bundles, where there is no `process`: beta.172 threw
 * `ReferenceError: process is not defined` while hydrating an Angular page
 * with `@defer`. Bundle both for the browser and run them in a context with
 * no `process` at all. */

const ENTRY = resolve(
	import.meta.dir,
	'..',
	'..',
	'fixtures',
	'runtime-mode',
	'browserEntry.ts'
);

let browserCode = '';

const runWithoutProcess = (call: string) => {
	const context: Record<string, unknown> = {};
	runInNewContext(`${browserCode}\nglobalThis.result = ${call};`, context);

	return context.result;
};

beforeAll(async () => {
	const result = await Bun.build({
		entrypoints: [ENTRY],
		format: 'iife',
		target: 'browser'
	});
	const [output] = result.outputs;
	if (!result.success || !output) {
		throw new Error('could not bundle the runtime-mode browser entry');
	}
	browserCode = await output.text();
});

describe('runtime mode in the browser', () => {
	test('the bundle has no process global to lean on', () => {
		expect(runInNewContext('typeof process', {})).toBe('undefined');
	});

	test('runtimeMode reads no NODE_ENV instead of throwing', () => {
		expect(
			runWithoutProcess(
				'[__exports.getNodeEnv(), __exports.isDevelopmentRuntime(), __exports.isProductionRuntime()]'
			)
		).toEqual([undefined, false, false]);
	});

	test('the missing-collector warning is a no-op in the browser', () => {
		expect(
			runWithoutProcess(
				'(__exports.warnMissingStreamingSlotCollector("DeferSlot"), "ok")'
			)
		).toBe('ok');
	});
});
