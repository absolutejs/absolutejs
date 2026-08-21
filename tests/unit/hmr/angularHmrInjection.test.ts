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
});
