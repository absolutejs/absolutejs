import { describe, expect, test } from 'bun:test';
import { applyAngularHmrInjection } from '../../../src/dev/angular/hmrInjectionPlugin';

describe('Angular HMR client acknowledgement injection', () => {
	test('records the shared native apply contract before sending its tier ack', () => {
		const transformed = applyAngularHmrInjection(
			`let CounterComponent = class CounterComponent {};
CounterComponent = __legacyDecorateClassTS([Component({ selector: 'app-counter' })], CounterComponent);`,
			'/project/.absolutejs/generated/angular/components/counter.component.js',
			{
				generatedAngularRoot: '/project/.absolutejs/generated/angular',
				projectRoot: '/project',
				userAngularRoot: '/project/example/angular'
			}
		);

		expect(transformed).toContain(
			'globalThis.__ABS_HMR_LAST_APPLY__ = timing'
		);
		expect(transformed).toContain('globalThis.__ABS_HMR_APPLIES__');
		expect(transformed).toContain("kind: 'component'");
		expect(transformed).toContain("outcome: error ? 'failed' : 'applied'");
		expect(transformed).toContain('target,\n        updateId');
	});

	/* The injected block carried a second path, `__ng_hmr_remount`, for
	 * a per-component destroy-and-recreate. It never worked once: the
	 * lookup it relied on matched nothing because Angular annotates a
	 * host node with `lView[ID]`, a NUMBER, and only `getLContext`
	 * turns that into the object the lookup expected. It acked success
	 * regardless, so a structural edit silently did not appear.
	 *
	 * The tier is gone and those edits rebootstrap instead
	 * (docs/dev/angular-hmr-tiers.md). This guards the removal: the
	 * integration tests that were supposed to cover the tier asserted
	 * the broadcast MESSAGE, which passes whether or not the client can
	 * act on it — so re-adding the path must come with a test that
	 * asserts the page after the edit, not the message. */
	test('injects no per-component remount path', () => {
		const transformed = applyAngularHmrInjection(
			`let CounterComponent = class CounterComponent {};
CounterComponent = __legacyDecorateClassTS([Component({ selector: 'app-counter' })], CounterComponent);`,
			'/project/.absolutejs/generated/angular/components/counter.component.js',
			{
				generatedAngularRoot: '/project/.absolutejs/generated/angular',
				projectRoot: '/project',
				userAngularRoot: '/project/example/angular'
			}
		);

		expect(transformed).not.toContain('__ng_hmr_remount');
		expect(transformed).not.toContain('__absAngularRemount');
		expect(transformed).not.toContain('angular:component-remount');
		expect(transformed).not.toContain('tier-1a');

		// the surgical path it kept
		expect(transformed).toContain('angular:component-update');
		expect(transformed).toContain("__ng_hmr_ack('tier-0'");
	});
});
